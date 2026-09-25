import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { createReadStream, statSync } from "fs";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";
import { getSupabaseAdmin } from "./supabase-admin";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

const GCS_SIGNED_URL_PREFIX = "https://storage.googleapis.com/";

/**
 * Signed GCS URLs (used for Runway clips, final exports, etc.) expire after a
 * maximum of 7 days (the ceiling for signing via the Replit sidecar's
 * credential exchange). Persisting them verbatim in the DB means anything
 * older than a week silently 403s in the player. This re-signs a stored URL
 * with a fresh 7-day expiry on every read. Non-GCS URLs (or URLs that fail to
 * parse/sign) are returned unchanged so callers never see a hard failure.
 */
export async function refreshSignedGcsUrl(url: string): Promise<string> {
  if (typeof url !== "string" || !url.startsWith(GCS_SIGNED_URL_PREFIX)) {
    return url;
  }
  try {
    const parsed = new URL(url);
    const { bucketName, objectName } = parseObjectPath(parsed.pathname);
    return await signObjectURL({
      bucketName,
      objectName,
      method: "GET",
      ttlSec: 7 * 24 * 60 * 60,
    });
  } catch {
    return url;
  }
}

/**
 * Walks an arbitrary JSON-ish value (objects/arrays/primitives) and refreshes
 * any string that looks like a stored GCS signed URL. Used to keep scene
 * data (demoClipUrl, thumbnailUrl, finalVideoUrl, etc.) playable no matter
 * how deeply nested the field is or what it's named.
 */
export async function refreshSignedGcsUrlsDeep<T>(value: T): Promise<T> {
  if (typeof value === "string") {
    return (await refreshSignedGcsUrl(value)) as unknown as T;
  }
  if (Array.isArray(value)) {
    return (await Promise.all(value.map((v) => refreshSignedGcsUrlsDeep(v)))) as unknown as T;
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(
        async ([k, v]) => [k, await refreshSignedGcsUrlsDeep(v)] as const,
      ),
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}

/* ══════════════════════════════════════════════════════════════════════════
   Supabase Storage media helpers (2026-09-22 migration)
   ──────────────────────────────────────────────────────────────────────────
   Clip storage moved from Replit-owned GCS (signed via the Replit sidecar,
   which doesn't exist on Render) to Supabase Storage.

   CORE RULE: persist STABLE STORAGE REFS, never signed URLs. A storage ref
   looks like `supabase://generated-clips/clips/<uuid>.mp4`. Readers mint a
   fresh short-lived signed URL from the ref on every read
   (refreshSupabaseStorageUrl / refreshSupabaseStorageUrlsDeep).

   Detection:
   - starts with `supabase://generated-clips/` → our storage ref → re-sign.
   - a signed URL under this project's `generated-clips` bucket (minted by an
     earlier read) → parse the object path out and re-sign.
   - starts with `https://storage.googleapis.com/` → legacy GCS URL → left
     as-is (legacy no-op; unplayable if the 7-day signature expired).
   - anything else (public Supabase URLs, Runway CDN URLs, …) → as-is.
   ══════════════════════════════════════════════════════════════════════════ */

/** Private Supabase Storage bucket for server-generated media (Runway clips, thumbnails, chain frames). */
export const SUPABASE_CLIPS_BUCKET = "generated-clips";

/** Stable storage-ref URI scheme persisted in the DB for Supabase-hosted media. */
export const SUPABASE_STORAGE_REF_PREFIX = `supabase://${SUPABASE_CLIPS_BUCKET}/`;

/** Signed-URL TTL minted at read time (1 day). */
export const SUPABASE_SIGNED_URL_TTL_SEC = 24 * 60 * 60;

const LEGACY_GCS_URL_PREFIX = "https://storage.googleapis.com/";

/** Idempotent bucket ensure — private bucket for generated clips.
 *
 *  Uses the Storage REST API directly (like ensureVideoExportsBucket)
 *  instead of supabase-js: under this service's Node/fetch combination the
 *  supabase-js bucket helpers can report success without the bucket actually
 *  being created (seen 2026-09-24 — getBucket said "not found", createBucket
 *  returned no error, yet the follow-up upload still got NoSuchBucket, which
 *  surfaces in the video editor as "Bucket not found: generated-clips").
 *  After creating, we re-read the bucket and throw LOUDLY if it is still
 *  missing, so an upload can never silently march into a doomed upload. */
export async function ensureSupabaseClipsBucket(): Promise<void> {
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").replace(/\/$/, "");
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured — cannot ensure generated-clips bucket.",
    );
  }
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const getBucket = () => fetch(`${url}/storage/v1/bucket/${SUPABASE_CLIPS_BUCKET}`, { headers });

  if ((await getBucket()).ok) return; // already exists

  const createRes = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: SUPABASE_CLIPS_BUCKET,
      name: SUPABASE_CLIPS_BUCKET,
      public: false,
      // NOTE: no file_size_limit — Supabase rejected it with 413 EntityTooLarge
      // on the video-exports bucket (PR #5). The 80 MB app-level cap in the
      // upload route is the guard instead.
    }),
  });
  const createText = await createRes.text().catch(() => "");
  const alreadyExists = createRes.status === 409 || /already exists/i.test(createText);
  if (!createRes.ok && !alreadyExists) {
    throw new Error(
      `Failed to create Supabase bucket "${SUPABASE_CLIPS_BUCKET}": ${createRes.status} ${createText.slice(0, 300)}`,
    );
  }

  // Verify it actually exists now — never silently continue into a doomed upload.
  const verifyRes = await getBucket();
  if (!verifyRes.ok) {
    const verifyText = await verifyRes.text().catch(() => "");
    throw new Error(
      `Supabase bucket "${SUPABASE_CLIPS_BUCKET}" still missing after create attempt ` +
        `(create: ${createRes.status} ${createText.slice(0, 120)}; ` +
        `verify: ${verifyRes.status} ${verifyText.slice(0, 120)})`,
    );
  }
}

