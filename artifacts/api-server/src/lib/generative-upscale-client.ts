/**
 * generative-upscale-client.ts — premium GENERATIVE video upscale provider
 * abstraction (Topaz-style: the model invents plausible detail, unlike the
 * existing ffmpeg Lanczos upscale which only resamples pixels).
 *
 * This is a SEPARATE product from the ffmpeg upscaler at /api/upscale and
 * must always be priced separately (premium) — never merged into it.
 *
 * No provider key is configured yet — every live call path is gated behind
 * generativeUpscaleConfigured() and throws GenerativeUpscaleNotConfiguredError.
 *
 * Env:
 *   GENERATIVE_UPSCALE_API_KEY — generative upscale provider API key
 *   GENERATIVE_UPSCALE_API_URL — optional override for the provider base URL
 *
 * DO NOT make live provider calls until a key is provisioned and the user
 * has approved the provider + pricing.
 */

/** True only when a provider key is configured. The UI gates on this. */
export function generativeUpscaleConfigured(): boolean {
  return !!process.env["GENERATIVE_UPSCALE_API_KEY"];
}

export class GenerativeUpscaleNotConfiguredError extends Error {
  readonly code = "GENERATIVE_UPSCALE_NOT_CONFIGURED";
  constructor() {
    super(
      "Generative AI upscaling is not connected yet — no GENERATIVE_UPSCALE_API_KEY is configured on the server. " +
        "The classic ffmpeg upscaler remains available.",
    );
    this.name = "GenerativeUpscaleNotConfiguredError";
  }
}

function requireConfigured(): void {
  if (!generativeUpscaleConfigured()) throw new GenerativeUpscaleNotConfiguredError();
}

export type GenerativeUpscaleTarget = "1080p" | "4k";

export interface GenerativeUpscaleRequest {
  /** Public URL of the source video. */
  sourceVideoUrl: string;
  target: GenerativeUpscaleTarget;
  /** 0-100: how aggressively the model reconstructs detail. */
  creativity?: number;
  userId: string;
}

export interface GenerativeUpscaleResult {
  providerJobId: string;
  status: "queued" | "processing" | "done" | "failed";
  videoUrl?: string;
}

/**
 * Submits a generative upscale to the configured provider.
 * NOT IMPLEMENTED — throws GenerativeUpscaleNotConfiguredError until a key
 * exists, and throws "not implemented" once configured until the provider
 * call is written (requires user approval of provider + pricing first).
 */
export async function submitGenerativeUpscale(_req: GenerativeUpscaleRequest): Promise<GenerativeUpscaleResult> {
  requireConfigured();
  // Provider call deliberately not implemented: no approved pricing yet.
  throw new Error(
    "Generative upscale provider is configured but the live submit call is not implemented yet — " +
      "needs provider + pricing approval before any paid upscale runs.",
  );
}
