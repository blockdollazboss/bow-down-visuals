import { Router, raw as expressRaw, type Request, type Response } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  getAggregator,
  type AggregatorReleasePayload,
  type PlatformDeliveryStatus,
} from "../../lib/distribution-aggregator";

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

/* ─── Tiered release pricing (v2) ───────────────────────────────────────────
   MARGIN LOGIC (documented assumptions — verify against real aggregator
   invoices; site credits ≈ $0.50 each at current pack pricing):
   - Single 10cr ≈ $5.00 revenue. Too Lost-style aggregators charge roughly
     $0–2 per single submission on volume plans → ~$3–5 gross margin.
   - EP 20cr ≈ $10.00 revenue vs ~$2–3 aggregator cost → ~$7–8 margin.
   - Album 30cr ≈ $15.00 revenue vs ~$3–5 aggregator cost → ~$10–12 margin.
   The fee also covers package validation, artwork QA, ISRC/UPC handling,
   delivery monitoring, and the pre-save/royalty tooling — not just the raw
   aggregator pass-through. Tiers are env-overridable without a redeploy of
   the pricing page (GET /api/distribution/pricing reads these live).
   Annual unlimited (DistroKid-style $19.99/yr equivalent ≈ 40cr) is the
   upsell — listed as coming-soon until billing supports subscriptions. */
export const RELEASE_TIER_CREDITS = {
  single: Number(process.env["DISTRIBUTION_SINGLE_CREDITS"]) || DISTRIBUTION_RELEASE_CREDITS,
  ep: Number(process.env["DISTRIBUTION_EP_CREDITS"]) || 20,
  album: Number(process.env["DISTRIBUTION_ALBUM_CREDITS"]) || 30,
} as const;
export type ReleaseType = keyof typeof RELEASE_TIER_CREDITS;

export const ANNUAL_UNLIMITED_PLAN = {
  label: "Distribute Unlimited",
  creditsPerYear: Number(process.env["DISTRIBUTION_ANNUAL_CREDITS"]) || 399,
  blurb:
    "Unlimited singles, EPs, and albums for a year — keep 100% of royalties.",
  comingSoon: true,
};

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

export const RELEASE_TYPES = ["single", "ep", "album"] as const;

const trackSchema = z.object({
  title: z.string().min(1, "Track title is required.").max(200),
  isrc: z
    .string()
    .max(20)
    .optional()
    .transform((v) => (v ? v.toUpperCase().replace(/[-\s]/g, "") : v)),
});

/* ISRC: 12 chars — 2 country + 3 registrant + 7 designation (e.g. USABC2412345) */
export function isValidIsrc(v: string | undefined | null): boolean {
  if (!v) return true; // optional
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(v.toUpperCase().replace(/[-\s]/g, ""));
}

export const createReleaseSchema = z.object({
  title: z.string().min(1, "Release title is required.").max(200),
  artistName: z.string().min(1, "Artist name is required.").max(120),
  releaseType: z.enum(RELEASE_TYPES).optional().default("single"),
  releaseDate: z.string().max(20).optional().default(""),
  platforms: z.array(z.enum(DISTRIBUTION_PLATFORMS)).max(8).optional().default([]),
  audioUrl: z.string().url("Audio URL must be a valid URL.").max(2000).optional().or(z.literal("")),
  artworkUrl: z.string().url("Artwork URL must be a valid URL.").max(2000).optional().or(z.literal("")),
  /* Optional link into the user's song library — server verifies ownership
     and prefills audioUrl from the song when none is given. */
  songId: z.string().uuid("Song id must be a valid UUID.").optional(),
  /* Release-level track listing. single → exactly 1, EP → 2–6, album → 7–30. */
  tracks: z.array(trackSchema).max(30).optional().default([]),
  isrc: z.string().max(20).optional().transform((v) => (v ? v.toUpperCase().replace(/[-\s]/g, "") : v)),
  genre: z.string().max(80).optional().default(""),
  explicit: z.boolean().optional().default(false),
  /* The creator must actively declare clean vs explicit — never defaulted silently. */
  explicitDeclared: z.boolean().optional().default(false),
  upc: z.string().max(20).optional().default(""),
  label: z.string().max(120).optional().default(""),
  copyrightLine: z.string().max(200).optional().default(""),
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
  release_type: string | null;
  isrc: string | null;
  genre: string | null;
  explicit: boolean | null;
  explicit_declared: boolean | null;
  upc: string | null;
  label: string | null;
  copyright_line: string | null;
  song_id: string | null;
  tracks: Array<{ title: string; isrc?: string }> | null;
  aggregator: string | null;
  aggregator_release_id: string | null;
  platform_statuses: Array<{ platform: string; status: string; detail?: string; updatedAt: string }> | null;
  presave_slug: string | null;
}

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  hint: string;
}

