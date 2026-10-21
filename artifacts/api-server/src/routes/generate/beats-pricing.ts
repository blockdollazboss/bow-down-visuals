import { z } from "zod";

/* ── Beat Marketplace pricing contract ─────────────────────────────────────
   Listing beats is FREE. The site takes a 15% commission on sales.
   The AI tag suggester costs 1 Visual Buc (BEAT_AI_TAGS_CREDIT_COST,
   env-overridable).
   NOTE: BEAT_LICENSE_TIERS / BEAT_SALE_COMMISSION_PCT mirror the DB schema
   (lib/db/src/schema/beats.ts). They're defined here (not imported from
   @workspace/db) so the pricing module stays dependency-light. */

/** License tiers available on every beat. */
export const BEAT_LICENSE_TIERS = ["basic", "premium", "exclusive"] as const;
export type BeatLicenseTier = (typeof BEAT_LICENSE_TIERS)[number];

/** Site commission on beat sales (percent, integer). */
export const BEAT_SALE_COMMISSION_PCT = 15;

export const BEAT_AI_TAGS_CREDIT_COST = 100;

/** Env-overridable AI tag suggester cost. */
export function getBeatAiTagsCost(): number {
  const v = Number(process.env["BEAT_AI_TAGS_CREDITS"]);
  return Number.isFinite(v) && v > 0 ? v : BEAT_AI_TAGS_CREDIT_COST;
}

/** Env-overridable commission percent. */
export function getBeatCommissionPct(): number {
  const v = Number(process.env["BEAT_SALE_COMMISSION_PCT"]);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : BEAT_SALE_COMMISSION_PCT;
}

export function isBeatLicenseTier(tier: unknown): tier is BeatLicenseTier {
  return typeof tier === "string" && (BEAT_LICENSE_TIERS as readonly string[]).includes(tier);
}

/* ── License terms (migration 0187) ────────────────────────────────────────
   Mirrors BeatLicenseTerms / BEAT_LICENSE_FORMATS in
   lib/db/src/schema/beats.ts. A null cap means the license does not cap
   that use (unlimited); a null termYears means no fixed term. */

/** Delivery formats a license can grant. */
export const BEAT_LICENSE_FORMATS = ["mp3", "wav_mp3", "wav_mp3_stems", "ownership_stems"] as const;
export type BeatLicenseFormat = (typeof BEAT_LICENSE_FORMATS)[number];

export interface BeatLicenseTerms {
  name: string;
  format: BeatLicenseFormat;
  streamsCap: number | null;
  salesCap: number | null;
  musicVideosCap: number | null;
  radioTvAllowed: boolean;
  livePerformancesCap: number | null;
  termYears: number | null;
  territory: string;
  creditLine: string | null;
  termsNote: string | null;
  isExclusive: boolean;
}

/** The standing terms of the three fixed tiers — exactly what their
    marketplace blurbs have always promised (en.json beats.tier*Blurb):
    Basic "MP3 lease · 1 music video · 50k streams", Premium "WAV + MP3 ·
    2 music videos · 500k streams", Exclusive "Full ownership · stems ·
    unlimited". Fixed-tier purchases snapshot these terms, so a buyer's
    record shows the same terms a custom template would. */
export function defaultTermsForTier(tier: BeatLicenseTier): BeatLicenseTerms {
  const base: BeatLicenseTerms = {
    name: tier,
    format: "mp3",
    streamsCap: null,
    salesCap: null,
    musicVideosCap: null,
    radioTvAllowed: false,
    livePerformancesCap: null,
    termYears: null,
    territory: "Worldwide",
    creditLine: null,
    termsNote: null,
    isExclusive: false,
  };
  if (tier === "basic") {
    return { ...base, name: "Basic", streamsCap: 50_000, musicVideosCap: 1 };
  }
  if (tier === "premium") {
    return { ...base, name: "Premium", format: "wav_mp3", streamsCap: 500_000, musicVideosCap: 2 };
  }
  return { ...base, name: "Exclusive", format: "ownership_stems", isExclusive: true };
}

/** Producer-custom template payload. Prices are the producer's own;
    the 15% commission applies on top at sale time, exactly as for tier
    prices. Caps accept null = unlimited. */
const capField = z.number().int().min(0).max(2_147_483_647).nullable().optional();