export const SHOP_PRODUCTS_BUCKET = "shop-products";

/**
 * Ensure the shop-products bucket exists before AI product-image uploads.
 * Same proven REST pattern as ensureVideoExportsBucket: create via the
 * Storage REST API (supabase-js bucket helpers have silently failed before),
 * then verify-after-create and throw LOUDLY if it is still missing — an
 * upload must never march into a doomed bucket. Bucket creation failures
 * are NOT swallowed: the caller refunds the credit.
 */
export async function ensureShopProductsBucket(): Promise<void> {
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").replace(/\/$/, "");
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured — cannot ensure shop-products bucket.",
    );
  }
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const getBucket = () => fetch(`${url}/storage/v1/bucket/${SHOP_PRODUCTS_BUCKET}`, { headers });

  if ((await getBucket()).ok) return; // already exists

  const createRes = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: SHOP_PRODUCTS_BUCKET,
      name: SHOP_PRODUCTS_BUCKET,
      public: true, // product images are served on public storefronts
    }),
  });
  const createText = await createRes.text().catch(() => "");
  const alreadyExists = createRes.status === 409 || /already exists/i.test(createText);
  if (!createRes.ok && !alreadyExists) {
    throw new Error(
      `Failed to create Supabase bucket "${SHOP_PRODUCTS_BUCKET}": ${createRes.status} ${createText.slice(0, 300)}`,
    );
  }

  // Verify it actually exists now — never silently continue into a doomed upload.
  const verifyRes = await getBucket();
  if (!verifyRes.ok) {
    const verifyText = await verifyRes.text().catch(() => "");
    throw new Error(
      `Supabase bucket "${SHOP_PRODUCTS_BUCKET}" still missing after create attempt ` +
        `(create: ${createRes.status} ${createText.slice(0, 120)}; ` +
        `verify: ${verifyRes.status} ${verifyText.slice(0, 120)})`,
    );
  }
}

/**
 * Upload a buffer to the private `generated-clips` bucket. Returns the
 * STABLE STORAGE REF (`supabase://generated-clips/<objectName>`) — persist
 * this, never a signed URL.
 */
export async function uploadMediaToSupabaseStorage(
  objectName: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const supabase = getSupabaseAdmin();
  try {
    await ensureSupabaseClipsBucket();
  } catch (ensureErr) {
    // Loud, not silent: the bucket-creation error is the root cause whenever
    // the upload below fails with "Bucket not found". Still attempt the upload
    // — the bucket may exist despite the ensure failure (e.g. a race).
    console.error(
      `[storage] ensureSupabaseClipsBucket failed for "${SUPABASE_CLIPS_BUCKET}":`,
      ensureErr instanceof Error ? ensureErr.message : ensureErr,
    );
  }
  const { error: upErr } = await supabase.storage
    .from(SUPABASE_CLIPS_BUCKET)
    .upload(objectName, buffer, { contentType, upsert: false });
  if (upErr) {
    throw new Error(
      `Supabase storage upload failed: ${upErr.message}` +
        ` (bucket: ${SUPABASE_CLIPS_BUCKET}, path: ${objectName})`,
    );
  }
  return `${SUPABASE_STORAGE_REF_PREFIX}${objectName}`;
}

/** Private Supabase Storage bucket for final exported videos (much larger
 *  files than generated clips, so it gets its own bucket + higher limit). */
export const VIDEO_EXPORTS_BUCKET = "video-exports";

