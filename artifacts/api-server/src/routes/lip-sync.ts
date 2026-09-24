import { Router } from "express";
import express from "express";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { existsSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { requireAuth } from "../middlewares/require-auth";
import { objectStorageClient } from "../lib/objectStorage";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { recordLipSyncHistory } from "../lib/payment-record";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Server-side secrets (never sent to the browser) ── */
/* Key resolution: prefer LIP_SYNC_API_KEY; fall back to SYNC_LABS_API_KEY so
   the app works whichever variable name the user added in Replit Secrets.    */
const _LIP_SYNC_API_KEY_RAW = process.env["LIP_SYNC_API_KEY"];
const _SYNC_LABS_API_KEY_RAW = process.env["SYNC_LABS_API_KEY"];
const LIP_SYNC_API_KEY = _LIP_SYNC_API_KEY_RAW ?? _SYNC_LABS_API_KEY_RAW;
const ACTIVE_KEY_VAR: string | null = _LIP_SYNC_API_KEY_RAW
  ? "LIP_SYNC_API_KEY"
  : _SYNC_LABS_API_KEY_RAW
    ? "SYNC_LABS_API_KEY"
    : null;
const MULTIPLE_KEYS_FOUND = !!(_LIP_SYNC_API_KEY_RAW && _SYNC_LABS_API_KEY_RAW);
const LIP_SYNC_PROVIDER = (process.env["LIP_SYNC_PROVIDER"] ?? "")
  .toLowerCase()
  .trim();
const SERVER_KEY_FOUND = !!(LIP_SYNC_API_KEY && LIP_SYNC_API_KEY.length > 0);
const PROVIDER_NAME = LIP_SYNC_PROVIDER || (SERVER_KEY_FOUND ? "sync" : null);

const STEM_BUCKET = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
const SIDECAR = "http://127.0.0.1:1106";

/** Sync Labs plan limit in seconds — Hobbyist plan (upgraded 2026-09-24). */
const PROVIDER_LIMIT_SEC = 60;

/** Supabase storage bucket for temporary lip-sync audio segments */
const LIP_SYNC_AUDIO_BUCKET = "lip-sync-temp";

/* ── Sync Labs ────────────────────────────────────────────────────────────── */
const SYNC_LABS_BASE = "https://api.sync.so/v2";
// Upgraded 2026-09-24: sync-1.9.0-beta produced poor lip-sync on song audio.
// lipsync-2 is the current-gen model (same input shape); override via env if needed.
const SYNC_LABS_MODEL = process.env.LIP_SYNC_MODEL || "lipsync-2";
const SYNC_POLL_INTERVAL_MS = 5_000;
const SYNC_MAX_POLLS = 72; // 72 × 5s = 6 minutes max

interface SyncLabsJob {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  outputUrl?: string;
  error?: string;
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

async function syncLabsSubmit(
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
  // logger available via req.log in routes; use console here (non-route context)
  console.info("[lip-sync] Sync Labs payload keys:", payloadKeys.join(", "));
  console.info(
    "[lip-sync] Removed fields:",
    SYNC_LABS_REMOVED_FIELDS.join(", "),
  );

  const res = await fetch(`${SYNC_LABS_BASE}/generate`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Sync Labs submit failed: HTTP ${res.status} — ${body.slice(0, 400)}`,
    );
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Sync Labs returned no job ID.");
  return data.id;
}

async function syncLabsPoll(jobId: string, apiKey: string): Promise<string> {
  for (let i = 0; i < SYNC_MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, SYNC_POLL_INTERVAL_MS));
    const res = await fetch(`${SYNC_LABS_BASE}/generate/${jobId}`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Sync Labs poll failed: HTTP ${res.status} — ${body.slice(0, 300)}`,
      );
    }
    const job = (await res.json()) as SyncLabsJob;
    if (job.status === "completed") {
      if (!job.outputUrl)
        throw new Error("Sync Labs job completed but returned no outputUrl.");
      return job.outputUrl;
    }
    if (job.status === "failed") {
      throw new Error(`Sync Labs job failed: ${job.error ?? "unknown error"}`);
    }
  }
  throw new SyncLabsTimeoutError();
}

/* ── URL type detection ──────────────────────────────────────────────────── */
type UrlType =
  | "public-https"
  | "supabase"
  | "replit-storage"
  | "blob"
  | "unknown";

function detectUrlType(url: string): UrlType {
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
async function probeUrl(
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

async function ensureSupabaseBucket(): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.createBucket(LIP_SYNC_AUDIO_BUCKET, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
  });
  // Ignore "already exists" — any other error propagates
  if (
    error &&
    !error.message?.toLowerCase().includes("already exist") &&
    error.message !== "Duplicate"
  ) {
    // Non-fatal: bucket might exist under a different error wording
  }
}

