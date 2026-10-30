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
import type { Request, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { isAdminRequest } from "./admin";

export const tmpUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpdir()),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || "upload")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80);
    cb(null, `upload-${randomUUID()}-${safe}`);
  },
});

/* ── Admin-aware upload limits (owner directive, Oct 29, 2026) ──────────
   The fileSize caps on DISK-backed routes are policy numbers (the file
   streams to temp disk; it never sits in RAM), so the owner's account
   gets a far larger ceiling on them: ADMIN_UPLOAD_MAX_BYTES. Member
   caps are byte-identical to before. This helper builds the member
   and admin multer instances from ONE options object (same storage,
   same fileFilter) and returns chain-compatible middleware that picks
   per request — mount it AFTER requireAuth so the caller's identity
   is resolved. Memory-storage routes deliberately do NOT use this:
   their caps are a technical guard (a buffered upload is RAM on a
   512 MB instance) and stay for everyone. */
export const ADMIN_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

export interface AdminAwareUpload {
  single(field: string): RequestHandler;
  array(field: string, maxCount?: number): RequestHandler;
  fields(fields: multer.Field[]): RequestHandler;
}

export function createAdminAwareUpload(options: multer.Options): AdminAwareUpload {
  const member = multer(options);
  const admin = multer({
    ...options,
    limits: { ...(options.limits ?? {}), fileSize: ADMIN_UPLOAD_MAX_BYTES },
  });
  const pick = (req: Request): multer.Multer => (isAdminRequest(req) ? admin : member);
  return {
    single: (field) => (req, res, next) => pick(req).single(field)(req, res, next),
    array: (field, maxCount) => (req, res, next) => pick(req).array(field, maxCount)(req, res, next),
    fields: (fields) => (req, res, next) => pick(req).fields(fields)(req, res, next),
  };
}