export interface RoyaltySplit {
  id?: string;
  name: string;
  role?: string;
  share: number;
}

const RELEASE_COLUMNS = sql`
  id, user_id, title, artist_name, release_date, platforms,
  audio_url, artwork_url, metadata, strategy, status,
  credits_charged, created_at, updated_at,
  release_type, isrc, genre, explicit, explicit_declared,
  upc, label, copyright_line, song_id, tracks,
  aggregator, aggregator_release_id, platform_statuses, presave_slug
`;

function rowToRelease(row: ReleaseRow, splits: RoyaltySplit[] = []) {
  const releaseType = (["single", "ep", "album"] as const).includes(row.release_type as ReleaseType)
    ? (row.release_type as ReleaseType)
    : "single";
  return {
    id: row.id,
    title: row.title,
    artistName: row.artist_name,
    releaseType,
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
    isrc: row.isrc,
    genre: row.genre,
    explicit: row.explicit ?? false,
    explicitDeclared: row.explicit_declared ?? false,
    upc: row.upc,
    label: row.label,
    copyrightLine: row.copyright_line,
    songId: row.song_id,
    tracks: row.tracks ?? [],
    aggregator: row.aggregator ?? "none",
    aggregatorReleaseId: row.aggregator_release_id,
    platformStatuses: row.platform_statuses ?? [],
    presaveSlug: row.presave_slug,
    royaltySplits: splits,
    checklist: buildChecklist(row),
  };
}

/* ─── Release checklist (server-side, the same rules the submit endpoint
   enforces) ───────────────────────────────────────────────────────────── */
