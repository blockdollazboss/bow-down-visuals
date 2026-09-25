import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

/* ─── Pricing ──────────────────────────────────────────────────────────────
   AI metadata + AI strategy: 1 credit each (env-overridable). A GPT-6 call
   is a fraction of a cent in provider fees, so 1 credit holds a deep margin
   while staying an impulse buy — and honors the standing rule that every
   AI feature costs a fee. Browsing and release setup are free (pure UI/DB,
   no compute burned).
   Distribution fee: 10 credits per release (env-overridable via
   DISTRIBUTION_RELEASE_CREDITS). This is a service/packaging fee for
   preparing the release package — v1 does NOT submit to Spotify/Apple
   APIs, and the UI says so honestly. */
export const AI_CREDIT_COST = Number(process.env["DISTRIBUTION_AI_CREDIT_COST"]) || 1;
export const DISTRIBUTION_RELEASE_CREDITS =
  Number(process.env["DISTRIBUTION_RELEASE_CREDITS"]) || 10;

/* ─── Platforms ────────────────────────────────────────────────────────────
   Keep in sync with the frontend /distribute page. These are the platforms
   a release package is prepared for in v1. Real API delivery is a future
   integration — the platform list here drives the checklist, not fake
   submission confirmations. */
export const DISTRIBUTION_PLATFORMS = [
  "spotify",
  "apple_music",
  "youtube_music",
  "tiktok",
  "instagram",
  "amazon_music",
  "deezer",
  "tidal",
] as const;
export type DistributionPlatform = (typeof DISTRIBUTION_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<DistributionPlatform, string> = {
  spotify: "Spotify",
  apple_music: "Apple Music",
  youtube_music: "YouTube Music",
  tiktok: "TikTok",
  instagram: "Instagram",
  amazon_music: "Amazon Music",
  deezer: "Deezer",
  tidal: "Tidal",
};

export const RELEASE_STATUSES = ["draft", "packaged"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

/* ─── Schemas ────────────────────────────────────────────────────────────── */

export const metadataSchema = z.object({
  vibe: z.string().min(1, "Describe the song's vibe.").max(500),
  lyrics: z.string().max(4000).optional().default(""),
  artistName: z.string().max(120).optional().default(""),
  workingTitle: z.string().max(200).optional().default(""),
});

export const strategySchema = z.object({
  title: z.string().min(1, "Release title is required.").max(200),
  artistName: z.string().min(1, "Artist name is required.").max(120),
  genreTags: z.array(z.string().max(40)).max(10).optional().default([]),
  releaseDate: z.string().max(20).optional().default(""),
  platforms: z.array(z.enum(DISTRIBUTION_PLATFORMS)).min(1).max(8).optional().default(["spotify"]),
});

export const createReleaseSchema = z.object({
  title: z.string().min(1, "Release title is required.").max(200),
  artistName: z.string().min(1, "Artist name is required.").max(120),
  releaseDate: z.string().max(20).optional().default(""),
  platforms: z.array(z.enum(DISTRIBUTION_PLATFORMS)).max(8).optional().default([]),
  audioUrl: z.string().url("Audio URL must be a valid URL.").max(2000).optional().or(z.literal("")),
  artworkUrl: z.string().url("Artwork URL must be a valid URL.").max(2000).optional().or(z.literal("")),
  metadata: z.record(z.string(), z.unknown()).optional(),
  strategy: z.record(z.string(), z.unknown()).optional(),
});

const updateReleaseSchema = createReleaseSchema.partial();

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function outOfCredits(res: Response, action: string) {
  res.status(402).json({
    error: "out_of_credits",
    message: `You're out of credits — top up to ${action}.`,
  });
}

async function chargeOr402(
  req: Request,
  res: Response,
  cost: number,
  action: string,
  actionLabel: string,
): Promise<number | null> {
  const balance = (req as Request & { userCredits?: number }).userCredits ?? 0;
  if (balance < cost) {
    outOfCredits(res, action);
    return null;
  }
  try {
    return await chargeCredits((req as Request & { userId?: string }).userId!, cost, { action: actionLabel });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      outOfCredits(res, action);
      return null;
    }
    throw err;
  }
}

/* DB rows come back from raw SQL (the pg-mem-safe pattern used by
   locations.ts — drizzle's query builder emits DEFAULT/rowMode constructs
   pg-mem can't execute). */
interface ReleaseRow {
  id: string;
  user_id: string;
  title: string;
  artist_name: string;
  release_date: string | null;
  platforms: string[] | null;
  audio_url: string | null;
  artwork_url: string | null;
  metadata: Record<string, unknown> | null;
  strategy: Record<string, unknown> | null;
  status: string;
  credits_charged: number;
  created_at: string;
  updated_at: string;
}

const RELEASE_COLUMNS = sql`
  id, user_id, title, artist_name, release_date, platforms,
  audio_url, artwork_url, metadata, strategy, status,
  credits_charged, created_at, updated_at
`;

function rowToRelease(row: ReleaseRow) {
  return {
    id: row.id,
    title: row.title,
    artistName: row.artist_name,
    releaseDate: row.release_date,
    platforms: row.platforms ?? [],
    audioUrl: row.audio_url,
    artworkUrl: row.artwork_url,
    metadata: row.metadata,
    strategy: row.strategy,
    status: row.status,
    creditsCharged: row.credits_charged,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ─── AI: release metadata generator ───────────────────────────────────────
   POST /api/distribution/metadata { vibe, lyrics?, artistName?, workingTitle? }
   → 200 { titleOptions[], description, genreTags[], creditsUsed, creditsRemaining }
   Paid: 1 credit. Charged BEFORE the model call; refunded if the provider
   call fails (the creator got nothing, so they keep their credit). */
router.post("/distribution/metadata", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = metadataSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid metadata request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { vibe, lyrics, artistName, workingTitle } = parsed.data;

  const creditsRemaining = await chargeOr402(req, res, AI_CREDIT_COST, "generate release metadata", "Distribution AI Metadata");
  if (creditsRemaining === null) return;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a music-marketing copywriter for independent artists. ` +
            `Given a song's vibe (and optional lyrics / artist name / working title), ` +
            `you produce a streaming-ready metadata package as JSON. ` +
            `Title options: 5 distinct, memorable, streaming-friendly titles — no ` +
            `generic filler like "Untitled Track". Description: a 2-3 sentence ` +
            `artist-bio-style blurb for the release page, written in third person ` +
            `when an artist name is given. Genre tags: 3-6 specific tags ` +
            `(e.g. "alt-R&B", "phonk", "afrobeats" — never just "pop"). ` +
            `Keep everything clean and platform-safe (no slurs, no explicit ` +
            `content in titles). Return ONLY JSON: ` +
            `{"titleOptions": ["...", ...], "description": "...", "genreTags": ["...", ...]}`,
        },
        {
          role: "user",
          content:
            `Write my release metadata.\n` +
            `Vibe: ${vibe.trim()}\n` +
            (workingTitle.trim() ? `Working title: ${workingTitle.trim()}\n` : "") +
            (artistName.trim() ? `Artist: ${artistName.trim()}\n` : "") +
            (lyrics.trim() ? `Lyrics (excerpt):\n${lyrics.trim().slice(0, 4000)}` : `No lyrics provided.`),
        },
      ],
      response_format: { type: "json_object" },
      /* GPT-6 rejects max_tokens — max_completion_tokens is the correct param. */
      max_completion_tokens: 1200,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let titleOptions: string[] = [];
    let description = "";
    let genreTags: string[] = [];
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(j["titleOptions"])) {
        titleOptions = j["titleOptions"]
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim())
          .slice(0, 5);
      }
      if (typeof j["description"] === "string") description = j["description"].trim();
      if (Array.isArray(j["genreTags"])) {
        genreTags = j["genreTags"]
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim())
          .slice(0, 6);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (titleOptions.length === 0 || !description || genreTags.length === 0) {
      throw new Error("Model returned no usable metadata");
    }

    res.json({ titleOptions, description, genreTags, creditsUsed: AI_CREDIT_COST, creditsRemaining });
  } catch (err) {
    /* Provider failed after the charge — refund so the creator pays only for
       metadata they actually received. */
    try {
      await refundCredits(req.userId!, AI_CREDIT_COST, { action: "Distribution AI Metadata — Refund (provider failed)" });
    } catch (refundErr) {
      logger.error({ err: refundErr }, "[distribution] metadata refund failed");
    }
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[distribution] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[distribution] metadata generation failed");
    res.status(502).json({ error: "Metadata generation hiccupped — your credit was refunded, try again." });
  }
});

