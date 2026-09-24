import { Router } from "express";
import express from "express";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { existsSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { requireAuth } from "../middlewares/require-auth";
import { objectStorageClient } from "../lib/objectStorage";
import {
  PROVIDER_LIMIT_SEC,
  SYNC_LABS_MODEL,
  SYNC_LABS_REMOVED_FIELDS,
  detectUrlType,
  getActiveKeyVar,
  getLipSyncApiKey,
  getLipSyncProviderName,
  getSyncLabsBase,
  hasMultipleKeys,
  isLipSyncServerKeyFound,
  normalizeProviderStatus,
  probeUrl,
  signGetUrl,
  syncLabsStatus,
  uploadAudioToSupabase,
} from "../lib/sync-labs";
import type { UrlType } from "../lib/sync-labs";
import { createLipSyncJob, getLipSyncJob, type LipSyncJob } from "../lib/lip-sync-jobs";
import { requestPollerTick } from "../lib/job-poller";
import { refreshSupabaseStorageUrlsDeep } from "../lib/objectStorage";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { recordLipSyncHistory } from "../lib/payment-record";
import { logger } from "../lib/logger";
  createExportJob,
  getExportJob,
  enqueueExport,
  type ExportStatusRef,
} from "../lib/export-jobs";
  runExportJobInBackground,
  EXPORT_CREDIT_COST,
  type ExportJobContext,
  type ExportRequestBody,
} from "./generate/export-video";

const router = Router();
const execFileAsync = promisify(execFile);

/** Replit object-storage bucket id for vocal stems (media prep moved to lib/sync-labs). */
const STEM_BUCKET = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];

/* ── Client-facing shape for a durable lip-sync job ──────────────────────
   Kept identical to the old in-memory record so the frontend keeps polling
   GET /api/lip-sync/job/:id unchanged: "queued" | "processing" | "done" | "failed". */
