/**
 * Pure pricing/plan resolution for the Image Studio.
 * Kept dependency-free so it can be unit-tested without the server.
 */

export type ImageStudioModel = "gpt-image-2" | "gen4_image" | "gen4_image_turbo";
/** The three output shapes offered in the studio. */
export type ImageStudioRatio = "1080:1920" | "1080:1080" | "1920:1080";

export const GPT_IMAGE_2_CREDIT_COST = 2;
export const GEN4_IMAGE_CREDIT_COST = 3;
export const GEN4_IMAGE_TURBO_CREDIT_COST = 2;

export interface ImageStudioPlan {
  model: ImageStudioModel;
  /** Site credits charged on success. */
  creditCost: number;
  ratio: ImageStudioRatio;
  /** True for the synchronous OpenAI path, false for async Runway tasks. */
  sync: boolean;
}

const VALID_RATIOS: readonly ImageStudioRatio[] = ["1080:1920", "1080:1080", "1920:1080"];

export function resolveImageStudioPlan(opts: {
  model?: string;
  ratio?: string;
  gptCredits?: number;
  proCredits?: number;
  turboCredits?: number;
}): ImageStudioPlan {
  const m = opts.model === "gen4_image_turbo" || opts.model === "gen4_image" ? opts.model : "gpt-image-2";
  const model: ImageStudioModel = m;
  const sync = model === "gpt-image-2";
  const creditCost = sync
    ? Number(opts.gptCredits) || GPT_IMAGE_2_CREDIT_COST
    : model === "gen4_image_turbo"
      ? Number(opts.turboCredits) || GEN4_IMAGE_TURBO_CREDIT_COST
      : Number(opts.proCredits) || GEN4_IMAGE_CREDIT_COST;
  const ratio: ImageStudioRatio = (VALID_RATIOS as readonly string[]).includes(opts.ratio ?? "")
    ? (opts.ratio as ImageStudioRatio)
    : "1080:1080";
  return { model, creditCost, ratio, sync };
}

/** OpenAI image size for a studio ratio (gpt-image-2 supported sizes). */
export function ratioToOpenAISize(ratio: ImageStudioRatio): "1024x1024" | "1024x1536" | "1536x1024" {
  switch (ratio) {
    case "1080:1920": return "1024x1536";
    case "1920:1080": return "1536x1024";
    default: return "1024x1024";
  }
}