export const beatLicenseTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  priceCents: z.number().int().min(0).max(100_000_00),
  isExclusive: z.boolean().default(false),
  format: z.enum(BEAT_LICENSE_FORMATS).default("mp3"),
  streamsCap: capField,
  salesCap: capField,
  musicVideosCap: capField,
  radioTvAllowed: z.boolean().default(false),
  livePerformancesCap: capField,
  termYears: z.number().int().min(1).max(100).nullable().optional(),
  territory: z.string().trim().min(1).max(60).default("Worldwide"),
  creditLine: z.string().trim().max(200).nullable().optional(),
  termsNote: z.string().trim().max(2000).nullable().optional(),
});

export type BeatLicenseTemplateInput = z.infer<typeof beatLicenseTemplateSchema>;

/** Patch payload: every field optional and NO defaults — an omitted
    field must leave the stored value untouched, never reset it. */
export const beatLicenseTemplatePatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  priceCents: z.number().int().min(0).max(100_000_00).optional(),
  isExclusive: z.boolean().optional(),
  format: z.enum(BEAT_LICENSE_FORMATS).optional(),
  streamsCap: capField,
  salesCap: capField,
  musicVideosCap: capField,
  radioTvAllowed: z.boolean().optional(),
  livePerformancesCap: capField,
  termYears: z.number().int().min(1).max(100).nullable().optional(),
  territory: z.string().trim().min(1).max(60).optional(),
  creditLine: z.string().trim().max(200).nullable().optional(),
  termsNote: z.string().trim().max(2000).nullable().optional(),
});

export type BeatLicenseTemplatePatch = z.infer<typeof beatLicenseTemplatePatchSchema>;

/** Normalize a validated template payload into the terms shape that is
    stored on the template row and snapshotted onto licenses at sale. */
export function termsFromTemplateInput(input: BeatLicenseTemplateInput): BeatLicenseTerms {
  return {
    name: input.name,
    format: input.format,
    streamsCap: input.streamsCap ?? null,
    salesCap: input.salesCap ?? null,
    musicVideosCap: input.musicVideosCap ?? null,
    radioTvAllowed: input.radioTvAllowed,
    livePerformancesCap: input.livePerformancesCap ?? null,
    termYears: input.termYears ?? null,
    territory: input.territory,
    creditLine: input.creditLine ?? null,
    termsNote: input.termsNote ?? null,
    isExclusive: input.isExclusive,
  };
}

/** Commission in integer cents, rounded to the nearest cent. */
export function commissionFor(priceCents: number): number {
  return Math.round((priceCents * getBeatCommissionPct()) / 100);
}

/** Producer payout in integer cents (price minus commission). */
export function producerPayoutFor(priceCents: number): number {
  return priceCents - commissionFor(priceCents);
}

/* ── Validation ──────────────────────────────────────────────────────────── */

export const BEAT_GENRES = [
  "hip-hop",
  "trap",
  "drill",
  "r&b",
  "afrobeats",
  "pop",
  "edm",
  "lofi",
  "rock",
  "latin",
] as const;

export const beatMetadataSchema = z.object({
  title: z.string().trim().min(1).max(120),
  audioUrl: z.string().url().max(2000),
  audioPath: z.string().max(500).optional(),
  previewUrl: z.string().url().max(2000).optional(),
  genre: z.string().trim().min(1).max(40).default("hip-hop"),
  bpm: z.number().int().min(40).max(220).optional(),
  musicalKey: z.string().trim().max(12).optional(),
  moodTags: z.array(z.string().trim().min(1).max(24)).max(10).default([]),
  description: z.string().trim().max(1000).optional(),
  basicPriceCents: z.number().int().min(0).max(10_000_00).default(2999),
  premiumPriceCents: z.number().int().min(0).max(10_000_00).default(9999),
  exclusivePriceCents: z.number().int().min(0).max(100_000_00).default(49999),
});

export type BeatMetadata = z.infer<typeof beatMetadataSchema>;

export const beatFiltersSchema = z.object({
  genre: z.string().trim().max(40).optional(),
  mood: z.string().trim().max(24).optional(),
  minBpm: z.coerce.number().int().min(40).max(220).optional(),
  maxBpm: z.coerce.number().int().min(40).max(220).optional(),
  key: z.string().trim().max(12).optional(),
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export type BeatFilters = z.infer<typeof beatFiltersSchema>;