/* ─── AI: pre-release strategy ─────────────────────────────────────────────
   POST /api/distribution/strategy { title, artistName, genreTags?, releaseDate?, platforms? }
   → 200 { timing, promoPlan[], checklist[], creditsUsed, creditsRemaining }
   Paid: 1 credit, same charge-then-refund-on-failure pattern. */
router.post("/distribution/strategy", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = strategySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid strategy request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { title, artistName, genreTags, releaseDate, platforms } = parsed.data;

  const creditsRemaining = await chargeOr402(req, res, AI_CREDIT_COST, "generate a release strategy", "Distribution AI Strategy");
  if (creditsRemaining === null) return;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a release strategist for independent musicians. Given a ` +
            `release's title, artist, genres, target date, and platforms, you ` +
            `produce a practical pre-release plan as JSON. Timing: one paragraph ` +
            `on WHEN to release (day-of-week logic, lead time for pitching, ` +
            `how far out the date should be — be specific, not vague). ` +
            `Promo plan: 5 concrete actions for the 2 weeks before release, ` +
            `each one sentence, ordered by impact. Checklist: 6 must-do items ` +
            `before the release goes live (artwork specs, metadata, pre-saves, ` +
            `etc.), each one sentence. No hype, no guarantees of virality — ` +
            `honest, actionable advice. Return ONLY JSON: ` +
            `{"timing": "...", "promoPlan": ["...", ...], "checklist": ["...", ...]}`,
        },
        {
          role: "user",
          content:
            `Build my pre-release strategy.\n` +
            `Title: ${title.trim()}\n` +
            `Artist: ${artistName.trim()}\n` +
            (genreTags.length ? `Genres: ${genreTags.join(", ")}\n` : "") +
            (releaseDate.trim() ? `Target date: ${releaseDate.trim()}\n` : `No target date set yet.\n`) +
            `Platforms: ${platforms.map((p) => PLATFORM_LABEL[p]).join(", ")}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let timing = "";
    let promoPlan: string[] = [];
    let checklist: string[] = [];
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (typeof j["timing"] === "string") timing = j["timing"].trim();
      const strArr = (v: unknown, n: number) =>
        Array.isArray(v)
          ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim()).slice(0, n)
          : [];
      promoPlan = strArr(j["promoPlan"], 5);
      checklist = strArr(j["checklist"], 6);
    } catch {
      /* fall through to the empty check below */
    }
    if (!timing || promoPlan.length === 0 || checklist.length === 0) {
      throw new Error("Model returned no usable strategy");
    }

    res.json({ timing, promoPlan, checklist, creditsUsed: AI_CREDIT_COST, creditsRemaining });
  } catch (err) {
    try {
      await refundCredits(req.userId!, AI_CREDIT_COST, { action: "Distribution AI Strategy — Refund (provider failed)" });
    } catch (refundErr) {
      logger.error({ err: refundErr }, "[distribution] strategy refund failed");
    }
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[distribution] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[distribution] strategy generation failed");
    res.status(502).json({ error: "Strategy generation hiccupped — your credit was refunded, try again." });
  }
});

/* ─── Releases (free — pure UI/DB, no compute) ──────────────────────────── */

/* POST /api/distribution/releases — create a release draft (free) */
router.post("/distribution/releases", requireAuth, async (req, res) => {
  const parsed = createReleaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid release.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  try {
    const id = randomUUID();
    const result = await db.execute(sql`
      INSERT INTO distribution_releases
        (id, user_id, title, artist_name, release_date, platforms,
         audio_url, artwork_url, metadata, strategy, status, credits_charged)
      VALUES (
        ${id}, ${req.userId!}, ${d.title.trim()}, ${d.artistName.trim()},
        ${d.releaseDate?.trim() || null}, ${JSON.stringify(d.platforms ?? [])}::jsonb,
        ${d.audioUrl?.trim() || null}, ${d.artworkUrl?.trim() || null},
        ${d.metadata ? JSON.stringify(d.metadata) : null}::jsonb,
        ${d.strategy ? JSON.stringify(d.strategy) : null}::jsonb,
        'draft', 0
      )
      RETURNING ${RELEASE_COLUMNS}
    `);
    res.status(201).json({ release: rowToRelease(result.rows[0] as unknown as ReleaseRow) });
  } catch (err) {
    logger.error({ err }, "[distribution] create release failed");
    res.status(500).json({ error: "Couldn't save the release — try again." });
  }
});

/* GET /api/distribution/releases — list the creator's releases (free) */
router.get("/distribution/releases", requireAuth, async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT ${RELEASE_COLUMNS}
      FROM distribution_releases
      WHERE user_id = ${req.userId!}
      ORDER BY created_at DESC
      LIMIT 200
    `);
    res.json({ releases: (result.rows as unknown as ReleaseRow[]).map(rowToRelease) });
  } catch (err) {
    logger.error({ err }, "[distribution] list releases failed");
    res.status(500).json({ error: "Couldn't load releases — try again." });
  }
});

