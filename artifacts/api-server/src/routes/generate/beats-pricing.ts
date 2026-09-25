import { z } from "zod";

/* ── Beat Marketplace pricing contract ─────────────────────────────────────
   Listing beats is FREE. The site takes a 15% commission on sales.
   The AI tag suggester costs 1 credit (BEAT_AI_TAGS_CREDIT_COST,
   env-overridable).
   NOTE: BEAT_LICENSE_TIERS / BEAT_SALE_COMMISSION_PCT mirror the DB schema
   (lib/db/src/schema/beats.ts). They're defined here (not imported from
   @workspace/db) so the pricing module stays dependency-light. */

/** License tiers available on every beat. */
export const BEAT_LICENSE_TIERS = ["basic", "premium", "exclusive"] as const;
export type BeatLicenseTier = (typeof BEAT_LICENSE_TIERS)[number];

/** Site commission on beat sales (percent, integer). */
export const BEAT_SALE_COMMISSION_PCT = 15;

export const BEAT_AI_TAGS_CREDIT_COST = 1;

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
