import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { r2GetPresignedPutUrl, r2PublicUrl, r2Delete, r2List, isR2Configured, r2CreateMultipartUpload, r2GetPresignedPartUrl, r2ListParts, r2CompleteMultipartUpload, r2AbortMultipartUpload } from "../lib/r2-client";
import { logger } from "../lib/logger";

const router = Router();

/* R2 presigned upload endpoints — lets the browser upload directly to R2
   without proxying bytes through the API server.

   POST /api/r2/presign-upload { key, contentType } -> { uploadUrl, publicUrl, key }
   The key must start with an allowed prefix (audio-stems/) or the caller's
   own user prefix ("<userId>/").

   POST /api/r2/upload { key, contentType } -> { uploadUrl, publicUrl, key }
   User-scoped alias used by the artist-references migration.

   GET /api/r2/list?prefix=<userId>/generated -> { files: [{ name, url, path }] }

   DELETE /api/r2/object — body { key }. Same key rules.

   Multipart (stack300 #67) — chunked/resumable large uploads:
   POST /api/r2/multipart/init     { key, contentType } -> { uploadId, key, publicUrl }
   POST /api/r2/multipart/part-url { key, uploadId, partNumber } -> { url }
   GET  /api/r2/multipart/parts?key&uploadId -> { parts: [{ partNumber, etag, size }] }
   POST /api/r2/multipart/complete { key, uploadId, parts: [{ partNumber, etag }] } -> { publicUrl, key }
   POST /api/r2/multipart/abort    { key, uploadId } -> { ok: true }
   Same requireAuth + key allowlist as every door above.
*/

const ALLOWED_PREFIXES = ["audio-stems/"];

const presignSchema = z.object({
  key: z.string().min(1).max(500),
  contentType: z.string().min(1).max(100),
});

function isKeyAllowed(key: string, userId?: string): boolean {
  if (!key || key.includes("..") || key.startsWith("/")) return false;
  if (ALLOWED_PREFIXES.some((p) => key.startsWith(p))) return true;
  if (key.startsWith("anon/")) return true;
  if (userId && key.startsWith(`${userId}/`)) return true;
  return false;
}

router.post("/r2/presign-upload", requireAuth, async (req, res) => {
  try {
    if (!isR2Configured()) {
      res.status(503).json({ error: "R2 storage not configured." });
      return;
    }
    const parsed = presignSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "key and contentType are required." });
      return;
    }
    const { key, contentType } = parsed.data;
    if (!isKeyAllowed(key, req.userId)) {
      res.status(403).json({ error: "Key prefix not allowed." });
      return;
    }
    const uploadUrl = await r2GetPresignedPutUrl(key, contentType);
    res.json({ uploadUrl, publicUrl: r2PublicUrl(key), key });
  } catch (err) {
    logger.error("r2 presign-upload failed");
    res.status(500).json({ error: "Could not create upload URL." });
  }
});

/* POST /api/r2/upload — user-scoped alias for the artist-references migration.
   Body { key, contentType } where key starts with "<userId>/". */
const uploadSchema = z.object({
  key: z.string().min(1).max(500),
  contentType: z.string().max(120).optional(),
});

router.post("/r2/upload", requireAuth, async (req, res) => {
  try {
    if (!isR2Configured()) {
      res.status(503).json({ error: "R2 storage not configured." });
      return;
    }
    const parsed = uploadSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "key is required." });
      return;
    }
    const { key, contentType } = parsed.data;
    if (!isKeyAllowed(key, req.userId)) {
      res.status(403).json({ error: "Key prefix not allowed." });
      return;
    }
    const uploadUrl = await r2GetPresignedPutUrl(key, contentType ?? "application/octet-stream");
    res.json({ uploadUrl, publicUrl: r2PublicUrl(key), key });
  } catch (err) {
    logger.error("r2 upload failed");
    res.status(500).json({ error: "Could not create upload URL." });
  }
});

/* GET /api/r2/list?prefix=<userId>/generated — list keys under a user prefix. */
router.get("/r2/list", requireAuth, async (req, res) => {
  try {
    if (!isR2Configured()) {
      res.status(503).json({ error: "R2 storage not configured." });
      return;
    }
    const prefix = String(req.query.prefix ?? "");
    if (!prefix || !isKeyAllowed(prefix, req.userId)) {
      res.status(403).json({ error: "Prefix not allowed." });
      return;
    }
    const keys = await r2List(prefix);
    res.json({
      files: keys.map((k) => ({
        name: k.slice(prefix.length),
        url: r2PublicUrl(k),
        path: k,
      })),
    });
  } catch (err) {
    logger.error("r2 list failed");
    res.status(500).json({ error: "Could not list files." });
  }
});