function releaseId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] ?? "" : id ?? "";
}

async function getOwnedRelease(id: string, userId: string): Promise<ReleaseRow | null> {
  const result = await db.execute(sql`
    SELECT ${RELEASE_COLUMNS}
    FROM distribution_releases
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `);
  return (result.rows[0] as unknown as ReleaseRow) ?? null;
}

/* GET /api/distribution/releases/:id — release detail (free) */
router.get("/distribution/releases/:id", requireAuth, async (req, res) => {
  try {
    const row = await getOwnedRelease(releaseId(req), req.userId!);
    if (!row) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    res.json({ release: rowToRelease(row) });
  } catch (err) {
    logger.error({ err }, "[distribution] get release failed");
    res.status(500).json({ error: "Couldn't load the release — try again." });
  }
});

/* PATCH /api/distribution/releases/:id — update a draft (free).
   Packaged releases are locked — the package was already paid for. */
router.patch("/distribution/releases/:id", requireAuth, async (req, res) => {
  const parsed = updateReleaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid release update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    const existing = await getOwnedRelease(releaseId(req), req.userId!);
    if (!existing) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    if (existing.status !== "draft") {
      res.status(409).json({ error: "This release is already packaged — create a new release to change it." });
      return;
    }
    const d = parsed.data;
    /* Merge over the existing row, then write every column explicitly —
       keeps one static query shape (pg-mem-safe) instead of dynamic SETs. */
    const merged = {
      title: d.title !== undefined ? d.title.trim() : existing.title,
      artist_name: d.artistName !== undefined ? d.artistName.trim() : existing.artist_name,
      release_date: d.releaseDate !== undefined ? d.releaseDate.trim() || null : existing.release_date,
      platforms: d.platforms !== undefined ? d.platforms : existing.platforms ?? [],
      audio_url: d.audioUrl !== undefined ? d.audioUrl.trim() || null : existing.audio_url,
      artwork_url: d.artworkUrl !== undefined ? d.artworkUrl.trim() || null : existing.artwork_url,
      metadata: d.metadata !== undefined ? d.metadata : existing.metadata,
      strategy: d.strategy !== undefined ? d.strategy : existing.strategy,
    };
    const result = await db.execute(sql`
      UPDATE distribution_releases
      SET title = ${merged.title},
          artist_name = ${merged.artist_name},
          release_date = ${merged.release_date},
          platforms = ${JSON.stringify(merged.platforms)}::jsonb,
          audio_url = ${merged.audio_url},
          artwork_url = ${merged.artwork_url},
          metadata = ${merged.metadata ? JSON.stringify(merged.metadata) : null}::jsonb,
          strategy = ${merged.strategy ? JSON.stringify(merged.strategy) : null}::jsonb,
          updated_at = now()
      WHERE id = ${releaseId(req)}
      RETURNING ${RELEASE_COLUMNS}
    `);
    const row = result.rows[0] as unknown as ReleaseRow;
    res.json({ release: rowToRelease(row) });
  } catch (err) {
    logger.error({ err }, "[distribution] update release failed");
    res.status(500).json({ error: "Couldn't update the release — try again." });
  }
});

