import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "./supabase-admin";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * Sync.so lip-sync provider client + server-side media preparation.
 *
 * Moved out of routes/lip-sync.ts so both the HTTP routes and the
 * server-owned background job poller (lib/job-poller.ts) share one
 * implementation. Nothing here touches Express — it is pure provider I/O.
 */
/* ── Server-side secrets (never sent to the browser) ── */
/* Key resolution: prefer LIP_SYNC_API_KEY; fall back to SYNC_LABS_API_KEY so
   the app works whichever variable name was added to the environment. */
function rawKeys() {
  return {
    primary: process.env["LIP_SYNC_API_KEY"],
    fallback: process.env["SYNC_LABS_API_KEY"],
  };
}

/** Resolved Sync.so API key, or null when none is configured. */
export function getLipSyncApiKey(): string | null {
  const { primary, fallback } = rawKeys();
  return primary ?? fallback ?? null;
}

/** Which env var supplied the active key (for diagnostics; never the key itself). */
export function getActiveKeyVar(): string | null {
  const { primary, fallback } = rawKeys();
  return primary ? "LIP_SYNC_API_KEY" : fallback ? "SYNC_LABS_API_KEY" : null;
}

export function hasMultipleKeys(): boolean {
  const { primary, fallback } = rawKeys();
  return !!(primary && fallback);
}

export function isLipSyncServerKeyFound(): boolean {
  const key = getLipSyncApiKey();
  return !!(key && key.length > 0);
}

/** Effective provider name: explicit LIP_SYNC_PROVIDER, or "sync" when a key exists. */
export function getLipSyncProviderName(): string | null {
  const explicit = (process.env["LIP_SYNC_PROVIDER"] ?? "").toLowerCase().trim();
  return explicit || (isLipSyncServerKeyFound() ? "sync" : null);
}

const SIDECAR = "http://127.0.0.1:1106";

/** Sync Labs plan limit in seconds — Hobbyist plan (upgraded 2026-09-24). */
export const PROVIDER_LIMIT_SEC = 60;

/** Supabase storage bucket for temporary lip-sync audio segments (exported for tests) */
export const LIP_SYNC_AUDIO_BUCKET = "lip-sync-temp";

/* ── Sync Labs ────────────────────────────────────────────────────────────── */
const SYNC_LABS_BASE = process.env["SYNC_LABS_BASE_URL"] ?? "https://api.sync.so/v2";

/** Sync.so API base URL (overridable via SYNC_LABS_BASE_URL for staging/tests). */
export function getSyncLabsBase(): string {
  return SYNC_LABS_BASE;
}
// Upgraded 2026-09-24: sync-1.9.0-beta produced poor lip-sync on song audio.
// lipsync-2 is the current-gen model (same input shape); override via env if needed.
export const SYNC_LABS_MODEL = process.env.LIP_SYNC_MODEL || "lipsync-2";
const SYNC_POLL_INTERVAL_MS = 5_000;
const SYNC_MAX_POLLS = 72; // 72 × 5s = 6 minutes max

export interface SyncLabsJob {
  id: string;
  /** Raw provider status — Sync.so reports COMPLETED in uppercase. */
  status: string;
  outputUrl?: string;
  error?: string;
}

/**
 * Typed provider error: carries the HTTP status so callers can distinguish
 * transient rejections (429 / plan-concurrency limit — wait and retry) from
 * permanent ones (422 validation, 401 auth — fail fast). Message text is
 * kept identical to the old plain-Error strings.
 */
export class SyncLabsError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "SyncLabsError";
    this.status = status;
  }
}

/** How a submit failure should be treated by the background poller. */
export type SubmitErrorKind =
  /** 429 / plan-concurrency / 5xx: wait with long backoff, don't burn attempts. */
  | "transient"
  /** Network timeout / DNS / reset: may not have reached the provider; re-queue normally. */
  | "transport"
  /** 4xx (other than 429), validation, auth: fail the job immediately. */
  | "permanent";

const TRANSIENT_MESSAGE_RE =
  /concurren|plan.{0,24}limit|rate.?limit|too many|capacity|overloaded|temporar|try again|busy|throttl/i;

/**
 * Classify a syncLabsSubmit failure. Transient rejections (the Sync.so plan
 * only allows N concurrent generations — exactly what blocks submits for
 * 25–40 min while slots free up) must back off for minutes, not burn all
 * submit attempts in ~2 minutes.
 */