export function buildChecklist(row: ReleaseRow): ChecklistItem[] {
  const tracks = row.tracks ?? [];
  const releaseType = (["single", "ep", "album"] as const).includes(row.release_type as ReleaseType)
    ? (row.release_type as ReleaseType)
    : "single";
  const trackRange: Record<ReleaseType, [number, number]> = {
    single: [1, 1],
    ep: [2, 6],
    album: [7, 30],
  };
  const [tMin, tMax] = trackRange[releaseType];

  const dateOk = (() => {
    if (!row.release_date) return false;
    const d = new Date(`${row.release_date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    const daysOut = (d.getTime() - Date.now()) / 86_400_000;
    return daysOut >= 7;
  })();
  const dateHint = (() => {
    if (!row.release_date) return "Pick a release date — platforms need at least 7 days lead time.";
    const d = new Date(`${row.release_date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return "Use YYYY-MM-DD format.";
    const daysOut = (d.getTime() - Date.now()) / 86_400_000;
    if (daysOut < 7) return "Too soon — platforms need at least 7 days lead time.";
    if (daysOut < 21) return "OK, but 3+ weeks gives playlist pitching a real shot.";
    return "Healthy lead time for playlist pitching.";
  })();

  const badIsrcs = tracks.filter((t) => !isValidIsrc(t.isrc)).length + (isValidIsrc(row.isrc) ? 0 : 1);

  return [
    {
      key: "title",
      label: "Release title",
      ok: row.title.trim().length >= 3,
      hint: "At least 3 characters — this is what fans search for.",
    },
    {
      key: "artist",
      label: "Artist name",
      ok: row.artist_name.trim().length >= 2,
      hint: "Must match your artist profile exactly across releases.",
    },
    {
      key: "audio",
      label: "Master audio",
      ok: Boolean(row.audio_url),
      hint: "Upload or pick a song from your library — WAV/MP3, final master.",
    },
    {
      key: "artwork",
      label: "Cover art",
      ok: Boolean(row.artwork_url),
      hint: "3000×3000px JPG/PNG, no blurry screenshots.",
    },
    {
      key: "releaseDate",
      label: "Release date",
      ok: dateOk,
      hint: dateHint,
    },
    {
      key: "platforms",
      label: "Platforms",
      ok: (row.platforms ?? []).length >= 1,
      hint: "Pick at least one platform to deliver to.",
    },
    {
      key: "explicit",
      label: "Explicit declaration",
      ok: Boolean(row.explicit_declared),
      hint: "You must declare clean or explicit — platforms reject undeclared releases.",
    },
    {
      key: "genre",
      label: "Genre",
      ok: Boolean(row.genre && row.genre.trim()),
      hint: "Primary genre drives playlist and radio placement.",
    },
    {
      key: "tracks",
      label: `Track listing (${releaseType === "single" ? "1 track" : releaseType === "ep" ? "2–6 tracks" : "7–30 tracks"})`,
      ok: tracks.length >= tMin && tracks.length <= tMax && tracks.every((t) => t.title.trim().length > 0),
      hint:
        releaseType === "single"
          ? "A single needs exactly 1 track."
          : releaseType === "ep"
            ? "An EP needs 2–6 tracks."
            : "An album needs 7–30 tracks.",
    },
    {
      key: "isrc",
      label: "ISRC codes",
      ok: badIsrcs === 0,
      hint: "Optional, but recommended — 12 characters (e.g. USABC2412345). We assign one if you skip it.",
    },
  ];
}

export function checklistPasses(checklist: ChecklistItem[]): boolean {
  return checklist.every((c) => c.ok);
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

/* Load royalty splits for a release (newest table — may not exist in old test DDLs). */
async function loadSplits(releaseId: string, userId: string): Promise<RoyaltySplit[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, payee_name, role, share_pct
      FROM distribution_royalty_splits
      WHERE release_id = ${releaseId} AND user_id = ${userId}
      ORDER BY share_pct DESC
    `);
    return (result.rows as Array<{ id: string; payee_name: string; role: string | null; share_pct: string }>).map(
      (r) => ({ id: r.id, name: r.payee_name, role: r.role ?? undefined, share: Number(r.share_pct) }),
    );
  } catch {
    /* Table missing (older installs) — splits are optional. */
    return [];
  }
}

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
  if (d.isrc && !isValidIsrc(d.isrc)) {
    res.status(400).json({ error: "Release ISRC looks invalid — 12 characters, e.g. USABC2412345." });
    return;
  }
  for (const t of d.tracks) {
    if (t.isrc && !isValidIsrc(t.isrc)) {
      res.status(400).json({ error: `Track "${t.title}" has an invalid ISRC — 12 characters, e.g. USABC2412345.` });
      return;
    }
  }
  try {
    /* Song-library link: verify ownership, prefill audio when not given. */
    let audioUrl = d.audioUrl?.trim() || null;
    let songId: string | null = null;
    if (d.songId) {
      const songResult = await db.execute(sql`
        SELECT id, audio_url FROM songs WHERE id = ${d.songId} AND user_id = ${req.userId!} LIMIT 1
      `);
      const song = songResult.rows[0] as unknown as { id: string; audio_url: string } | undefined;
      if (!song) {
        res.status(400).json({ error: "That song isn't in your library." });
        return;
      }
      songId = song.id;
      if (!audioUrl) audioUrl = song.audio_url;
    }
    const id = randomUUID();
    const result = await db.execute(sql`
      INSERT INTO distribution_releases
        (id, user_id, title, artist_name, release_type, release_date, platforms,
         audio_url, artwork_url, song_id, tracks, isrc, genre, explicit,
         explicit_declared, upc, label, copyright_line,
         metadata, strategy, status, credits_charged)
      VALUES (
        ${id}, ${req.userId!}, ${d.title.trim()}, ${d.artistName.trim()}, ${d.releaseType},
        ${d.releaseDate?.trim() || null}, ${JSON.stringify(d.platforms ?? [])}::jsonb,
        ${audioUrl}, ${d.artworkUrl?.trim() || null}, ${songId},
        ${JSON.stringify(d.tracks ?? [])}::jsonb,
        ${d.isrc || null}, ${d.genre?.trim() || null}, ${d.explicit}, ${d.explicitDeclared},
        ${d.upc?.trim() || null}, ${d.label?.trim() || null}, ${d.copyrightLine?.trim() || null},
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
    res.json({ releases: (result.rows as unknown as ReleaseRow[]).map((r) => rowToRelease(r)) });
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

/* GET /api/distribution/releases/:id — release detail (free, with splits) */
router.get("/distribution/releases/:id", requireAuth, async (req, res) => {
  try {
    const row = await getOwnedRelease(releaseId(req), req.userId!);
    if (!row) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    const splits = await loadSplits(row.id, req.userId!);
    res.json({ release: rowToRelease(row, splits) });
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
    if (d.isrc !== undefined && d.isrc && !isValidIsrc(d.isrc)) {
      res.status(400).json({ error: "Release ISRC looks invalid — 12 characters, e.g. USABC2412345." });
      return;
    }
    /* Merge over the existing row, then write every column explicitly —
       keeps one static query shape (pg-mem-safe) instead of dynamic SETs. */
    const merged = {
      title: d.title !== undefined ? d.title.trim() : existing.title,
      artist_name: d.artistName !== undefined ? d.artistName.trim() : existing.artist_name,
      release_type: d.releaseType !== undefined ? d.releaseType : (existing.release_type ?? "single"),
      release_date: d.releaseDate !== undefined ? d.releaseDate.trim() || null : existing.release_date,
      platforms: d.platforms !== undefined ? d.platforms : existing.platforms ?? [],
      audio_url: d.audioUrl !== undefined ? d.audioUrl.trim() || null : existing.audio_url,
      artwork_url: d.artworkUrl !== undefined ? d.artworkUrl.trim() || null : existing.artwork_url,
      tracks: d.tracks !== undefined ? d.tracks : (existing.tracks ?? []),
      isrc: d.isrc !== undefined ? d.isrc || null : existing.isrc,
      genre: d.genre !== undefined ? d.genre.trim() || null : existing.genre,
      explicit: d.explicit !== undefined ? d.explicit : (existing.explicit ?? false),
      explicit_declared:
        d.explicitDeclared !== undefined ? d.explicitDeclared : (existing.explicit_declared ?? false),
      upc: d.upc !== undefined ? d.upc.trim() || null : existing.upc,
      label: d.label !== undefined ? d.label.trim() || null : existing.label,
      copyright_line: d.copyrightLine !== undefined ? d.copyrightLine.trim() || null : existing.copyright_line,
      metadata: d.metadata !== undefined ? d.metadata : existing.metadata,
      strategy: d.strategy !== undefined ? d.strategy : existing.strategy,
    };
    const result = await db.execute(sql`
      UPDATE distribution_releases
      SET title = ${merged.title},
          artist_name = ${merged.artist_name},
          release_type = ${merged.release_type},
          release_date = ${merged.release_date},
          platforms = ${JSON.stringify(merged.platforms)}::jsonb,
          audio_url = ${merged.audio_url},
          artwork_url = ${merged.artwork_url},
          tracks = ${JSON.stringify(merged.tracks)}::jsonb,
          isrc = ${merged.isrc},
          genre = ${merged.genre},
          explicit = ${merged.explicit},
          explicit_declared = ${merged.explicit_declared},
          upc = ${merged.upc},
          label = ${merged.label},
          copyright_line = ${merged.copyright_line},
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

/* ─── Delivery poller ───────────────────────────────────────────────────────
   After a release is submitted, per-platform statuses are refreshed from the
   aggregator on a 15s tick until every platform is terminal (live/failed).
   In-memory (same tradeoff as the mix-master/audio-cleanup job stores):
   a restart re-registers in-flight deliveries from the DB via
   resumeActiveDeliveries(). Mock-mode jobs are re-submitted to rebuild the
   adapter's in-memory simulation clock. */
const activeDeliveries = new Map<string, { aggregatorReleaseId: string }>();
let deliveryPollerStarted = false;

function ensureDeliveryPoller(): void {
  if (deliveryPollerStarted) return;
  deliveryPollerStarted = true;
  const timer = setInterval(tickDeliveries, 15_000);
  /* Don't hold the process open in tests / serverless. */
  (timer as unknown as { unref?: () => void }).unref?.();
}

async function tickDeliveries(): Promise<void> {
  if (activeDeliveries.size === 0) return;
  const aggregator = getAggregator();
  for (const [releaseId, job] of activeDeliveries) {
    try {
      const statuses = await aggregator.fetchPlatformStatuses(job.aggregatorReleaseId);
      await db.execute(sql`
        UPDATE distribution_releases
        SET platform_statuses = ${JSON.stringify(statuses)}::jsonb,
            updated_at = now()
        WHERE id = ${releaseId}
      `);
      const terminal = (s: string) => s === "live" || s === "failed";
      if (statuses.length > 0 && statuses.every((s) => terminal(s.status))) {
        activeDeliveries.delete(releaseId);
        logger.info({ releaseId }, "[distribution] delivery completed");
      }
    } catch (err) {
      logger.error({ err, releaseId }, "[distribution] delivery poll failed");
    }
  }
}

/** Re-register in-flight deliveries after a restart. Exported for server boot. */
export async function resumeActiveDeliveries(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT id, aggregator, aggregator_release_id, platform_statuses
      FROM distribution_releases
      WHERE status = 'packaged' AND aggregator IS NOT NULL AND aggregator != 'none'
      LIMIT 500
    `);
    const aggregator = getAggregator();
    for (const r of result.rows as Array<{
      id: string;
      aggregator: string;
      aggregator_release_id: string | null;
      platform_statuses: Array<{ status: string }> | null;
    }>) {
      const statuses = r.platform_statuses ?? [];
      const done = statuses.length > 0 && statuses.every((s) => s.status === "live" || s.status === "failed");
      if (done || !r.aggregator_release_id) continue;
      if (r.aggregator === "mock") {
        /* Mock jobs live in adapter memory — re-submit to restart the clock. */
        const row = await getOwnedReleaseUnsafe(r.id);
        if (row) {
          try {
            const sub = await aggregator.submitRelease(buildAggregatorPayload(row));
            await db.execute(sql`
              UPDATE distribution_releases
              SET aggregator_release_id = ${sub.aggregatorReleaseId}, updated_at = now()
              WHERE id = ${r.id}
            `);
            activeDeliveries.set(r.id, { aggregatorReleaseId: sub.aggregatorReleaseId });
          } catch (err) {
            logger.error({ err, releaseId: r.id }, "[distribution] mock resume failed");
          }
        }
      } else {
        activeDeliveries.set(r.id, { aggregatorReleaseId: r.aggregator_release_id });
      }
    }
    if (activeDeliveries.size > 0) ensureDeliveryPoller();
  } catch (err) {
    logger.error({ err }, "[distribution] resumeActiveDeliveries failed");
  }
}

async function getOwnedReleaseUnsafe(id: string): Promise<ReleaseRow | null> {
  const result = await db.execute(sql`
    SELECT ${RELEASE_COLUMNS} FROM distribution_releases WHERE id = ${id} LIMIT 1
  `);
  return (result.rows[0] as unknown as ReleaseRow) ?? null;
}

function buildAggregatorPayload(row: ReleaseRow): AggregatorReleasePayload {
  const tracks = (row.tracks ?? []).map((t) => ({
    title: t.title,
    isrc: t.isrc,
    audioUrl: row.audio_url ?? "",
    explicit: row.explicit ?? false,
  }));
  return {
    clientReleaseId: row.id,
    title: row.title,
    artistName: row.artist_name,
    releaseType: (["single", "ep", "album"] as const).includes(row.release_type as ReleaseType)
      ? (row.release_type as ReleaseType)
      : "single",
    releaseDate: row.release_date ?? "",
    genre: row.genre ?? undefined,
    explicit: row.explicit ?? false,
    label: row.label ?? undefined,
    copyrightLine: row.copyright_line ?? undefined,
    upc: row.upc ?? undefined,
    isrc: row.isrc ?? undefined,
    tracks: tracks.length > 0 ? tracks : [{ title: row.title, audioUrl: row.audio_url ?? "", explicit: row.explicit ?? false }],
    artworkUrl: row.artwork_url ?? "",
    platforms: row.platforms ?? [],
  };
}

/* ─── Submit for distribution (paid) ───────────────────────────────────────
   POST /api/distribution/releases/:id/submit
   1. Validates the server-side release checklist (400 + checklist when incomplete).
   2. Charges the tiered fee (single 10 / EP 20 / album 30 credits).
   3. Submits the package to the configured aggregator (Too Lost when keys
      are set, otherwise the mock sandbox) and registers the delivery poller.
   4. Marks the release "packaged".

   HONESTY CONTRACT: platform_statuses is the ONLY delivery truth and comes
   from the aggregator adapter. In mock mode the API notice + UI label it a
   sandbox simulation. Credits are refunded if the aggregator submission fails. */
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

    const checklist = buildChecklist(existing);
    if (!checklistPasses(checklist)) {
      res.status(400).json({
        error: "The release isn't ready yet — complete the checklist first.",
        checklist,
      });
      return;
    }

    const releaseType = (["single", "ep", "album"] as const).includes(existing.release_type as ReleaseType)
      ? (existing.release_type as ReleaseType)
      : "single";
    const cost = RELEASE_TIER_CREDITS[releaseType];

    const balance = req.userCredits ?? 0;
    if (balance < cost) {
      res.status(402).json({
        error: "out_of_credits",
        message: `Distributing a ${releaseType} costs ${cost} credits — top up to continue.`,
      });
      return;
    }
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, cost, {
        action: `Music Distribution — ${releaseType.toUpperCase()} release`,
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `Distributing a ${releaseType} costs ${cost} credits — top up to continue.`,
        });
        return;
      }
      throw err;
    }

    /* Submit to the aggregator BEFORE marking packaged — refund if it fails. */
    const aggregator = getAggregator();
    let aggregatorReleaseId: string;
    try {
      const sub = await aggregator.submitRelease(buildAggregatorPayload(existing));
      aggregatorReleaseId = sub.aggregatorReleaseId;
    } catch (err) {
      try {
        await refundCredits(req.userId!, cost, {
          action: `Music Distribution — Refund (aggregator submission failed)`,
        });
      } catch (refundErr) {
        logger.error({ err: refundErr }, "[distribution] submit refund failed");
      }
      logger.error({ err }, "[distribution] aggregator submission failed");
      res.status(502).json({
        error: "The distributor rejected the package — your credits were refunded. Check the checklist and try again.",
      });
      return;
    }

    const queuedStatuses = (existing.platforms ?? []).map((platform) => ({
      platform,
      status: "queued" as PlatformDeliveryStatus,
      detail: aggregator.live
        ? "Package queued at the distributor."
        : "Package queued at the distributor (sandbox simulation).",
      updatedAt: new Date().toISOString(),
    }));

    const result = await db.execute(sql`
      UPDATE distribution_releases
      SET status = 'packaged',
          credits_charged = ${cost},
          aggregator = ${aggregator.name},
          aggregator_release_id = ${aggregatorReleaseId},
          platform_statuses = ${JSON.stringify(queuedStatuses)}::jsonb,
          updated_at = now()
      WHERE id = ${releaseId(req)}
      RETURNING ${RELEASE_COLUMNS}
    `);
    const row = result.rows[0] as unknown as ReleaseRow;

    activeDeliveries.set(row.id, { aggregatorReleaseId });
    ensureDeliveryPoller();

    res.json({
      release: rowToRelease(row),
      creditsUsed: cost,
      creditsRemaining,
      /* The honesty contract, in the API response itself. */
      notice: aggregator.live
        ? "Your release is with the distributor — track per-platform delivery status below."
        : "Sandbox mode: your release is moving through a simulated delivery pipeline " +
          "(queued → pending → delivered → live). No real platform has received anything yet — " +
          "add Too Lost API keys to go live.",
    });
  } catch (err) {
    logger.error({ err }, "[distribution] submit release failed");
    res.status(500).json({ error: "Couldn't submit the release — try again." });
  }
});

