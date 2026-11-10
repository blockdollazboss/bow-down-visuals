import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { r2GetPresignedPutUrl, r2PublicUrl, r2Delete, r2List, isR2Configured, r2CreateMultipartUpload, r2GetPresignedPartUrl, r2ListParts, r2CompleteMultipartUpload, r2AbortMultipartUpload } from "../lib/r2-client";
import { sweepOrphanedMultipartUploads } from "../lib/r2-bucket-sweep";
import { logger } from "../lib/logger";

const router = Router();

/* R2 presigned upload endpoints — lets the browser upload directly to R2
   without proxying bytes through the API server.

   POST /api/r2/presign-upload { key, contentType } -> { uploadUrl, publicUrl, key }
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

   Key rules (stack400 C-06) — member data isolation is absolute. A key is
   allowed only under the caller's OWN prefixes:
     - "<userId>/…"                (the member's general prefix)
     - "audio-stems/<userId>/…"    (stem uploads; the FE builds exactly
                                    this shape in lib/audio-stems.ts)
   There is NO shared namespace: the old bare "audio-stems/" allowance let
   any member overwrite or delete any other member's stems and exports,
   and the old "anon/" allowance (nothing in the codebase ever used it)
   was a world-writable scratch prefix. Server-internal writes (the
   music-export rail writing audio-stems/<userId>/exports/…, the generate
   rails) call lib/r2-client directly and never pass through these doors,
   so scoping the doors does not touch them.

   Every door carries requireAuth + publicApiLimiter (stack400 C-07).
*/

/* ── Multipart caps (stack400 C-07) ──────────────────────────────────────
   Sized from the site's own numbers, not invented: the FE client cuts
   parts at 8 MiB (R2_MULTIPART_PART_BYTES) and the largest upload ceiling
   anywhere on the site is 1 GiB (ADMIN_UPLOAD_MAX_BYTES in
   lib/upload-storage.ts; member doors elsewhere cap at 80–100 MB).
   128 parts × 8 MiB = 1 GiB per session — far above every real member
   flow, and ~78× below the old 10,000-part door. The byte cap is enforced
   at complete from the SERVER's part list (the sizes R2 actually holds),
   never from client claims. The in-flight cap counts sessions this
   process started and has not seen complete/abort for; entries older
   than the C-08 horizon are swept (and aborted bucket-side) lazily at
   init, so an abandoned session stops occupying a slot after 24h even
   before the bucket lifecycle rule lands. */
const MAX_IN_FLIGHT_SESSIONS_PER_USER = 5;
const MAX_PART_NUMBER = 128;
const MAX_SESSION_BYTES = 1024 * 1024 * 1024; // 1 GiB
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface TrackedSession {
  key: string;
  startedAt: number;
}

/* userId -> uploadId -> session. In-process by design: the cap is an
   abuse tripwire, not an accounting ledger. */
const inflightSessions = new Map<string, Map<string, TrackedSession>>();

function inflightCount(userId: string): number {
  return inflightSessions.get(userId)?.size ?? 0;
}

function trackSession(userId: string, uploadId: string, key: string): void {
  let sessions = inflightSessions.get(userId);
  if (!sessions) {
    sessions = new Map();
    inflightSessions.set(userId, sessions);
  }
  sessions.set(uploadId, { key, startedAt: Date.now() });
}

function untrackSession(userId: string, uploadId: string): void {
  const sessions = inflightSessions.get(userId);
  if (!sessions) return;
  sessions.delete(uploadId);
  if (sessions.size === 0) inflightSessions.delete(userId);
}

/* The bucket sweep's view of this tracker: when the tracker started
   holding an upload, or null when it does not hold it. */
function trackedSessionStartedAt(uploadId: string): number | null {
  for (const sessions of inflightSessions.values()) {
    const session = sessions.get(uploadId);
    if (session) return session.startedAt;
  }
  return null;
}

/* C-08 (code-side half): abort tracked sessions that have been sitting
   incomplete past the 24h horizon and free their slots. This only sees
   sessions this process started — uploads orphaned by a restart are
   swept bucket-wide by lib/r2-bucket-sweep (same init trigger, below),
   and the bucket lifecycle rule stays the config-side backstop
   (AbortIncompleteMultipartUpload after 1 day; the config step + its
   blocker are recorded in infra/r2/README.md).
   Best-effort: a failed abort is logged, never fatal to the init that
   triggered the sweep. */
async function sweepStaleSessions(now: number): Promise<void> {
  for (const [userId, sessions] of inflightSessions) {
    for (const [uploadId, session] of sessions) {
      if (now - session.startedAt > SESSION_MAX_AGE_MS) {
        sessions.delete(uploadId);
        try {
          await r2AbortMultipartUpload(session.key, uploadId);
        } catch {
          logger.error("r2 multipart stale-session abort failed");
        }
      }
    }
    if (sessions.size === 0) inflightSessions.delete(userId);
  }
}

