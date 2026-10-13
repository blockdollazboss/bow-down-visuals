/**
 * MIRROR-ON-SAVE (owner directive 2026-10-13: "I keep losing all my files.
 * This should never happen").
 *
 * The site's recurrent data-loss family was one mistake repeated: media
 * stored as EXTERNAL URLs that expire (Replit-GCS signed URLs died
 * 2026-07-14 and took the June 23 project's clips with them; the Shark
 * King vault photo died the same way). From now on, whenever a save path
 * accepts an external http(s) media URL, the server downloads the file
 * and re-hosts it in our own storage (R2 / Supabase via
 * uploadMediaToSupabaseStorage), storing the permanent r2:// or
 * supabase:// ref instead. Read paths already re-sign those refs fresh
 * on every load, so a mirrored file can never expire.
 *
 * Best-effort by design: any failure (dead URL, oversize, network)
 * returns the original value so a save NEVER breaks because mirroring
 * failed — the failure is logged loudly instead. Values that are
 * already permanent (r2://, supabase://), site-relative ("/videos/…"),
 * or non-URL pass through untouched.
 */
import { uploadMediaToSupabaseStorage } from "./objectStorage";

const MAX_BYTES = 200 * 1024 * 1024; // same cap the clip-recovery path used

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

function extensionFor(contentType: string, url: string, kind: "image" | "video" | "audio"): string {
  const fromType = EXT_BY_CONTENT_TYPE[contentType];
  if (fromType) return fromType;
  try {
    const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(new URL(url).pathname);
    if (m) return m[1].toLowerCase();
  } catch { /* fall through */ }
  return kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "jpg";
}

export function isExternalHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

export function isPermanentMediaValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return (
    v.startsWith("r2://") ||
    v.startsWith("supabase://") ||
    v.startsWith("/") ||
    v.startsWith("data:")
  );
}

/**
 * Mirror one external media URL into permanent storage.
 * Returns the storage ref on success, the original value otherwise.
 */
export async function mirrorExternalMediaUrl(
  value: string | null | undefined,
  opts: { kind: "image" | "video" | "audio"; ownerKey: string },
): Promise<string | null | undefined> {
  if (!isExternalHttpUrl(value) || isPermanentMediaValue(value)) return value;
  const url = (value as string).trim();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.kind === "image" ? 60_000 : 120_000),
    });
    if (!res.ok) {
      console.error(`[mirrorMedia] source answered ${res.status} for ${opts.kind} (owner ${opts.ownerKey}) — keeping original URL`);
      return value;
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) {
      console.error(`[mirrorMedia] source too large (${declared}B) for ${opts.kind} — keeping original URL`);
      return value;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      console.error(`[mirrorMedia] bad payload (${buf.length}B) for ${opts.kind} — keeping original URL`);
      return value;
    }
    const contentType =
      res.headers.get("content-type")?.split(";")[0]?.trim() ||
      (opts.kind === "video" ? "video/mp4" : opts.kind === "audio" ? "audio/mpeg" : "image/jpeg");
    const ext = extensionFor(contentType, url, opts.kind);
    const objectName = `mirrored/${opts.ownerKey}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const ref = await uploadMediaToSupabaseStorage(objectName, buf, contentType);
    console.log(`[mirrorMedia] mirrored ${opts.kind} for owner ${opts.ownerKey} -> ${ref}`);
    return ref;
  } catch (err) {
    console.error(
      `[mirrorMedia] mirror failed for ${opts.kind} (owner ${opts.ownerKey}):`,
      err instanceof Error ? err.message : String(err),
    );
    return value;
  }
}

/**
 * Mirror every external clip/thumbnail URL inside a project's scenes.
 * Returns a new output_data object when anything changed, else the input.
 */
export async function mirrorProjectScenes<T extends Record<string, unknown>>(
  outputData: T,
  ownerKey: string,
): Promise<T> {
  const scenes = (outputData as { scenes?: unknown }).scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) return outputData;
  let changed = false;
  const mirrored = await Promise.all(
    scenes.map(async (scene) => {
      if (!scene || typeof scene !== "object") return scene;
      const s = { ...(scene as Record<string, unknown>) };
      if (isExternalHttpUrl(s["demoClipUrl"]) && !isPermanentMediaValue(s["demoClipUrl"])) {
        const ref = await mirrorExternalMediaUrl(s["demoClipUrl"] as string, { kind: "video", ownerKey });
        if (ref !== s["demoClipUrl"]) { s["demoClipUrl"] = ref; changed = true; }
      }
      if (isExternalHttpUrl(s["thumbnailUrl"]) && !isPermanentMediaValue(s["thumbnailUrl"])) {
        const ref = await mirrorExternalMediaUrl(s["thumbnailUrl"] as string, { kind: "image", ownerKey });
        if (ref !== s["thumbnailUrl"]) { s["thumbnailUrl"] = ref; changed = true; }
      }
      return s;
    }),
  );
  if (!changed) return outputData;
  return { ...outputData, scenes: mirrored };
}
