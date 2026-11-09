import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { isAdminRequest } from "../../lib/admin";
import { ADMIN_UPLOAD_MAX_BYTES } from "../../lib/upload-storage";
import { isR2Configured, r2ObjectSize, r2PublicUrl } from "../../lib/r2-client";
import { logger } from "../../lib/logger";

const router = Router();

/**
 * Scene-clip uploads — direct-to-storage door (Stack 400 census D-45).
 *
 * BEFORE: POST /upload-clip took the whole file through this server —
 * multer to a temp disk file (80 MB member cap, 1 GB owner ceiling,
 * single-shot, no resume), then a server-side stream onward into the
 * private `generated-clips` bucket. Every byte transited the server
 * twice and a dropped connection at 79 MB started over.
 *
 * NOW: the clip rides the same direct door the other uploads use
 * (routes/r2-upload.ts — consumed READ-ONLY; this file never edits it):
 *
 *   1. POST /upload-clip/session — the server MINTS the upload: it
 *      checks the video rule + the size caps and hands back the
 *      per-member scoped key `<userId>/clips/<ts>-<uuid>.<ext>` (the
 *      only prefix family the door's allowlist accepts for clips).
 *   2. The browser uploads the bytes straight to R2 through the doors
 *      (single presigned PUT ≤20 MB, resumable multipart above it —
 *      FE helper src/lib/r2-storage.ts via src/lib/clip-upload.ts).
 *   3. POST /upload-clip/complete — the server RECORDS the clip: it
 *      verifies the finished object exists under the caller's own
 *      clips prefix, re-checks its real size against the caps, and
 *      answers the recorded `{ url, ref }`.
 *
 * The recorded answer keeps the exact shape downstream consumers have
 * always read (`{ url, ref }` — the scheduler persists `ref` as its
 * never-expiring media ref, shoutout delivery PATCHes `ref ?? url`,
 * the scene-clip PATCH stores what it is handed). Both fields are now
 * the clip's permanent public R2 URL: public URLs pass through the
 * storage refresh helpers unchanged, so every read path that worked
 * with the old signed-url + r2:// pair keeps working untouched.
 *
 * No credits are charged for uploads. The old multipart POST
 * /upload-clip is retired — no server-disk transit door remains.
 */

/** Member cap for scene clips (the admin/owner ceiling comes from
 *  lib/upload-storage, the same constant the retired multer door used). */
export const UPLOAD_CLIP_MAX_BYTES = 80 * 1024 * 1024;

function clipLimitFor(req: { userEmail?: string }): { bytes: number; label: string } {
  return isAdminRequest(req)
    ? { bytes: ADMIN_UPLOAD_MAX_BYTES, label: "1 GB" }
    : { bytes: UPLOAD_CLIP_MAX_BYTES, label: "80 MB" };
}

function tooLargeBody(label: string) {
  return {
    error: "FILE_TOO_LARGE",
    message: `This clip exceeds the ${label} upload limit. Please use a smaller video file.`,
  };
}

const STORAGE_DOWN_BODY = {
  error: "Clip storage is not available right now — please try again in a moment.",
};

const sessionSchema = z.object({
  filename: z.string().max(300).optional(),
  contentType: z.string().min(1).max(120),
  size: z.number().int().min(1),
});

/**
 * POST /upload-clip/session — mint a clip upload.
 * Body: { filename?, contentType, size } → 200 { key }.
 */
router.post("/upload-clip/session", requireAuth, async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "filename, a video contentType and a positive size are required." });
    return;
  }
  const { filename, contentType, size } = parsed.data;
  if (!contentType.startsWith("video/")) {
    res.status(400).json({ error: "Only video files are allowed" });
    return;
  }
  const limit = clipLimitFor(req);
  if (size > limit.bytes) {
    res.status(413).json(tooLargeBody(limit.label));
    return;
  }
  if (!isR2Configured()) {
    res.status(503).json(STORAGE_DOWN_BODY);
    return;
  }
  const rawExt = (filename?.split(".").pop() ?? "mp4").toLowerCase();
  const ext = rawExt.replace(/[^a-z0-9]/g, "") || "mp4";
  const key = `${req.userId}/clips/${Date.now()}-${randomUUID()}.${ext}`;
  res.json({ key });
});

const completeSchema = z.object({
  key: z.string().min(1).max(500),
});

/**
 * POST /upload-clip/complete — record a finished clip upload.
 * Body: { key } → 200 { url, ref }.
 * The key must sit under the caller's own clips prefix; the object must
 * exist; its real stored size must respect the same caps as the mint.
 */
router.post("/upload-clip/complete", requireAuth, async (req, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "An upload key is required." });
    return;
  }
  const { key } = parsed.data;
  const ownPrefix = `${req.userId}/clips/`;
  if (!key.startsWith(ownPrefix) || key.includes("..")) {
    res.status(403).json({ error: "Key not allowed." });
    return;
  }
  if (!isR2Configured()) {
    res.status(503).json(STORAGE_DOWN_BODY);
    return;
  }
  let head: { size: number; contentType: string | null } | null = null;
  try {
    head = await r2ObjectSize(key);
  } catch (err) {
    logger.error({ err }, "[upload-clip] complete: head check failed");
    res.status(502).json({ error: "We couldn't verify that upload — please try again." });
    return;
  }
  if (!head) {
    res.status(404).json({ error: "That upload could not be found — please try uploading again." });
    return;
  }
  const limit = clipLimitFor(req);
  if (head.size > limit.bytes) {
    res.status(413).json(tooLargeBody(limit.label));
    return;
  }
  const url = r2PublicUrl(key);
  res.json({ url, ref: url });
});

export default router;
