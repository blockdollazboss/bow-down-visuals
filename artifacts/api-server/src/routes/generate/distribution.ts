import { Router, raw as expressRaw, type Request, type Response } from "express";
import { randomUUID, createHmac, timingSafeEqual, randomInt } from "crypto";
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
export const AI_CREDIT_COST = Number(process.env["DISTRIBUTION_AI_CREDIT_COST"]) || 100;
export const DISTRIBUTION_RELEASE_CREDITS =
  Number(process.env["DISTRIBUTION_RELEASE_CREDITS"]) || 1000;

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
  ep: Number(process.env["DISTRIBUTION_EP_CREDITS"]) || 2000,
  album: Number(process.env["DISTRIBUTION_ALBUM_CREDITS"]) || 3000,
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
  "correctional",
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
  correctional: "Jails & Prisons",
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
  platforms: z.array(z.enum(DISTRIBUTION_PLATFORMS)).min(1).max(9).optional().default(["spotify"]),
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

/* ─── Release Metadata Manager: barcode helpers ────────────────────────────
   The "generate barcode" helper mints a valid-format UPC-A (12 digits with a
   correct GS1 check digit) that is explicitly labeled INTERNAL — a real,
   store-recognized UPC can only come from a distribution partner. The digits
   are random, never registered with GS1, and must never be presented to a
   store as an official UPC. */

/** GS1 check digit for the first 11 digits of a UPC-A. */
export function upcACheckDigit(first11: string): string {
  const digits = first11.split("").map((d) => Number(d));
  const oddSum = digits.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
  const evenSum = digits.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0);
  const total = oddSum * 3 + evenSum;
  return String((10 - (total % 10)) % 10);
}

/** GS1 check digit for the first 12 digits of an EAN-13. */
export function ean13CheckDigit(first12: string): string {
  const digits = first12.split("").map((d) => Number(d));
  const evenSum = digits.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0);
  const oddSum = digits.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
  const total = oddSum + evenSum * 3;
  return String((10 - (total % 10)) % 10);
}

/** Mint a valid-format UPC-A placeholder. Prefixed 09 (unassigned GS1 range)
    so it can never collide with a real registered barcode. */
export function generateInternalBarcode(): string {
  let body = "09";
  for (let i = 0; i < 9; i++) body += String(randomInt(0, 10));
  return body + upcACheckDigit(body);
}

/** Validate a manually-entered UPC-A or EAN-13 (digits + correct check digit). */
export function isValidUpc(v: string | undefined | null): boolean {
  if (!v) return true; // optional
  const digits = v.replace(/[-\s]/g, "");
  if (!/^\d+$/.test(digits)) return false;
  if (digits.length === 12) return upcACheckDigit(digits.slice(0, 11)) === digits[11];
  if (digits.length === 13) return ean13CheckDigit(digits.slice(0, 12)) === digits[12];
  return false;
}

export const UPC_KINDS = ["internal", "official"] as const;
export const TERRITORY_MODES = ["worldwide", "include", "exclude"] as const;

const territoryCodes = z
  .array(z.string().regex(/^[A-Z]{2}$/, "Territory codes must be ISO 3166-1 alpha-2 (e.g. US).").max(2))
  .max(300)
  .optional()
  .default([]);

export const createReleaseSchema = z.object({
  title: z.string().min(1, "Release title is required.").max(200),
  artistName: z.string().min(1, "Artist name is required.").max(120),
  releaseType: z.enum(RELEASE_TYPES).optional().default("single"),
  releaseDate: z.string().max(20).optional().default(""),
  platforms: z.array(z.enum(DISTRIBUTION_PLATFORMS)).max(9).optional().default([]),
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
  /* 'internal' = placeholder minted by the barcode helper; 'official' = a
     real UPC assigned via a distribution partner. Honesty: the UI must say
     so, and generated barcodes are always stored as internal. */
  upcKind: z.enum(UPC_KINDS).optional().default("internal"),
  label: z.string().max(120).optional().default(""),
  /* Custom label name / imprint (DistroKid-style). */
  labelImprint: z.string().max(120).optional().default(""),
  copyrightLine: z.string().max(200).optional().default(""),
  /* © and ℗ lines, separately editable; UI auto-suggests from label + year. */
  copyrightCLine: z.string().max(200).optional().default(""),
  copyrightPLine: z.string().max(200).optional().default(""),
  /* Subgenre alongside the primary genre. */
  subgenre: z.string().max(80).optional().default(""),
  /* Original (first) release date and preorder on-sale date. */
  originalReleaseDate: z.string().max(20).optional().default(""),
  preorderDate: z.string().max(20).optional().default(""),
  territoriesMode: z.enum(TERRITORY_MODES).optional().default("worldwide"),
  territories: territoryCodes,
  metadata: z.record(z.string(), z.unknown()).optional(),
  strategy: z.record(z.string(), z.unknown()).optional(),
});