/* DELETE /api/r2/object — body { key }. Same prefix allowlist. */
router.delete("/r2/object", requireAuth, async (req, res) => {
  try {
    if (!isR2Configured()) {
      res.status(503).json({ error: "R2 storage not configured." });
      return;
    }
    const { key } = req.body ?? {};
    if (typeof key !== "string" || !isKeyAllowed(key, req.userId)) {
      res.status(403).json({ error: "Key not allowed." });
      return;
    }
    await r2Delete(key);
    res.json({ ok: true });
  } catch (err) {
    logger.error("r2 delete failed");
    res.status(500).json({ error: "Delete failed." });
  }
});

/* ── Multipart uploads (stack300 #67) ─────────────────────────────────── */

const multipartInitSchema = z.object({
  key: z.string().min(1).max(500),
  contentType: z.string().min(1).max(100),
});

const multipartScopedSchema = z.object({
  key: z.string().min(1).max(500),
  uploadId: z.string().min(1).max(500),
});

const multipartPartUrlSchema = multipartScopedSchema.extend({
  partNumber: z.number().int().min(1).max(10000),
});

const multipartCompleteSchema = multipartScopedSchema.extend({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10000),
        etag: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(10000),
});

function r2Ready(res: import("express").Response): boolean {
  if (!isR2Configured()) {
    res.status(503).json({ error: "R2 storage not configured." });
    return false;
  }
  return true;
}

router.post("/r2/multipart/init", requireAuth, async (req, res) => {
  try {
    if (!r2Ready(res)) return;
    const parsed = multipartInitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "key and contentType are required." });
      return;
    }
    const { key, contentType } = parsed.data;
    if (!isKeyAllowed(key, req.userId)) {
      res.status(403).json({ error: "Key prefix not allowed." });
      return;
    }
    const uploadId = await r2CreateMultipartUpload(key, contentType);
    res.json({ uploadId, key, publicUrl: r2PublicUrl(key) });
  } catch (err) {
    logger.error("r2 multipart init failed");
    res.status(500).json({ error: "Could not start multipart upload." });
  }
});

router.post("/r2/multipart/part-url", requireAuth, async (req, res) => {
  try {
    if (!r2Ready(res)) return;
    const parsed = multipartPartUrlSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "key, uploadId and a valid partNumber are required." });
      return;
    }
    const { key, uploadId, partNumber } = parsed.data;
    if (!isKeyAllowed(key, req.userId)) {
      res.status(403).json({ error: "Key prefix not allowed." });
      return;
    }
    const url = await r2GetPresignedPartUrl(key, uploadId, partNumber);
    res.json({ url });
  } catch (err) {
    logger.error("r2 multipart part-url failed");
    res.status(500).json({ error: "Could not create part upload URL." });
  }
});

/* GET /api/r2/multipart/parts?key&uploadId — the parts the server already
   holds; a resumed upload reconciles against this, never against hope. */
router.get("/r2/multipart/parts", requireAuth, async (req, res) => {
  try {
    if (!r2Ready(res)) return;
    const key = String(req.query.key ?? "");
    const uploadId = String(req.query.uploadId ?? "");
    if (!key || !uploadId) {
      res.status(400).json({ error: "key and uploadId are required." });
      return;
    }
    if (!isKeyAllowed(key, req.userId)) {
      res.status(403).json({ error: "Key prefix not allowed." });
      return;
    }
    const parts = await r2ListParts(key, uploadId);
    res.json({ parts });
  } catch (err) {
    logger.error("r2 multipart list-parts failed");
    res.status(500).json({ error: "Could not list uploaded parts." });
  }
});

router.post("/r2/multipart/complete", requireAuth, async (req, res) => {
  try {
    if (!r2Ready(res)) return;
    const parsed = multipartCompleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "key, uploadId and a non-empty parts list are required." });
      return;
    }
    const { key, uploadId, parts } = parsed.data;
    if (!isKeyAllowed(key, req.userId)) {
      res.status(403).json({ error: "Key prefix not allowed." });
      return;
    }
    const publicUrl = await r2CompleteMultipartUpload(key, uploadId, parts);
    res.json({ publicUrl, key });
  } catch (err) {
    logger.error("r2 multipart complete failed");
    res.status(500).json({ error: "Could not complete multipart upload." });
  }
});

router.post("/r2/multipart/abort", requireAuth, async (req, res) => {
  try {
    if (!r2Ready(res)) return;
    const parsed = multipartScopedSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "key and uploadId are required." });
      return;
    }
    const { key, uploadId } = parsed.data;
    if (!isKeyAllowed(key, req.userId)) {
      res.status(403).json({ error: "Key prefix not allowed." });
      return;
    }
    await r2AbortMultipartUpload(key, uploadId);
    res.json({ ok: true });
  } catch (err) {
    logger.error("r2 multipart abort failed");
    res.status(500).json({ error: "Could not abort multipart upload." });
  }
});

export default router;
