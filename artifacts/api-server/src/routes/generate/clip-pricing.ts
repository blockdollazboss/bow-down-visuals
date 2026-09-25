/**
 * Pure pricing/plan resolution for the Runway clip generator.
 * Kept dependency-free so it can be unit-tested without the server.
 */

export type ClipModel = "gen4.5" | "seedance2_5";
export type ClipResolution = "720p" | "1080p";
/** The four Seedance 2.5 ratios this route ever requests. */
export type SeedanceRatio = "1280:720" | "720:1280" | "1920:1080" | "1080:1920";

export const GEN45_CREDIT_COST = 4;
export const SEEDANCE_CREDITS_PER_SEC_FALLBACK = 1.5;
export const SEEDANCE_MIN_DURATION_SEC = 3;
export const SEEDANCE_MAX_DURATION_SEC = 30;

export interface ClipPlan {
  model: ClipModel;
  useSeedance: boolean;
  /** Resolved clip length in seconds (5 for gen4.5, clamped 3–30 for seedance). */
  durationSec: number;
  /** Site credits charged on success. */
  creditCost: number;
  /** Runway ratio string for the requested orientation + resolution tier. */
  seedanceRatio: SeedanceRatio;
}

export function resolveClipPlan(opts: {
  model?: string;
  durationSec?: number | string;
  resolution?: string;
  ratio?: string;
  creditsPerSec?: number;
}): ClipPlan {
  const useSeedance = opts.model === "seedance2_5";
  const creditsPerSec = Number(opts.creditsPerSec) || SEEDANCE_CREDITS_PER_SEC_FALLBACK;
  const durationSec = useSeedance
    ? Math.min(
        SEEDANCE_MAX_DURATION_SEC,
        Math.max(SEEDANCE_MIN_DURATION_SEC, Math.round(Number(opts.durationSec) || 5)),
      )
    : 5;
  const creditCost = useSeedance ? Math.ceil(durationSec * creditsPerSec) : GEN45_CREDIT_COST;
  const landscape = opts.ratio === "1280:720";
  const hiRes = opts.resolution === "1080p";
  const seedanceRatio: SeedanceRatio = landscape
    ? hiRes ? "1920:1080" : "1280:720"
    : hiRes ? "1080:1920" : "720:1280";
  return {
    model: useSeedance ? "seedance2_5" : "gen4.5",
    useSeedance,
    durationSec,
    creditCost,
    seedanceRatio,
  };
}
