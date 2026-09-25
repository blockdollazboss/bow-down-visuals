import { Router, type Response } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { eq, and, or, desc } from "drizzle-orm";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  db,
  collabProfilesTable,
  collabRequestsTable,
  isCollabNicheKey,
  isCollabPlatformKey,
  COLLAB_NICHES,
  COLLAB_PLATFORMS,
} from "@workspace/db";

/* ─── Collab Finder ─────────────────────────────────────────────────────────
   /collabs page: creators publish a public collab profile and discover
   partners. Pricing:
   - Browsing profiles: FREE (pure read)
   - My profile create/update: FREE (pure write)
   - AI match report: 1 CREDIT (GPT-6 burns tokens) — charge-before-generate,
     refund on provider failure. Uses max_completion_tokens (GPT-6 rejects
     max_tokens).
   - Sending / answering collab requests: FREE (inbox is pure interface).
   - Outreach templates: static copy in the frontend (zero runtime compute),
     so proposals stay genuinely free. */

export const COLLAB_MATCH_CREDITS = Number(process.env["COLLAB_MATCH_CREDIT_COST"]) || 1;

/* Re-exported for route consumers + tests. */
export { isCollabNicheKey, isCollabPlatformKey, COLLAB_NICHES, COLLAB_PLATFORMS };

export const NICHE_LABELS: Record<string, string> = {
  music: "Music",
  gaming: "Gaming",
  vlogging: "Vlogging",
  comedy: "Comedy",
  education: "Education",
  fitness: "Fitness",
  beauty: "Beauty",
  tech: "Tech",
  cooking: "Cooking",
  travel: "Travel",
  fashion: "Fashion",
  podcasting: "Podcasting",
  other: "Other",
};

export const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  twitch: "Twitch",
  x: "X",
  discord: "Discord",
};

export const MATCH_SYSTEM_PROMPT =
  `You are a creator-collaboration strategist for Bow Down Visuals. Given two ` +
  `creator profiles, score their collaboration compatibility and explain it like ` +
  `a sharp talent manager — concrete, no fluff.\n\n` +
  `Score 0-100 weighing: (1) niche overlap or complementary niches that share an ` +
  `audience (e.g. music + gaming both skew young and entertainment-hungry); ` +
  `(2) audience-size complement — similar size is peer-to-peer, a gap means the ` +
  `smaller creator should bring the bigger idea; (3) stated collab interests ` +
  `matching up.\n\n` +
  `Return ONLY JSON: {\n` +
  `  "score": <0-100 integer>,\n` +
  `  "verdict": "<one punchy sentence: great fit / solid / risky>",\n` +
  `  "strengths": ["<2-4 concrete reasons this pairing works>"],\n` +
  `  "risks": ["<1-3 honest risks or mismatches>"],\n` +
  `  "ideas": ["<3 specific collab video/stream ideas for THIS pair>"]\n` +
  `}.`;

const platformEntrySchema = z.object({
  platform: z.string().refine(isCollabPlatformKey, "Unknown platform."),
  followers: z.number().int().min(0).max(1000000000),
});

const upsertProfileSchema = z.object({
  displayName: z.string().min(1, "Give your profile a display name.").max(60),
  niche: z.string().refine(isCollabNicheKey, "Pick a niche."),
  platforms: z.array(platformEntrySchema).max(6).default([]),
  collabInterests: z.string().max(500).default(""),
  bio: z.string().max(500).default(""),
  isPublic: z.boolean().default(true),
});

const browseSchema = z.object({
  niche: z.string().optional(),
});

const matchSchema = z.object({
  /* user_id of the other creator to match against my profile */
  targetUserId: z.string().uuid("Pick a creator to match with."),
});

const sendRequestSchema = z.object({
  toUserId: z.string().uuid("Pick a creator to message."),
  message: z.string().min(1, "Write a message first.").max(1000),
});

const respondSchema = z.object({
  action: z.enum(["accepted", "declined"]),
});

export interface MatchProfileSummary {
  displayName: string;
  niche: string;
  platforms: { platform: string; followers: number }[];
  collabInterests: string;
  bio: string;
}

