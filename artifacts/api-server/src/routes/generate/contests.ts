import { Router } from "express";
import { randomUUID, createHash } from "crypto";
import { z } from "zod";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { db, contestsTable, contestEntriesTable } from "@workspace/db";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, LedgerWriteError } from "../../lib/credits";
import { getOpenAI } from "../../lib/ai-clients";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
  normalizeToStorageRef,
} from "../../lib/objectStorage";

const router = Router();

/* ─── Fan Contests ──────────────────────────────────────────────────────
   Creators run giveaways: prize, rules, entry methods (follow / comment /
   share / purchase), an entry-tracking dashboard, a provably-fair winner
   draw (seeded random + audit log), and an AI winner-announcement graphic.

   Money model: contests are FREE to run — building a contest, tracking
   entries, verifying entries, and drawing the winner are pure interface
   (no compute, no API cost), so they charge nothing. Only the AI
   announcement graphic burns GPU, so only it charges (1 credit). */

/** Site credits per AI winner-announcement graphic. Env-overridable. */
export const CONTEST_ANNOUNCE_CREDIT_COST =
  Number(process.env["CONTEST_ANNOUNCE_CREDITS"]) || 1;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL"] || "gpt-image-2.5";

/** Draw algorithm version — bumped if the draw procedure ever changes. */
export const DRAW_ALGORITHM = "fan-contests-draw-v1";

export const ENTRY_METHODS = ["follow", "comment", "share", "purchase"] as const;
export type EntryMethod = (typeof ENTRY_METHODS)[number];

export const ENTRY_METHOD_LABELS: Record<EntryMethod, string> = {
  follow: "Follow",
  comment: "Comment",
  share: "Share",
  purchase: "Purchase",
};

export const CONTEST_STATUSES = ["draft", "active", "ended"] as const;

/* ─── Pure helpers (unit-tested) ──────────────────────────────────────── */

/**
 * Builds the provably-fair draw seed.
 * sha256(contestId | sorted entry ids | drawnAt ISO) — deterministic, and
 * anyone with the audit log can recompute it.
 */
export function buildDrawSeed(
  contestId: string,
  sortedEntryIds: string[],
  drawnAtIso: string,
): string {
  return createHash("sha256")
    .update([contestId, ...sortedEntryIds, drawnAtIso].join("|"), "utf8")
    .digest("hex");
}

/**
 * mulberry32 — a small, deterministic PRNG. Seeded from the first 8 hex
 * chars of the draw seed. Deterministic across runtimes (pure integer math).
 */
export function mulberry32(seedHex: string): () => number {
  let a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DrawResult {
  winnerEntryId: string;
  winnerIndex: number;
  seed: string;
  entryCount: number;
}

/**
 * Picks the winner from a deterministically-ordered entry id list.
 * Throws when there are no entries. Pure — the same inputs always produce
 * the same winner, which is what makes the draw verifiable.
 */
export function pickWinner(sortedEntryIds: string[], seed: string): DrawResult {
  if (sortedEntryIds.length === 0) {
    throw new Error("Cannot draw a winner: no verified entries");
  }
  const rand = mulberry32(seed);
  const winnerIndex = Math.floor(rand() * sortedEntryIds.length);
  return {
    winnerEntryId: sortedEntryIds[winnerIndex]!,
    winnerIndex,
    seed,
    entryCount: sortedEntryIds.length,
  };
}

export interface DrawAudit {
  algorithm: string;
  seed: string;
  entryCount: number;
  entryIds: string[];
  winnerEntryId: string;
  winnerIndex: number;
  drawnAt: string;
  drawnBy: string;
}

/**
 * Re-runs a draw from a stored audit payload and returns whether the
 * recorded winner matches a fresh computation. Pure — used by tests and
 * by anyone verifying a draw.
 */
export function verifyDrawAudit(audit: DrawAudit): boolean {
  const recomputedSeed = buildDrawSeed(
    (audit as { contestId?: string }).contestId ?? "",
    audit.entryIds,
    audit.drawnAt,
  );
  if (recomputedSeed !== audit.seed) return false;
  const result = pickWinner(audit.entryIds, audit.seed);
  return (
    result.winnerEntryId === audit.winnerEntryId &&
    result.winnerIndex === audit.winnerIndex
  );
}

/**
 * Fraud-prevention helper: an entry is a duplicate when the same handle
 * already entered via the same method (case-insensitive handle match).
 * Pure — unit-tested.
 */
export function isDuplicateEntry(
  existing: Array<{ handle: string; entry_method: string }>,
  handle: string,
  entryMethod: string,
): boolean {
  const norm = handle.trim().toLowerCase();
  return existing.some(
    (e) =>
      e.handle.trim().toLowerCase() === norm &&
      e.entry_method === entryMethod,
  );
}

/* ─── Validation schemas ─────────────────────────────────────────────── */

const createContestSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(120),
  prize: z.string().trim().min(1, "prize is required").max(200),
  description: z.string().trim().max(2000).default(""),
  rules: z.string().trim().max(4000).default(""),
  entryMethods: z
    .array(z.enum(ENTRY_METHODS))
    .min(1, "pick at least one entry method")
    .max(4),
  startsAt: z.string().datetime({ offset: true }).optional().nullable(),
  endsAt: z.string().datetime({ offset: true }).optional().nullable(),
  status: z.enum(CONTEST_STATUSES).default("draft"),
});