const presignSchema = z.object({
  key: z.string().min(1).max(500),
  contentType: z.string().min(1).max(100),
});

function isKeyAllowed(key: string, userId?: string): boolean {
  if (!key || key.includes("..") || key.startsWith("/")) return false;
  if (!userId) return false;
  if (key.startsWith(`${userId}/`)) return true;
  if (key.startsWith(`audio-stems/${userId}/`)) return true;
  return false;
}

router.post("/r2/presign-upload", requireAuth, publicApiLimiter, async (req, res) => {
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

router.post("/r2/upload", requireAuth, publicApiLimiter, async (req, res) => {
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
router.get("/r2/list", requireAuth, publicApiLimiter, async (req, res) => {
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

/* DELETE /api/r2/object — body { key }. Same prefix rules. */
router.delete("/r2/object", requireAuth, publicApiLimiter, async (req, res) => {
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
  partNumber: z.number().int().min(1).max(MAX_PART_NUMBER),
});

const multipartCompleteSchema = multipartScopedSchema.extend({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(MAX_PART_NUMBER),
        etag: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(MAX_PART_NUMBER),
});

function r2Ready(res: import("express").Response): boolean {
  if (!isR2Configured()) {
    res.status(503).json({ error: "R2 storage not configured." });
    return false;
  }
  return true;
}

router.post("/r2/multipart/init", requireAuth, publicApiLimiter, async (req, res) => {
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
    const userId = req.userId as string;
    await sweepStaleSessions(Date.now());
    /* Bucket-wide orphan sweep rides the same lazy init trigger (it
       throttles itself to one bucket listing per interval) and never
       throws — orphans this process never tracked get aborted past
       the same 24h horizon; anything the tracker holds is left to
       sweepStaleSessions above. */
    await sweepOrphanedMultipartUploads({ trackedStartedAt: trackedSessionStartedAt });
    if (inflightCount(userId) >= MAX_IN_FLIGHT_SESSIONS_PER_USER) {
      res.status(429).json({
        error: "Too many uploads in progress. Finish or cancel one before starting another.",
      });
      return;
    }
    const uploadId = await r2CreateMultipartUpload(key, contentType);
    trackSession(userId, uploadId, key);
    res.json({ uploadId, key, publicUrl: r2PublicUrl(key) });
  } catch (err) {
    logger.error("r2 multipart init failed");
    res.status(500).json({ error: "Could not start multipart upload." });
  }
});

router.post("/r2/multipart/part-url", requireAuth, publicApiLimiter, async (req, res) => {
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
router.get("/r2/multipart/parts", requireAuth, publicApiLimiter, async (req, res) => {
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

/* S3 ETags come back quoted ("\"abc…\"") from some doors and bare from
   others; the VALUE is the identity, so reconciliation compares the
   unquoted form on both sides. */
function normalizeEtag(etag: string): string {
  return etag.replace(/^"+|"+$/g, "");
}

router.post("/r2/multipart/complete", requireAuth, publicApiLimiter, async (req, res) => {
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
    /* C-09: the client's part list is a claim, not the truth. Reconcile
       it against the server's own ListParts before completing — the
       submitted (partNumber, etag) set must match what R2 actually
       holds, exactly: nothing forged, nothing missing, nothing extra. */
    const serverParts = await r2ListParts(key, uploadId);
    const serverByNumber = new Map(serverParts.map((p) => [p.partNumber, normalizeEtag(p.etag)]));
    const matches =
      parts.length === serverParts.length &&
      parts.every((p) => serverByNumber.get(p.partNumber) === normalizeEtag(p.etag));
    if (!matches) {
      res.status(409).json({
        error:
          "The uploaded parts don't match what the server received. Resume the upload so it can reconcile, then try completing again.",
      });
      return;
    }
    /* C-07 byte cap, measured on the server's sizes (post-reconciliation
       the submitted set IS the server set, so this is the true total). */
    const totalBytes = serverParts.reduce((sum, p) => sum + p.size, 0);
    if (totalBytes > MAX_SESSION_BYTES) {
      res.status(413).json({ error: "This upload is larger than the 1 GB upload limit." });
      return;
    }
    const publicUrl = await r2CompleteMultipartUpload(key, uploadId, parts);
    if (req.userId) untrackSession(req.userId, uploadId);
    res.json({ publicUrl, key });
  } catch (err) {
    logger.error("r2 multipart complete failed");
    res.status(500).json({ error: "Could not complete multipart upload." });
  }
});

router.post("/r2/multipart/abort", requireAuth, publicApiLimiter, async (req, res) => {
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
    if (req.userId) untrackSession(req.userId, uploadId);
    res.json({ ok: true });
  } catch (err) {
    logger.error("r2 multipart abort failed");
    res.status(500).json({ error: "Could not abort multipart upload." });
  }
});

export default router;