const updateReleaseSchema = createReleaseSchema.partial();

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function outOfCredits(res: Response, action: string) {
  res.status(402).json({
    error: "out_of_credits",
    message: `You're out of Visual Bucs — top up to ${action}.`,
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
  upc_kind: string | null;
  label: string | null;
  label_imprint: string | null;
  copyright_line: string | null;
  copyright_c_line: string | null;
  copyright_p_line: string | null;
  subgenre: string | null;
  original_release_date: string | null;
  preorder_date: string | null;
  territories_mode: string | null;
  territories: string[] | null;
  song_id: string | null;
  tracks: Array<{ title: string; isrc?: string }> | null;
  aggregator: string | null;
  aggregator_release_id: string | null;
  platform_statuses: Array<{ platform: string; status: string; detail?: string; updatedAt: string }> | null;
  presave_slug: string | null;
  presave_headline?: string | null;
  presave_platform_links?: Record<string, string> | null;
  presave_bonus_url?: string | null;
  split_share_slug: string | null;
}

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  hint: string;
}

/* Canonical collaborator roles for a split agreement (DistroKid parity). */
export const SPLIT_ROLES = ["artist", "producer", "writer", "featured"] as const;
export type SplitRole = (typeof SPLIT_ROLES)[number];

export interface RoyaltySplit {
  id?: string;
  name: string;
  role?: string;
  email?: string | null;
  inviteStatus?: string;
  share: number;
  agreementVersion?: number;
  effectiveFrom?: string;
}

const RELEASE_COLUMNS = sql`
  id, user_id, title, artist_name, release_date, platforms,
  audio_url, artwork_url, metadata, strategy, status,
  credits_charged, created_at, updated_at,
  release_type, isrc, genre, explicit, explicit_declared,
  upc, upc_kind, label, label_imprint, copyright_line, copyright_c_line, copyright_p_line,
  subgenre, original_release_date, preorder_date, territories_mode, territories,
  song_id, tracks,
  aggregator, aggregator_release_id, platform_statuses, presave_slug, split_share_slug
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
    upcKind: (["internal", "official"] as const).includes(row.upc_kind as "internal")
      ? (row.upc_kind as "internal" | "official")
      : "internal",
    label: row.label,
    labelImprint: row.label_imprint,
    copyrightLine: row.copyright_line,
    copyrightCLine: row.copyright_c_line,
    copyrightPLine: row.copyright_p_line,
    subgenre: row.subgenre,
    originalReleaseDate: row.original_release_date,
    preorderDate: row.preorder_date,
    territoriesMode: (["worldwide", "include", "exclude"] as const).includes(row.territories_mode as "worldwide")
      ? (row.territories_mode as "worldwide" | "include" | "exclude")
      : "worldwide",
    territories: row.territories ?? [],
    songId: row.song_id,
    tracks: row.tracks ?? [],
    aggregator: row.aggregator ?? "none",
    aggregatorReleaseId: row.aggregator_release_id,
    platformStatuses: row.platform_statuses ?? [],
    presaveSlug: row.presave_slug,
    splitShareSlug: row.split_share_slug,
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
    res.status(502).json({ error: "Metadata generation hiccupped — your Visual Buc was refunded, try again." });
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
    res.status(502).json({ error: "Strategy generation hiccupped — your Visual Buc was refunded, try again." });
  }
});

/* Load royalty splits for a release (newest table — may not exist in old test DDLs). */
/* Load the ACTIVE royalty splits for a release (the newest agreement
   version — older versions stay in the ledger as history). */
async function loadSplits(releaseId: string, userId: string): Promise<RoyaltySplit[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, payee_name, role, payee_email, invite_status, share_pct,
             agreement_version, effective_from
      FROM distribution_royalty_splits
      WHERE release_id = ${releaseId} AND user_id = ${userId} AND superseded_at IS NULL
      ORDER BY share_pct DESC
    `);
    return (
      result.rows as Array<{
        id: string; payee_name: string; role: string | null; payee_email: string | null;
        invite_status: string | null; share_pct: string; agreement_version: number | null;
        effective_from: string | null;
      }>
    ).map((r) => ({
      id: r.id,
      name: r.payee_name,
      role: r.role ?? undefined,
      email: r.payee_email ?? null,
      inviteStatus: r.invite_status ?? "not_invited",
      share: Number(r.share_pct),
      agreementVersion: Number(r.agreement_version ?? 1),
      effectiveFrom: r.effective_from ?? undefined,
    }));
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
  if (d.upc && !isValidUpc(d.upc)) {
    res.status(400).json({ error: "That UPC/EAN looks invalid — 12-digit UPC-A or 13-digit EAN with a valid check digit." });
    return;
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
         explicit_declared, upc, upc_kind, label, label_imprint, copyright_line,
         copyright_c_line, copyright_p_line, subgenre, original_release_date,
         preorder_date, territories_mode, territories,
         metadata, strategy, status, credits_charged)
      VALUES (
        ${id}, ${req.userId!}, ${d.title.trim()}, ${d.artistName.trim()}, ${d.releaseType},
        ${d.releaseDate?.trim() || null}, ${JSON.stringify(d.platforms ?? [])}::jsonb,
        ${audioUrl}, ${d.artworkUrl?.trim() || null}, ${songId},
        ${JSON.stringify(d.tracks ?? [])}::jsonb,
        ${d.isrc || null}, ${d.genre?.trim() || null}, ${d.explicit}, ${d.explicitDeclared},
        ${d.upc?.trim() || null}, ${d.upcKind ?? "internal"},
        ${d.label?.trim() || null}, ${d.labelImprint?.trim() || null},
        ${d.copyrightLine?.trim() || null}, ${d.copyrightCLine?.trim() || null},
        ${d.copyrightPLine?.trim() || null}, ${d.subgenre?.trim() || null},
        ${d.originalReleaseDate?.trim() || null}, ${d.preorderDate?.trim() || null},
        ${d.territoriesMode ?? "worldwide"}, ${JSON.stringify(d.territories ?? [])}::jsonb,
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
    if (d.upc !== undefined && d.upc && !isValidUpc(d.upc)) {
      res.status(400).json({ error: "That UPC/EAN looks invalid — 12-digit UPC-A or 13-digit EAN with a valid check digit." });
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
      upc_kind: d.upcKind !== undefined ? d.upcKind : (existing.upc_kind ?? "internal"),
      label: d.label !== undefined ? d.label.trim() || null : existing.label,
      label_imprint: d.labelImprint !== undefined ? d.labelImprint.trim() || null : existing.label_imprint,
      copyright_line: d.copyrightLine !== undefined ? d.copyrightLine.trim() || null : existing.copyright_line,
      copyright_c_line:
        d.copyrightCLine !== undefined ? d.copyrightCLine.trim() || null : existing.copyright_c_line,
      copyright_p_line:
        d.copyrightPLine !== undefined ? d.copyrightPLine.trim() || null : existing.copyright_p_line,
      subgenre: d.subgenre !== undefined ? d.subgenre.trim() || null : existing.subgenre,
      original_release_date:
        d.originalReleaseDate !== undefined ? d.originalReleaseDate.trim() || null : existing.original_release_date,
      preorder_date: d.preorderDate !== undefined ? d.preorderDate.trim() || null : existing.preorder_date,
      territories_mode:
        d.territoriesMode !== undefined ? d.territoriesMode : (existing.territories_mode ?? "worldwide"),
      territories: d.territories !== undefined ? d.territories : (existing.territories ?? []),
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
          upc_kind = ${merged.upc_kind},
          label = ${merged.label},
          label_imprint = ${merged.label_imprint},
          copyright_line = ${merged.copyright_line},
          copyright_c_line = ${merged.copyright_c_line},
          copyright_p_line = ${merged.copyright_p_line},
          subgenre = ${merged.subgenre},
          original_release_date = ${merged.original_release_date},
          preorder_date = ${merged.preorder_date},
          territories_mode = ${merged.territories_mode},
          territories = ${JSON.stringify(merged.territories)}::jsonb,
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

/* ─── Generate internal barcode (FREE) ─────────────────────────────────────
   POST /api/distribution/releases/:id/generate-barcode
   Mints a valid-format UPC-A placeholder for the release's internal catalog
   ID. Stored with upc_kind='internal' and the UI must label it
   "Internal catalog ID — official UPC assigned when distributed via
   partner." A real, store-recognized UPC only comes from a distribution
   partner. Refuses to overwrite an official UPC. Drafts only. */
router.post("/distribution/releases/:id/generate-barcode", requireAuth, async (req, res) => {
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
    if (existing.upc && existing.upc_kind === "official") {
      res.status(409).json({
        error: "This release already has an official UPC assigned via a partner — it can't be replaced by a placeholder.",
      });
      return;
    }
    const barcode = generateInternalBarcode();
    const result = await db.execute(sql`
      UPDATE distribution_releases
      SET upc = ${barcode}, upc_kind = 'internal', updated_at = now()
      WHERE id = ${releaseId(req)}
      RETURNING ${RELEASE_COLUMNS}
    `);
    res.json({
      release: rowToRelease(result.rows[0] as unknown as ReleaseRow),
      barcode,
      kind: "internal",
      notice:
        "Internal catalog ID minted — this is a placeholder, not a store-recognized UPC. " +
        "Your official UPC is assigned when the release is distributed via a partner.",
    });
  } catch (err) {
    logger.error({ err }, "[distribution] generate-barcode failed");
    res.status(500).json({ error: "Couldn't generate the barcode — try again." });
  }
});

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
        error: "The distributor rejected the package — your Visual Bucs were refunded. Check the checklist and try again.",
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
   PUT /api/distribution/releases/:id/splits { splits: [{ name, role?, email?, share }] }
   Shares must sum to exactly 100. Versioned ledger: saving supersedes the
   previous agreement version instead of deleting it, so edits apply to
   FUTURE earnings only (DistroKid behavior) — the version effective on a
   money entry's date is the one applied to that income.
   Splits are accounting-only: actual automatic store payouts require a
   distribution partnership we don't have, and the UI says so. */
const SPLIT_ROLE_VALUES = ["artist", "producer", "writer", "featured"] as const;
const splitRoleSchema = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().toLowerCase().pipe(z.enum(SPLIT_ROLE_VALUES)).optional(),
  )
  .optional();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const splitsSchema = z.object({
  splits: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Payee name is required.").max(120),
        role: splitRoleSchema,
        email: z
          .string()
          .trim()
          .max(254)
          .refine((s) => s === "" || EMAIL_RE.test(s), "That email doesn't look valid.")
          .optional()
          .default(""),
        share: z.number().positive("Share must be positive.").max(100),
      }),
    )
    .min(1, "Add at least one payee.")
    .max(20),
});

