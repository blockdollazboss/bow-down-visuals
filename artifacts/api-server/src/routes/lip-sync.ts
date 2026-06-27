import { Router } from "express";
import express from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/require-auth";
import { objectStorageClient } from "../lib/objectStorage";

const router = Router();

/* ── Server-side secrets (never sent to the browser) ── */
const LIP_SYNC_API_KEY  = process.env["LIP_SYNC_API_KEY"];
const LIP_SYNC_PROVIDER = (process.env["LIP_SYNC_PROVIDER"] ?? "").toLowerCase().trim();
const SERVER_KEY_FOUND  = !!(LIP_SYNC_API_KEY && LIP_SYNC_API_KEY.length > 0);
const PROVIDER_NAME     = LIP_SYNC_PROVIDER || (SERVER_KEY_FOUND ? "custom" : null);

const STEM_BUCKET = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
const SIDECAR     = "http://127.0.0.1:1106";

/* ── Sync Labs ────────────────────────────────────────────────────────────── */
const SYNC_LABS_BASE   = "https://api.sync.so/v2";
const SYNC_LABS_MODEL  = "sync-1.9.0-beta";
const SYNC_POLL_INTERVAL_MS = 5_000;
const SYNC_MAX_POLLS    = 72; // 72 × 5s = 6 minutes max

interface SyncLabsJob {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  outputUrl?: string;
  error?: string;
}

async function syncLabsSubmit(clipUrl: string, audioUrl: string, apiKey: string): Promise<string> {
  const res = await fetch(`${SYNC_LABS_BASE}/generate`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: SYNC_LABS_MODEL,
      input: [
        { type: "video", url: clipUrl },
        { type: "audio", url: audioUrl },
      ],
      options: {
        pads: [0, 5, 0, 0],
        synergize: true,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sync Labs submit failed: HTTP ${res.status} — ${body.slice(0, 300)}`);
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
    // pending | processing — keep polling
  }
  throw new Error("Sync Labs job timed out after 6 minutes.");
}

/* ── Object storage helper ───────────────────────────────────────────────── */
async function signGetUrl(bucketName: string, objectName: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
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
  if (!res.ok) throw new Error(`Failed to sign URL: ${res.status}`);
  const { signed_url } = (await res.json()) as { signed_url: string };
  return signed_url;
}

/* ──────────────────────────────────────────────────────────────────────────
   GET /lip-sync/status
   Public — returns safe provider info. Never exposes the API key.
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
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   POST /lip-sync/preview
   Secure — LIP_SYNC_API_KEY read from server env only.
   Supports: sync (Sync Labs)
────────────────────────────────────────────────────────────────────────── */
router.post("/lip-sync/preview", requireAuth, async (req, res) => {
  const {
    clipUrl,
    audioUrl,
    audioSourceType,
    strength,
    preserveFaceIdentity,
    preserveArtistLook,
  } = (req.body ?? {}) as {
    clipUrl?: string;
    audioUrl?: string;
    audioSourceType?: string;
    strength?: string;
    preserveFaceIdentity?: boolean;
    preserveArtistLook?: boolean;
  };

  void audioSourceType; void strength; void preserveFaceIdentity; void preserveArtistLook;

  if (!clipUrl || typeof clipUrl !== "string" || !clipUrl.startsWith("http")) {
    res.status(400).json({ error: "clipUrl is required and must be an HTTP URL.", code: "invalid_clip_url" });
    return;
  }
  if (!audioUrl || typeof audioUrl !== "string" || !audioUrl.startsWith("http")) {
    res.status(400).json({ error: "audioUrl is required and must be an HTTP URL.", code: "invalid_audio_url" });
    return;
  }
  if (!SERVER_KEY_FOUND || !LIP_SYNC_API_KEY) {
    const msg = PROVIDER_NAME === "sync"
      ? "Sync Labs API key missing. Add LIP_SYNC_API_KEY in Replit Secrets."
      : "Lip Sync provider not connected. Add LIP_SYNC_API_KEY in Replit Secrets.";
    res.status(503).json({ error: msg, code: "provider_not_connected" });
    return;
  }

  /* Extend socket timeout to 7 minutes so long-running polls don't get cut off */
  req.socket.setTimeout(420_000);

  req.log.info({ clipUrl, audioSourceType, provider: PROVIDER_NAME }, "[lip-sync] starting preview");

  try {
    if (PROVIDER_NAME === "sync") {
      /* ── Sync Labs ── */
      const jobId = await syncLabsSubmit(clipUrl, audioUrl, LIP_SYNC_API_KEY);
      req.log.info({ jobId }, "[lip-sync] Sync Labs job submitted");
      const outputUrl = await syncLabsPoll(jobId, LIP_SYNC_API_KEY);
      req.log.info({ jobId, outputUrl }, "[lip-sync] Sync Labs job completed");
      res.json({
        url:       outputUrl,
        provider:  "sync",
        createdAt: new Date().toISOString(),
      });
      return;
    }

    /* ── Unknown provider ── */
    throw new Error(
      `Provider "${PROVIDER_NAME}" is not wired. ` +
      "Set LIP_SYNC_PROVIDER=sync in Replit Secrets to use Sync Labs.",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lip sync failed";
    req.log.error({ err }, "[lip-sync] preview failed");
    res.status(502).json({ error: msg, code: "provider_error" });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
   POST /lip-sync/upload-vocal-stem
   Accepts a raw audio file (mp3/wav/ogg/aac), saves to object storage.
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
      const ext = ct.includes("wav") ? "wav"
        : ct.includes("ogg") ? "ogg"
        : ct.includes("aac") ? "aac"
        : "mp3";
      const contentType =
        ext === "wav" ? "audio/wav"
        : ext === "ogg" ? "audio/ogg"
        : ext === "aac" ? "audio/aac"
        : "audio/mpeg";

      const objectName = `vocal-stems/${req.userId}/${randomUUID()}.${ext}`;
      const bucket = objectStorageClient.bucket(STEM_BUCKET);
      await bucket.file(objectName).save(buffer, { contentType, resumable: false });

      const url = await signGetUrl(STEM_BUCKET, objectName);
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