/* Pure prompt builder — exported for tests. Caps every field (injection hygiene). */
export function buildMatchPrompt(me: MatchProfileSummary, them: MatchProfileSummary): string {
  const fmt = (p: MatchProfileSummary, label: string) => {
    const plats = p.platforms
      .map((e) => `${PLATFORM_LABELS[e.platform] ?? e.platform} (${formatFollowers(e.followers)})`)
      .join(", ");
    return [
      `${label}: ${p.displayName.slice(0, 60)}`,
      `Niche: ${NICHE_LABELS[p.niche] ?? p.niche}`,
      plats ? `Platforms: ${plats.slice(0, 300)}` : "Platforms: none listed",
      p.collabInterests.trim() ? `Wants to collab on: ${p.collabInterests.slice(0, 500)}` : null,
      p.bio.trim() ? `Bio: ${p.bio.slice(0, 500)}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  };
  return `Score this potential collaboration:\n\n${fmt(me, "Creator A (requesting the report)")}\n\n${fmt(them, "Creator B")}`;
}

export function formatFollowers(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${n}`;
}

export interface MatchReport {
  score: number;
  verdict: string;
  strengths: string[];
  risks: string[];
  ideas: string[];
}

/* Pure JSON parser — exported for tests. Never throws on malformed output. */
export function parseMatchJson(raw: string): MatchReport | null {
  try {
    const j = JSON.parse(raw) as Partial<MatchReport>;
    const score = typeof j.score === "number" ? Math.max(0, Math.min(100, Math.round(j.score))) : NaN;
    if (!Number.isFinite(score)) return null;
    const strs = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 300)).slice(0, 5)
        : [];
    const verdict = typeof j.verdict === "string" && j.verdict.trim() ? j.verdict.trim().slice(0, 200) : "";
    if (!verdict) return null;
    return { score, verdict, strengths: strs(j.strengths), risks: strs(j.risks), ideas: strs(j.ideas) };
  } catch {
    return null;
  }
}

const router = Router();

async function chargeOr402(
  userId: string,
  balance: number,
  cost: number,
  res: Response,
): Promise<number | null> {
  if (balance < cost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to run an AI match report.",
    });
    return null;
  }
  try {
    return await chargeCredits(userId, cost, { action: "Collab Finder match report" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to run an AI match report.",
      });
      return null;
    }
    throw err;
  }
}

function toSummary(row: typeof collabProfilesTable.$inferSelect): MatchProfileSummary {
  return {
    displayName: row.display_name,
    niche: row.niche,
    platforms: Array.isArray(row.platforms) ? row.platforms : [],
    collabInterests: row.collab_interests,
    bio: row.bio,
  };
}

/* GET /api/collabs/profiles?niche=music → 200 { profiles } — FREE browse */
router.get("/collabs/profiles", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = browseSchema.safeParse(req.query ?? {});
  const niche = parsed.success ? parsed.data.niche : undefined;
  try {
    const rows = await db
      .select()
      .from(collabProfilesTable)
      .where(
        niche && isCollabNicheKey(niche)
          ? and(eq(collabProfilesTable.is_public, true), eq(collabProfilesTable.niche, niche))
          : eq(collabProfilesTable.is_public, true),
      )
      .orderBy(desc(collabProfilesTable.updated_at))
      .limit(100);
    res.json({
      profiles: rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        niche: r.niche,
        nicheLabel: NICHE_LABELS[r.niche] ?? r.niche,
        platforms: (Array.isArray(r.platforms) ? r.platforms : []).map((e) => ({
          platform: e.platform,
          label: PLATFORM_LABELS[e.platform] ?? e.platform,
          followers: e.followers,
          followersLabel: formatFollowers(e.followers),
        })),
        collabInterests: r.collab_interests,
        bio: r.bio,
        isOwn: r.user_id === req.userId,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[collabs] browse failed");
    res.status(500).json({ error: "Couldn't load creator profiles — try again." });
  }
});

/* GET /api/collabs/profile/me → 200 { profile | null } — FREE */
router.get("/collabs/profile/me", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(collabProfilesTable)
      .where(eq(collabProfilesTable.user_id, req.userId!))
      .limit(1);
    const r = rows[0];
    res.json({
      profile: r
        ? {
            displayName: r.display_name,
            niche: r.niche,
            platforms: Array.isArray(r.platforms) ? r.platforms : [],
            collabInterests: r.collab_interests,
            bio: r.bio,
            isPublic: r.is_public,
          }
        : null,
    });
  } catch (err) {
    logger.error({ err }, "[collabs] my profile failed");
    res.status(500).json({ error: "Couldn't load your profile — try again." });
  }
});