async function uploadAudioToSupabase(
  buffer: Buffer,
  objectName: string,
  contentType = "audio/mpeg",
): Promise<string> {
  await ensureSupabaseBucket().catch(() => {
    /* ignore — bucket likely exists */
  });
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
async function signGetUrl(
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
async function trimAndUploadAudioSegment(
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
async function trimAndUploadVideoSegment(
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

/* ── In-process async job store ──────────────────────────────────────────
   Each POST /lip-sync/preview enqueues a job here and returns its ID
   immediately so the HTTP response completes before the proxy times out.
   Jobs are pruned after 2 h; the server process is long-running so this
   is safe for a single-instance dev/prod deployment.                       */
interface LipSyncJob {
  status: "queued" | "processing" | "done" | "failed";
  url?: string;
  provider?: string;
  error?: string;
  code?: string;
  durationSec?: number;
  /** Sync.so provider job ID — set immediately after the job is accepted,
   *  before polling begins, so the client can save it and check later. */
  syncLabsJobId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Thrown by syncLabsPoll when the poll limit is exhausted without a terminal
 *  result.  Caught separately so the job is kept as "processing" rather than
 *  marked "failed" — the Sync.so job may still be running. */
class SyncLabsTimeoutError extends Error {
  constructor() {
    super("Still processing on Sync.so. Check again in a few minutes.");
    this.name = "SyncLabsTimeoutError";
  }
}

interface LipSyncJobParams {
  clipUrl: string;
  audioUrl: string;
  sceneStartSec: number;
  sceneEndSec: number;
  /** Who requested this job — used to record a generation_history row on success. */
  userId?: string | null;
  projectId?: string | null;
  sceneId?: string | null;
}

const lipSyncJobs = new Map<string, LipSyncJob>();

setInterval(
  () => {
    const cutoffMs = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, job] of lipSyncJobs) {
      if (new Date(job.createdAt).getTime() < cutoffMs) lipSyncJobs.delete(id);
    }
  },
  30 * 60 * 1000,
).unref();

async function processLipSyncJob(
  jobId: string,
  params: LipSyncJobParams,
): Promise<void> {
  const now = () => new Date().toISOString();
  const update = (patch: Partial<LipSyncJob>) => {
    const j = lipSyncJobs.get(jobId);
    if (j) lipSyncJobs.set(jobId, { ...j, ...patch, updatedAt: now() });
  };

  try {
    update({ status: "processing" });

    const { segmentUrl, durationSec } = await trimAndUploadAudioSegment(
      params.audioUrl,
      params.sceneStartSec,
      params.sceneEndSec,
    );

    if (durationSec > PROVIDER_LIMIT_SEC) {
      update({
        status: "failed",
        error: `Audio segment is ${durationSec.toFixed(1)}s — exceeds Sync Labs plan limit of ${PROVIDER_LIMIT_SEC}s. Trim the scene or upgrade your plan.`,
        code: "segment_too_long",
        durationSec,
      });
      return;
    }

    if (PROVIDER_NAME === "sync") {
      /* Trim the video to the audio window so the provider gets a short
         video + short audio pair. Falls back to the full clip if the trim
         fails — never break a job over an optimization. */
      let providerClipUrl = params.clipUrl;
      try {
        providerClipUrl = await trimAndUploadVideoSegment(
          params.clipUrl,
          durationSec,
        );
      } catch (vidErr) {
        console.warn(
          "[lip-sync] video trim failed, falling back to full clip:",
          vidErr instanceof Error ? vidErr.message : String(vidErr),
        );
      }
      const syncId = await syncLabsSubmit(
        providerClipUrl,
        segmentUrl,
        LIP_SYNC_API_KEY!,
      );
      /* Save the provider job ID immediately so the client can store it and
         check the Sync.so job status later — even after a local timeout. */
      update({ syncLabsJobId: syncId });

      const outputUrl = await syncLabsPoll(syncId, LIP_SYNC_API_KEY!);
      update({ status: "done", url: outputUrl, provider: "sync", durationSec });
      if (params.userId) {
        void recordLipSyncHistory({
          userId:      params.userId,
          projectId:   params.projectId,
          sceneId:     params.sceneId,
          videoUrl:    outputUrl,
          creditsUsed: 0,
        });
      }
      return;
    }

    throw new Error(
      `Provider "${PROVIDER_NAME}" is not wired. Set LIP_SYNC_PROVIDER=sync in Replit Secrets.`,
    );
  } catch (err) {
    if (err instanceof SyncLabsTimeoutError) {
      /* Keep as "processing" — the Sync.so job may still be running.
         The client can use the saved syncLabsJobId to check later. */
      update({
        status: "processing",
        error: err.message,
        code: "still_processing",
      });
    } else {
      update({
        status: "failed",
        error: err instanceof Error ? err.message : "Lip sync job failed",
        code: "provider_error",
      });
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   GET /lip-sync/health
   Simple reachability probe — no auth required.
────────────────────────────────────────────────────────────────────────── */
router.get("/lip-sync/health", (_req, res) => {
  res.json({ success: true, route: "lip-sync-health-ok" });
});

/* ──────────────────────────────────────────────────────────────────────────
   GET /lip-sync/status
────────────────────────────────────────────────────────────────────────── */
router.get("/lip-sync/status", (_req, res) => {
  const missingKeyMessage =
    PROVIDER_NAME === "sync" && !SERVER_KEY_FOUND
      ? "Sync Labs API key missing. Add LIP_SYNC_API_KEY in Replit Secrets."
      : !SERVER_KEY_FOUND
        ? "Lip Sync API key missing. Add LIP_SYNC_API_KEY in Replit Secrets."
        : null;

  res.json({
    connected: SERVER_KEY_FOUND,
    providerName: PROVIDER_NAME ?? null,
    serverKeyFound: SERVER_KEY_FOUND,
    frontendKeyExposed: false,
    mode: SERVER_KEY_FOUND ? "real" : "mock",
    missingKeyMessage,
    providerLimitSec: PROVIDER_LIMIT_SEC,
    model: SYNC_LABS_MODEL,
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   GET /lip-sync/account-check
   Returns key inventory + billing status from Sync Labs.
   Requires auth — the key's last-4 and billing status are not public info.
   Never exposes full API key — only last 4 chars and env var name.
────────────────────────────────────────────────────────────────────────── */
router.get("/lip-sync/account-check", requireAuth, async (_req, res) => {
  const activeKeyLast4 =
    LIP_SYNC_API_KEY && LIP_SYNC_API_KEY.length >= 4
      ? LIP_SYNC_API_KEY.slice(-4)
      : LIP_SYNC_API_KEY
        ? "****"
        : null;

  if (!LIP_SYNC_API_KEY) {
    res.json({
      keyPresent: false,
      activeKeyVar: null,
      activeKeyLast4: null,
      multipleKeysFound: MULTIPLE_KEYS_FOUND,
      providerEndpointConfigured: true,
      accountStatusAvailable: false,
      billingBlocked: null,
      httpStatus: null,
      lastError:
        "No Sync Labs API key found. Add LIP_SYNC_API_KEY or SYNC_LABS_API_KEY in Replit Secrets.",
      message: "No API key configured.",
    });
    return;
  }

  /* Try Sync Labs list-jobs endpoint — read-only, does not consume credits */
  let httpStatus: number | null = null;
  let billingBlocked: boolean | null = null;
  let accountStatusAvailable = false;
  let lastError: string | null = null;

  /* Probe billing by fetching a non-existent job ID.
     Sync Labs returns 404 "job not found" when the key is valid and billing OK.
     It returns 402 when the free tier is exhausted regardless of job ID.
     It returns 401/403 when the key is invalid.
     This is read-only and does not consume credits.                          */
  const PROBE_JOB_ID = "00000000-0000-0000-0000-000000000000";
  try {
    const r = await fetch(`${SYNC_LABS_BASE}/generate/${PROBE_JOB_ID}`, {
      headers: { "x-api-key": LIP_SYNC_API_KEY },
      signal: AbortSignal.timeout(12_000),
    });
    httpStatus = r.status;
    const body = await r.text().catch(() => "");

    if (r.status === 404) {
      /* "Job not found" — key is valid, billing is active */
      accountStatusAvailable = true;
      billingBlocked = false;
      lastError = null;
    } else if (r.status === 200) {
      /* Unlikely for a fake UUID, but handle it */
      accountStatusAvailable = true;
      billingBlocked = false;
    } else if (r.status === 402) {
      accountStatusAvailable = true;
      billingBlocked = true;
      lastError = `HTTP 402 — ${body.slice(0, 300) || "free_tier_generations_exhausted"}`;
    } else if (r.status === 401 || r.status === 403) {
      accountStatusAvailable = true;
      billingBlocked = null;
      lastError = `HTTP ${r.status} — API key invalid or unauthorized. ${body.slice(0, 200)}`;
    } else {
      lastError = `HTTP ${r.status} — ${body.slice(0, 200)}`;
    }
  } catch (err) {
    lastError =
      err instanceof Error ? err.message : "Network error contacting Sync Labs";
  }

  const message = MULTIPLE_KEYS_FOUND
    ? `Multiple keys found. Using ${ACTIVE_KEY_VAR} ending in ${activeKeyLast4}`
    : `Using ${ACTIVE_KEY_VAR} ending in ${activeKeyLast4}`;

  res.json({
    keyPresent: true,
    activeKeyVar: ACTIVE_KEY_VAR,
    activeKeyLast4,
    multipleKeysFound: MULTIPLE_KEYS_FOUND,
    providerEndpointConfigured: true,
    accountStatusAvailable,
    billingBlocked,
    httpStatus,
    lastError,
    message,
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   GET /lip-sync/job/:id
   Poll a queued / running / finished lip-sync job.
   Returns the LipSyncJob record directly.
────────────────────────────────────────────────────────────────────────── */
router.get("/lip-sync/job/:id", requireAuth, (req, res) => {
  const job = lipSyncJobs.get(String(req.params["id"] ?? ""));
  if (!job) {
    res
      .status(404)
      .json({ error: "Job not found or expired", code: "job_not_found" });
    return;
  }
  res.json(job);
});

/* ──────────────────────────────────────────────────────────────────────────
   GET /lip-sync/check-provider-job/:syncJobId
   Directly check a Sync.so job by its provider ID.
   Used by the client after a local timeout to see if Sync.so finished.
────────────────────────────────────────────────────────────────────────── */
router.get(
  "/lip-sync/check-provider-job/:syncJobId",
  requireAuth,
  async (req, res) => {
    const syncJobId = String(req.params["syncJobId"] ?? "").trim();
    if (!syncJobId) {
      res
        .status(400)
        .json({ error: "syncJobId is required", code: "missing_param" });
      return;
    }
    if (!LIP_SYNC_API_KEY) {
      res
        .status(503)
        .json({ error: "Lip Sync API key not configured", code: "no_api_key" });
      return;
    }

    try {
      const pollRes = await fetch(`${SYNC_LABS_BASE}/generate/${syncJobId}`, {
        headers: { "x-api-key": LIP_SYNC_API_KEY },
        signal: AbortSignal.timeout(30_000),
      });
      if (!pollRes.ok) {
        const body = await pollRes.text().catch(() => "");
        res.status(502).json({
          error: `Sync.so returned HTTP ${pollRes.status}`,
          detail: body.slice(0, 300),
          code: "provider_error",
        });
        return;
      }
      const job = (await pollRes.json()) as SyncLabsJob;
      res.json({
        status: job.status, // "pending" | "processing" | "completed" | "failed"
        outputUrl: job.outputUrl ?? null,
        error: job.error ?? null,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Check failed",
        code: "network_error",
      });
    }
  },
);

/* ──────────────────────────────────────────────────────────────────────────
   GET /lip-sync/check-inputs
   Validate audio URL and clip URL before submitting to Sync Labs.
   Never exposes secrets; never requires auth (read-only probe).
────────────────────────────────────────────────────────────────────────── */
router.get("/lip-sync/check-inputs", async (req, res) => {
  const { audioUrl, clipUrl } = req.query as {
    audioUrl?: string;
    clipUrl?: string;
  };

  async function checkUrl(url: string | undefined, label: string) {
    if (!url)
      return {
        found: false,
        sourceType: "unknown" as UrlType,
        probe: null,
        error: `No ${label} URL provided`,
      };
    if (url.startsWith("blob:"))
      return {
        found: false,
        sourceType: "blob" as UrlType,
        probe: null,
        error:
          "Blob URL cannot be accessed server-side — use a permanent storage URL",
      };
    if (!url.startsWith("http"))
      return {
        found: false,
        sourceType: "unknown" as UrlType,
        probe: null,
        error: "URL must start with https://",
      };

    const sourceType = detectUrlType(url);
    const probe = await probeUrl(url);
    return {
      found: probe.ok,
      sourceType,
      probe: { status: probe.status, contentType: probe.contentType },
      error: probe.error ?? null,
    };
  }

  const [audio, clip] = await Promise.all([
    checkUrl(audioUrl, "audio"),
    checkUrl(clipUrl, "clip"),
  ]);

  const readyToSubmit = audio.found && clip.found && SERVER_KEY_FOUND;

  /* Payload validation:
     removedFields = fields that WERE in the payload and have been stripped out.
     payloadValid  = true because the sanitized payload no longer contains them. */
  const sanitizedPayloadKeys = ["model", "input[video]", "input[audio]"];
  const removedFields = [...SYNC_LABS_REMOVED_FIELDS]; // informational: what was removed
  const payloadValid = true; // always valid after fix — removed fields are gone

  res.json({
    audio: { url: audioUrl ?? null, ...audio },
    clip: { url: clipUrl ?? null, ...clip },
    provider: {
      connected: SERVER_KEY_FOUND,
      providerName: PROVIDER_NAME ?? null,
    },
    payload: {
      sanitizedKeys: sanitizedPayloadKeys,
      removedFields,
      payloadValid,
      sanitizedReady: readyToSubmit,
    },
    readyToSubmit,
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   POST /lip-sync/preview
   Trims audio to the scene's exact time range, then submits to Sync Labs.
────────────────────────────────────────────────────────────────────────── */
router.post("/lip-sync/preview", requireAuth, async (req, res) => {
  /* Validate inputs synchronously, then fire-and-forget background processing.
     The HTTP response completes in < 1 s so the Replit proxy never times out. */
  try {
    const {
      clipUrl,
      audioUrl,
      sceneStartSec,
      sceneEndSec,
      audioSourceType,
      strength,
      preserveFaceIdentity,
      preserveArtistLook,
      projectId,
      sceneId,
    } = (req.body ?? {}) as {
      clipUrl?: string;
      audioUrl?: string;
      sceneStartSec?: number;
      sceneEndSec?: number;
      audioSourceType?: string;
      strength?: string;
      preserveFaceIdentity?: boolean;
      preserveArtistLook?: boolean;
      projectId?: string;
      sceneId?: string;
    };

    void audioSourceType;
    void strength;
    void preserveFaceIdentity;
    void preserveArtistLook;

    /* ── Validate inputs ── */
    if (
      !clipUrl ||
      typeof clipUrl !== "string" ||
      !clipUrl.startsWith("http")
    ) {
      res
        .status(400)
        .json({
          error: "clipUrl is required and must be an HTTP URL.",
          code: "invalid_clip_url",
        });
      return;
    }
    if (!audioUrl || typeof audioUrl !== "string") {
      res
        .status(400)
        .json({ error: "audioUrl is required.", code: "invalid_audio_url" });
      return;
    }
    if (audioUrl.startsWith("blob:")) {
      res.status(400).json({
        error:
          "Audio URL is a temporary browser blob URL (blob:…). Upload the audio file to permanent storage first.",
        code: "blob_url_not_supported",
      });
      return;
    }
    if (!audioUrl.startsWith("http")) {
      res
        .status(400)
        .json({
          error: `Audio URL must start with https:// (got: ${audioUrl.slice(0, 30)})`,
          code: "invalid_audio_url",
        });
      return;
    }
    if (
      typeof sceneStartSec !== "number" ||
      typeof sceneEndSec !== "number" ||
      sceneEndSec <= sceneStartSec
    ) {
      res.status(400).json({
        error:
          "sceneStartSec and sceneEndSec are required; sceneEndSec must be greater than sceneStartSec.",
        code: "invalid_timing",
      });
      return;
    }
    if (!SERVER_KEY_FOUND || !LIP_SYNC_API_KEY) {
      const msg =
        PROVIDER_NAME === "sync"
          ? "Sync Labs API key missing. Add LIP_SYNC_API_KEY in Replit Secrets."
          : "Lip Sync provider not connected. Add LIP_SYNC_API_KEY in Replit Secrets.";
      res.status(503).json({ error: msg, code: "provider_not_connected" });
      return;
    }

    /* ── Pre-flight: verify audio URL is reachable (fast HEAD check) ── */
    const audioProbe = await probeUrl(audioUrl);
    if (!audioProbe.ok) {
      res.status(400).json({
        error: `Audio URL is not reachable: ${audioProbe.error} (type: ${detectUrlType(audioUrl)}, url: ${audioUrl.slice(0, 100)})`,
        code: "audio_url_unreachable",
      });
      return;
    }

    /* ── Pre-flight: verify clip URL is reachable ── */
    const clipProbe = await probeUrl(clipUrl);
    if (!clipProbe.ok) {
      res.status(400).json({
        error: `Clip URL is not reachable: ${clipProbe.error} (url: ${clipUrl.slice(0, 100)})`,
        code: "clip_url_unreachable",
      });
      return;
    }

    /* ── Enqueue job and return immediately ────────────────────────────────
       Background processing (FFmpeg trim + Sync Labs submit/poll) runs after
       the HTTP response is sent. The client polls GET /api/lip-sync/job/:id
       every few seconds until status becomes "done" or "failed".           */
    const jobId = randomUUID();
    const now = new Date().toISOString();
    lipSyncJobs.set(jobId, {
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    void processLipSyncJob(jobId, {
      clipUrl,
      audioUrl,
      sceneStartSec,
      sceneEndSec,
      userId: req.userId,
      projectId: projectId ?? null,
      sceneId: sceneId ?? null,
    });

    req.log.info(
      {
        jobId,
        clipUrl: clipUrl.slice(0, 80),
        sceneStartSec,
        sceneEndSec,
        provider: PROVIDER_NAME,
      },
      "[lip-sync] job queued — returning immediately",
    );

    res.json({ jobId, status: "queued" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lip sync failed";
    req.log.error({ err }, "[lip-sync] preview route error");
    if (!res.headersSent) {
      res.status(502).json({ error: msg, code: "provider_error" });
    }
  }
});

/* ──────────────────────────────────────────────────────────────────────────
   POST /lip-sync/upload-vocal-stem
────────────────────────────────────────────────────────────────────────── */
router.post(
  "/lip-sync/upload-vocal-stem",
  requireAuth,
  express.raw({ type: () => true, limit: "100mb" }),
  async (req, res) => {
    try {
      const buffer = req.body as Buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
        res
          .status(400)
          .json({ error: "No valid audio data received.", code: "empty_file" });
        return;
      }
      if (!STEM_BUCKET) {
        res
          .status(500)
          .json({ error: "Object storage not configured.", code: "no_bucket" });
        return;
      }

      const ct = (req.headers["content-type"] ?? "audio/mpeg").toLowerCase();
      const ext = ct.includes("wav")
        ? "wav"
        : ct.includes("ogg")
          ? "ogg"
          : ct.includes("aac")
            ? "aac"
            : "mp3";
      const contentType =
        ext === "wav"
          ? "audio/wav"
          : ext === "ogg"
            ? "audio/ogg"
            : ext === "aac"
              ? "audio/aac"
              : "audio/mpeg";

      const objectName = `vocal-stems/${req.userId}/${randomUUID()}.${ext}`;
      const bucket = objectStorageClient.bucket(STEM_BUCKET);
      await bucket
        .file(objectName)
        .save(buffer, { contentType, resumable: false });

      // Try Replit sidecar first; fall back to Supabase if it fails
      let url: string;
      try {
        url = await signGetUrl(STEM_BUCKET, objectName);
      } catch (signErr) {
        req.log.warn(
          { err: signErr, objectName },
          "[lip-sync] Replit sidecar signing failed for vocal stem — trying Supabase",
        );
        url = await uploadAudioToSupabase(
          buffer,
          `vocal-stems/${req.userId}/${randomUUID()}.${ext}`,
        );
      }

      req.log.info(
        { objectName, bytes: buffer.length },
        "[lip-sync] vocal stem uploaded",
      );
      res.json({ url, ext, bytes: buffer.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      req.log.error({ err: msg }, "[lip-sync] vocal stem upload failed");
      res.status(500).json({ error: msg, code: "upload_failed" });
    }
  },
);

/* ══════════════════════════════════════════════════════════════════════════
   Scene-only test render — POST /lip-sync/scene-test
   Downloads the lip-sync video + project audio, trims the audio to the
   scene section, applies the video timing offset, muxes with FFmpeg, and
   uploads the result to GCS (with fallback in-memory download route).
   Returns a jobId for polling.
══════════════════════════════════════════════════════════════════════════ */

interface SceneTestDebug {
  routeCalled: boolean;
  ffmpegStarted: boolean;
  ffmpegFinished: boolean;
  outputExists: boolean;
  outputBytes: number;
  outputValid: boolean | null;
  uploadStarted: boolean;
  uploadFinished: boolean;
  signRequestStarted: boolean;
  signRequestFinished: boolean;
  signedUrlCreated: boolean;
  bucketName: string | null;
  objectPath: string | null;
  storageMethod: "signed-url" | "fallback-download" | null;
  resultUrl: string | null;
  lastStorageError: string | null;
  lastError: string | null;
}

interface SceneTestJob {
  status: "queued" | "running" | "done" | "failed";
  step?: string;
  resultUrl?: string;
  storageMethod?: "signed-url" | "fallback-download";
  fileSize?: number;
  error?: string;
  renderSucceeded?: boolean;
  debug: SceneTestDebug;
  createdAt: string;
  updatedAt: string;
}

const sceneTestJobs = new Map<string, SceneTestJob>();
const sceneTestBuffers = new Map<string, Buffer>(); // fallback in-memory download

setInterval(
  () => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, job] of sceneTestJobs) {
      if (new Date(job.createdAt).getTime() < cutoff) {
        sceneTestJobs.delete(id);
        sceneTestBuffers.delete(id);
      }
    }
  },
  30 * 60 * 1000,
).unref();

async function processSceneTestJob(
  jobId: string,
  params: {
    clipUrl: string;
    audioUrl: string;
    sceneStartSec: number;
    sceneEndSec: number;
    videoOffsetSec: number;
  },
): Promise<void> {
  const now = () => new Date().toISOString();
  const update = (patch: Partial<SceneTestJob>) => {
    const j = sceneTestJobs.get(jobId);
    if (j) sceneTestJobs.set(jobId, { ...j, ...patch, updatedAt: now() });
  };
  const dbg = (patch: Partial<SceneTestDebug>) => {
    const j = sceneTestJobs.get(jobId);
    if (j)
      sceneTestJobs.set(jobId, {
        ...j,
        debug: { ...j.debug, ...patch },
        updatedAt: now(),
      });
  };

  const tmpDir = await mkdtemp(join(tmpdir(), "lipsync-test-"));
  try {
    /* ── 1: Download lip sync clip ──────────────────────────────────────── */
    update({ status: "running", step: "downloading lip sync video" });
    const clipRes = await fetch(params.clipUrl, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!clipRes.ok)
      throw new Error(`Clip download failed: HTTP ${clipRes.status}`);
    const clipPath = join(tmpDir, "clip.mp4");
    await writeFile(clipPath, Buffer.from(await clipRes.arrayBuffer()));

    /* ── 2: Download project audio ──────────────────────────────────────── */
    update({ step: "downloading audio" });
    const audioRes = await fetch(params.audioUrl, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!audioRes.ok)
      throw new Error(`Audio download failed: HTTP ${audioRes.status}`);
    const audioCt = audioRes.headers.get("content-type") ?? "";
    const audioExt = audioCt.includes("wav")
      ? "wav"
      : audioCt.includes("ogg")
        ? "ogg"
        : "mp3";
    const audioPath = join(tmpDir, `audio.${audioExt}`);
    await writeFile(audioPath, Buffer.from(await audioRes.arrayBuffer()));

    /* ── 3: Build FFmpeg filter_complex ─────────────────────────────────── */
    update({ step: "rendering mp4" });
    dbg({ ffmpegStarted: true });

    const sceneDur = params.sceneEndSec - params.sceneStartSec;
    const offset = params.videoOffsetSec;
    const outputPath = join(tmpDir, "scene-test.mp4");

    const audioTrimFilter = `atrim=start=${params.sceneStartSec.toFixed(3)}:end=${params.sceneEndSec.toFixed(3)},asetpts=PTS-STARTPTS`;

    let filterComplex: string;
    let videoMap: string;
    const audioMap = "[ao]";

    if (Math.abs(offset) < 0.02) {
      filterComplex = `[1:a]${audioTrimFilter}[ao]`;
      videoMap = "0:v";
    } else if (offset > 0) {
      /* Mouth too early → delay video with black padding at start */
      filterComplex = [
        `[0:v]tpad=start_duration=${offset.toFixed(3)}:color=black[vp]`,
        `[1:a]${audioTrimFilter}[ao]`,
      ].join(";");
      videoMap = "[vp]";
    } else {
      /* Mouth too late → advance video by trimming its start */
      const trimStart = (-offset).toFixed(3);
      filterComplex = [
        `[0:v]trim=start=${trimStart},setpts=PTS-STARTPTS[vt]`,
        `[1:a]${audioTrimFilter}[ao]`,
      ].join(";");
      videoMap = "[vt]";
    }

    const ffmpegArgs = [
      "-y",
      "-i",
      clipPath,
      "-i",
      audioPath,
      "-filter_complex",
      filterComplex,
      "-map",
      videoMap,
      "-map",
      audioMap,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-t",
      sceneDur.toFixed(3),
      "-movflags",
      "+faststart",
      outputPath,
    ];

    let ffmpegStderr = "";
    try {
      const result = await execFileAsync("ffmpeg", ffmpegArgs, {
        timeout: 120_000,
      });
      ffmpegStderr = result.stderr ?? "";
    } catch (ffErr: unknown) {
      ffmpegStderr = (ffErr as { stderr?: string }).stderr ?? "";
      const errMsg = ffErr instanceof Error ? ffErr.message : String(ffErr);
      const stderrTail = ffmpegStderr
        .split("\n")
        .filter(Boolean)
        .slice(-10)
        .join("\n");
      throw new Error(
        `FFmpeg failed: ${errMsg.slice(0, 200)}` +
          (stderrTail ? ` — ${stderrTail.slice(-300)}` : ""),
      );
    }
    void ffmpegStderr;
    dbg({ ffmpegFinished: true });

    /* ── 4: Verify output (size + ffprobe) ───────────────────────────────── */
    const outputExists = existsSync(outputPath);
    dbg({ outputExists });
    if (!outputExists) throw new Error("FFmpeg produced no output file");

    const outputBytes = statSync(outputPath).size;
    dbg({ outputBytes });
    const MIN_BYTES = 100 * 1024; // 100 KB
    if (outputBytes < MIN_BYTES) {
      throw new Error(
        `Output too small (${(outputBytes / 1024).toFixed(1)} KB < 100 KB) — FFmpeg may have failed silently`,
      );
    }

    /* ffprobe validation */
    let outputValid: boolean | null = null;
    try {
      const probe = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        outputPath,
      ]);
      outputValid = probe.stdout.trim().toLowerCase().includes("video");
    } catch {
      outputValid = false;
    }
    dbg({ outputValid });
    if (outputValid === false) {
      throw new Error(
        "ffprobe found no video stream in output — render produced an invalid file",
      );
    }

    update({ renderSucceeded: true });

    /* ── 5: Read file buffer (needed for both GCS upload and fallback) ───── */
    const fileBuffer = readFileSync(outputPath);

    /* ── 6: Upload to GCS + sign URL (with fallback on failure) ─────────── */
    update({ step: "uploading result" });

    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? null;
    const objectName = `lip-sync-tests/${jobId}.mp4`;
    dbg({ bucketName: bucketId, objectPath: objectName });

    let signedUrl: string | null = null;
    let storageError: string | null = null;

    if (bucketId) {
      try {
        dbg({ uploadStarted: true });
        const bucket = objectStorageClient.bucket(bucketId);
        await bucket
          .file(objectName)
          .save(fileBuffer, { contentType: "video/mp4", resumable: false });
        dbg({ uploadFinished: true });

        dbg({ signRequestStarted: true });
        signedUrl = await signGetUrl(bucketId, objectName);
        dbg({
          signRequestFinished: true,
          signedUrlCreated: true,
          resultUrl: signedUrl,
        });
      } catch (storErr) {
        storageError =
          storErr instanceof Error ? storErr.message : String(storErr);
        dbg({
          signRequestFinished: true,
          signedUrlCreated: false,
          lastStorageError: storageError,
        });

        // Replit object storage signing can fail even when the render worked.
        // Do not fail the Scene Only Test; use backend fallback download route.
      }
    } else {
      storageError =
        "DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — using fallback download";
    }

    /* ── 7: Fallback — serve via in-memory download route ───────────────── */
    if (!signedUrl) {
      sceneTestBuffers.set(jobId, fileBuffer);
      const fallbackUrl = `/api/lip-sync-tests/${jobId}/download`;
      dbg({ storageMethod: "fallback-download", resultUrl: fallbackUrl });
      update({
        status: "done",
        step: "done",
        resultUrl: fallbackUrl,
        storageMethod: "fallback-download",
        fileSize: outputBytes,
        /* soft error — render succeeded, only signing failed */
        error: storageError
          ? `Render succeeded. Storage signing failed — using fallback download. (${storageError.slice(0, 200)})`
          : undefined,
      });
      return;
    }

    dbg({ storageMethod: "signed-url" });
    update({
      status: "done",
      step: "done",
      resultUrl: signedUrl,
      storageMethod: "signed-url",
      fileSize: outputBytes,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    dbg({ lastError: errMsg });
    update({ status: "failed", step: "failed", error: errMsg });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/lip-sync-tests/:testId/download
   Fallback download route — serves the rendered MP4 from memory when
   Replit object-storage signing fails.  No auth required; the UUID testId
   is unguessable and acts as the bearer token.
────────────────────────────────────────────────────────────────────────── */
router.get("/lip-sync-tests/:testId/download", (req, res) => {
  const paramId = req.params["testId"];
  const testId = Array.isArray(paramId) ? (paramId[0] ?? "") : (paramId ?? "");
  const buf = sceneTestBuffers.get(testId);
  if (!buf) {
    res
      .status(404)
      .json({ error: "Test file not found or expired", code: "not_found" });
    return;
  }
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="scene-test-${testId.slice(0, 8)}.mp4"`,
  );
  res.setHeader("Cache-Control", "private, max-age=7200");
  res.end(buf);
});

/* ──────────────────────────────────────────────────────────────────────────
   POST /lip-sync/scene-test
   Enqueues a scene render job and returns { jobId } immediately.
────────────────────────────────────────────────────────────────────────── */
router.post("/lip-sync/scene-test", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      clipUrl?: unknown;
      audioUrl?: unknown;
      sceneStartSec?: unknown;
      sceneEndSec?: unknown;
      videoOffsetSec?: unknown;
    };

    if (!body.clipUrl || typeof body.clipUrl !== "string") {
      res
        .status(400)
        .json({ error: "clipUrl is required", code: "missing_clip" });
      return;
    }
    if (!body.audioUrl || typeof body.audioUrl !== "string") {
      res
        .status(400)
        .json({ error: "audioUrl is required", code: "missing_audio" });
      return;
    }
    const sceneStartSec = Number(body.sceneStartSec ?? 0);
    const sceneEndSec = Number(body.sceneEndSec ?? 0);
    const videoOffsetSec = Number(body.videoOffsetSec ?? 0);

    if (
      !Number.isFinite(sceneStartSec) ||
      !Number.isFinite(sceneEndSec) ||
      sceneEndSec <= sceneStartSec
    ) {
      res
        .status(400)
        .json({
          error: "Invalid scene timing: sceneEndSec must be > sceneStartSec",
          code: "invalid_timing",
        });
      return;
    }

    const jobId = randomUUID();
    const createdAt = new Date().toISOString();
    const initJob: SceneTestJob = {
      status: "queued",
      step: "preparing",
      debug: {
        routeCalled: true,
        ffmpegStarted: false,
        ffmpegFinished: false,
        outputExists: false,
        outputBytes: 0,
        outputValid: null,
        uploadStarted: false,
        uploadFinished: false,
        signRequestStarted: false,
        signRequestFinished: false,
        signedUrlCreated: false,
        bucketName: null,
        objectPath: null,
        storageMethod: null,
        resultUrl: null,
        lastStorageError: null,
        lastError: null,
      },
      createdAt,
      updatedAt: createdAt,
    };
    sceneTestJobs.set(jobId, initJob);

    req.log.info(
      {
        jobId,
        sceneStartSec,
        sceneEndSec,
        videoOffsetSec,
        clipUrl: body.clipUrl.slice(0, 80),
      },
      "[scene-test] job queued",
    );

    void processSceneTestJob(jobId, {
      clipUrl: body.clipUrl,
      audioUrl: body.audioUrl,
      sceneStartSec,
      sceneEndSec,
      videoOffsetSec,
    });

    res.json({ jobId, status: "queued" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scene test failed";
    req.log.error({ err }, "[scene-test] route error");
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
   GET /lip-sync/scene-test/:jobId
   Polls the status of a scene test render job.
────────────────────────────────────────────────────────────────────────── */
router.get("/lip-sync/scene-test/:jobId", requireAuth, (req, res) => {
  const paramJobId = req.params["jobId"];
  const job = sceneTestJobs.get(
    Array.isArray(paramJobId) ? (paramJobId[0] ?? "") : (paramJobId ?? ""),
  );
  if (!job) {
    res
      .status(404)
      .json({ error: "Scene test job not found", code: "not_found" });
    return;
  }
  res.json(job);
});

export default router;