export function classifySubmitError(err: unknown): SubmitErrorKind {
  const status = err instanceof SyncLabsError ? err.status : null;
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    TRANSIENT_MESSAGE_RE.test(message)
  ) {
    return "transient";
  }
  if (status !== null && status >= 400) return "permanent";
  // A SyncLabsError means the provider answered (or failed in a
  // provider-shaped way). Anything not explicitly transient is
  // deterministic — retrying the identical request won't help.
  if (err instanceof SyncLabsError) return "permanent";
  return "transport"; // network timeouts, DNS, connection resets — may not have reached the provider
}

/** Transient submit backoff schedule: 5 → 10 → 20 → 40 min (capped). */
export function submitDeferralBackoffMs(deferrals: number): number {
  const minutes = [5, 10, 20, 40];
  return minutes[Math.min(Math.max(deferrals, 0), minutes.length - 1)] * 60_000;
}

/** Consecutive transient deferrals before the job fails (~24h at the capped backoff). */
export const MAX_SUBMIT_DEFERRALS = 36;

/** Normalized provider status: "pending" | "processing" | "completed" | "failed". */
export function normalizeProviderStatus(job: SyncLabsJob): string {
  return String(job.status ?? "").toLowerCase();
}

/**
 * Fields removed from the Sync Labs payload because they are not part of
 * the v2 API schema. Kept here so /check-inputs can report them to the UI.
 */
export const SYNC_LABS_REMOVED_FIELDS = ["synergize", "pads"] as const;

/** Build and log the sanitized Sync Labs payload (never logs the API key). */
function buildSyncLabsPayload(clipUrl: string, audioUrl: string) {
  return {
    model: SYNC_LABS_MODEL,
    input: [
      { type: "video", url: clipUrl },
      { type: "audio", url: audioUrl },
    ],
    // NOTE: no "options" block — all previously-sent fields (synergize, pads)
    // are not part of the Sync Labs v2 API and caused HTTP 422.
  };
}

export async function syncLabsSubmit(
  clipUrl: string,
  audioUrl: string,
  apiKey: string,
): Promise<string> {
  const payload = buildSyncLabsPayload(clipUrl, audioUrl);

  // Log the sanitized payload (keys only — no API key, no full URLs in prod)
  const payloadKeys = [
    "model",
    ...payload.input.map((i) => `input[${i.type}]`),
  ];
  logger.info("[lip-sync] Sync Labs payload keys: %s", payloadKeys.join(", "));
  logger.info("[lip-sync] Removed fields: %s", SYNC_LABS_REMOVED_FIELDS.join(", "));

  const res = await fetch(`${SYNC_LABS_BASE}/generate`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SyncLabsError(
      `Sync Labs submit failed: HTTP ${res.status} — ${body.slice(0, 400)}`,
      res.status,
    );
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Sync Labs returned no job ID.");
  return data.id;
}

/**
 * Single-shot provider status check for one Sync.so job.
 * The background poller calls this on its backoff schedule — unlike the old
 * blocking poll loop, no request or tab ever waits on a 25–40 minute run.
 */
export async function syncLabsStatus(jobId: string, apiKey: string): Promise<SyncLabsJob> {
  const res = await fetch(`${SYNC_LABS_BASE}/generate/${jobId}`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SyncLabsError(
      `Sync Labs status check failed: HTTP ${res.status} — ${text.slice(0, 300)}`,
      res.status,
    );
  }
  return (await res.json()) as SyncLabsJob;
}

/* ── URL type detection ──────────────────────────────────────────────────── */
export type UrlType =
  | "public-https"
  | "supabase"
  | "replit-storage"
  | "blob"
  | "unknown";

export function detectUrlType(url: string): UrlType {
  if (!url) return "unknown";
  if (url.startsWith("blob:")) return "blob";
  if (!url.startsWith("http")) return "unknown";
  const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
  if (supabaseUrl && url.startsWith(supabaseUrl)) return "supabase";
  if (
    url.includes("storage.googleapis.com") ||
    url.includes("replit-objstore") ||
    url.includes("127.0.0.1:1106")
  )
    return "replit-storage";
  return "public-https";
}

/** HEAD-check a URL, return { ok, status, contentType, error } */
export async function probeUrl(
  url: string,
  timeoutMs = 15_000,
): Promise<{
  ok: boolean;
  status: number;
  contentType: string | null;
  error: string | null;
}> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type"),
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentType: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ── Supabase storage for trimmed audio segments ─────────────────────────── */

/** Idempotent bucket ensure — private bucket for trimmed lip-sync audio.
 *
 *  Uses the Storage REST API directly (same pattern as
 *  ensureSupabaseClipsBucket / ensureVideoExportsBucket in
 *  lib/objectStorage.ts) instead of supabase-js: under this service's
 *  Node/fetch combination the supabase-js bucket helpers can report success
 *  without the bucket actually being created, and file_size_limit in the
 *  create body gets rejected with 413 EntityTooLarge (seen on the
 *  video-exports bucket, PR #5). After creating, we re-read the bucket and
 *  throw LOUDLY if it is still missing, so an upload can never silently
 *  march into a doomed upload.
 *
 *  Exported for the $0 verification suite. */
export async function ensureSupabaseBucket(): Promise<void> {
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").replace(/\/$/, "");
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured — cannot ensure "lip-sync-temp" bucket.',
    );
  }
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const getBucket = () => fetch(`${url}/storage/v1/bucket/${LIP_SYNC_AUDIO_BUCKET}`, { headers });

  if ((await getBucket()).ok) return; // already exists

  const createRes = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: LIP_SYNC_AUDIO_BUCKET,
      name: LIP_SYNC_AUDIO_BUCKET,
      public: false,
      // NOTE: no file_size_limit — Supabase rejected it with 413 EntityTooLarge
      // on the video-exports bucket (PR #5). Trimmed audio segments are tiny.
    }),
  });
  const createText = await createRes.text().catch(() => "");
  const alreadyExists = createRes.status === 409 || /already exists/i.test(createText);
  if (!createRes.ok && !alreadyExists) {
    throw new Error(
      `Failed to create Supabase bucket "${LIP_SYNC_AUDIO_BUCKET}": ${createRes.status} ${createText.slice(0, 300)}`,
    );
  }

  // Verify it actually exists now — never silently continue into a doomed upload.
  const verifyRes = await getBucket();
  if (!verifyRes.ok) {
    const verifyText = await verifyRes.text().catch(() => "");
    throw new Error(
      `Supabase bucket "${LIP_SYNC_AUDIO_BUCKET}" still missing after create attempt ` +
        `(create: ${createRes.status} ${createText.slice(0, 120)}; ` +
        `verify: ${verifyRes.status} ${verifyText.slice(0, 120)})`,
    );
  }
}

