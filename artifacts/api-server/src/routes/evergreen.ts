import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  evergreenProposalsTable,
  evergreenSettingsTable,
  scheduledPostsTable,
  type ScheduledPost,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import {
  DEFAULT_EVERGREEN_SETTINGS,
  EVERGREEN_NOT_READY,
  buildEvergreenProposals,
  evergreenSkipReason,
  isMissingEvergreenTable,
  normalizeEvergreenSettings,
  type EvergreenCandidateInput,
  type EvergreenSettings,
} from "../lib/evergreen";

/* ─── Evergreen recycling (Wave-4 #48) ────────────────────────────────────
   Docked in the Scheduler: the house re-surfaces a creator's own back
   catalog as PROPOSALS inside the creator's windows. It never posts.

   GET  /api/evergreen/settings        my settings (defaults when unset)
   PUT  /api/evergreen/settings        save on/off, windows, spacing, cap
   GET  /api/evergreen/candidates      my posted back catalog + why each
                                       post is / isn't ready to resurface
   POST /api/evergreen/proposals/generate   build proposals (free)
   GET  /api/evergreen/proposals       my proposals
   POST /api/evergreen/proposals/:id/approve  → creates a FREE scheduled-
                                       post DRAFT; the creator still
                                       schedules it themselves
   POST /api/evergreen/proposals/:id/reject   decline the resurfacing

   Tables come from provisional migration 9999-wave4850. Writes answer
   an honest 503 (EVERGREEN_NOT_READY) until it lands; reads degrade to
   defaults / empty lists. Money: none anywhere in this router. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const settingsSchema = z.object({
  enabled: z.boolean(),
  windows: z.object({
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    timezone: z.string().min(1).max(60),
  }),
  baseSpacingDays: z.number().int().min(1).max(90),
  maxCycles: z.number().int().min(1).max(6),
});

function notReady(res: Response) {
  return res.status(503).json(EVERGREEN_NOT_READY);
}

function settingsDto(s: EvergreenSettings) {
  return {
    enabled: s.enabled,
    windows: s.windows,
    base_spacing_days: s.baseSpacingDays,
    max_cycles: s.maxCycles,
  };
}

async function loadSettings(userId: string): Promise<EvergreenSettings> {
  try {
    const rows = await db
      .select()
      .from(evergreenSettingsTable)
      .where(eq(evergreenSettingsTable.user_id, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return DEFAULT_EVERGREEN_SETTINGS;
    return {
      enabled: row.enabled,
      windows: row.windows,
      baseSpacingDays: row.base_spacing_days,
      maxCycles: row.max_cycles,
    };
  } catch (err) {
    if (isMissingEvergreenTable(err)) return DEFAULT_EVERGREEN_SETTINGS;
    throw err;
  }
}

interface CycleFacts {
  cyclesUsed: Map<string, number>;
  lastRecycledAt: Map<string, Date>;
  pending: Set<string>;
}

/** Cycle facts from the proposal ledger: cyclesUsed = approved
 *  proposals; lastRecycledAt = their latest proposed slot. */
async function loadCycleFacts(userId: string, postIds: string[]): Promise<CycleFacts> {
  const facts: CycleFacts = { cyclesUsed: new Map(), lastRecycledAt: new Map(), pending: new Set() };
  if (postIds.length === 0) return facts;
  try {
    const rows = await db
      .select()
      .from(evergreenProposalsTable)
      .where(and(eq(evergreenProposalsTable.user_id, userId), inArray(evergreenProposalsTable.source_post_id, postIds)));
    for (const r of rows) {
      if (r.status === "approved") {
        facts.cyclesUsed.set(r.source_post_id, (facts.cyclesUsed.get(r.source_post_id) ?? 0) + 1);
        const prev = facts.lastRecycledAt.get(r.source_post_id);
        if (!prev || r.proposed_slot > prev) facts.lastRecycledAt.set(r.source_post_id, r.proposed_slot);
      } else if (r.status === "pending_approval") {
        facts.pending.add(r.source_post_id);
      }
    }
  } catch (err) {
    if (!isMissingEvergreenTable(err)) throw err;
  }
  return facts;
}

async function loadMyPostedPosts(userId: string): Promise<ScheduledPost[]> {
  return db
    .select()
    .from(scheduledPostsTable)
    .where(and(eq(scheduledPostsTable.user_id, userId), eq(scheduledPostsTable.status, "posted")))
    .orderBy(desc(scheduledPostsTable.posted_at))
    .limit(200);
}

function candidateInput(post: ScheduledPost, facts: CycleFacts): EvergreenCandidateInput {
  return {
    postId: post.id,
    status: post.status,
    postedAt: post.posted_at,
    platforms: post.platforms ?? [],
    cyclesUsed: facts.cyclesUsed.get(post.id) ?? 0,
    lastRecycledAt: facts.lastRecycledAt.get(post.id) ?? null,
    hasPendingProposal: facts.pending.has(post.id),
  };
}

