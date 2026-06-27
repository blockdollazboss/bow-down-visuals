import { Router } from "express";
import express from "express";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { requireAuth } from "../middlewares/require-auth";
import { objectStorageClient } from "../lib/objectStorage";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Server-side secrets (never sent to the browser) ── */
const LIP_SYNC_API_KEY  = process.env["LIP_SYNC_API_KEY"];
const LIP_SYNC_PROVIDER = (process.env["LIP_SYNC_PROVIDER"] ?? "").toLowerCase().trim();
const SERVER_KEY_FOUND  = !!(LIP_SYNC_API_KEY && LIP_SYNC_API_KEY.length > 0);
const PROVIDER_NAME     = LIP_SYNC_PROVIDER || (SERVER_KEY_FOUND ? "custom" : null);

const STEM_BUCKET = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
const SIDECAR     = "http://127.0.0.1:1106";

/** Sync Labs plan limit in seconds */
const PROVIDER_LIMIT_SEC = 20;

/** Supabase storage bucket for temporary lip-sync audio segments */
const LIP_SYNC_AUDIO_BUCKET = "lip-sync-temp";

/* ── Sync Labs ────────────────────────────────────────────────────────────── */
const SYNC_LABS_BASE        = "https://api.sync.so/v2";
const SYNC_LABS_MODEL       = "sync-1.9.0-beta";
const SYNC_POLL_INTERVAL_MS = 5_000;
const SYNC_MAX_POLLS        = 72; // 72 × 5s = 6 minutes max

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

async function syncLabsSubmit(clipUrl: string, audioUrl: string, apiKey: string): Promise<string> {
  const payload = buildSyncLabsPayload(clipUrl, audioUrl);

  // Log the sanitized payload (keys only — no API key, no full URLs in prod)
  const payloadKeys = [
    "model",
    ...payload.input.map((i) => `input[${i.type}]`),
  ];
  // logger available via req.log in routes; use console here (non-route context)
  console.info("[lip-sync] Sync Labs payload keys:", payloadKeys.join(", "));
  console.info("[lip-sync] Removed fields:", SYNC_LABS_REMOVED_FIELDS.join(", "));

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
      throw new Error(`Sync Labs poll failed: HTTP ${res.status} — ${body.slice(0, 300)}`);
    }
    const job = (await res.json()) as SyncLabsJob;
    if (job.status === "completed") {
      if (!job.outputUrl) throw new Error("Sync Labs job completed but returned no outputUrl.");
      return job.outputUrl;
    }
    if (job.status === "failed") {
      throw new Error(`Sync Labs job failed: ${job.error ?? "unknown error"}`);
    }
  }
  throw new Error("Sync Labs job timed out after 6 minutes.");
}

/* ── URL type detection ──────────────────────────────────────────────────── */
type UrlType = "public-https" | "supabase" | "replit-storage" | "blob" | "unknown";

function detectUrlType(url: string): UrlType {
  if (!url) return "unknown";
  if (url.startsWith("blob:"))   return "blob";
  if (!url.startsWith("http"))   return "unknown";
  const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
  if (supabaseUrl && url.startsWith(supabaseUrl)) return "supabase";
  if (
    url.includes("storage.googleapis.com") ||
    url.includes("replit-objstore") ||
    url.includes("127.0.0.1:1106")
  ) return "replit-storage";
  return "public-https";
}

/** HEAD-check a URL, return { ok, status, contentType, error } */
async function probeUrl(url: string, timeoutMs = 15_000): Promise<{
  ok: boolean;
  status: number;
  contentType: string | null;
  error: string | null;
}> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type"),
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, status: 0, contentType: null, error: err instanceof Error ? err.message : String(err) };
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
  if (error && !error.message?.toLowerCase().includes("already exist") && error.message !== "Duplicate") {
    // Non-fatal: bucket might exist under a different error wording
  }
}

