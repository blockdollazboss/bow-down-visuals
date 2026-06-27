import { Router } from "express";
import express from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/require-auth";
import { objectStorageClient } from "../lib/objectStorage";

const router = Router();

/* ── Server-side secrets (never sent to the browser) ── */
const LIP_SYNC_API_KEY  = process.env["LIP_SYNC_API_KEY"];
const LIP_SYNC_PROVIDER = process.env["LIP_SYNC_PROVIDER"];
const SERVER_KEY_FOUND  = !!(LIP_SYNC_API_KEY && LIP_SYNC_API_KEY.length > 0);
const PROVIDER_NAME     = LIP_SYNC_PROVIDER || (SERVER_KEY_FOUND ? "Custom" : null);

const STEM_BUCKET = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
const SIDECAR     = "http://127.0.0.1:1106";

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
  res.json({
    connected:          SERVER_KEY_FOUND,
    providerName:       PROVIDER_NAME ?? null,
    serverKeyFound:     SERVER_KEY_FOUND,
    frontendKeyExposed: false,
    mode:               SERVER_KEY_FOUND ? "real" : "mock",
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   POST /lip-sync/preview
   Secure — LIP_SYNC_API_KEY read from server env only.
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

  if (!clipUrl || typeof clipUrl !== "string" || !clipUrl.startsWith("http")) {
    res.status(400).json({ error: "clipUrl is required and must be an HTTP URL.", code: "invalid_clip_url" });
    return;
  }
  if (!audioUrl || typeof audioUrl !== "string" || !audioUrl.startsWith("http")) {
    res.status(400).json({ error: "audioUrl is required and must be an HTTP URL.", code: "invalid_audio_url" });
    return;
  }

  if (!SERVER_KEY_FOUND || !LIP_SYNC_API_KEY) {
    res.status(503).json({
      error: "Lip Sync provider not connected. Add LIP_SYNC_API_KEY in Replit Secrets.",
      code: "provider_not_connected",
    });
    return;
  }

  req.log.info({ clipUrl, audioSourceType, strength }, "[lip-sync] starting preview");

  try {
    /* ── Wire your real provider here ──────────────────────────────────────
       Example for a generic lip-sync API (replace with your actual provider):

       const providerRes = await fetch("https://api.your-provider.com/lip-sync", {
         method: "POST",
         headers: {
           Authorization: `Bearer ${LIP_SYNC_API_KEY}`,
           "Content-Type": "application/json",
         },
         body: JSON.stringify({
           video_url:     clipUrl,
           audio_url:     audioUrl,
           strength:      strength ?? "medium",
           preserve_face: preserveFaceIdentity ?? true,
           preserve_look: preserveArtistLook ?? true,
         }),
         signal: AbortSignal.timeout(300_000),
       });
       if (!providerRes.ok) {
         const text = await providerRes.text().catch(() => "");
         throw new Error(`Provider error: HTTP ${providerRes.status}: ${text.slice(0, 200)}`);
       }
       const data = await providerRes.json() as { result_url?: string };
       const resultUrl = data.result_url;
       if (!resultUrl) throw new Error("Provider returned no result URL.");

       res.json({
         url:       resultUrl,
         provider:  PROVIDER_NAME,
         createdAt: new Date().toISOString(),
       });
       return;
    ─────────────────────────────────────────────────────────────────────── */

    // LIP_SYNC_API_KEY is set but no provider is wired yet.
    // Add your provider call above this line, then remove the throw below.
    throw new Error(
      "LIP_SYNC_API_KEY is set but no provider is wired yet. " +
      "Edit artifacts/api-server/src/routes/lip-sync.ts to add your provider call.",
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