function toClientLipSyncJob(job: LipSyncJob) {
  const status =
    job.state === "queued"
      ? "queued"
      : job.state === "done"
        ? "done"
        : job.state === "failed"
          ? "failed"
          : "processing";
  const durationSec = job.params.sceneEndSec - job.params.sceneStartSec;
  return {
    status,
    url: job.resultUrl ?? undefined,
    provider: job.params.provider ?? "sync",
    error: job.error?.message,
    code: job.error?.code,
    durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
    syncLabsJobId: job.providerJobId ?? undefined,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
  };
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
  const providerName = getLipSyncProviderName();
  const serverKeyFound = isLipSyncServerKeyFound();
  const missingKeyMessage =
    providerName === "sync" && !serverKeyFound
      ? "Sync Labs API key missing. Add LIP_SYNC_API_KEY in Replit Secrets."
      : !serverKeyFound
        ? "Lip Sync API key missing. Add LIP_SYNC_API_KEY in Replit Secrets."
        : null;

  res.json({
    connected: serverKeyFound,
    providerName: providerName ?? null,
    serverKeyFound,
    frontendKeyExposed: false,
    mode: serverKeyFound ? "real" : "mock",
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
  const lipSyncApiKey = getLipSyncApiKey();
  const activeKeyVar = getActiveKeyVar();
  const multipleKeysFound = hasMultipleKeys();
  const activeKeyLast4 =
    lipSyncApiKey && lipSyncApiKey.length >= 4
      ? lipSyncApiKey.slice(-4)
      : lipSyncApiKey
        ? "****"
        : null;

  if (!lipSyncApiKey) {
    res.json({
      keyPresent: false,
      activeKeyVar: null,
      activeKeyLast4: null,
      multipleKeysFound,
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
    const r = await fetch(`${getSyncLabsBase()}/generate/${PROBE_JOB_ID}`, {
      headers: { "x-api-key": lipSyncApiKey },
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

  const message = multipleKeysFound
    ? `Multiple keys found. Using ${activeKeyVar} ending in ${activeKeyLast4}`
    : `Using ${activeKeyVar} ending in ${activeKeyLast4}`;

  res.json({
    keyPresent: true,
    activeKeyVar,
    activeKeyLast4,
    multipleKeysFound,
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
router.get("/lip-sync/job/:id", requireAuth, async (req, res) => {
  const id = String(req.params["id"] ?? "");
  const job = await getLipSyncJob(id).catch(() => undefined);
  if (!job || job.userId !== req.userId) {
    res
      .status(404)
      .json({ error: "Job not found or expired", code: "job_not_found" });
    return;
  }
  res.json(toClientLipSyncJob(job));
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
    const apiKey = getLipSyncApiKey();
    if (!apiKey) {
      res
        .status(503)
        .json({ error: "Lip Sync API key not configured", code: "no_api_key" });
      return;
    }

    try {
      const job = await syncLabsStatus(syncJobId, apiKey);
      res.json({
        status: normalizeProviderStatus(job), // "pending" | "processing" | "completed" | "failed"
        outputUrl: job.outputUrl ?? null,
        error: job.error ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Check failed";
      const m = /HTTP (\d+)/.exec(msg);
      if (m) {
        res.status(502).json({
          error: `Sync.so returned HTTP ${m[1]}`,
          detail: msg.slice(0, 300),
          code: "provider_error",
        });
        return;
      }
      res.status(500).json({ error: msg, code: "network_error" });
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

  const readyToSubmit = audio.found && clip.found && isLipSyncServerKeyFound();

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
      connected: isLipSyncServerKeyFound(),
      providerName: getLipSyncProviderName() ?? null,
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
    const apiKey = getLipSyncApiKey();
    if (!apiKey) {
      const msg =
        getLipSyncProviderName() === "sync"
          ? "Sync Labs API key missing. Add LIP_SYNC_API_KEY in Replit Secrets."
          : "Lip Sync provider not connected. Add LIP_SYNC_API_KEY in Replit Secrets.";
      res.status(503).json({ error: msg, code: "provider_not_connected" });
      return;
    }
    void apiKey;

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

    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Not authenticated.", code: "unauthorized" });
      return;
    }

    /* ── Enqueue a durable server-owned job and return immediately ─────────
       The job row survives restarts and the background poller drives it
       through Sync.so's 25–40 minute runs — the tab can close right after
       this response. The client keeps polling GET /api/lip-sync/job/:id
       as before until status becomes "done" or "failed".                */
    const job = await createLipSyncJob({
      userId,
      projectId: projectId ?? null,
      sceneId: sceneId ?? null,
      params: {
        clipUrl,
        audioUrl,
        sceneStartSec,
        sceneEndSec,
        provider: getLipSyncProviderName(),
      },
    });
    const jobId = job.id;

    // Wake the poller so the submit starts within seconds, not on the next tick.
    requestPollerTick();

    req.log.info(
      {
        jobId,
        clipUrl: clipUrl.slice(0, 80),
        sceneStartSec,
        sceneEndSec,
        provider: getLipSyncProviderName(),
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

/* ══════════════════════════════════════════════════════════════════════════
   ONE-CLICK RUN-ALL — POST /api/lip-sync/run-all
   Replaces the old DevTools-console workaround script (lipsync-full-run.js).
   Orchestrates the whole pipeline server-side so the user's browser tab is
   never in the loop: for each exportable scene → trim the song window →
   submit to Sync Labs → poll → save the lipSyncUrl onto the scene → run the
   final export with the lip-sync-first clip URLs.

   ── Robustness note ──
   A run executes as an in-process async loop and the HTTP response returns
   immediately with a runId, so the user navigating away (or closing the tab)
   does NOT affect the run — only their status polling stops; the run keeps
   going and they can resume watching it later via GET /api/lip-sync/run/:id.
   Limitation: the orchestration state lives in this process's memory, so a
   server restart/deploy mid-run kills the orchestration (unlike
   /api/export-final-video jobs, runs are not persisted and not recovered on
   boot). The per-scene lip-sync sub-jobs and the final export job themselves
   live in their own durable/in-process stores and keep their own progress;
   only the run-all orchestration would need to be re-started.
   Also note: the captured userSupabase client carries the request's JWT,
   which can expire on very long runs — the final project save uses the
   service-role client (ownership verified up front), and the export runs
   under the export job's own persisted context.
   ══════════════════════════════════════════════════════════════════════════ */

type RunAllSceneState = "queued" | "syncing" | "done" | "skipped" | "failed";

interface RunAllScene {
  index: number;
  sceneId: string | null;
  state: RunAllSceneState;
  lipSyncUrl?: string;
  error?: string;
}

interface RunAllRecord {
  runId: string;
  userId: string;
  projectId: string;
  state: "running" | "done" | "failed";
  scenes: RunAllScene[];
  exportState: "pending" | "running" | "done" | "failed" | "skipped";
  exportJobId?: string;
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const lipSyncRuns = new Map<string, RunAllRecord>();

setInterval(
  () => {
    const cutoffMs = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, run] of lipSyncRuns) {
      if (new Date(run.createdAt).getTime() < cutoffMs) lipSyncRuns.delete(id);
    }
  },
  30 * 60 * 1000,
).unref();

/** Scene-timing timestamp parser — mirrors the console script exactly. */
function parseSceneTimestamp(ts: unknown): { d: number; explicit: boolean } {
  if (!ts) return { d: 5, explicit: false };
  const m = String(ts).match(
    /(\d+):(\d+(?:\.\d+)?)\s*-\s*(\d+):(\d+(?:\.\d+)?)/,
  );
  if (m) {
    const s = Number(m[1]) * 60 + Number(m[2]);
    const e = Number(m[3]) * 60 + Number(m[4]);
    if (e > s) return { d: e - s, explicit: true };
  }
  return { d: 5, explicit: false };
}

/** Probe song duration server-side (ffprobe on the remote URL) — the
 *  server-side equivalent of the script's `new Audio(url)` metadata probe. */
async function probeAudioDurationSec(url: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        url,
      ],
      { timeout: 20_000 },
    );
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

const RUN_ALL_SCENE_TIMEOUT_MS = 12 * 60 * 1000; // per scene (matches the server provider poll window)
const RUN_ALL_EXPORT_TIMEOUT_MS = 35 * 60 * 1000;

/** Poll an in-process lip-sync sub-job until it resolves. Rejects on failure/timeout. */
async function waitForLipSyncSubJob(subJobId: string): Promise<string> {
  const deadline = Date.now() + RUN_ALL_SCENE_TIMEOUT_MS;
  for (;;) {
    await new Promise((r) => setTimeout(r, 8000));
    const job = lipSyncJobs.get(subJobId);
    if (!job) throw new Error("Lip-sync sub-job disappeared.");
    if (job.status === "done" && job.url) return job.url;
    if (job.status === "failed")
      throw new Error(job.error ?? "Lip-sync provider failed.");
    if (Date.now() >= deadline) break;
  }
  /* Provider-direct recovery: our poller may have given up while Sync.so is
     still working. Check the provider job directly before failing the scene. */
  const syncId = lipSyncJobs.get(subJobId)?.syncLabsJobId;
  if (syncId && LIP_SYNC_API_KEY) {
    const recoverUntil = Date.now() + 10 * 60 * 1000;
    while (Date.now() < recoverUntil) {
      await new Promise((r) => setTimeout(r, 15000));
      try {
        const res = await fetch(`${SYNC_LABS_BASE}/generate/${syncId}`, {
          headers: { "x-api-key": LIP_SYNC_API_KEY },
          signal: AbortSignal.timeout(30_000),
        });
        if (res.ok) {
          const pj = (await res.json()) as SyncLabsJob;
          if (pj.status === "completed" && pj.outputUrl) {
            const job = lipSyncJobs.get(subJobId);
            if (job) {
              job.status = "done";
              job.url = pj.outputUrl;
              job.updatedAt = new Date().toISOString();
            }
            return pj.outputUrl;
          }
          if (pj.status === "failed")
            throw new Error(`Sync Labs job failed: ${pj.error ?? "unknown error"}`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Sync Labs job failed"))
          throw e;
        /* transient — keep polling */
      }
    }
  }
  throw new Error("Lip-sync timed out for this scene — keeping the original clip.");
}

/** Poll the durable export job until it resolves. Returns the video URL. */
async function waitForExportJob(exportJobId: string): Promise<string> {
  const deadline = Date.now() + RUN_ALL_EXPORT_TIMEOUT_MS;
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const job = await getExportJob(exportJobId).catch(() => undefined);
    if (!job) throw new Error("Export job disappeared.");
    if (job.state === "done") {
      const result = (job.result ?? {}) as Record<string, unknown>;
      const url =
        typeof result["url"] === "string"
          ? result["url"]
          : typeof result["videoUrl"] === "string"
            ? result["videoUrl"]
            : null;
      if (!url) throw new Error("Export finished but returned no video URL.");
      return url;
    }
    if (job.state === "failed") {
      const err = (job.error ?? {}) as { message?: string; code?: string };
      throw new Error(err.message ?? "Export failed.");
    }
    if (Date.now() >= deadline)
      throw new Error(
        "The export did not finish in time. Check the Export tab on the site.",
      );
  }
}

interface RunAllSceneInput {
  id: string | null;
  clipUrl: string;
}
interface RunAllTiming {
  start: number;
  end: number;
  dur: number;
}
interface RunAllContext {
  userId: string;
  projectId: string;
  scenes: RunAllSceneInput[];
  timings: RunAllTiming[];
  resolvedAudio: { url: string; src: string; missing: boolean };
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  userSupabase: unknown;
  userPlan?: string;
}

/**
 * The background orchestrator. Fire-and-forget from the route — never throws
 * (all failures are recorded on the run record for the status endpoint).
 */
async function processRunAll(runId: string, ctx: RunAllContext): Promise<void> {
  const now = () => new Date().toISOString();
  const getRun = () => lipSyncRuns.get(runId);
  const patchRun = (patch: Partial<RunAllRecord>) => {
    const r = getRun();
    if (r) lipSyncRuns.set(runId, { ...r, ...patch, updatedAt: now() });
  };
  const patchScene = (index: number, patch: Partial<RunAllScene>) => {
    const r = getRun();
    if (!r) return;
    const scenes = r.scenes.map((s) =>
      s.index === index ? { ...s, ...patch } : s,
    );
    lipSyncRuns.set(runId, { ...r, scenes, updatedAt: now() });
  };

  /* sceneId → successful lip-sync result; applied to the project in one save */
  const lipSyncResults = new Map<
    string,
    { url: string; jobId: string }
  >();

  try {
    /* ── 1. Lip-sync every scene (mirrors script §5) ── */
    for (let i = 0; i < ctx.scenes.length; i++) {
      const s = ctx.scenes[i]!;
      const t = ctx.timings[i]!;
      patchScene(i, { state: "syncing" });

      if (t.dur > PROVIDER_LIMIT_SEC) {
        patchScene(i, {
          state: "skipped",
          error: `Window is ${t.dur.toFixed(1)}s — exceeds the ${PROVIDER_LIMIT_SEC}s plan limit. Original clip kept.`,
        });
        continue;
      }

      /* Reuse the exact per-scene pipeline as POST /lip-sync/preview
         (trim → submit → poll) — no duplicated provider-call code. */
      const subJobId = randomUUID();
      const stamp = now();
      lipSyncJobs.set(subJobId, {
        status: "queued",
        createdAt: stamp,
        updatedAt: stamp,
      });
      void processLipSyncJob(subJobId, {
        clipUrl: s.clipUrl,
        audioUrl: ctx.resolvedAudio.url,
        sceneStartSec: t.start,
        sceneEndSec: t.end,
        userId: ctx.userId,
        projectId: ctx.projectId,
        sceneId: s.id,
      });

      try {
        const url = await waitForLipSyncSubJob(subJobId);
        if (s.id) lipSyncResults.set(s.id, { url, jobId: subJobId });
        patchScene(i, { state: "done", lipSyncUrl: url });
        ctx.log.info(
          { runId, scene: i + 1, subJobId },
          "[run-all] scene lip-synced",
        );
      } catch (err) {
        patchScene(i, {
          state: "failed",
          error: err instanceof Error ? err.message : "Lip-sync failed",
        });
        ctx.log.warn(
          { runId, scene: i + 1, err: err instanceof Error ? err.message : err },
          "[run-all] scene kept original clip",
        );
      }
    }

    /* ── 2. Save the project with the new lip-sync clips (mirrors script §6) ──
       Re-reads fresh output_data and merges per-scene clip entries instead of
       wholesale-replacing editorSettings, so edits the user made while the
       run was in flight are preserved. Uses the service-role client scoped by
       id + user_id — same approach as PATCH /api/projects/:id. */
    {
      const admin = getSupabaseAdmin();
      const { data: fresh, error: freshErr } = await admin
        .from("projects")
        .select("output_data")
        .eq("id", ctx.projectId)
        .eq("user_id", ctx.userId)
        .single();
      if (freshErr || !fresh)
        throw new Error("Project not found — it may have been deleted.");
      const freshOut = ((fresh?.output_data ?? {}) as Record<string, unknown>) as {
        editorSettings?: Record<string, unknown>;
      };
      const freshSettings = (freshOut.editorSettings ?? {}) as Record<string, unknown>;
      const freshClips = { ...((freshSettings["clips"] ?? {}) as Record<string, unknown>) };
      for (const [sceneId, r] of lipSyncResults) {
        freshClips[sceneId] = {
          ...((freshClips[sceneId] ?? {}) as Record<string, unknown>),
          useLipSync: true,
          lipSyncStatus: "done",
          lipSyncUrl: r.url,
          lipSyncJobId: r.jobId,
          lipSyncOffsetSeconds: 0,
        };
      }
      const { error: updErr } = await admin
        .from("projects")
        .update({
          output_data: {
            ...(fresh?.output_data as Record<string, unknown>),
            editorSettings: { ...freshSettings, clips: freshClips },
          },
        })
        .eq("id", ctx.projectId)
        .eq("user_id", ctx.userId);
      if (updErr) throw new Error(`Project save failed: ${updErr.message}`);
    }

    const okCount = lipSyncResults.size;
    ctx.log.info(
      { runId, okCount, total: ctx.scenes.length },
      "[run-all] project saved, building final export",
    );

    /* ── 3. Final export (mirrors script §7 — lip-sync-first clip URLs plus
       the project's captions / watermark / branding / effects / transitions) ── */
    patchRun({ exportState: "running" });

    const resolvedClipUrls = ctx.scenes.map((s) => {
      const r = s.id ? lipSyncResults.get(s.id) : undefined;
      return r ? r.url : s.clipUrl;
    });

    /* Re-read settings fresh so the export uses the latest captions, watermark,
       branding, effects, transitions and overlay choices. */
    const admin = getSupabaseAdmin();
    const { data: latest } = await admin
      .from("projects")
      .select("output_data")
      .eq("id", ctx.projectId)
      .eq("user_id", ctx.userId)
      .single();
    const latestOut = ((latest?.output_data ?? {}) as Record<string, unknown>) as {
      editorSettings?: Record<string, unknown>;
    };
    const settings = (latestOut.editorSettings ?? {}) as Record<string, any>;
    const clips = (settings["clips"] ?? {}) as Record<string, any>;
    const ms = (settings["musicStudio"] ?? {}) as Record<string, any>;
    const va = (ms["videoAudio"] ?? {}) as Record<string, any>;
    const exp = (settings["export"] ?? {}) as Record<string, any>;

    const payload: ExportRequestBody = {
      projectId: ctx.projectId,
      clipUrls: resolvedClipUrls,
      audioUrl: ctx.resolvedAudio.url,
      aspectRatio: exp["format"] ?? "16:9",
      fadeAudioInSec: va["fadeIn"] ?? 0,
      fadeAudioOutSec: va["fadeOut"] ?? 0,
      loopAudio: va["loopAudio"] ?? false,
      audioStartSec: va["startSec"] ?? 0,
      matchVideoLength: va["matchVideoLength"] ?? true,
      addWatermark:
        settings["watermarkIncludeInExport"] !== false &&
        (settings["watermarkType"] || "text") !== "none",
      customWatermarkUrl: exp["customWatermarkUrl"] ?? null,
      watermarkPosition: settings["watermarkPosition"] ?? "bottom-right",
      watermarkSize: settings["watermarkSize"] ?? "medium",
      watermarkMargin: settings["watermarkMargin"] ?? 16,
      audioSource: va["source"] || "uploaded",
      captions: settings["captions"] ?? { lines: [] },
      branding: settings["branding"] ?? null,
      exportRangeStart: null,
      exportRangeEnd: null,
      clipTransitions: ctx.scenes.map((s) => {
        const c = (s.id && clips[s.id]) || {};
        if (!c["transition"] || c["transition"] === "Cut") return null;
        return {
          type: c["transition"] as string,
          duration: (c["transitionDuration"] as number | undefined) ?? 1.0,
        };
      }),
      overlayItems: settings["overlayItems"] ?? [],
      effects: settings["effects"]?.length ? settings["effects"] : null,
      overlayEffects: settings["overlays"]?.length ? settings["overlays"] : null,
      overlayEffectIntensity: settings["overlayIntensity"] ?? null,
      fitMode: exp["fitMode"] ?? "fill",
    };

    const exportJob = await createExportJob(ctx.userId, ctx.projectId, payload);
    patchRun({ exportJobId: exportJob.id });

    const statusRef: ExportStatusRef = { current: null };
    const exportCtx: ExportJobContext = {
      body: payload,
      userId: ctx.userId,
      userPlan: ctx.userPlan,
      userSupabase: ctx.userSupabase as ExportJobContext["userSupabase"],
      log: ctx.log,
      statusRef,
    };
    enqueueExport(() => runExportJobInBackground(exportJob.id, exportCtx));

    const videoUrl = await waitForExportJob(exportJob.id);
    patchRun({ state: "done", exportState: "done", videoUrl });
    ctx.log.info({ runId, videoUrl }, "[run-all] DONE");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Run failed";
    ctx.log.error({ runId, err: message }, "[run-all] failed");
    patchRun({ state: "failed", error: message });
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   POST /api/lip-sync/run-all
   One-click: lip-sync every exportable scene, then run the final export.
   Returns immediately with a runId — the run continues in the background
   even if the user navigates away. Poll GET /api/lip-sync/run/:runId.
────────────────────────────────────────────────────────────────────────── */
router.post("/lip-sync/run-all", requireAuth, async (req, res) => {
  try {
    const { projectId } = (req.body ?? {}) as { projectId?: string };
    if (!projectId || typeof projectId !== "string" || !projectId.trim()) {
      res
        .status(400)
        .json({ error: "projectId is required.", code: "missing_project_id" });
      return;
    }
    if (!SERVER_KEY_FOUND || !LIP_SYNC_API_KEY) {
      res.status(503).json({
        error: "Lip Sync provider not connected.",
        code: "provider_not_connected",
      });
      return;
    }

    /* Credit gate mirrors POST /api/export-final-video: 5 credits are
       deducted only when the export actually succeeds. */
    const isDev = process.env["NODE_ENV"] === "development";
    if (!isDev && (req.userCredits ?? 0) < EXPORT_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough credits. Please buy more credits to continue.",
      });
      return;
    }

    /* Fetch the project (ownership-scoped, like PATCH /api/projects/:id). */
    const { data: project, error: fetchErr } = await req.userSupabase!
      .from("projects")
      .select("id, input_data, output_data")
      .eq("id", projectId.trim())
      .eq("user_id", req.userId)
      .single();
    if (fetchErr || !project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const outputData = (await refreshSupabaseStorageUrlsDeep(
      (project.output_data ?? {}) as Record<string, unknown>,
    )) as unknown as {
      scenes?: unknown[];
      editorSettings?: Record<string, any>;
    };
    const inputData = (project.input_data ?? {}) as Record<string, any>;

    /* ── Scene discovery (mirrors script §2) ── */
    const allScenes = (outputData.scenes ?? []) as Record<string, any>[];
    const sceneUrl = (s: Record<string, any>): string | null =>
      s["demoClipUrl"] || s["videoUrl"] || s["clipUrl"] || s["url"] || s["src"] || null;
    const scenes = allScenes.filter(
      (s) => sceneUrl(s) && s["selected"] !== false && s["approved"] !== false,
    );
    if (!scenes.length) {
      res.status(400).json({
        error: "No exportable scenes found in this project.",
        code: "no_scenes",
      });
      return;
    }

    const settings = (outputData.editorSettings ?? {}) as Record<string, any>;
    const clips = (settings["clips"] ?? {}) as Record<string, any>;
    const ms = (settings["musicStudio"] ?? {}) as Record<string, any>;
    const va = (ms["videoAudio"] ?? {}) as Record<string, any>;
    const rawAudioUrl: string | null =
      inputData["audioUrl"] ||
      inputData["audio_url"] ||
      ms["stems"]?.[0]?.["url"] ||
      null;
    if (!rawAudioUrl) {
      res.status(400).json({
        error: "No song audio URL on the project.",
        code: "no_audio",
      });
      return;
    }

    /* Resolve the same audio the editor's Export tab would use (script §2). */
    const src: string = va["source"] || "uploaded";
    let resolvedAudio = { url: rawAudioUrl, src, missing: false };
    if (src !== "uploaded" && src !== "none") {
      const ex = ((ms["exports"] ?? []) as any[]).filter((e) => e && e["url"]);
      resolvedAudio = ex.length
        ? { url: ex[ex.length - 1]["url"] as string, src, missing: false }
        : { url: rawAudioUrl, src, missing: true };
    }

    /* ── Song duration drives scene timing (script §3) ── */
    let audioDuration: number | null =
      (va["duration"] as number | undefined) ??
      (inputData["songDuration"] as number | undefined) ??
      (inputData["duration"] as number | undefined) ??
      null;
    if (!audioDuration) {
      audioDuration = await probeAudioDurationSec(resolvedAudio.url);
    }

    /* ── Per-scene song windows (script §4: explicit timestamps → even song
       distribution → manual overrides) ── */
    const raw = scenes.map((s) => parseSceneTimestamp(s["timestamp"]));
    const allDefault = raw.length > 0 && raw.every((r) => !r.explicit);
    const durs: number[] =
      allDefault && (audioDuration ?? 0) > 0
        ? scenes.map(() => (audioDuration as number) / scenes.length)
        : raw.map((r) => r.d);
    const timings: RunAllTiming[] = [];
    let acc = 0;
    for (let i = 0; i < scenes.length; i++) {
      const d = durs[i] ?? 5;
      let start = acc;
      if (settings["timelineLayout"] === "manual") {
        const me = clips[scenes[i]!["id"]]?.["manualStartSec"];
        if (typeof me === "number" && me >= 0) start = me;
      }
      timings.push({ start, end: start + d, dur: d });
      acc += d;
    }

    /* ── Create the run record and return immediately ── */
    const runId = randomUUID();
    const stamp = new Date().toISOString();
    lipSyncRuns.set(runId, {
      runId,
      userId: req.userId!,
      projectId: projectId.trim(),
      state: "running",
      scenes: scenes.map((s, i) => ({
        index: i,
        sceneId: (s["id"] as string | undefined) ?? null,
        state: "queued" as RunAllSceneState,
      })),
      exportState: "pending",
      createdAt: stamp,
      updatedAt: stamp,
    });

    req.log.info(
      { runId, projectId: projectId.trim(), scenes: scenes.length },
      "[run-all] started",
    );

    void processRunAll(runId, {
      userId: req.userId!,
      projectId: projectId.trim(),
      scenes: scenes.map((s) => ({
        id: (s["id"] as string | undefined) ?? null,
        clipUrl: sceneUrl(s) as string,
      })),
      timings,
      resolvedAudio,
      log: req.log ?? logger,
      userSupabase: req.userSupabase,
      userPlan: req.userPlan,
    });

    res.status(202).json({ runId, state: "running", sceneCount: scenes.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Run failed to start";
    req.log.error({ err }, "[run-all] route error");
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/lip-sync/run/:runId
   Poll a one-click run-all job. Returns per-scene progress + export state.
────────────────────────────────────────────────────────────────────────── */
router.get("/lip-sync/run/:runId", requireAuth, (req, res) => {
  const rawId = req.params["runId"];
  const runId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");
  const run = lipSyncRuns.get(runId);
  if (!run || run.userId !== req.userId) {
    res.status(404).json({ error: "Run not found or expired", code: "not_found" });
    return;
  }
  res.json({
    runId: run.runId,
    projectId: run.projectId,
    state: run.state,
    sceneCount: run.scenes.length,
    scenes: run.scenes,
    exportState: run.exportState,
    exportJobId: run.exportJobId ?? null,
    videoUrl: run.videoUrl ?? null,
    error: run.error ?? null,
  });
});

export default router;