async function nextAgreementVersion(releaseId: string, userId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(agreement_version), 0) + 1 AS v
    FROM distribution_royalty_splits
    WHERE release_id = ${releaseId} AND user_id = ${userId}
  `);
  return Number((result.rows[0] as { v: string | number } | undefined)?.v ?? 1);
}

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
    /* Versioned save: the old agreement becomes history, the new one takes
       effect now. Past earnings keep their old splits; future earnings use
       this version. */
    const version = await nextAgreementVersion(releaseId(req), req.userId!);
    await db.execute(sql`
      UPDATE distribution_royalty_splits
      SET superseded_at = now()
      WHERE release_id = ${releaseId(req)} AND user_id = ${req.userId!} AND superseded_at IS NULL
    `);
    for (const s of parsed.data.splits) {
      await db.execute(sql`
        INSERT INTO distribution_royalty_splits
          (id, release_id, user_id, payee_name, role, payee_email, invite_status,
           share_pct, agreement_version, effective_from)
        VALUES (${randomUUID()}, ${releaseId(req)}, ${req.userId!}, ${s.name.trim()},
          ${s.role ?? null}, ${s.email.trim() || null}, 'not_invited',
          ${s.share}, ${version}, now())
      `);
    }
    const splits = await loadSplits(releaseId(req), req.userId!);
    res.json({ splits, agreementVersion: version });
  } catch (err) {
    logger.error({ err }, "[distribution] save splits failed");
    res.status(500).json({ error: "Couldn't save royalty splits — try again." });
  }
});

/* ─── Split agreement share link ───────────────────────────────────────────
   POST /api/distribution/releases/:id/splits/share-link — mint (idempotently)
   a public slug for the split agreement summary. The frontend appends
   ?ref=CODE to the shared URL so collaborators land on your referral link. */
router.post("/distribution/releases/:id/splits/share-link", requireAuth, async (req, res) => {
  try {
    const existing = await getOwnedRelease(releaseId(req), req.userId!);
    if (!existing) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    if (existing.split_share_slug) {
      res.json({ slug: existing.split_share_slug, url: `${APP_PUBLIC_URL}/splits/${existing.split_share_slug}` });
      return;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = randomInt(0, 0xffffffffff).toString(16).padStart(10, "0");
      try {
        await db.execute(sql`
          UPDATE distribution_releases
          SET split_share_slug = ${slug}, updated_at = now()
          WHERE id = ${releaseId(req)} AND user_id = ${req.userId!}
        `);
        res.json({ slug, url: `${APP_PUBLIC_URL}/splits/${slug}` });
        return;
      } catch (err) {
        /* Slug collision — astronomically unlikely; retry. */
        if ((err as { code?: string })?.code !== "23505") throw err;
      }
    }
    res.status(500).json({ error: "Couldn't mint a share link — try again." });
  } catch (err) {
    logger.error({ err }, "[distribution] split share-link failed");
    res.status(500).json({ error: "Couldn't mint a share link — try again." });
  }
});

/* GET /api/distribution/splits/:slug — PUBLIC split agreement summary.
   No auth: this page is meant to be shared with collaborators. Shows only
   the agreement (names, roles, shares) — never emails, invite tokens, or
   the creator's account info. */
router.get("/distribution/splits/:slug", async (req, res) => {
  const slug = (req.params.slug ?? "").trim();
  if (!/^[a-f0-9]{10}$/.test(slug)) {
    res.status(404).json({ error: "Split agreement not found." });
    return;
  }
  try {
    const releaseResult = await db.execute(sql`
      SELECT id, title, artist_name
      FROM distribution_releases
      WHERE split_share_slug = ${slug}
      LIMIT 1
    `);
    const release = releaseResult.rows[0] as
      | { id: string; title: string; artist_name: string }
      | undefined;
    if (!release) {
      res.status(404).json({ error: "Split agreement not found." });
      return;
    }
    const splitsResult = await db.execute(sql`
      SELECT payee_name, role, share_pct, agreement_version, effective_from
      FROM distribution_royalty_splits
      WHERE release_id = ${release.id} AND superseded_at IS NULL
      ORDER BY share_pct DESC
    `);
    const splits = (splitsResult.rows as Array<{
      payee_name: string; role: string | null; share_pct: string;
      agreement_version: number | null; effective_from: string | null;
    }>).map((r) => ({
      name: r.payee_name,
      role: r.role,
      share: Number(r.share_pct),
    }));
    res.json({
      title: release.title,
      artistName: release.artist_name,
      splits,
      agreementVersion: splitsResult.rows.length
        ? Number((splitsResult.rows[0] as { agreement_version: number | null }).agreement_version ?? 1)
        : 0,
      effectiveFrom: splitsResult.rows.length
        ? (splitsResult.rows[0] as { effective_from: string | null }).effective_from
        : null,
      disclaimer:
        "Split accounting for this release's logged income. Automatic payouts " +
        "directly from stores need a distribution partner — these shares are " +
        "the agreed accounting for earnings the creator logs.",
    });
  } catch (err) {
    logger.error({ err }, "[distribution] split summary failed");
    res.status(500).json({ error: "Couldn't load the split agreement — try again." });
  }
});

/* ─── Split invites (stub until an email provider is configured) ──────────
   POST /api/distribution/releases/:id/splits/invite { splitId } —
   records the invite on the split row. Real emails are NOT sent unless an
   email provider is configured; when it isn't, this 501s with a clear
   message the UI shows (share the agreement link instead). */
const EMAIL_PROVIDER_CONFIGURED = Boolean(
  process.env["RESEND_API_KEY"] || process.env["SENDGRID_API_KEY"] || process.env["SMTP_HOST"],
);

router.post("/distribution/releases/:id/splits/invite", requireAuth, async (req, res) => {
  const parsed = z.object({ splitId: z.string().uuid() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "splitId is required." });
    return;
  }
  try {
    const existing = await getOwnedRelease(releaseId(req), req.userId!);
    if (!existing) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    const check = await db.execute(sql`
      SELECT id, payee_name, payee_email
      FROM distribution_royalty_splits
      WHERE id = ${parsed.data.splitId}
        AND release_id = ${releaseId(req)}
        AND user_id = ${req.userId!}
        AND superseded_at IS NULL
      LIMIT 1
    `);
    const split = check.rows[0] as
      | { id: string; payee_name: string; payee_email: string | null }
      | undefined;
    if (!split) {
      res.status(404).json({ error: "Collaborator not found." });
      return;
    }
    if (!split.payee_email) {
      res.status(400).json({ error: "Add an email for this collaborator before inviting them." });
      return;
    }
    const inviteToken = randomUUID();
    await db.execute(sql`
      UPDATE distribution_royalty_splits
      SET invite_status = 'invited', invite_token = ${inviteToken}
      WHERE id = ${split.id}
    `);
    if (!EMAIL_PROVIDER_CONFIGURED) {
      /* Stub: invite recorded, no email sent. UI shows the message and falls
         back to sharing the agreement link. */
      res.status(501).json({
        error: "No email provider is configured, so the invite email can't be sent. The invite was recorded — share your split agreement link with them instead.",
        recorded: true,
        emailSent: false,
      });
      return;
    }
    /* An email provider is configured but invite delivery isn't wired yet —
       recorded honestly rather than pretending to send. */
    res.json({ recorded: true, emailSent: false, inviteToken });
  } catch (err) {
    logger.error({ err }, "[distribution] split invite failed");
    res.status(500).json({ error: "Couldn't record the invite — try again." });
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
      SELECT ${RELEASE_COLUMNS},
             presave_headline, presave_platform_links, presave_bonus_url,
             (SELECT COUNT(*) FROM presave_follows WHERE release_id = distribution_releases.id) AS follower_count,
             (SELECT COUNT(*) FROM presave_shares WHERE release_id = distribution_releases.id) AS share_count
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
        /* ── HyperFollow upgrades (migration 0082) ── */
        headline: row.presave_headline ?? null,
        platformLinks: (row.presave_platform_links ?? {}) as Record<string, string>,
        bonusUrl: row.presave_bonus_url ?? null,
        followerCount: Number((row as unknown as Record<string, unknown>)["follower_count"] ?? 0),
        shareCount: Number((row as unknown as Record<string, unknown>)["share_count"] ?? 0),
      },
    });
  } catch (err) {
    logger.error({ err }, "[distribution] presave lookup failed");
    res.status(500).json({ error: "Couldn't load the pre-save page — try again." });
  }
});

/* ─── Pre-save upgrades (HyperFollow parity, migration 0082) ────────────
   POST /api/distribution/presave/:slug/follow (public) — fan pre-saves /
   joins the notify list: stored on the release AND subscribed to the
   artist's email list (auto-provisioned from the artist name when needed).
   POST /api/distribution/presave/:slug/share (public) — records a share
   action; returns the bonus content URL when the artist set one (share to
   unlock).
   PATCH /api/distribution/releases/:id/presave-settings (auth) — artist
   sets headline, platform URLs, bonus URL. Free.
   GET /api/distribution/releases/:id/presave-stats (auth) — follower/share
   counts + recent follows for the artist dashboard. Free. */

const followBodySchema = z.object({
  email: z.string().email("Enter a valid email address.").max(254),
  name: z.string().max(120).optional().default(""),
  platform: z.string().max(60).optional().default(""),
});

const shareBodySchema = z.object({
  channel: z.string().max(40).optional().default(""),
});

/* Slug → release id + artist (public, minimal fields). */
async function getPublicReleaseBySlug(
  slug: string,
): Promise<{ id: string; userId: string; artistName: string; bonusUrl: string | null } | null> {
  const result = await db.execute(sql`
    SELECT id, user_id, artist_name, presave_bonus_url
    FROM distribution_releases
    WHERE presave_slug = ${slug}
    LIMIT 1
  `);
  const row = result.rows[0] as
    | { id: string; user_id: string; artist_name: string; presave_bonus_url: string | null }
    | undefined;
  if (!row) return null;
  return { id: row.id, userId: row.user_id, artistName: row.artist_name, bonusUrl: row.presave_bonus_url };
}

function slugifyHandle(base: string): string {
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34);
  return clean || "fans";
}

/* Ensure the artist has an email list — reuse their oldest list, or create
   one named after the artist on first fan signup. */
async function ensureArtistList(userId: string, artistName: string): Promise<{ id: string; handle: string }> {
  const existing = await db.execute(sql`
    SELECT id, handle FROM email_lists
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const row = existing.rows[0] as { id: string; handle: string } | undefined;
  if (row) return { id: row.id, handle: row.handle };

  const base = `${slugifyHandle(artistName)}-fans`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const handle = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await db.execute(sql`SELECT id FROM email_lists WHERE handle = ${handle} LIMIT 1`);
    if (taken.rows.length > 0) continue;
    const created = await db.execute(sql`
      INSERT INTO email_lists (user_id, name, handle, description)
      VALUES (${userId}, ${`${artistName} fans`}, ${handle}, ${"Fans from pre-save pages."})
      RETURNING id, handle
    `);
    const createdRow = created.rows[0] as { id: string; handle: string };
    return { id: createdRow.id, handle: createdRow.handle };
  }
  throw new Error("handle_unavailable");
}