/* ─── Pricing (free) ────────────────────────────────────────────────────────
   GET /api/distribution/pricing — live tier pricing so the UI never hardcodes
   credit costs. Env-overridable on the server without a frontend redeploy. */
router.get("/distribution/pricing", requireAuth, (_req, res) => {
  res.json({
    tiers: [
      {
        type: "single",
        credits: RELEASE_TIER_CREDITS.single,
        label: "Single",
        blurb: "1 track — the fastest way to get a song on every platform.",
      },
      {
        type: "ep",
        credits: RELEASE_TIER_CREDITS.ep,
        label: "EP",
        blurb: "2–6 tracks — a project with room to breathe.",
      },
      {
        type: "album",
        credits: RELEASE_TIER_CREDITS.album,
        label: "Album",
        blurb: "7–30 tracks — the full statement.",
      },
    ],
    annualPlan: ANNUAL_UNLIMITED_PLAN,
    aiMetadataCost: AI_CREDIT_COST,
    aiStrategyCost: AI_CREDIT_COST,
    aggregator: getAggregator().name,
    aggregatorLive: getAggregator().live,
  });
});

/* ─── Platform delivery status (free) ──────────────────────────────────────
   GET /api/distribution/releases/:id/platforms — poll while statuses are
   non-terminal. Statuses come from the aggregator adapter only. */