/** Idempotent bucket ensure — private bucket, 500 MB per-file limit so
 *  longer exports don't hit the clips bucket's 100 MB cap.
 *
 *  Uses the Storage REST API directly (like uploadFileStreamToSupabaseStorage)
 *  instead of supabase-js: under this service's Node/fetch combination the
 *  supabase-js bucket helpers can report success without the bucket actually
 *  being created (seen 2026-09-24 — getBucket said "not found", createBucket
 *  returned no error, yet the follow-up upload still got NoSuchBucket).
 *  After creating, we re-read the bucket and throw LOUDLY if it is still
 *  missing, so an export can never silently march into a doomed upload. */
export async function ensureVideoExportsBucket(): Promise<void> {
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").replace(/\/$/, "");
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured — cannot ensure video-exports bucket.",
    );
  }
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const getBucket = () => fetch(`${url}/storage/v1/bucket/${VIDEO_EXPORTS_BUCKET}`, { headers });

  if ((await getBucket()).ok) return; // already exists

  const createRes = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: VIDEO_EXPORTS_BUCKET,
      name: VIDEO_EXPORTS_BUCKET,
      public: false,
      // NOTE: no file_size_limit — Supabase rejected 500 MB with 413 EntityTooLarge
    }),
  });
  const createText = await createRes.text().catch(() => "");
  const alreadyExists = createRes.status === 409 || /already exists/i.test(createText);
  if (!createRes.ok && !alreadyExists) {
    throw new Error(
      `Failed to create Supabase bucket "${VIDEO_EXPORTS_BUCKET}": ${createRes.status} ${createText.slice(0, 300)}`,
    );
  }

  // Verify it actually exists now — never silently continue into a doomed upload.
  const verifyRes = await getBucket();
  if (!verifyRes.ok) {
    const verifyText = await verifyRes.text().catch(() => "");
    throw new Error(
      `Supabase bucket "${VIDEO_EXPORTS_BUCKET}" still missing after create attempt ` +
        `(create: ${createRes.status} ${createText.slice(0, 120)}; ` +
        `verify: ${verifyRes.status} ${verifyText.slice(0, 120)})`,
    );
  }
}

/**
 * Stream a local file to Supabase Storage WITHOUT loading it into the Node
 * heap. The api-server runs with --max-old-space-size=160, so readFileSync on
 * a multi-hundred-MB final MP4 would OOM the process.
 *
 * Uses the Storage REST API directly with a web ReadableStream body
 * (duplex: 'half') rather than supabase-js .upload(), whose stream-body
 * handling isn't guaranteed under this Node/fetch combination.
 *
 * Returns the STABLE STORAGE REF (`supabase://<bucket>/<objectName>`) —
 * persist this, never a signed URL (readers re-sign via
 * refreshSupabaseStorageUrl / refreshSupabaseStorageUrlsDeep).
 */
export async function uploadFileStreamToSupabaseStorage(
  bucket: string,
  objectName: string,
  filePath: string,
  contentType: string,
): Promise<string> {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url) {
    throw new Error("SUPABASE_URL is not configured — cannot upload export.");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured — cannot upload export.");
  }

  const { size } = statSync(filePath);
  const endpoint = `${url.replace(/\/$/, "")}/storage/v1/object/${bucket}/${objectName}`;
  const init: Record<string, unknown> = {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": contentType,
      "Content-Length": String(size),
      "x-upsert": "true",
    },
    // Web-stream body keeps heap flat; duplex:'half' is required by Node's
    // fetch for stream bodies (not in the DOM RequestInit type, hence the cast).
    body: Readable.toWeb(createReadStream(filePath)),
    duplex: "half",
    signal: AbortSignal.timeout(10 * 60 * 1000),
  };
  const res = await fetch(endpoint, init as RequestInit);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Supabase storage upload failed: ${res.status} ${text.slice(0, 300)}` +
        ` (bucket: ${bucket}, path: ${objectName})`,
    );
  }
  return `supabase://${bucket}/${objectName}`;
}

/**
 * First-party Supabase Storage buckets. `parseSupabaseStorageRefBucketed`
 * recognizes refs and old signed URLs for every bucket listed here, so
 * adding a bucket here is enough to make re-signing work for it.
 */
const KNOWN_STORAGE_BUCKETS: readonly string[] = [
  SUPABASE_CLIPS_BUCKET,
  VIDEO_EXPORTS_BUCKET,
];

export interface ParsedStorageRef {
  bucket: string;
  objectPath: string;
}

/**
 * Extract the bucket + object path from a stored value when it refers to one
 * of our Supabase buckets — either a `supabase://<bucket>/<path>` storage
 * ref or a previously-minted signed URL under this project's bucket.
 * Returns null for legacy GCS URLs and everything else.
 */
