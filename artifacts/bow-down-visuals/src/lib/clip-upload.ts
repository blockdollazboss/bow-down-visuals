/**
 * clip-upload.ts — scene-clip uploads through the direct-to-storage
 * door (Stack 400 census D-45).
 *
 * The old path POSTed the whole file as multipart FormData to
 * /api/upload-clip: every byte transited the site's server (multer to
 * disk, then a server-side stream into storage), single-shot, 80 MB
 * cap, no resume. This helper gives clip uploads the same door the
 * other uploads already use:
 *
 *   1. POST /api/upload-clip/session mints the upload — the server
 *      checks the video rule + size caps and hands back the caller's
 *      per-member scoped key (`<userId>/clips/…`).
 *   2. r2UploadFile (lib/r2-storage.ts) moves the bytes browser → R2
 *      directly through the /api/r2 doors: single presigned PUT for
 *      small clips, resumable multipart for large ones.
 *   3. POST /api/upload-clip/complete records the finished clip — the
 *      server verifies the object and answers the recorded ref.
 *
 * The resolved value keeps the exact `{ url, ref }` shape every caller
 * read from the old door, so downstream consumers (scheduler media
 * refs, shoutout delivery, scene-clip attach) are untouched.
 *
 * Failures throw an Error whose message is the server's own honest
 * copy (via apiErrorMessage) — callers surface it through their usual
 * toast/error state; nothing fails silently.
 */
import { apiErrorMessage } from "./api-error";
import { r2UploadFile } from "./r2-storage";

export const CLIP_UPLOAD_SESSION_PATH = "/api/upload-clip/session";
export const CLIP_UPLOAD_COMPLETE_PATH = "/api/upload-clip/complete";

export interface ClipUploadResult {
  url: string;
  ref: string;
}

export async function uploadClipDirect(
  file: File,
  token: string | null,
): Promise<ClipUploadResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  /* 1 — mint: the server applies the video rule + caps and scopes the key. */
  const sessionRes = await fetch(CLIP_UPLOAD_SESSION_PATH, {
    method: "POST",
    headers,
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  const sessionData: unknown = await sessionRes.json().catch(() => ({}));
  if (!sessionRes.ok) {
    throw new Error(
      apiErrorMessage(sessionData, `Upload could not start (${sessionRes.status})`),
    );
  }
  const key = (sessionData as { key?: unknown }).key;
  if (typeof key !== "string" || !key) {
    throw new Error("Upload could not start — the server did not hand back an upload key.");
  }

  /* 2 — bytes move browser → storage directly (resumable above 20 MB). */
  const publicUrl = await r2UploadFile(key, file, file.type || "video/mp4", token);

  /* 3 — record: the server verifies the object and returns the ref. */
  const completeRes = await fetch(CLIP_UPLOAD_COMPLETE_PATH, {
    method: "POST",
    headers,
    body: JSON.stringify({ key }),
  });
  const completeData: unknown = await completeRes.json().catch(() => ({}));
  if (!completeRes.ok) {
    throw new Error(
      apiErrorMessage(completeData, `Upload could not finish (${completeRes.status})`),
    );
  }
  const recorded = completeData as { url?: unknown; ref?: unknown };
  const url = typeof recorded.url === "string" && recorded.url ? recorded.url : publicUrl;
  if (!url) throw new Error("Upload succeeded but returned no clip URL.");
  const ref = typeof recorded.ref === "string" && recorded.ref ? recorded.ref : url;
  return { url, ref };
}