router.get("/distribution/releases/:id/platforms", requireAuth, async (req, res) => {
  try {
    const row = await getOwnedRelease(releaseId(req), req.userId!);
    if (!row) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    res.json({
      platformStatuses: row.platform_statuses ?? [],
      aggregator: row.aggregator ?? "none",
      aggregatorLive: getAggregator().live,
      aggregatorReleaseId: row.aggregator_release_id,
    });
  } catch (err) {
    logger.error({ err }, "[distribution] platforms poll failed");
    res.status(500).json({ error: "Couldn't load delivery status — try again." });
  }
});

/* ─── Royalty splits (free) ─────────────────────────────────────────────────
   PUT /api/distribution/releases/:id/splits { splits: [{ name, role?, share }] }
   Shares must sum to exactly 100. Informational only — payouts are a future
   integration; the UI says so. */
const splitsSchema = z.object({
  splits: z
    .array(
      z.object({
        name: z.string().min(1, "Payee name is required.").max(120),
        role: z.string().max(80).optional().default(""),
        share: z.number().positive("Share must be positive.").max(100),
      }),
    )
    .min(1, "Add at least one payee.")
    .max(20),
});

router.put("/distribution/releases/:id/splits", requireAuth, async (req, res) => {
  const parsed = splitsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid royalty splits.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const total = parsed.data.splits.reduce((sum, s) => sum + s.share, 0);
  if (Math.abs(total - 100) > 0.01) {
    res.status(400).json({
      error: `Royalty shares must total 100% — yours total ${total.toFixed(2)}%.`,
    });
    return;
  }
  try {
    const existing = await getOwnedRelease(releaseId(req), req.userId!);
    if (!existing) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    await db.execute(sql`
      DELETE FROM distribution_royalty_splits
      WHERE release_id = ${releaseId(req)} AND user_id = ${req.userId!}
    `);
    for (const s of parsed.data.splits) {
      await db.execute(sql`
        INSERT INTO distribution_royalty_splits (id, release_id, user_id, payee_name, role, share_pct)
        VALUES (${randomUUID()}, ${releaseId(req)}, ${req.userId!}, ${s.name.trim()}, ${s.role?.trim() || null}, ${s.share})
      `);
    }
    const splits = await loadSplits(releaseId(req), req.userId!);
    res.json({ splits });
  } catch (err) {
    logger.error({ err }, "[distribution] save splits failed");
    res.status(500).json({ error: "Couldn't save royalty splits — try again." });
  }
});