export function parseSupabaseStorageRefBucketed(
  value: string,
): ParsedStorageRef | null {
  if (typeof value !== "string" || value.length === 0) return null;
  for (const bucket of KNOWN_STORAGE_BUCKETS) {
    const prefix = `supabase://${bucket}/`;
    if (value.startsWith(prefix)) {
      const objectPath = value.slice(prefix.length);
      return objectPath.length > 0 ? { bucket, objectPath } : null;
    }
  }
  const supabaseUrl = (
    process.env["SUPABASE_URL"] ??
    process.env["VITE_SUPABASE_URL"] ??
    ""
  ).replace(/\/$/, "");
  if (supabaseUrl) {
    for (const bucket of KNOWN_STORAGE_BUCKETS) {
      const signPrefix = `${supabaseUrl}/storage/v1/object/sign/${bucket}/`;
      if (value.startsWith(signPrefix)) {
        const rest = value.slice(signPrefix.length).split("?")[0] ?? "";
        const objectPath = decodeURIComponent(rest);
        return objectPath.length > 0 ? { bucket, objectPath } : null;
      }
    }
  }
  return null;
}

/**
 * Extract the object path from a stored value when it refers to any of our
 * Supabase buckets — either a `supabase://<bucket>/<path>` storage ref or a
 * previously-minted signed URL under this project's bucket. Returns null
 * for legacy GCS URLs and everything else.
 */
export function parseSupabaseStorageRef(value: string): string | null {
  const parsed = parseSupabaseStorageRefBucketed(value);
  return parsed ? parsed.objectPath : null;
}

/**
 * Normalize a media value to the stable storage-ref form when it points at
 * one of our Supabase buckets. Use at WRITE time before persisting. The
 * bucket is preserved (`supabase://video-exports/...` stays video-exports).
 * Legacy GCS URLs and unrelated URLs pass through unchanged.
 */
export function normalizeToStorageRef(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const parsed = parseSupabaseStorageRefBucketed(value);
  if (!parsed) return value;
  return `supabase://${parsed.bucket}/${parsed.objectPath}`;
}

/**
 * Mint a fresh 1-day signed URL for a stored value. Storage refs (and our
 * own older signed URLs) are re-signed from the bucket they point at;
 * legacy GCS URLs and everything else pass through unchanged so callers
 * never see a hard failure.
 */
export async function refreshSupabaseStorageUrl(value: string): Promise<string> {
  const parsed = parseSupabaseStorageRefBucketed(value);
  if (!parsed) return value; // legacy GCS / public / unrelated → as-is
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.objectPath, SUPABASE_SIGNED_URL_TTL_SEC);
    if (error || !data?.signedUrl) return value;
    return data.signedUrl;
  } catch {
    return value;
  }
}

/** True when the string is a legacy Replit-owned GCS URL. */
export function isLegacyGcsUrl(value: string): boolean {
  return typeof value === "string" && value.startsWith(LEGACY_GCS_URL_PREFIX);
}

/**
 * Best-effort expiry check for legacy GCS signed URLs. Handles both the
 * `Expires=<epoch>` style and the V4 `X-Goog-Expires`+`X-Goog-Date` style.
 * Returns true only when the URL is provably expired — unparseable URLs
 * return false (conservative: leave as-is).
 */
function isExpiredGcsSignedUrl(url: string): boolean {
  try {
    const q = new URL(url).searchParams;
    const expiresParam = q.get("Expires");
    if (expiresParam) {
      const epoch = Number(expiresParam);
      if (!Number.isFinite(epoch)) return false;
      return epoch * 1000 < Date.now();
    }
    const googExpires = q.get("X-Goog-Expires");
    const googDate = q.get("X-Goog-Date");
    if (googExpires && googDate) {
      const secs = Number(googExpires);
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(googDate);
      if (!m || !Number.isFinite(secs)) return false;
      const issued = Date.UTC(
        Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4]), Number(m[5]), Number(m[6]),
      );
      return issued + secs * 1000 < Date.now();
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Walks an arbitrary JSON-ish value and mints fresh signed URLs for any
 * string stored as a Supabase storage ref. Legacy GCS URLs that are
 * provably expired become null so the frontend shows "unavailable /
 * regenerate" instead of a broken player (null media URLs are a normal,
 * handled state in the video editor). Everything else passes through.
 */
export async function refreshSupabaseStorageUrlsDeep<T>(value: T): Promise<T> {
  if (typeof value === "string") {
    if (parseSupabaseStorageRef(value)) {
      return (await refreshSupabaseStorageUrl(value)) as unknown as T;
    }
    if (isLegacyGcsUrl(value) && isExpiredGcsSignedUrl(value)) {
      return null as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return (await Promise.all(
      value.map((v) => refreshSupabaseStorageUrlsDeep(v)),
    )) as unknown as T;
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(
        async ([k, v]) => [k, await refreshSupabaseStorageUrlsDeep(v)] as const,
      ),
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}
