/**
 * bg-image-client.ts — AI background-plate image generation (WIRED,
 * Stack 7 #4). Uses the house image-generation path — the same OpenAI
 * image model the thumbnail/artist-image routes use
 * (OPENAI_IMAGE_MODEL_25, default gpt-image-2.5-sunburst) — uploads
 * the plate to R2 and returns its public URL.
 *
 * Key resolution: BG_IMAGE_API_KEY when set (dedicated key), else the
 * house OPENAI_API_KEY. Configured = either exists.
 */
import { randomUUID } from "crypto";
import OpenAI from "openai";
import { r2Upload } from "./r2-client";

export type BgImageProvider = "openai" | "custom";

function apiKey(): string | null {
  return process.env["BG_IMAGE_API_KEY"] || process.env["OPENAI_API_KEY"] || null;
}

export function bgImageProviderName(): BgImageProvider | null {
  if (!apiKey()) return null;
  const forced = (process.env["BG_IMAGE_PROVIDER"] || "").toLowerCase();
  return forced === "custom" ? "custom" : "openai";
}

/** True when an image-generation key is configured. The UI gates on this. */
export function bgImageProviderConfigured(): boolean {
  return bgImageProviderName() !== null;
}

export class BgImageNotConfiguredError extends Error {
  readonly code = "BG_IMAGE_PROVIDER_NOT_CONFIGURED";
  constructor() {
    super(
      "AI background generation is not connected yet — no image-generation API key is configured on the server.",
    );
    this.name = "BgImageNotConfiguredError";
  }
}

export class BgImageGenerationError extends Error {
  readonly code = "BG_GENERATE_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "BgImageGenerationError";
  }
}

export interface BgImageRequest {
  prompt: string;
  style: string;
  userId: string;
}

export interface BgImageResult {
  imageUrl: string;
}

const STYLE_SUFFIX: Record<string, string> = {
  "studio": "professional photo studio backdrop, seamless, soft rim light",
  "neon-city": "city street at night, neon glow, wet reflections, cinematic",
  "golden-palace": "luxurious golden palace interior, marble, warm light, elegant",
  "beach-sunset": "beach at golden-hour sunset, palm silhouettes, dreamy soft light",
};

export function bgImageModel(): string {
  return process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";
}

export function buildBgPrompt(prompt: string, style: string): string {
  const suffix = STYLE_SUFFIX[style] ?? STYLE_SUFFIX["studio"]!;
  return `Empty background plate, no people, no text: ${prompt}. Setting: ${suffix}. Wide 16:9 composition, high detail.`;
}

/* Injectable seams for tests — production uses the real clients. */
export interface BgImageDeps {
  generate?: (prompt: string) => Promise<Buffer>;
  upload?: (userId: string, buffer: Buffer) => Promise<string>;
}
let depsOverride: BgImageDeps | null = null;
export function __setBgImageDepsForTests(deps: BgImageDeps | null): void {
  depsOverride = deps;
}

async function defaultGenerate(prompt: string): Promise<Buffer> {
  const key = apiKey();
  if (!key) throw new BgImageNotConfiguredError();
  const client = new OpenAI({ apiKey: key });
  const resp = await client.images.generate({
    model: bgImageModel(),
    prompt: prompt.slice(0, 4000),
    size: "1536x1024",
    quality: "high",
    n: 1,
  });
  const first = resp.data?.[0];
  if (first?.b64_json) return Buffer.from(first.b64_json, "base64");
  if (first?.url) {
    const dl = await fetch(first.url, { signal: AbortSignal.timeout(120_000) });
    if (!dl.ok) throw new BgImageGenerationError(`Generated image download failed (${dl.status}).`);
    return Buffer.from(await dl.arrayBuffer());
  }
  throw new BgImageGenerationError("Image generation returned no image data.");
}

async function defaultUpload(userId: string, buffer: Buffer): Promise<string> {
  const filePath = `bg-plates/${userId}/${randomUUID()}.png`;
  return r2Upload(filePath, buffer, "image/png");
}

/** Generate a background plate, upload it, return its public URL. */
export async function generateBackgroundImage(req: BgImageRequest): Promise<BgImageResult> {
  if (!bgImageProviderConfigured()) throw new BgImageNotConfiguredError();
  const generate = depsOverride?.generate ?? defaultGenerate;
  const upload = depsOverride?.upload ?? defaultUpload;
  const buffer = await generate(buildBgPrompt(req.prompt, req.style));
  if (!buffer || buffer.length === 0) {
    throw new BgImageGenerationError("Image generation returned no image data.");
  }
  const imageUrl = await upload(req.userId, buffer);
  return { imageUrl };
}