/* POST /api/collabs/profile → 200 { profile } — FREE create/update */
router.post("/collabs/profile", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = upsertProfileSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid profile.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  try {
    const existing = await db
      .select({ id: collabProfilesTable.id })
      .from(collabProfilesTable)
      .where(eq(collabProfilesTable.user_id, req.userId!))
      .limit(1);
    if (existing[0]) {
      await db
        .update(collabProfilesTable)
        .set({
          display_name: d.displayName.trim(),
          niche: d.niche,
          platforms: d.platforms,
          collab_interests: d.collabInterests.trim(),
          bio: d.bio.trim(),
          is_public: d.isPublic,
          updated_at: new Date(),
        })
        .where(eq(collabProfilesTable.user_id, req.userId!));
    } else {
      await db.insert(collabProfilesTable).values({
        user_id: req.userId!,
        display_name: d.displayName.trim(),
        niche: d.niche,
        platforms: d.platforms,
        collab_interests: d.collabInterests.trim(),
        bio: d.bio.trim(),
        is_public: d.isPublic,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[collabs] profile upsert failed");
    res.status(500).json({ error: "Couldn't save your profile — try again." });
  }
});

/* POST /api/collabs/match { targetUserId } → 200 { report, creditsUsed, creditsRemaining }
   PAID: 1 credit. Charge before generate, refund on provider failure. */
router.post("/collabs/match", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = matchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid match request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (parsed.data.targetUserId === req.userId) {
    res.status(400).json({ error: "That's you — pick another creator to match with." });
    return;
  }

  const creditsRemaining = await chargeOr402(req.userId!, req.userCredits ?? 0, COLLAB_MATCH_CREDITS, res);
  if (creditsRemaining === null) return;

  try {
    const [meRows, themRows] = await Promise.all([
      db.select().from(collabProfilesTable).where(eq(collabProfilesTable.user_id, req.userId!)).limit(1),
      db.select().from(collabProfilesTable).where(eq(collabProfilesTable.user_id, parsed.data.targetUserId)).limit(1),
    ]);
    const me = meRows[0];
    const them = themRows[0];
    if (!me) {
      throw Object.assign(new Error("no_own_profile"), { status: 400 });
    }
    if (!them || !them.is_public) {
      throw Object.assign(new Error("no_target_profile"), { status: 404 });
    }

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: MATCH_SYSTEM_PROMPT },
        { role: "user", content: buildMatchPrompt(toSummary(me), toSummary(them)) },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 800,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const report = parseMatchJson(raw);
    if (!report) {
      throw new Error("Model returned no usable match report");
    }

    res.json({
      report: { ...report, targetDisplayName: them.display_name },
      creditsUsed: COLLAB_MATCH_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundCredits(req.userId!, COLLAB_MATCH_CREDITS, {
      action: "Collab Finder match report (provider failure refund)",
    }).catch(() => {});
    const status = (err as { status?: number }).status;
    if (status === 400) {
      res.status(400).json({ error: "Set up your collab profile first — it takes 30 seconds. (Credit refunded.)" });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: "That creator's profile isn't available. (Credit refunded.)" });
      return;
    }
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[collabs] OpenAI rate limit / quota");
      res.status(503).json({ error: "The matcher is catching its breath — try again in a moment. (Credit refunded.)" });
      return;
    }
    logger.error({ err }, "[collabs] match failed");
    res.status(502).json({ error: "The matcher hiccupped — try again. (Credit refunded.)" });
  }
});