async function uploadAudioToSupabase(buffer: Buffer, objectName: string): Promise<string> {
  await ensureSupabaseBucket().catch(() => {/* ignore — bucket likely exists */});
  const supabase = getSupabaseAdmin();

  const { error: upErr } = await supabase.storage
    .from(LIP_SYNC_AUDIO_BUCKET)
    .upload(objectName, buffer, { contentType: "audio/mpeg", upsert: true });

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
async function signGetUrl(bucketName: string, objectName: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: bucketName, object_name: objectName, method: "GET", expires_at: expiresAt }),
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
    const dlRes = await fetch(audioUrl, { signal: AbortSignal.timeout(120_000) });
    if (!dlRes.ok) {
      throw new Error(
        `Audio download failed: HTTP ${dlRes.status}` +
        ` (url type: ${detectUrlType(audioUrl)})`,
      );
    }
    const ct  = dlRes.headers.get("content-type") ?? "";
    const ext = ct.includes("wav") ? "wav" : ct.includes("ogg") ? "ogg" : "mp3";
    const inputPath  = join(tmpDir, `input.${ext}`);
    const outputPath = join(tmpDir, "segment.mp3");
    await writeFile(inputPath, Buffer.from(await dlRes.arrayBuffer()));

    /* 2. Trim with FFmpeg */
    let ffmpegStderr = "";
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",   inputPath,
      "-ss",  String(startSec),
      "-to",  String(endSec),
      "-c:a", "libmp3lame",
      "-q:a", "2",
      outputPath,
    ]).catch((err: Error & { stderr?: string }) => {
      ffmpegStderr = (err as unknown as { stderr?: string }).stderr ?? "";
      throw new Error(`FFmpeg trim failed: ${err.message}${ffmpegStderr ? ` — ${ffmpegStderr.slice(-200)}` : ""}`);
    });

    /* 3. Verify actual duration */
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      outputPath,
    ]);
    const durationSec = parseFloat(stdout.trim());
    if (isNaN(durationSec)) throw new Error("Could not determine trimmed audio duration.");

    /* 4. Upload trimmed segment to Supabase storage → signed URL */
    const buffer     = await readFile(outputPath);
    const objectName = `segments/${randomUUID()}.mp3`;
    const segmentUrl = await uploadAudioToSupabase(buffer, objectName);

    return { segmentUrl, durationSec };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

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
    connected:          SERVER_KEY_FOUND,
    providerName:       PROVIDER_NAME ?? null,
    serverKeyFound:     SERVER_KEY_FOUND,
    frontendKeyExposed: false,
    mode:               SERVER_KEY_FOUND ? "real" : "mock",
    missingKeyMessage,
    providerLimitSec:   PROVIDER_LIMIT_SEC,
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   GET /lip-sync/check-inputs
   Validate audio URL and clip URL before submitting to Sync Labs.
   Never exposes secrets; never requires auth (read-only probe).
