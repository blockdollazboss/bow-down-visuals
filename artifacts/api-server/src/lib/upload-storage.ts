/**
 * upload-storage.ts — shared disk-backed multer storage for large
 * uploads. (2026-10-12, OOM fix.)
 *
 * multer.memoryStorage() held entire uploads (up to 100 MB) in RAM
 * for the request's duration; a few concurrent uploads could OOM the
 * 512 MB container (oom-investigation.md, suspect #3). Disk storage
 * lands the file in the OS temp dir instead; handlers pass
 * req.file.path downstream and delete the temp file when done.
 * Mirrors the pattern routes/generate/mix-master.ts already used.
 */
import multer from "multer";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

export const tmpUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpdir()),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || "upload")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80);
    cb(null, `upload-${randomUUID()}-${safe}`);
  },
});