export async function uploadAudioToSupabase(
  buffer: Buffer,
  objectName: string,
  contentType = "audio/mpeg",
): Promise<string> {
  // Fail fast here: ensureSupabaseBucket verifies the bucket exists after
  // creation and throws loudly if it is still missing — never silently
  // march into a doomed upload.
  await ensureSupabaseBucket();
  const supabase = getSupabaseAdmin();

  const { error: upErr } = await supabase.storage
    .from(LIP_SYNC_AUDIO_BUCKET)
    .upload(objectName, buffer, { contentType, upsert: true });

  if (upErr) {
    throw new Error(
      `Supabase audio upload failed: ${upErr.message}` +
        ` (bucket: ${LIP_SYNC_AUDIO_BUCKET}, path: ${objectName})`,
    );
  }

  const { data: signData, error: signErr } = await supabase.storage
    .from(LIP_SYNC_AUDIO_BUCKET)
    .createSignedUrl(objectName, 7200); // 2-hour TTL

  if (signErr || !signData?.signedUrl) {
    throw new Error(
      `Supabase signed URL failed: ${signErr?.message ?? "no URL returned"}` +
        ` (bucket: ${LIP_SYNC_AUDIO_BUCKET}, path: ${objectName})`,
    );
  }

  return signData.signedUrl;
}