async function subscribeEmailListFan(listId: string, email: string, name: string): Promise<void> {
  const existing = await db.execute(sql`
    SELECT id, unsubscribed_at FROM email_subscribers
    WHERE list_id = ${listId} AND email = ${email}
    LIMIT 1
  `);
  const row = existing.rows[0] as { id: string; unsubscribed_at: string | null } | undefined;
  if (!row) {
    await db.execute(sql`
      INSERT INTO email_subscribers (list_id, email, name, source, confirmed)
      VALUES (${listId}, ${email}, ${name || null}, ${"presave"}, ${true})
    `);
    return;
  }
  await db.execute(sql`
    UPDATE email_subscribers
    SET unsubscribed_at = NULL, name = COALESCE(NULLIF(${name}, ''), name), source = ${"presave"}
    WHERE id = ${row.id}
  `);
}

router.post("/distribution/presave/:slug/follow", publicApiLimiter, async (req, res) => {
  try {
    const parsed = followBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid email address.", code: "invalid_email" });
      return;
    }
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const release = await getPublicReleaseBySlug(slug ?? "");
    if (!release) {
      res.status(404).json({ error: "Pre-save link not found." });
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();
    const name = parsed.data.name.trim();
    const platform = parsed.data.platform.trim().toLowerCase();

    /* Idempotent follow: re-following updates the name/platform. */
    const followed = await db.execute(sql`
      INSERT INTO presave_follows (release_id, email, name, platform, source)
      VALUES (${release.id}, ${email}, ${name || null}, ${platform || null}, ${"presave"})
      ON CONFLICT (release_id, email) DO UPDATE SET
        name = COALESCE(NULLIF(EXCLUDED.name, ''), presave_follows.name),
        platform = COALESCE(NULLIF(EXCLUDED.platform, ''), presave_follows.platform)
      RETURNING (xmax = 0) AS inserted
    `);
    const followedRow = followed.rows[0] as { inserted: boolean } | undefined;

    /* Also join the artist's email list — this is the fan-list handoff. */
    try {
      const list = await ensureArtistList(release.userId, release.artistName);
      await subscribeEmailListFan(list.id, email, name);
    } catch (err) {
      logger.warn({ err }, "[distribution] presave email-list subscribe failed (non-fatal)");
    }

    const count = await db.execute(sql`
      SELECT COUNT(*) AS c FROM presave_follows WHERE release_id = ${release.id}
    `);
    res.json({
      ok: true,
      alreadyFollowing: followedRow ? !followedRow.inserted : false,
      followerCount: Number((count.rows[0] as { c: string | number }).c ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "[distribution] presave follow failed");
    res.status(500).json({ error: "Couldn't save your pre-save — try again." });
  }
});

router.post("/distribution/presave/:slug/share", publicApiLimiter, async (req, res) => {
  try {
    const parsed = shareBodySchema.safeParse(req.body ?? {});
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const release = await getPublicReleaseBySlug(slug ?? "");
    if (!release) {
      res.status(404).json({ error: "Pre-save link not found." });
      return;
    }
    await db.execute(sql`
      INSERT INTO presave_shares (release_id, channel)
      VALUES (${release.id}, ${parsed.success ? parsed.data.channel.trim().toLowerCase() || null : null})
    `);
    const count = await db.execute(sql`
      SELECT COUNT(*) AS c FROM presave_shares WHERE release_id = ${release.id}
    `);
    res.json({
      ok: true,
      shareCount: Number((count.rows[0] as { c: string | number }).c ?? 0),
      /* Share-to-unlock: bonus content revealed after the fan shares. */
      bonusUrl: release.bonusUrl,
    });
  } catch (err) {
    logger.error({ err }, "[distribution] presave share failed");
    res.status(500).json({ error: "Couldn't record your share — try again." });
  }
});

const presaveSettingsSchema = z.object({
  headline: z.string().max(140).optional(),
  platformLinks: z.record(z.string(), z.string().max(500)).optional(),
  bonusUrl: z.string().max(500).optional(),
});

const PRESAVE_LINK_PLATFORMS = new Set([
  "spotify", "apple_music", "youtube_music", "tiktok",
  "amazon_music", "deezer", "tidal",
]);

function cleanUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return null;
  return v;
}

router.patch("/distribution/releases/:id/presave-settings", requireAuth, async (req, res) => {
  try {
    const release = await getOwnedRelease(releaseId(req), req.userId!);
    if (!release) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    const parsed = presaveSettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid pre-save settings." });
      return;
    }
    const { headline, platformLinks, bonusUrl } = parsed.data;

    /* Keep only known platform keys with real http(s) URLs. */
    const links: Record<string, string> = {};
    if (platformLinks) {
      for (const [key, value] of Object.entries(platformLinks)) {
        const clean = cleanUrl(value);
        if (clean && PRESAVE_LINK_PLATFORMS.has(key)) links[key] = clean;
      }
    }

    const current = await db.execute(sql`
      SELECT presave_headline, presave_platform_links, presave_bonus_url
      FROM distribution_releases WHERE id = ${release.id}
    `);
    const cur = (current.rows[0] ?? {}) as {
      presave_headline?: string | null; presave_platform_links?: Record<string, string> | null; presave_bonus_url?: string | null;
    };
    const currentLinks = (cur.presave_platform_links ?? {}) as Record<string, string>;
    const merged = platformLinks ? links : currentLinks;
    const nextHeadline = headline !== undefined ? headline.trim() || null : (cur.presave_headline ?? null);
    const nextBonus = bonusUrl !== undefined ? cleanUrl(bonusUrl) : (cur.presave_bonus_url ?? null);

    await db.execute(sql`
      UPDATE distribution_releases
      SET presave_headline = ${nextHeadline},
          presave_platform_links = ${JSON.stringify(merged)}::jsonb,
          presave_bonus_url = ${nextBonus},
          updated_at = now()
      WHERE id = ${release.id}
    `);
    res.json({
      ok: true,
      settings: { headline: nextHeadline, platformLinks: merged, bonusUrl: nextBonus },
    });
  } catch (err) {
    logger.error({ err }, "[distribution] presave settings save failed");
    res.status(500).json({ error: "Couldn't save pre-save settings — try again." });
  }
});