/* DELETE /api/distribution/releases/:id — delete a draft (free) */
router.delete("/distribution/releases/:id", requireAuth, async (req, res) => {
  try {
    const existing = await getOwnedRelease(releaseId(req), req.userId!);
    if (!existing) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    if (existing.status !== "draft") {
      res.status(409).json({ error: "Packaged releases can't be deleted — contact support if you need changes." });
      return;
    }
    await db.execute(sql`DELETE FROM distribution_releases WHERE id = ${releaseId(req)}`);
    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err }, "[distribution] delete release failed");
    res.status(500).json({ error: "Couldn't delete the release — try again." });
  }
});

/* ─── Submit for distribution (paid) ───────────────────────────────────────
   POST /api/distribution/releases/:id/submit
   Charges DISTRIBUTION_RELEASE_CREDITS and marks the release "packaged".

   HONESTY CONTRACT (v1): this prepares the release package — validated
   metadata, platform checklist, status tracking. It does NOT submit to
   Spotify/Apple APIs. The response and the UI say exactly that. There is no
   "delivered" status in v1; that status is reserved for the future
   real-delivery integration. Never fabricate a submission confirmation. */
router.post("/distribution/releases/:id/submit", requireAuth, async (req, res) => {
  try {
    const existing = await getOwnedRelease(releaseId(req), req.userId!);
    if (!existing) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    if (existing.status !== "draft") {
      res.status(409).json({ error: "This release is already packaged." });
      return;
    }
    if (!existing.title.trim() || !existing.artist_name.trim()) {
      res.status(400).json({ error: "Give the release a title and artist name first." });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < DISTRIBUTION_RELEASE_CREDITS) {
      res.status(402).json({
        error: "out_of_credits",
        message: `Packaging a release costs ${DISTRIBUTION_RELEASE_CREDITS} credits — top up to continue.`,
      });
      return;
    }
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, DISTRIBUTION_RELEASE_CREDITS, {
        action: "Music Distribution — Release Packaging",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `Packaging a release costs ${DISTRIBUTION_RELEASE_CREDITS} credits — top up to continue.`,
        });
        return;
      }
      throw err;
    }

    const result = await db.execute(sql`
      UPDATE distribution_releases
      SET status = 'packaged',
          credits_charged = ${DISTRIBUTION_RELEASE_CREDITS},
          updated_at = now()
      WHERE id = ${releaseId(req)}
      RETURNING ${RELEASE_COLUMNS}
    `);
    const row = result.rows[0] as unknown as ReleaseRow;

    res.json({
      release: rowToRelease(row),
      creditsUsed: DISTRIBUTION_RELEASE_CREDITS,
      creditsRemaining,
      /* The honesty contract, in the API response itself. */
      notice:
        "Your release package is prepared — metadata, artwork, audio, and platform checklist are ready. " +
        "Direct delivery to streaming platforms is coming soon; we'll notify you when your release ships.",
    });
  } catch (err) {
    logger.error({ err }, "[distribution] submit release failed");
    res.status(500).json({ error: "Couldn't package the release — try again." });
  }
});

export default router;
