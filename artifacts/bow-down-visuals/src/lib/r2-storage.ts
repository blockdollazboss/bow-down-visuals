import { apiErrorMessage } from "./api-error";
import { mapWithConcurrency } from "./async-pool";
/* R2 storage helper for the browser.
   The browser never holds R2 credentials — uploads go through presigned
   PUT URLs minted by POST /api/r2/upload, lists via GET /api/r2/list,
   deletes via DELETE /api/r2/object. Files over the multipart threshold
   go through the chunked multipart door (POST /api/r2/multipart/*) so a
   failure retries one part instead of restarting from byte 0. */

interface R2File {
  name: string;
  url: string;
  path: string;
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Upload a file to R2 via presigned PUT. Returns the public URL.
 *  Files over R2_MULTIPART_THRESHOLD_BYTES take the chunked multipart
 *  path (stack300 #67); everything else keeps the single PUT. */
export async function r2UploadFile(
  key: string,
  file: Blob,
  contentType: string,
  token: string | null,
): Promise<string> {
  if (file.size > R2_MULTIPART_THRESHOLD_BYTES) {
    return r2UploadFileMultipart(key, file, contentType, token);
  }
  const res = await fetch("/api/r2/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ key, contentType }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, `Upload URL request failed (${res.status})`));
  }
  const { uploadUrl, publicUrl } = (await res.json()) as { uploadUrl: string; publicUrl: string };
  const put = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": contentType },
  });
  if (!put.ok) throw new Error(`R2 upload failed (${put.status})`);
  return publicUrl;
}

/* ── Multipart (chunked, resumable) uploads — stack300 #67 ───────────────
   The single PUT restarted from byte 0 on any failure. Here the file is
   cut into parts that upload independently (pool of 3): a failed part is
   retried alone, and the upload id + completed parts are remembered in
   sessionStorage so re-picking the same file in this session reconciles
   against the server's part list and sends only what's missing. */

export const R2_MULTIPART_THRESHOLD_BYTES = 20 * 1024 * 1024;
export const R2_MULTIPART_PART_BYTES = 8 * 1024 * 1024;
const PART_MAX_ATTEMPTS = 3;
const PART_CONCURRENCY = 3;

export interface PlannedPart {
  partNumber: number;
  start: number;
  end: number;
}

/** Slice plan for a file of `size` bytes (pure — pinned by tests). */
export function planParts(
  size: number,
  partSize: number = R2_MULTIPART_PART_BYTES,
): PlannedPart[] {
  const parts: PlannedPart[] = [];
  let partNumber = 1;
  for (let start = 0; start < size; start += partSize) {
    parts.push({ partNumber, start, end: Math.min(size, start + partSize) });
    partNumber += 1;
  }
  return parts;
}

interface MultipartSession {
  uploadId: string;
  etags: Record<number, string>;
}

function sessionKeyFor(key: string, file: Blob): string {
  const lastModified = file instanceof File ? file.lastModified : 0;
  return `bdv-r2mp:${key}:${file.size}:${lastModified}`;
}

function readSession(storageKey: string): MultipartSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MultipartSession;
    if (typeof parsed.uploadId !== "string" || !parsed.etags) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(storageKey: string, session: MultipartSession): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(session));
  } catch {
    /* storage unavailable (privacy mode) — upload still works, just
       without cross-pick resume. */
  }
}

function clearSession(storageKey: string): void {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    /* nothing to clear */
  }
}

async function multipartApi<T>(
  path: string,
  init: RequestInit,
  token: string | null,
  fallback: string,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, `${fallback} (${res.status})`));
  }
  return (await res.json()) as T;
}

async function putPartWithRetry(url: string, body: Blob, partNumber: number): Promise<string | null> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, { method: "PUT", body });
      if (!res.ok) throw new Error(`R2 part upload failed (${res.status})`);
      return res.headers.get("ETag");
    } catch (err) {
      lastError = err;
      if (attempt < PART_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`R2 part ${partNumber} upload failed`);
}

