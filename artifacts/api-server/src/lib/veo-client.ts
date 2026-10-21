/**
 * Google Veo 3.1 video generation via the Gemini API.
 * Same GEMINI_API_KEY as Nano Banana — no separate credential.
 *
 * Flow: predictLongRunning → operation name → poll until done →
 * download the hosted MP4 (needs the API key) within the 2-day window.
 */

import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const VEO_MODEL = process.env["VEO_VIDEO_MODEL"] || "veo-3.1-generate-preview";
const VEO_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}`;

function geminiKey(): string {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("GEMINI_API_KEY is not configured on the server");
  return key;
}

export interface VeoSubmitOpts {
  prompt: string;
  /** 16:9 or 9:16 — the only two Veo aspect ratios. */
  aspectRatio: "16:9" | "9:16";
  /** Base64-encoded first-frame image for image-to-video (optional). */
  imageBase64?: string;
  imageMimeType?: string;
  /** Base64-encoded LAST-frame image — Veo 3.1 first/last-frame
   *  interpolation. Only forwarded when a first frame is also present:
   *  Veo does not accept a lone last frame. */
  lastFrameBase64?: string;
  lastFrameMimeType?: string;
  /** 720p keeps cost at $0.40/s; 1080p/4K cost more and are 8s-only. */
  resolution?: "720p" | "1080p";
}

/** Submits a Veo generation. Returns the long-running operation name. */
export async function submitVeoVideo(opts: VeoSubmitOpts): Promise<string> {
  const instance: Record<string, unknown> = { prompt: opts.prompt.slice(0, 4000) };
  if (opts.imageBase64) {
    instance["image"] = {
      inlineData: { mimeType: opts.imageMimeType || "image/jpeg", data: opts.imageBase64 },
    };
    /* Last frame rides only alongside a first frame — never alone. */
    if (opts.lastFrameBase64) {
      instance["lastFrame"] = {
        inlineData: { mimeType: opts.lastFrameMimeType || "image/jpeg", data: opts.lastFrameBase64 },
      };
    }
  }
  const res = await fetch(`${VEO_BASE}:predictLongRunning`, {
    method: "POST",
    headers: { "x-goog-api-key": geminiKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [instance],
      parameters: {
        aspectRatio: opts.aspectRatio,
        resolution: opts.resolution ?? "720p",
        /* 8s is the max and the only length allowed with reference images
           or 1080p+; fixed for predictable per-clip pricing. */
        durationSeconds: 8,
        /* Creator site with adult artists: allow adults, never children. */
        personGeneration: "allow_adult",
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Veo submit failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { name?: string; error?: { message?: string } };
  if (json.error?.message) throw new Error(`Veo submit failed: ${json.error.message}`);
  if (!json.name) throw new Error("Veo submit returned no operation name.");
  return json.name;
}

export interface VeoPollResult {
  done: boolean;
  /** Hosted MP4 URI (2-day retention) once done. */
  videoUri?: string;
  error?: string;
}

interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: { video?: { uri?: string } }[];
    };
  };
}

/** Polls a Veo long-running operation once. Callers poll on their own cadence. */
export async function pollVeoOperation(operationName: string): Promise<VeoPollResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${operationName}`, {
    headers: { "x-goog-api-key": geminiKey() },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Veo poll failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const op = (await res.json()) as VeoOperation;
  if (op.error?.message) return { done: true, error: op.error.message };
  if (!op.done) return { done: false };
  const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) return { done: true, error: "Veo finished with no video output." };
  return { done: true, videoUri: uri };
}

/** Downloads a Veo-hosted MP4 (the Files API URI needs the API key). */
export async function downloadVeoVideo(videoUri: string): Promise<Buffer> {
  const sep = videoUri.includes("?") ? "&" : "?";
  const res = await fetch(`${videoUri}${sep}key=${geminiKey()}`, {
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Veo download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Streaming variant of downloadVeoVideo — writes the MP4 straight to
 * disk instead of buffering the whole clip in RAM.
 * (2026-10-12, OOM fix.)
 */
export async function downloadVeoVideoToFile(
  videoUri: string,
  destPath: string,
): Promise<void> {
  const sep = videoUri.includes("?") ? "&" : "?";
  const res = await fetch(`${videoUri}${sep}key=${geminiKey()}`, {
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Veo download failed (${res.status})`);
  if (!res.body) throw new Error("Veo download returned no body");
  await pipeline(
    res.body as Parameters<typeof pipeline>[0],
    createWriteStream(destPath),
  );
}