/* ─── Pre-save links (free) ─────────────────────────────────────────────────
   POST /api/distribution/releases/:id/presave — mint a shareable pre-save
   slug. GET /api/distribution/presave/:slug is PUBLIC (no auth) so fans can
   open the landing page without an account. */
const APP_PUBLIC_URL = (process.env["APP_PUBLIC_URL"] ?? "https://bowdownvisuals.com").replace(/\/$/, "");

function presaveUrl(slug: string): string {
  return `${APP_PUBLIC_URL}/presave/${slug}`;
}

router.post("/distribution/releases/:id/presave", requireAuth, async (req, res) => {
  try {
    const existing = await getOwnedRelease(releaseId(req), req.userId!);
    if (!existing) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    if (existing.presave_slug) {
      res.json({ slug: existing.presave_slug, url: presaveUrl(existing.presave_slug) });
      return;
    }
    /* Retry on the astronomically-unlikely slug collision (UNIQUE constraint). */
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = randomUUID().replace(/-/g, "").slice(0, 10);
      try {
        await db.execute(sql`
          UPDATE distribution_releases SET presave_slug = ${slug}, updated_at = now()
          WHERE id = ${releaseId(req)}
        `);
        res.json({ slug, url: presaveUrl(slug) });
        return;
      } catch (err) {
        logger.warn({ err, attempt }, "[distribution] presave slug collision, retrying");
      }
    }
    res.status(500).json({ error: "Couldn't mint the pre-save link — try again." });
  } catch (err) {
    logger.error({ err }, "[distribution] presave mint failed");
    res.status(500).json({ error: "Couldn't mint the pre-save link — try again." });
  }
});

