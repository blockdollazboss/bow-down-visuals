import { Router } from "express";
import express from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/require-auth";
import { objectStorageClient } from "../lib/objectStorage";

const SIDECAR = "http://127.0.0.1:1106";
const router = Router();

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

router.post(
  "/upload-watermark",
  requireAuth,
  express.raw({ type: () => true, limit: "5mb" }),
  async (req, res) => {
    try {
      const buffer = req.body as Buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
        res.status(400).json({ error: "No valid image data received" });
        return;
      }

      const ct = (req.headers["content-type"] ?? "image/png").toLowerCase();
      const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg"
        : ct.includes("webp") ? "webp"
        : "png";
      const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;

      const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
      if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

      const objectName = `watermarks/${randomUUID()}.${ext}`;
      const bucket = objectStorageClient.bucket(bucketId);
      await bucket.file(objectName).save(buffer, { contentType, resumable: false });

      const url = await signGetUrl(bucketId, objectName);
      req.log.info({ objectName, bytes: buffer.length }, "[upload-watermark] saved");
      res.json({ url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      req.log.error({ err: msg }, "[upload-watermark] failed");
      res.status(500).json({ error: msg });
    }
  },
);

export default router;