const addEntrySchema = z.object({
  handle: z.string().trim().min(1, "handle is required").max(80),
  email: z.string().trim().email().max(200).optional().nullable(),
  entryMethod: z.enum(ENTRY_METHODS),
});

type AuthedRequest = Parameters<Parameters<typeof router.post>[1]>[0] & {
  userId?: string;
  userCredits?: number;
};

/** Express 5 types params as string | string[] — contests use single segments. */
function param(req: { params: Record<string, string | string[] | undefined> }, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function loadContestForUser(contestId: string, userId: string) {
  const rows = await db
    .select()
    .from(contestsTable)
    .where(and(eq(contestsTable.id, contestId), eq(contestsTable.user_id, userId)))
    .limit(1);
  return rows[0] ?? null;
}

function toContestJson(c: typeof contestsTable.$inferSelect) {
  return {
    id: c.id,
    title: c.title,
    prize: c.prize,
    description: c.description,
    rules: c.rules,
    entryMethods: c.entry_methods,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    status: c.status,
    winnerEntryId: c.winner_entry_id,
    drawAudit: c.draw_audit,
    announcementImageUrl: c.announcement_image_url,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

/* ─────────────────────────────────────────────────────────────────────
   GET /api/contests — list the caller's contests (free).
────────────────────────────────────────────────────────────────────── */
router.get("/contests", requireAuth, async (req, res) => {
  const r = req as AuthedRequest;
  const rows = await db
    .select()
    .from(contestsTable)
    .where(eq(contestsTable.user_id, r.userId!))
    .orderBy(desc(contestsTable.created_at));
  const withCounts = await Promise.all(
    rows.map(async (c) => {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(contestEntriesTable)
        .where(eq(contestEntriesTable.contest_id, c.id));
      return { ...toContestJson(c), entryCount: count };
    }),
  );
  res.json({ contests: withCounts });
});

/* ─────────────────────────────────────────────────────────────────────
   POST /api/contests — create a contest (free).
────────────────────────────────────────────────────────────────────── */
router.post("/contests", requireAuth, async (req, res) => {
  const r = req as AuthedRequest;
  const parsed = createContestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid contest" });
    return;
  }
  const b = parsed.data;
  if (b.startsAt && b.endsAt && new Date(b.endsAt) <= new Date(b.startsAt)) {
    res.status(400).json({ error: "endsAt must be after startsAt" });
    return;
  }
  const [row] = await db
    .insert(contestsTable)
    .values({
      user_id: r.userId!,
      title: b.title,
      prize: b.prize,
      description: b.description,
      rules: b.rules,
      entry_methods: [...b.entryMethods],
      starts_at: b.startsAt ? new Date(b.startsAt) : null,
      ends_at: b.endsAt ? new Date(b.endsAt) : null,
      status: b.status,
    })
    .returning();
  res.status(201).json({ contest: toContestJson(row!) });
});

/* ─────────────────────────────────────────────────────────────────────
   GET /api/contests/:id — contest detail + entries (free).
────────────────────────────────────────────────────────────────────── */
router.get("/contests/:id", requireAuth, async (req, res) => {
  const r = req as AuthedRequest;
  const contest = await loadContestForUser(param(req, "id"), r.userId!);
  if (!contest) {
    res.status(404).json({ error: "Contest not found" });
    return;
  }
  const entries = await db
    .select()
    .from(contestEntriesTable)
    .where(eq(contestEntriesTable.contest_id, contest.id))
    .orderBy(asc(contestEntriesTable.created_at));
  const byMethod: Record<string, number> = {};
  let verified = 0;
  for (const e of entries) {
    byMethod[e.entry_method] = (byMethod[e.entry_method] ?? 0) + 1;
    if (e.is_verified) verified += 1;
  }
  res.json({
    contest: toContestJson(contest),
    entries,
    stats: { total: entries.length, verified, byMethod },
  });
});

/* ─────────────────────────────────────────────────────────────────────
   POST /api/contests/:id/entries — add an entry (free).
   Fraud prevention: same handle + same method = duplicate (409).
────────────────────────────────────────────────────────────────────── */
router.post("/contests/:id/entries", requireAuth, async (req, res) => {
  const r = req as AuthedRequest;
  const contest = await loadContestForUser(param(req, "id"), r.userId!);
  if (!contest) {
    res.status(404).json({ error: "Contest not found" });
    return;
  }
  if (contest.status === "ended") {
    res.status(400).json({ error: "This contest has ended — entries are closed" });
    return;
  }
  const parsed = addEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" });
    return;
  }
  const { handle, email, entryMethod } = parsed.data;
  if (!(contest.entry_methods as string[]).includes(entryMethod)) {
    res.status(400).json({ error: `This contest does not accept "${entryMethod}" entries` });
    return;
  }
  const existing = await db
    .select({
      handle: contestEntriesTable.handle,
      entry_method: contestEntriesTable.entry_method,
    })
    .from(contestEntriesTable)
    .where(eq(contestEntriesTable.contest_id, contest.id));
  if (isDuplicateEntry(existing, handle, entryMethod)) {
    res.status(409).json({ error: "This handle already entered via this method" });
    return;
  }
  const [row] = await db
    .insert(contestEntriesTable)
    .values({
      contest_id: contest.id,
      handle: handle.trim(),
      email: email ?? null,
      entry_method: entryMethod,
    })
    .returning();
  res.status(201).json({ entry: row });
});

/* ─────────────────────────────────────────────────────────────────────
   PATCH /api/contests/:id/entries/:entryId — verify/unverify (free).
   The creator reviews proof, then marks entries verified; only verified
   entries are eligible for the draw.
────────────────────────────────────────────────────────────────────── */
router.patch("/contests/:id/entries/:entryId", requireAuth, async (req, res) => {
  const r = req as AuthedRequest;
  const contest = await loadContestForUser(param(req, "id"), r.userId!);
  if (!contest) {
    res.status(404).json({ error: "Contest not found" });
    return;
  }
  const parsed = z.object({ isVerified: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "isVerified (boolean) is required" });
    return;
  }
  const [row] = await db
    .update(contestEntriesTable)
    .set({ is_verified: parsed.data.isVerified })
    .where(
      and(
        eq(contestEntriesTable.id, param(req, "entryId")),
        eq(contestEntriesTable.contest_id, contest.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.json({ entry: row });
});

/* ─────────────────────────────────────────────────────────────────────
   POST /api/contests/:id/draw — provably-fair winner draw (free).
   Only verified entries are eligible. The audit log (algorithm, seed,
   entry ids, winner, timestamp) is stored on the contest so the draw can
   be re-run and verified by anyone.
────────────────────────────────────────────────────────────────────── */
router.post("/contests/:id/draw", requireAuth, async (req, res) => {
  const r = req as AuthedRequest;
  const contest = await loadContestForUser(param(req, "id"), r.userId!);
  if (!contest) {
    res.status(404).json({ error: "Contest not found" });
    return;
  }
  const entries = await db
    .select()
    .from(contestEntriesTable)
    .where(
      and(
        eq(contestEntriesTable.contest_id, contest.id),
        eq(contestEntriesTable.is_verified, true),
      ),
    )
    .orderBy(asc(contestEntriesTable.id));
  if (entries.length === 0) {
    res.status(400).json({ error: "No verified entries — verify at least one entry first" });
    return;
  }
  const drawnAt = new Date().toISOString();
  const entryIds = entries.map((e) => e.id);
  const seed = buildDrawSeed(contest.id, entryIds, drawnAt);
  const result = pickWinner(entryIds, seed);
  const audit: DrawAudit & { contestId: string } = {
    algorithm: DRAW_ALGORITHM,
    contestId: contest.id,
    seed,
    entryCount: result.entryCount,
    entryIds,
    winnerEntryId: result.winnerEntryId,
    winnerIndex: result.winnerIndex,
    drawnAt,
    drawnBy: r.userId!,
  };
  const winner = entries.find((e) => e.id === result.winnerEntryId)!;
  const [updated] = await db
    .update(contestsTable)
    .set({
      winner_entry_id: result.winnerEntryId,
      draw_audit: audit,
      status: "ended",
      updated_at: new Date(),
    })
    .where(eq(contestsTable.id, contest.id))
    .returning();
  res.json({
    contest: toContestJson(updated!),
    winner,
    audit,
  });
});

/* ─────────────────────────────────────────────────────────────────────
   POST /api/contests/:id/announce — AI winner-announcement graphic.
   1 credit, charged only on success. 400 on bad state before credits are
   touched; 402 when short; refund if storage upload fails after charging.
────────────────────────────────────────────────────────────────────── */
export function buildAnnouncePrompt(opts: {
  contestTitle: string;
  prize: string;
  winnerHandle: string;
}): string {
  const { contestTitle, prize, winnerHandle } = opts;
  return (
    `A celebratory winner-announcement graphic for the giveaway "${contestTitle}". ` +
    `Bold centered headline reading "WINNER", the winner's handle "${winnerHandle}" displayed prominently below it, ` +
    `and the prize "${prize}" named in elegant smaller lettering. ` +
    `Luxurious black and gold aesthetic: deep black background, rich metallic gold accents, ` +
    `confetti and gold particle effects, premium cinematic lighting, elegant serif typography touches, ` +
    `high-end brand identity design. Crisp vector-style digital art, clean edges, high contrast, ` +
    `no photographic faces, no watermark, no signature.`
  ).slice(0, 4000);
}

router.post("/contests/:id/announce", requireAuth, async (req, res) => {
  const r = req as AuthedRequest;
  const contest = await loadContestForUser(param(req, "id"), r.userId!);
  if (!contest) {
    res.status(404).json({ error: "Contest not found" });
    return;
  }
  if (!contest.winner_entry_id) {
    res.status(400).json({ error: "Draw a winner before generating the announcement" });
    return;
  }

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = r.userCredits ?? 0;
  if (currentCredits < CONTEST_ANNOUNCE_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  const winnerRows = await db
    .select()
    .from(contestEntriesTable)
    .where(eq(contestEntriesTable.id, contest.winner_entry_id))
    .limit(1);
  const winnerHandle = winnerRows[0]?.handle ?? "our winner";
  const prompt = buildAnnouncePrompt({
    contestTitle: contest.title,
    prize: contest.prize,
    winnerHandle,
  });
  req.log?.info?.(
    { userId: r.userId, contestId: contest.id },
    "[contests] announcement graphic generation started",
  );

  try {
    const imageResp = await getOpenAI().images.generate({
      model: IMAGE_MODEL,
      prompt,
      size: "1024x1024",
      quality: "high",
      n: 1,
    });
    const b64 = imageResp.data?.[0]?.b64_json;
    if (!b64) {
      res.status(500).json({ error: "Image generation returned no image data." });
      return;
    }

    /* ── Charge AFTER success — failure above means no charge ── */
    try {
      await chargeCredits(
        r.userId!,
        CONTEST_ANNOUNCE_CREDIT_COST,
        { action: `Contest announcement: ${contest.title}` },
        { rollbackOnLedgerFailure: false },
      );
    } catch (err) {
      if (err instanceof LedgerWriteError) {
        req.log?.error?.({ err }, "[contests] CRITICAL: ledger write failed after deduction");
      } else {
        req.log?.error?.({ err }, "[contests] credit deduction FAILED — graphic delivered without charge");
      }
    }

    /* ── Store; refund if the upload fails after charging ── */
    try {
      const objectName = `contests/${r.userId}/${randomUUID()}.png`;
      const storageRef = await uploadMediaToSupabaseStorage(
        objectName,
        Buffer.from(b64, "base64"),
        "image/png",
      );
      const url = await refreshSupabaseStorageUrl(storageRef);
      await db
        .update(contestsTable)
        .set({ announcement_image_url: url, updated_at: new Date() })
        .where(eq(contestsTable.id, contest.id));
      res.json({
        url,
        path: normalizeToStorageRef(storageRef),
        creditCost: CONTEST_ANNOUNCE_CREDIT_COST,
      });
    } catch (uploadErr) {
      await refundCredits(r.userId!, CONTEST_ANNOUNCE_CREDIT_COST, {
        action: `Contest announcement — Refund (storage failed)`,
      });
      req.log?.error?.({ err: uploadErr }, "[contests] storage upload failed — credit refunded");
      res.status(500).json({ error: "Could not save the announcement graphic. Your credit was refunded." });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Announcement generation failed";
    req.log?.error?.({ err: msg }, "[contests] generation failed — no credits charged");
    res.status(500).json({ error: msg });
  }
});

export default router;
