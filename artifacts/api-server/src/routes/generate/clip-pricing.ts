/**
 * Pure pricing/plan resolution for the Runway clip generator.
 * Kept dependency-free so it can be unit-tested without the server.
 */

export type ClipModel = "gen4.5" | "seedance2_5";
export type ClipResolution = "720p" | "1080p";
/** The four Seedance 2.5 ratios this route ever requests. */
ortpe SeedanceRatio = "1280:720" | "720:1280" | "1920:1080" | "1080:1920";
export const GEN45_CREDIT_COST = 
      4;
/* Resolution-aware Seedance 2.5 site-credit rates (credits per output second).
   Grounded in the Runway Dev API rate card (docs.dev.runwayml.com/guides/pricing):
   seedance2_5 bills 30 credits/sec at 720p and 68 credits/sec at 1080p, with API
   credits at $0.01 each, so provider cost is $0.30/sec (720p) / $0.68/sec (1080p).
   Reference images and audio are free on this route, and the site's pipeline
   uses image references only, so there is no input-video surcharge. At ~$0.50
   per site credit: 3/sec at 720p retails $1.50/sec = 5.0x margin; 6/sec at
   1080p retails $3.00/sec = ~4.4x margin. */
export const SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT = 3;
export const SEEDANCE_1080P_CREDITS_PER_SEC_DEFAULT = 6;
/** Legacy flat fallback (pre-resolution-aware pricing). Kept exported so old
    imports keep compiling; do not use for new code. */
export const SEEDANCE_CREDITS_PER_SEC_FALLBACK = 1.5;
export const SEEDANCE_MIN_DURATION_SEC = 3;
export const SEEDANCE_MAX_DURATION_SEC = 30;

/* ── Explicit approval gate ─────────────────────────────────────────────────
   The per-scene Seedance price above is a PROPOSAL until the user approves it.
   While SEEDANCE_PRICING_APPROVED is false, the server refuses every
   seedance2_5 submission BEFORE any Runway task is created, any credit is
   checked, or any pending task is tracked: nothing generates and nothing
   moves. Flip to true only after explicit user approval, in a reviewed commit
   — never as a drive-by. */
export const SEEDANCE_PRICING_APPROVED = true; // flipped 2026-09-25 after explicit user approval of 3/6 credits/sec
/** Bump when the proposed rates change, so an approval is tied to a version. */
export const SEEDANCE_PRICING_VERSION = "2026-09-25-resolution-aware";

export interface ClipPlan {
  model: ClipModel;
  useSeedance: boolean;
  /** Resolved clip length in seconds (5 for gen4.5, clamped 3–30 for seedance). */
  durationSec: number;
  /** Site credits charged on success. */
  creditCost: number;
  /** Runway ratio string for the requested orientation + resolution tier. */
  seedanceRatio: SeedanceRatio;
  /** False until the user approves the Seedance price (explicit gate). */
  pricingApproved: boolean;
}

export function resolveClipPlan(opts: {
  model?: string;
  durationSec?: number | string;
  resolution?: string;
  ratio?: string;
  creditsPerSec720p?: number;
  creditsPerSec1080p?: number;
}): ClipPlan {
  const useSeedance = opts.model === "seedance2_5";
  const landscape = opts.ratio === "1280:720";
  const hiRes = opts.resolution === "1080p";
  const creditsPerSec = hiRes
    ? Number(opts.creditsPerSec1080p) || SEEDANCE_1080P_CREDITS_PER_SEC_DEFAULT
    : Number(opts.creditsPerSec720p) || SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT;
  const durationSec = useSeedance
    ? Math.min(
        SEEDANCE_MAX_DURATION_SEC,
        Math.max(SEEDANCE_MIN_DURATION_SEC, Math.round(Number(opts.durationSec) || 5)),
      )
    : 5;
  const creditCost = useSeedance ? Math.ceil(durationSec * creditsPerSec) : GEN45_CREDIT_COST;
  const seedanceRatio: SeedanceRatio = landscape
    ? hiRes ? "1920:1080" : "1280:720"
    : hiRes ? "1080:1920" : "720:1280";
  return {
    model: useSeedance ? "seedance2_5" : "gen4.5",
    useSeedance,
    durationSec,
    creditCost,
    seedanceRatio,
    pricingApproved: SEEDANCE_PRICING_APPROVED,
  };
}
