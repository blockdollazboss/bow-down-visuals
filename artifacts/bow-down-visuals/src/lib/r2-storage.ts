/* R2 storage helper for the browser.
   The browser never holds R2 credentials — uploads go through presigned
   PUT URLs minted by POST /api/r2/upload, lists via GET /api/r2/list,
   deletes via DELETE /api/r2/object. */

interface R2File {
  name: string;
  url: string;
  path: string;
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Upload a file to R2 via presigned PUT. Returns the public URL. */
export async function r2UploadFile(
  key: string,
  file: Blob,
  contentType: string,
  token: string | null,
): Promise<string> {
  const res = await fetch("/api/r2/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ key, contentType }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Upload URL request failed (${res.status})`);
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
    throw new Error(data.error ?? `R2 delete failed (${res.status})`);
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