router.get("/distribution/presave/:slug", async (req, res) => {
  try {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const result = await db.execute(sql`
      SELECT ${RELEASE_COLUMNS}
      FROM distribution_releases
      WHERE presave_slug = ${slug ?? ""}
      LIMIT 1
    `);
    const row = result.rows[0] as unknown as ReleaseRow | undefined;
    if (!row) {
      res.status(404).json({ error: "Pre-save link not found." });
      return;
    }
    res.json({
      presave: {
        title: row.title,
        artistName: row.artist_name,
        artworkUrl: row.artwork_url,
        releaseDate: row.release_date,
        releaseType: row.release_type ?? "single",
        genre: row.genre,
        platforms: row.platforms ?? [],
        aggregatorLive: getAggregator().live,
      },
    });
  } catch (err) {
    logger.error({ err }, "[distribution] presave lookup failed");
    res.status(500).json({ error: "Couldn't load the pre-save page — try again." });
  }
});

/* ─── Too Lost delivery webhook ─────────────────────────────────────────────
   POST /api/distribution/webhooks/toolost — real-time delivery status.
   TO-CONFIRM: exact signature scheme in the Too Lost developer docs. This
   implementation expects an HMAC-SHA256 hex digest of the raw body in the
   `x-toolost-signature` header, keyed by TOOLOST_WEBHOOK_SECRET. Update to
   match the docs before going live. */