router.get("/distribution/releases/:id/presave-stats", requireAuth, async (req, res) => {
  try {
    const release = await getOwnedRelease(releaseId(req), req.userId!);
    if (!release) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    const [followCount, shareCount, recent, settingsRow] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) AS c FROM presave_follows WHERE release_id = ${release.id}`),
      db.execute(sql`SELECT COUNT(*) AS c FROM presave_shares WHERE release_id = ${release.id}`),
      db.execute(sql`
        SELECT email, name, platform, created_at
        FROM presave_follows
        WHERE release_id = ${release.id}
        ORDER BY created_at DESC
        LIMIT 50
      `),
      db.execute(sql`
        SELECT presave_headline, presave_platform_links, presave_bonus_url
        FROM distribution_releases
        WHERE id = ${release.id}
        LIMIT 1
      `),
    ]);
    const s = (settingsRow.rows[0] ?? {}) as {
      presave_headline?: string | null; presave_platform_links?: Record<string, string> | null; presave_bonus_url?: string | null;
    };
    res.json({
      settings: {
        headline: s.presave_headline ?? null,
        platformLinks: s.presave_platform_links ?? {},
        bonusUrl: s.presave_bonus_url ?? null,
      },
      followers: Number((followCount.rows[0] as { c: string | number }).c ?? 0),
      shares: Number((shareCount.rows[0] as { c: string | number }).c ?? 0),
      recentFollows: recent.rows as Array<{
        email: string; name: string | null; platform: string | null; created_at: string;
      }>,
    });
  } catch (err) {
    logger.error({ err }, "[distribution] presave stats failed");
    res.status(500).json({ error: "Couldn't load pre-save stats — try again." });
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