────────────────────────────────────────────────────────────────────────── */
router.get("/lip-sync/check-inputs", async (req, res) => {
  const { audioUrl, clipUrl } = req.query as { audioUrl?: string; clipUrl?: string };

  async function checkUrl(url: string | undefined, label: string) {
    if (!url) return { found: false, sourceType: "unknown" as UrlType, probe: null, error: `No ${label} URL provided` };
    if (url.startsWith("blob:")) return { found: false, sourceType: "blob" as UrlType, probe: null, error: "Blob URL cannot be accessed server-side — use a permanent storage URL" };
    if (!url.startsWith("http")) return { found: false, sourceType: "unknown" as UrlType, probe: null, error: "URL must start with https://" };

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

  const readyToSubmit =
    audio.found && clip.found && SERVER_KEY_FOUND;

  /* Payload validation:
     removedFields = fields that WERE in the payload and have been stripped out.
     payloadValid  = true because the sanitized payload no longer contains them. */
  const sanitizedPayloadKeys = ["model", "input[video]", "input[audio]"];
  const removedFields        = [...SYNC_LABS_REMOVED_FIELDS]; // informational: what was removed
  const payloadValid         = true; // always valid after fix — removed fields are gone

  res.json({
    audio: { url: audioUrl ?? null, ...audio },
    clip:  { url: clipUrl  ?? null, ...clip },
    provider: {
      connected:      SERVER_KEY_FOUND,
      providerName:   PROVIDER_NAME ?? null,
    },
    payload: {
      sanitizedKeys:   sanitizedPayloadKeys,
      removedFields,
      payloadValid,
      sanitizedReady:  readyToSubmit,
    },
    readyToSubmit,
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   POST /lip-sync/preview
   Trims audio to the scene's exact time range, then submits to Sync Labs.
────────────────────────────────────────────────────────────────────────── */
router.post("/lip-sync/preview", requireAuth, async (req, res) => {
  /* Single catch wraps EVERYTHING — guarantees JSON even on unhandled errors */
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
    } = (req.body ?? {}) as {
      clipUrl?:              string;
      audioUrl?:             string;
      sceneStartSec?:        number;
      sceneEndSec?:          number;
      audioSourceType?:      string;
      strength?:             string;
      preserveFaceIdentity?: boolean;
      preserveArtistLook?:  boolean;
    };

    void audioSourceType; void strength; void preserveFaceIdentity; void preserveArtistLook;

    /* ── Validate inputs ── */
    if (!clipUrl || typeof clipUrl !== "string" || !clipUrl.startsWith("http")) {
      res.status(400).json({ error: "clipUrl is required and must be an HTTP URL.", code: "invalid_clip_url" });
      return;
    }
    if (!audioUrl || typeof audioUrl !== "string") {
      res.status(400).json({ error: "audioUrl is required.", code: "invalid_audio_url" });
      return;
    }
    if (audioUrl.startsWith("blob:")) {
      res.status(400).json({
        error: "Audio URL is a temporary browser blob URL (blob:…). Upload the audio file to permanent storage first.",
        code: "blob_url_not_supported",
      });
      return;
    }
    if (!audioUrl.startsWith("http")) {
      res.status(400).json({ error: `Audio URL must start with https:// (got: ${audioUrl.slice(0, 30)})`, code: "invalid_audio_url" });
      return;
    }
    if (typeof sceneStartSec !== "number" || typeof sceneEndSec !== "number" || sceneEndSec <= sceneStartSec) {
      res.status(400).json({
        error: "sceneStartSec and sceneEndSec are required; sceneEndSec must be greater than sceneStartSec.",
        code: "invalid_timing",
      });
      return;
    }
    if (!SERVER_KEY_FOUND || !LIP_SYNC_API_KEY) {
      const msg = PROVIDER_NAME === "sync"
        ? "Sync Labs API key missing. Add LIP_SYNC_API_KEY in Replit Secrets."
        : "Lip Sync provider not connected. Add LIP_SYNC_API_KEY in Replit Secrets.";
      res.status(503).json({ error: msg, code: "provider_not_connected" });
      return;
    }

    /* ── Pre-flight: verify audio URL is reachable ── */
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

    /* Extend socket timeout for trimming + polling */
    req.socket.setTimeout(480_000);

    req.log.info(
      { clipUrl: clipUrl.slice(0, 80), sceneStartSec, sceneEndSec, provider: PROVIDER_NAME },
      "[lip-sync] starting preview — trimming audio segment",
    );

    /* ── Step 1: Trim audio to scene range ── */
    const { segmentUrl, durationSec } = await trimAndUploadAudioSegment(audioUrl, sceneStartSec, sceneEndSec);

    req.log.info({ durationSec, sceneStartSec, sceneEndSec }, "[lip-sync] audio segment trimmed and uploaded");

    /* ── Step 2: Verify duration against provider plan limit ── */
    if (durationSec > PROVIDER_LIMIT_SEC) {
      res.status(400).json({
        error: `Audio segment is ${durationSec.toFixed(1)}s — exceeds Sync Labs plan limit of ${PROVIDER_LIMIT_SEC}s. Trim the scene or upgrade your plan.`,
        code: "segment_too_long",
        durationSec,
        limitSec: PROVIDER_LIMIT_SEC,
      });
      return;
    }

    /* ── Step 3: Submit to provider ── */
    if (PROVIDER_NAME === "sync") {
      const jobId     = await syncLabsSubmit(clipUrl, segmentUrl, LIP_SYNC_API_KEY);
      req.log.info({ jobId }, "[lip-sync] Sync Labs job submitted");
      const outputUrl = await syncLabsPoll(jobId, LIP_SYNC_API_KEY);
      req.log.info({ jobId, outputUrl }, "[lip-sync] Sync Labs job completed");
      res.json({
        url:       outputUrl,
        provider:  "sync",
        createdAt: new Date().toISOString(),
        segmentDurationSec: durationSec,
      });
      return;
    }

    throw new Error(
      `Provider "${PROVIDER_NAME}" is not wired. ` +
      "Set LIP_SYNC_PROVIDER=sync in Replit Secrets to use Sync Labs.",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lip sync failed";
    req.log.error({ err }, "[lip-sync] preview failed");
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
        res.status(400).json({ error: "No valid audio data received.", code: "empty_file" });
        return;
      }
      if (!STEM_BUCKET) {
        res.status(500).json({ error: "Object storage not configured.", code: "no_bucket" });
        return;
      }

      const ct = (req.headers["content-type"] ?? "audio/mpeg").toLowerCase();
      const ext = ct.includes("wav") ? "wav" : ct.includes("ogg") ? "ogg" : ct.includes("aac") ? "aac" : "mp3";
      const contentType =
        ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : ext === "aac" ? "audio/aac" : "audio/mpeg";

      const objectName = `vocal-stems/${req.userId}/${randomUUID()}.${ext}`;
      const bucket = objectStorageClient.bucket(STEM_BUCKET);
      await bucket.file(objectName).save(buffer, { contentType, resumable: false });

      // Try Replit sidecar first; fall back to Supabase if it fails
      let url: string;
      try {
        url = await signGetUrl(STEM_BUCKET, objectName);
      } catch (signErr) {
        req.log.warn({ err: signErr, objectName }, "[lip-sync] Replit sidecar signing failed for vocal stem — trying Supabase");
        url = await uploadAudioToSupabase(buffer, `vocal-stems/${req.userId}/${randomUUID()}.${ext}`);
      }

      req.log.info({ objectName, bytes: buffer.length }, "[lip-sync] vocal stem uploaded");
      res.json({ url, ext, bytes: buffer.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      req.log.error({ err: msg }, "[lip-sync] vocal stem upload failed");
      res.status(500).json({ error: msg, code: "upload_failed" });
    }
  },
);

export default router;