/* ── Replit object storage signed URL (kept for vocal stems) ─────────────── */
export async function signGetUrl(
  bucketName: string,
  objectName: string,
): Promise<string> {
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "GET",
      expires_at: expiresAt,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Object storage signing failed: HTTP ${res.status}` +
        ` — bucket: ${bucketName}, path: ${objectName}` +
        (body ? ` — ${body.slice(0, 200)}` : ""),
    );
  }
  const { signed_url } = (await res.json()) as { signed_url: string };
  return signed_url;
}

/* ── Audio segmentation (FFmpeg + Supabase storage) ──────────────────────── */
export async function trimAndUploadAudioSegment(
  audioUrl: string,
  startSec: number,
  endSec: number,
): Promise<{ segmentUrl: string; durationSec: number }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "lipsync-"));
  try {
    /* 1. Download source audio — prefer direct fetch (works for signed HTTPS URLs) */
    const dlRes = await fetch(audioUrl, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!dlRes.ok) {
      throw new Error(
        `Audio download failed: HTTP ${dlRes.status}` +
          ` (url type: ${detectUrlType(audioUrl)})`,
      );
    }
    const ct = dlRes.headers.get("content-type") ?? "";
    const ext = ct.includes("wav") ? "wav" : ct.includes("ogg") ? "ogg" : "mp3";
    const inputPath = join(tmpDir, `input.${ext}`);
    const outputPath = join(tmpDir, "segment.mp3");
    await writeFile(inputPath, Buffer.from(await dlRes.arrayBuffer()));

    /* 2. Trim with FFmpeg
       IMPORTANT: `timeout` is required here — without it a stalled/hung ffmpeg
       process (e.g. on a corrupt or unusual input) blocks this await forever,
       which leaves the job permanently "processing" with no syncLabsJobId to
       check, and the client's Check-Job-Status button stays disabled with no
       way to recover except abandoning the job. */
    let ffmpegStderr = "";
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-ss",
        String(startSec),
        "-to",
        String(endSec),
        "-c:a",
        "libmp3lame",
        "-q:a",
        "2",
        outputPath,
      ],
      { timeout: 60_000 },
    ).catch((err: Error & { stderr?: string; killed?: boolean }) => {
      ffmpegStderr = (err as unknown as { stderr?: string }).stderr ?? "";
      const timedOut = err.killed || /ETIMEDOUT|signal/i.test(err.message);
      throw new Error(
        timedOut
          ? "FFmpeg trim timed out after 60s — the source audio may be malformed or unreachable mid-stream."
          : `FFmpeg trim failed: ${err.message}${ffmpegStderr ? ` — ${ffmpegStderr.slice(-200)}` : ""}`,
      );
    });

    /* 3. Verify actual duration */
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        outputPath,
      ],
      { timeout: 15_000 },
    );
    const durationSec = parseFloat(stdout.trim());
    if (isNaN(durationSec))
      throw new Error("Could not determine trimmed audio duration.");

    /* 4. Upload trimmed segment to Supabase storage → signed URL */
    const buffer = await readFile(outputPath);
    const objectName = `segments/${randomUUID()}.mp3`;
    const segmentUrl = await uploadAudioToSupabase(buffer, objectName);

    return { segmentUrl, durationSec };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── Video segmentation (FFmpeg + Supabase storage) ────────────────────────
   Trims the scene's clip to the same duration as the audio segment so the
   provider receives a short video + short audio pair. Previously the FULL
   untrimmed clip was submitted alongside a short audio window, which
   degraded lip-sync quality (2026-09-24). Downloading server-side also
   fixes signed-URL expiry: the provider fetches our fresh signed URL
   instead of a possibly-stale client URL. Falls back to the original
   clipUrl if trimming fails. */
export async function trimAndUploadVideoSegment(
  clipUrl: string,
  durationSec: number,
): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), "lipsync-vid-"));
  try {
    const dlRes = await fetch(clipUrl, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!dlRes.ok) {
      throw new Error(
        `Video download failed: HTTP ${dlRes.status}` +
          ` (url type: ${detectUrlType(clipUrl)})`,
      );
    }
    const inputPath = join(tmpDir, "input.mp4");
    const outputPath = join(tmpDir, "segment.mp4");
    await writeFile(inputPath, Buffer.from(await dlRes.arrayBuffer()));

    /* Trim to the audio window duration from the clip start. -an strips the
       clip's own audio track — the provider receives clean audio separately,
       so a conflicting embedded track can't confuse the model. Timeout is
       required: a hung ffmpeg must not wedge the job forever. */
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-t",
        durationSec.toFixed(3),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { timeout: 120_000 },
    ).catch((err: Error & { stderr?: string; killed?: boolean }) => {
      const timedOut = err.killed || /ETIMEDOUT|signal/i.test(err.message);
      throw new Error(
        timedOut
          ? "FFmpeg video trim timed out after 120s."
          : `FFmpeg video trim failed: ${err.message}`,
      );
    });

    /* Verify the trimmed segment is a valid, non-trivial video file */
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_type,width,height",
        "-of",
        "default=noprint_wrappers=1",
        outputPath,
      ],
      { timeout: 15_000 },
    );
    if (!stdout.toLowerCase().includes("video")) {
      throw new Error("Trimmed video has no video stream.");
    }
    const segBytes = statSync(outputPath).size;
    if (segBytes < 10 * 1024) {
      throw new Error(`Trimmed video too small (${segBytes} bytes).`);
    }

    const buffer = await readFile(outputPath);
    return await uploadAudioToSupabase(
      buffer,
      `segments/${randomUUID()}.mp4`,
      "video/mp4",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