function proposalDto(r: typeof evergreenProposalsTable.$inferSelect) {
  return {
    id: r.id,
    source_post_id: r.source_post_id,
    cycle: r.cycle,
    proposed_slot: r.proposed_slot.toISOString(),
    status: r.status,
    draft_post_id: r.draft_post_id ?? null,
    created_at: r.created_at.toISOString(),
  };
}

/* ── Settings ─────────────────────────────────────────────────────────── */

router.get("/evergreen/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    return res.json({ settings: settingsDto(await loadSettings(req.userId!)), defaults: settingsDto(DEFAULT_EVERGREEN_SETTINGS) });
  } catch (err) {
    logger.error({ err }, "[evergreen] settings read failed");
    return res.status(500).json({ error: "evergreen_failed", message: "Couldn't load your evergreen settings." });
  }
});

router.put("/evergreen/settings", requireAuth, async (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_settings", message: parsed.error.issues[0]?.message ?? "Invalid settings." });
  }
  const normalized = normalizeEvergreenSettings(parsed.data);
  if ("error" in normalized) return res.status(400).json({ error: "invalid_settings", message: normalized.error });
  const s = normalized.settings;
  try {
    const now = new Date();
    await db
      .insert(evergreenSettingsTable)
      .values({
        user_id: req.userId!,
        enabled: s.enabled,
        windows: s.windows,
        base_spacing_days: s.baseSpacingDays,
        max_cycles: s.maxCycles,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: evergreenSettingsTable.user_id,
        set: { enabled: s.enabled, windows: s.windows, base_spacing_days: s.baseSpacingDays, max_cycles: s.maxCycles, updated_at: now },
      });
    return res.json({ settings: settingsDto(s) });
  } catch (err) {
    if (isMissingEvergreenTable(err)) return notReady(res);
    logger.error({ err }, "[evergreen] settings save failed");
    return res.status(500).json({ error: "evergreen_failed", message: "Couldn't save your evergreen settings." });
  }
});

/* ── Candidates ───────────────────────────────────────────────────────── */

router.get("/evergreen/candidates", requireAuth, async (req: Request, res: Response) => {
  try {
    const settings = await loadSettings(req.userId!);
    const posts = await loadMyPostedPosts(req.userId!);
    const facts = await loadCycleFacts(req.userId!, posts.map((p) => p.id));
    const now = new Date();
    return res.json({
      enabled: settings.enabled,
      candidates: posts.map((p) => {
        const input = candidateInput(p, facts);
        return {
          post_id: p.id,
          caption: p.caption,
          media_url: p.media_url,
          media_type: p.media_type,
          platforms: p.platforms ?? [],
          posted_at: p.posted_at ? p.posted_at.toISOString() : null,
          cycles_used: input.cyclesUsed,
          max_cycles: settings.maxCycles,
          skip_reason: evergreenSkipReason(input, settings, now),
        };
      }),
    });
  } catch (err) {
    logger.error({ err }, "[evergreen] candidates failed");
    return res.status(500).json({ error: "evergreen_failed", message: "Couldn't load your back catalog." });
  }
});

/* ── Proposals ────────────────────────────────────────────────────────── */

router.post("/evergreen/proposals/generate", requireAuth, async (req: Request, res: Response) => {
  try {
    const settings = await loadSettings(req.userId!);
    if (!settings.enabled) {
      return res.status(409).json({
        error: "evergreen_off",
        message: "Evergreen is off. Turn it on in your evergreen settings before generating proposals.",
      });
    }
    const posts = await loadMyPostedPosts(req.userId!);
    const facts = await loadCycleFacts(req.userId!, posts.map((p) => p.id));
    const now = new Date();
    const { proposals, skipped } = buildEvergreenProposals(posts.map((p) => candidateInput(p, facts)), settings, now);
    const created = [];
    for (const draft of proposals) {
      const rows = await db
        .insert(evergreenProposalsTable)
        .values({
          user_id: req.userId!,
          source_post_id: draft.sourcePostId,
          cycle: draft.cycle,
          proposed_slot: draft.proposedSlot,
          status: "pending_approval",
        })
        .returning();
      if (rows[0]) created.push(proposalDto(rows[0]));
    }
    return res.json({ proposals: created, skipped });
  } catch (err) {
    if (isMissingEvergreenTable(err)) return notReady(res);
    logger.error({ err }, "[evergreen] generate failed");
    return res.status(500).json({ error: "evergreen_failed", message: "Couldn't generate evergreen proposals." });
  }
});

