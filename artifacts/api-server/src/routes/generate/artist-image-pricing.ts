/**
 * Pure pricing/plan resolution for AI artist-image generation.
 * Kept dependency-free so it can be unit-tested without the server.
 */

export type ArtistImageModel = "gen4_image" | "gen4_image_turbo";
/** The three output shapes offered for artist images. */
export type ArtistImageRatio = "1080:1920" | "1080:1080" | "1920:1080";

export const GEN4_IMAGE_CREDIT_COST = 3;
export const GEN4_IMAGE_TURBO_CREDIT_COST = 2;

export interface ArtistImagePlan {
  model: ArtistImageModel;
  /** Site credits charged on success. */
  creditCost: number;
  ratio: ArtistImageRatio;
}

const VALID_RATIOS: readonly ArtistImageRatio[] = ["1080:1920", "1080:1080", "1920:1080"];

export function resolveArtistImagePlan(opts: {
  model?: string;
  ratio?: string;
  proCredits?: number;
  turboCredits?: number;
}): ArtistImagePlan {
  const useTurbo = opts.model === "gen4_image_turbo";
  const model: ArtistImageModel = useTurbo ? "gen4_image_turbo" : "gen4_image";
  const creditCost = useTurbo
    ? Number(opts.turboCredits) || GEN4_IMAGE_TURBO_CREDIT_COST
    : Number(opts.proCredits) || GEN4_IMAGE_CREDIT_COST;
  const ratio: ArtistImageRatio = (VALID_RATIOS as readonly string[]).includes(opts.ratio ?? "")
    ? (opts.ratio as ArtistImageRatio)
    : "1080:1920";
  return { model, creditCost, ratio };
}
