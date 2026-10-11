/**
 * Pure pricing/plan resolution for AI artist-image generation.
 * Kept dependency-free so it can be unit-tested without the server.
 */

export type ArtistImageModel = "gen4_image" | "gen4_image_turbo" | "gpt-image-2.5-sunburst" | "nano-banana-2.1";
/** The three output shapes offered for artist images. */
export type ArtistImageRatio = "1080:1920" | "1080:1080" | "1920:1080";

export const GEN4_IMAGE_CREDIT_COST = 200;
export const GEN4_IMAGE_TURBO_CREDIT_COST = 100;
/**
 * Draft credit price for GPT Image 2.5 Sunburst (best quality).
 * Real-world cost for a high-quality portrait is roughly $0.07–$0.15, so
 * 2 credits (~$1.00) holds a healthy margin. Verify against actual
 * OpenAI invoices and tune via ARTIST_IMAGE_SUNBURST_CREDITS.
 */
export const GPT_IMAGE_25_SUNBURST_CREDIT_COST = 100;
/**
 * Credit price for Nano Banana 2.1 (Google Gemini image, default fast tier).
 * Real-world cost is ~$0.034 per 1K image (~$0.05 at 2K), so 100 credits
 * (~$0.50) holds a very healthy margin. Tune via ARTIST_IMAGE_NANO_CREDITS.
 */
export const NANO_BANANA_21_CREDIT_COST = 100;

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
  sunburstCredits?: number;
  nanoCredits?: number;
}): ArtistImagePlan {
  const useTurbo = opts.model === "gen4_image_turbo";
  const useSunburst = opts.model === "gpt-image-2.5-sunburst";
  const useNano = opts.model === "nano-banana-2.1";
  const model: ArtistImageModel = useNano
    ? "nano-banana-2.1"
    : useSunburst
      ? "gpt-image-2.5-sunburst"
      : useTurbo
        ? "gen4_image_turbo"
        : "gen4_image";
  const creditCost = useNano
    ? Number(opts.nanoCredits) || NANO_BANANA_21_CREDIT_COST
    : useSunburst
      ? Number(opts.sunburstCredits) || GPT_IMAGE_25_SUNBURST_CREDIT_COST
      : useTurbo
        ? Number(opts.turboCredits) || GEN4_IMAGE_TURBO_CREDIT_COST
        : Number(opts.proCredits) || GEN4_IMAGE_CREDIT_COST;
  const ratio: ArtistImageRatio = (VALID_RATIOS as readonly string[]).includes(opts.ratio ?? "")
    ? (opts.ratio as ArtistImageRatio)
    : "1080:1920";
  return { model, creditCost, ratio };
}