router.get("/evergreen/proposals", requireAuth, async (req: Request, res: Response) => {
  try {
    let rows: Array<typeof evergreenProposalsTable.$inferSelect> = [];
    try {
      rows = await db
        .select()
        .from(evergreenProposalsTable)
        .where(eq(evergreenProposalsTable.user_id, req.userId!))
        .orderBy(desc(evergreenProposalsTable.created_at))
        .limit(100);
    } catch (err) {
      if (!isMissingEvergreenTable(err)) throw err;
    }
    const postIds = [...new Set(rows.map((r) => r.source_post_id))];
    const posts = postIds.length
      ? await db.select().from(scheduledPostsTable).where(inArray(scheduledPostsTable.id, postIds))
      : [];
    const byId = new Map(posts.map((p) => [p.id, p]));
    return res.json({
      proposals: rows.map((r) => {
        const src = byId.get(r.source_post_id);
        return {
          ...proposalDto(r),
          source_caption: src?.caption ?? "",
          source_media_url: src?.media_url ?? null,
          source_platforms: src?.platforms ?? [],
        };
      }),
    });
  } catch (err) {
    logger.error({ err }, "[evergreen] proposals list failed");
    return res.status(500).json({ error: "evergreen_failed", message: "Couldn't load your evergreen proposals." });
  }
});

/* Approve → a FREE draft in the Scheduler carrying the proposed slot.
   The draft cannot fire on its own (the scheduler worker only claims
   `scheduled` rows); the creator reviews it and presses Schedule
   themselves — evergreen is never the last hand on a post. */
router.post("/evergreen/proposals/:id/approve", requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params["id"] ?? "");
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    let proposal: typeof evergreenProposalsTable.$inferSelect | undefined;
    try {
      const rows = await db
        .select()
        .from(evergreenProposalsTable)
        .where(and(eq(evergreenProposalsTable.id, id), eq(evergreenProposalsTable.user_id, req.userId!)))
        .limit(1);
      proposal = rows[0];
    } catch (err) {
      if (isMissingEvergreenTable(err)) return notReady(res);
      throw err;
    }
    if (!proposal) return res.status(404).json({ error: "not_found", message: "That proposal doesn't exist." });
    if (proposal.status !== "pending_approval") {
      return res.status(409).json({ error: "already_decided", message: "That proposal was already decided." });
    }
    const srcRows = await db
      .select()
      .from(scheduledPostsTable)
      .where(and(eq(scheduledPostsTable.id, proposal.source_post_id), eq(scheduledPostsTable.user_id, req.userId!)))
      .limit(1);
    const src = srcRows[0];
    if (!src) return res.status(404).json({ error: "source_gone", message: "The original post is no longer in your catalog." });

    const draftRows = await db
      .insert(scheduledPostsTable)
      .values({
        user_id: req.userId!,
        status: "draft",
        media_url: src.media_url,
        media_type: src.media_type,
        caption: src.caption,
        hashtags: src.hashtags,
        platforms: src.platforms ?? [],
        account_ids: src.account_ids ?? {},
        scheduled_at: proposal.proposed_slot,
        release_id: src.release_id ?? null,
        provenance: src.provenance ?? null,
      })
      .returning();
    const draft = draftRows[0]!;

    const now = new Date();
    await db
      .update(evergreenProposalsTable)
      .set({ status: "approved", draft_post_id: draft.id, decided_at: now, updated_at: now })
      .where(eq(evergreenProposalsTable.id, id));
    return res.json({
      proposal: proposalDto({ ...proposal, status: "approved", draft_post_id: draft.id, decided_at: now }),
      draft_post_id: draft.id,
    });
  } catch (err) {
    if (isMissingEvergreenTable(err)) return notReady(res);
    logger.error({ err }, "[evergreen] approve failed");
    return res.status(500).json({ error: "evergreen_failed", message: "Couldn't approve that proposal." });
  }
});

router.post("/evergreen/proposals/:id/reject", requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params["id"] ?? "");
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    let proposal: typeof evergreenProposalsTable.$inferSelect | undefined;
    try {
      const rows = await db
        .select()
        .from(evergreenProposalsTable)
        .where(and(eq(evergreenProposalsTable.id, id), eq(evergreenProposalsTable.user_id, req.userId!)))
        .limit(1);
      proposal = rows[0];
    } catch (err) {
      if (isMissingEvergreenTable(err)) return notReady(res);
      throw err;
    }
    if (!proposal) return res.status(404).json({ error: "not_found", message: "That proposal doesn't exist." });
    if (proposal.status !== "pending_approval") {
      return res.status(409).json({ error: "already_decided", message: "That proposal was already decided." });
    }
    const now = new Date();
    await db
      .update(evergreenProposalsTable)
      .set({ status: "rejected", decided_at: now, updated_at: now })
      .where(eq(evergreenProposalsTable.id, id));
    return res.json({ proposal: proposalDto({ ...proposal, status: "rejected", decided_at: now }) });
  } catch (err) {
    if (isMissingEvergreenTable(err)) return notReady(res);
    logger.error({ err }, "[evergreen] reject failed");
    return res.status(500).json({ error: "evergreen_failed", message: "Couldn't reject that proposal." });
  }
});

export default router;
