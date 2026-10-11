/**
 * bg-image-client.ts — AI background-plate image generation provider abstraction.
 *
 * Shaped for an OpenAI-compatible image model (gpt-image family) OR a
 * dedicated background-image API (chosen at deploy time via env).
 * No provider key is configured yet — every live call path is gated behind
 * bgImageProviderConfigured() and throws BgImageNotConfiguredError.
 *
 * Env:
 *   BG_IMAGE_API_KEY  — image-generation API key for AI background plates
 *   BG_IMAGE_PROVIDER — "openai" | "custom" (default: "openai" when the key exists)
 *
 * DO NOT make live provider calls until a key is provisioned and the user
 * has approved the provider + pricing. ZERO paid calls may run from this file
 * until that approval exists.
 */

export type BgImageProvider = "openai" | "custom";

export function bgImageProviderName(): BgImageProvider | null {
  const forced = (process.env["BG_IMAGE_PROVIDER"] || "").toLowerCase();
  if (forced === "openai" && process.env["BG_IMAGE_API_KEY"]) return "openai";
  if (forced === "custom" && process.env["BG_IMAGE_API_KEY"]) return "custom";
  if (process.env["BG_IMAGE_API_KEY"]) return "openai";
  return null;
}

/** True only when a provider key is configured. The UI gates on this. */
export function bgImageProviderConfigured(): boolean {
  return bgImageProviderName() !== null;
}

export class BgImageNotConfiguredError extends Error {
  readonly code = "BG_IMAGE_PROVIDER_NOT_CONFIGURED";
  constructor() {
    super(
      "AI background generation is not connected yet — no image-generation API key is configured on the server. " +
        "Add BG_IMAGE_API_KEY to enable AI-generated background plates.",
    );
    this.name = "BgImageNotConfiguredError";
  }
}

export class BgImageNotImplementedError extends Error {
  readonly code = "BG_IMAGE_PROVIDER_NOT_IMPLEMENTED";
  constructor() {
    super(
      "AI background generation is not wired up yet — the provider submit is a stub (see TODO in bg-image-client.ts). " +
        "No credits were charged and no provider call was made.",
    );
    this.name = "BgImageNotImplementedError";
  }
}

function requireProvider(): BgImageProvider {
  const provider = bgImageProviderName();
  if (!provider) throw new BgImageNotConfiguredError();
  return provider;
}

export interface BgImageRequest {
  /** User's background description (already combined with the chosen style). */
  prompt: string;
  /** Style preset id sent from the editor (studio | neon-city | golden-palace | beach-sunset). */
  style: string;
  userId: string;
}

export interface BgImageResult {
  /** Public URL of the generated background plate. */
  imageUrl: string;
}

/**
 * Generate a background plate image.
 *
 * TODO (needs user approval before any live call): implement the provider
 * submit — e.g. POST to the OpenAI Images API (gpt-image-1) with
 *   { model, prompt, size: "1536x1024", n: 1 }
 * using BG_IMAGE_API_KEY, upload the bytes to R2/Supabase storage, and
 * return the public URL. Do NOT charge credits until the user has approved
 * the final price (BG_GENERATE_CREDIT_COST is a PLACEHOLDER).
 *
 * Until then: throws BgImageNotImplementedError so the route can return 501
 * with no charge and no paid provider call.
 */
export async function generateBackgroundImage(_req: BgImageRequest): Promise<BgImageResult> {
  requireProvider();
  // Provider submit is intentionally not implemented — see TODO above.
  // ZERO paid API calls may be made from here until provider + price are approved.
  throw new BgImageNotImplementedError();
}