export async function r2UploadFileMultipart(
  key: string,
  file: Blob,
  contentType: string,
  token: string | null,
): Promise<string> {
  const storageKey = sessionKeyFor(key, file);
  const plan = planParts(file.size);
  let session = readSession(storageKey);
  let uploadId = "";

  if (session) {
    // Resume: the server's part list is the truth — adopt its ETags for
    // the parts it already holds and forget any it doesn't.
    uploadId = session.uploadId;
    try {
      const { parts } = await multipartApi<{ parts: Array<{ partNumber: number; etag: string }> }>(
        `/api/r2/multipart/parts?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`,
        { method: "GET" },
        token,
        "Could not check uploaded parts",
      );
      session.etags = {};
      for (const p of parts) session.etags[p.partNumber] = p.etag;
    } catch {
      // The remembered upload is gone (aborted/expired) — start fresh.
      clearSession(storageKey);
      session = null;
      uploadId = "";
    }
  }

  if (!session) {
    const init = await multipartApi<{ uploadId: string }>(
      "/api/r2/multipart/init",
      { method: "POST", body: JSON.stringify({ key, contentType }) },
      token,
      "Multipart upload could not start",
    );
    uploadId = init.uploadId;
    session = { uploadId, etags: {} };
    writeSession(storageKey, session);
  }
  const active = session as MultipartSession;

  try {
    const missing = plan.filter((p) => !active.etags[p.partNumber]);
    await mapWithConcurrency(missing, PART_CONCURRENCY, async (part) => {
      const { url } = await multipartApi<{ url: string }>(
        "/api/r2/multipart/part-url",
        {
          method: "POST",
          body: JSON.stringify({ key, uploadId, partNumber: part.partNumber }),
        },
        token,
        "Could not create part upload URL",
      );
      const etag = await putPartWithRetry(
        url,
        file.slice(part.start, part.end),
        part.partNumber,
      );
      if (etag) {
        active.etags[part.partNumber] = etag;
        writeSession(storageKey, active);
      }
    });

    // Any part whose ETag the browser couldn't read back (headers can be
    // hidden cross-origin) is filled in from the server's own list —
    // the complete call needs every part's ETag, and the server is the
    // only honest source for them.
    if (plan.some((p) => !active.etags[p.partNumber])) {
      const { parts } = await multipartApi<{ parts: Array<{ partNumber: number; etag: string }> }>(
        `/api/r2/multipart/parts?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`,
        { method: "GET" },
        token,
        "Could not check uploaded parts",
      );
      for (const p of parts) active.etags[p.partNumber] = p.etag;
    }
    const stillMissing = plan.filter((p) => !active.etags[p.partNumber]);
    if (stillMissing.length > 0) {
      throw new Error(
        `R2 upload incomplete: ${stillMissing.length} part(s) did not land.`,
      );
    }

    const { publicUrl } = await multipartApi<{ publicUrl: string }>(
      "/api/r2/multipart/complete",
      {
        method: "POST",
        body: JSON.stringify({
          key,
          uploadId,
          parts: plan.map((p) => ({
            partNumber: p.partNumber,
            etag: active.etags[p.partNumber] as string,
          })),
        }),
      },
      token,
      "Could not finish multipart upload",
    );
    clearSession(storageKey);
    return publicUrl;
  } catch (err) {
    // A failed upload id must not leak server-side parts forever; abort
    // best-effort and drop the resume record so the next try starts true.
    await multipartApi(
      "/api/r2/multipart/abort",
      { method: "POST", body: JSON.stringify({ key, uploadId }) },
      token,
      "Could not abort multipart upload",
    ).catch(() => undefined);
    clearSession(storageKey);
    throw err;
  }
}

/** List files under a prefix. Returns [{ name, url, path }]. */
export async function r2List(prefix: string, token: string | null): Promise<R2File[]> {
  const res = await fetch(`/api/r2/list?prefix=${encodeURIComponent(prefix)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`R2 list failed (${res.status})`);
  const data = (await res.json()) as { files: R2File[] };
  return data.files ?? [];
}

/** Delete a key from R2. */
export async function r2Remove(key: string, token: string | null): Promise<void> {
  const res = await fetch("/api/r2/object", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, `R2 delete failed (${res.status})`));
  }
}

/** Extract the storage key from a Supabase or R2 public URL. */
export function storageKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const marker = "/artist-references/";
    const idx = u.pathname.indexOf(marker);
    if (idx >= 0) return decodeURIComponent(u.pathname.slice(idx + marker.length));
    if (u.hostname.includes("r2.dev") || u.hostname.includes("r2.cloudflarestorage.com")) {
      return decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    }
    return null;
  } catch {
    return null;
  }
}