router.post(
  "/distribution/webhooks/toolost",
  expressRawBody(),
  async (req: Request, res: Response) => {
    const secret = process.env["TOOLOST_WEBHOOK_SECRET"];
    if (!secret) {
      res.status(503).json({ error: "Delivery webhooks are not configured." });
      return;
    }
    const signature = req.header("x-toolost-signature") ?? "";
    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from("");
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({ error: "Bad webhook signature." });
      return;
    }
    try {
      const body = JSON.parse(raw.toString("utf8")) as {
        external_id?: string;
        deliveries?: Array<{ store?: string; platform?: string; status?: string; detail?: string }>;
      };
      if (!body.external_id || !Array.isArray(body.deliveries)) {
        res.status(400).json({ error: "Malformed webhook payload." });
        return;
      }
      const releaseId = body.external_id;
      const existing = await getOwnedReleaseUnsafe(releaseId);
      if (!existing) {
        res.status(404).json({ error: "Unknown release." });
        return;
      }
      const now = new Date().toISOString();
      const statuses = body.deliveries.map((d) => {
        const native = String(d.status ?? "").toLowerCase();
        let status: PlatformDeliveryStatus = "pending";
        if (/live|published|available/.test(native)) status = "live";
        else if (/deliver/.test(native)) status = "delivered";
        else if (/fail|reject|error/.test(native)) status = "failed";
        else if (/queue/.test(native)) status = "queued";
        return {
          platform: d.store ?? d.platform ?? "unknown",
          status,
          detail: d.detail,
          updatedAt: now,
        };
      });
      await db.execute(sql`
        UPDATE distribution_releases
        SET platform_statuses = ${JSON.stringify(statuses)}::jsonb, updated_at = now()
        WHERE id = ${releaseId}
      `);
      const done = statuses.every((s) => s.status === "live" || s.status === "failed");
      if (done) activeDeliveries.delete(releaseId);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "[distribution] webhook failed");
      res.status(500).json({ error: "Webhook processing failed." });
    }
  },
);

/** express.raw() for the webhook route only — must not disturb the JSON body
    parser used by every other route. */
function expressRawBody() {
  return expressRaw({ type: "application/json" });
}

export default router;