/* POST /api/collabs/requests { toUserId, message } → 200 { ok } — FREE send */
router.post("/collabs/requests", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = sendRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (parsed.data.toUserId === req.userId) {
    res.status(400).json({ error: "You can't send a collab request to yourself." });
    return;
  }
  try {
    const target = await db
      .select({ id: collabProfilesTable.id })
      .from(collabProfilesTable)
      .where(and(eq(collabProfilesTable.user_id, parsed.data.toUserId), eq(collabProfilesTable.is_public, true)))
      .limit(1);
    if (!target[0]) {
      res.status(404).json({ error: "That creator isn't accepting collab requests right now." });
      return;
    }
    const dup = await db
      .select({ id: collabRequestsTable.id })
      .from(collabRequestsTable)
      .where(
        and(
          eq(collabRequestsTable.from_user_id, req.userId!),
          eq(collabRequestsTable.to_user_id, parsed.data.toUserId),
          eq(collabRequestsTable.status, "pending"),
        ),
      )
      .limit(1);
    if (dup[0]) {
      res.status(409).json({ error: "You already have a pending request with this creator." });
      return;
    }
    await db.insert(collabRequestsTable).values({
      from_user_id: req.userId!,
      to_user_id: parsed.data.toUserId,
      message: parsed.data.message.trim(),
      status: "pending",
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[collabs] send request failed");
    res.status(500).json({ error: "Couldn't send the request — try again." });
  }
});

/* GET /api/collabs/requests → 200 { received, sent } — FREE inbox */
router.get("/collabs/requests", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const [received, sent] = await Promise.all([
      db
        .select({
          id: collabRequestsTable.id,
          message: collabRequestsTable.message,
          status: collabRequestsTable.status,
          createdAt: collabRequestsTable.created_at,
          fromDisplayName: collabProfilesTable.display_name,
          fromNiche: collabProfilesTable.niche,
        })
        .from(collabRequestsTable)
        .leftJoin(collabProfilesTable, eq(collabProfilesTable.user_id, collabRequestsTable.from_user_id))
        .where(eq(collabRequestsTable.to_user_id, req.userId!))
        .orderBy(desc(collabRequestsTable.created_at))
        .limit(100),
      db
        .select({
          id: collabRequestsTable.id,
          message: collabRequestsTable.message,
          status: collabRequestsTable.status,
          createdAt: collabRequestsTable.created_at,
          toDisplayName: collabProfilesTable.display_name,
          toNiche: collabProfilesTable.niche,
        })
        .from(collabRequestsTable)
        .leftJoin(collabProfilesTable, eq(collabProfilesTable.user_id, collabRequestsTable.to_user_id))
        .where(eq(collabRequestsTable.from_user_id, req.userId!))
        .orderBy(desc(collabRequestsTable.created_at))
        .limit(100),
    ]);
    res.json({ received, sent });
  } catch (err) {
    logger.error({ err }, "[collabs] inbox failed");
    res.status(500).json({ error: "Couldn't load your inbox — try again." });
  }
});

/* POST /api/collabs/requests/:id/respond { action } → 200 { ok } — FREE */
router.post("/collabs/requests/:id/respond", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = respondSchema.safeParse(req.body ?? {});
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!parsed.success || !id) {
    res.status(400).json({ error: "Invalid response." });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(collabRequestsTable)
      .where(
        and(
          eq(collabRequestsTable.id, id),
          eq(collabRequestsTable.to_user_id, req.userId!),
          eq(collabRequestsTable.status, "pending"),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "Request not found or already answered." });
      return;
    }
    await db
      .update(collabRequestsTable)
      .set({ status: parsed.data.action, updated_at: new Date() })
      .where(eq(collabRequestsTable.id, id));
    res.json({ ok: true, status: parsed.data.action });
  } catch (err) {
    logger.error({ err }, "[collabs] respond failed");
    res.status(500).json({ error: "Couldn't update the request — try again." });
  }
});

export default router;
