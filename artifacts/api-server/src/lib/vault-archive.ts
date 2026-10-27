import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";

/**
 * vault-archive.ts — The Vault packager (Stack-200 UPGRADE #162).
 *
 * The delta over the existing data-only account export: THE MEDIA
 * ITSELF. One ZIP archive holding a creator's original songs, videos
 * and art at full quality — files are fetched byte-for-byte and stored
 * in the archive UNCOMPRESSED (archiver level 0 for media entries), so
 * a Vault can never silently recompress someone's body of work down.
 * JSON data entries (the account export payload incl. sales + splits,
 * and the archive manifest) are deflated normally.
 *
 * Honesty rules:
 * - A file that cannot be fetched is SKIPPED and named in
 *   manifest.json with the reason — never silently dropped, and one
 *   dead file never fails the whole Vault.
 * - If NOT ONE media file can be packaged (and there was media to
 *   package), the build fails loudly rather than shipping an
 *   empty-shell archive as "your whole body of work".
 */

export interface VaultMediaItem {
  /** Archive path, e.g. "media/songs/<rowId>-track.mp3". */
  path: string;
  /** Source URL the original bytes are fetched from. */
  url: string;
  kind: "audio" | "video" | "image" | "file";
  /** Human label for the manifest (song title, clip id, …). */
  label: string;
}

export interface VaultSkipped {
  url: string;
  label: string;
  reason: string;
}

export interface VaultBuildResult {
  fileCount: number;
  skipped: VaultSkipped[];
  sizeBytes: number;
}

/** URL-bearing fields scanned on owned rows, in priority order. */
const MEDIA_FIELDS = [
  "audio_url",
  "video_url",
  "image_url",
  "cover_art_url",
  "cover_url",
  "thumbnail_url",
  "file_url",
  "url",
] as const;

const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "flac", "ogg", "oga", "aac"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "mkv", "m4v"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"]);

function kindForField(field: string, url: string): VaultMediaItem["kind"] {
  if (field === "audio_url") return "audio";
  if (field === "video_url") return "video";
  if (field === "image_url" || field === "cover_art_url" || field === "cover_url" || field === "thumbnail_url") {
    return "image";
  }
  const ext = url.split("?")[0]!.split(".").pop()?.toLowerCase() ?? "";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (VIDEO_EXT.has(ext)) return "video";
  if (IMAGE_EXT.has(ext)) return "image";
  return "file";
}

function folderFor(table: string, kind: VaultMediaItem["kind"]): string {
  if (table === "songs") return "media/songs";
  if (table === "generated_clips") return "media/videos";
  if (kind === "image") return "media/art";
  if (kind === "video") return "media/videos";
  if (kind === "audio") return "media/audio";
  return "media/files";
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "file";
}

function baseNameFromUrl(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) return sanitizeFileName(decodeURIComponent(last));
  } catch {
    /* not a URL — fall through */
  }
  return sanitizeFileName(fallback);
}

/**
 * Pure inventory: scan the rows of the creator's owned tables and list
 * every distinct media original exactly once. The same URL appearing
 * on several rows (a song's cover on its project, say) is packaged
 * once, under the first label that names it.
 */
export function collectMediaInventory(
  tables: Record<string, unknown[]>,
): VaultMediaItem[] {
  const seen = new Set<string>();
  const items: VaultMediaItem[] = [];
  for (const [table, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) continue;
    for (const raw of rows) {
      if (typeof raw !== "object" || raw === null) continue;
      const row = raw as Record<string, unknown>;
      const rowId = typeof row["id"] === "string" ? row["id"] : "row";
      const title =
        (typeof row["title"] === "string" && row["title"]) ||
        (typeof row["name"] === "string" && row["name"]) ||
        rowId;
      for (const field of MEDIA_FIELDS) {
        const value = row[field];
        if (typeof value !== "string" || value.length === 0) continue;
        if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        const kind = kindForField(field, value);
        const fileName = baseNameFromUrl(value, `${title}`);
        items.push({
          path: `${folderFor(table, kind)}/${sanitizeFileName(rowId)}-${fileName}`,
          url: value,
          kind,
          label: `${title} (${field})`,
        });
      }
    }
  }
  return items;
}

export interface VaultArchiveDeps {
  /** Fetch one original's bytes. Throws on any failure. */
  fetchMedia: (url: string) => Promise<Buffer>;
  /** Consume the finished archive stream (upload). Resolves when stored. */
  storeArchive: (body: Readable) => Promise<void>;
  /** Progress callback: (packagedCount, totalCount). */
  onMediaProgress?: (done: number, total: number) => void | Promise<void>;
}

const README_TEXT = `THE VAULT — your Bow Down Visuals archive
============================================

Everything in this package is yours: the original files you made and
uploaded here, at full quality, never recompressed — plus your data.

  media/            your original songs, videos and art
  data/account-export.json   your profile, projects, drafts, clips,
                             songs, sales and split records, settings
  manifest.json     the full list of what was packaged — including
                    anything that could not be fetched, named with
                    the reason, so nothing is ever silently missing.

What you made here is yours to take. Always.
`;

/**
 * Package one Vault. Streams the ZIP into deps.storeArchive while
 * fetching originals one at a time (bounded memory on a small box).
 * Returns the manifest facts for the job record.
 */
export async function buildVaultArchive(
  deps: VaultArchiveDeps,
  input: {
    exportedAt: string;
    dataPayload: Record<string, unknown>;
    inventory: VaultMediaItem[];
  },
): Promise<VaultBuildResult> {
  const skipped: VaultSkipped[] = [];
  const packaged: Array<{ path: string; label: string; kind: string; bytes: number }> = [];

  const archive = new ZipArchive({ zlib: { level: 9 } });
  // The fail-loud path destroys the archive with an error; swallow that
  // emission here — the failure is reported by the throw below, and an
  // unlistened 'error' would otherwise crash the process.
  archive.on("error", () => undefined);
  const sink = new PassThrough();
  let sizeBytes = 0;
  sink.on("data", (chunk: Buffer) => {
    sizeBytes += chunk.length;
  });
  const stored = deps.storeArchive(sink);
  // Guard: if the store fails early, don't surface an unhandled rejection
  // while packaging continues; it is re-awaited (and thrown) below.
  stored.catch(() => undefined);
  archive.pipe(sink);

  archive.append(README_TEXT, { name: "README.txt" });
  archive.append(JSON.stringify(input.dataPayload, null, 2), {
    name: "data/account-export.json",
  });

  let done = 0;
  for (const item of input.inventory) {
    try {
      const bytes = await deps.fetchMedia(item.url);
      // Media is STORED, never deflated/recompressed — originals stay originals.
      archive.append(bytes, { name: item.path, store: true });
      packaged.push({ path: item.path, label: item.label, kind: item.kind, bytes: bytes.length });
    } catch (err) {
      skipped.push({
        url: item.url,
        label: item.label,
        reason: err instanceof Error ? err.message : "fetch failed",
      });
    }
    done++;
    await deps.onMediaProgress?.(done, input.inventory.length);
  }

  if (input.inventory.length > 0 && packaged.length === 0) {
    const failure = new Error(
      "None of your media files could be fetched, so no Vault was packaged. Your files are still on the site — please try again.",
    );
    archive.destroy(new Error("none of your media could be fetched"));
    // pipe() does not forward errors to the destination: destroy the sink
    // too, or the store consumer waits forever for an 'end' that never
    // comes and this throw never lands.
    sink.destroy(failure);
    await stored.catch(() => undefined);
    throw failure;
  }

  const manifest = {
    exportedAt: input.exportedAt,
    fileCount: packaged.length,
    files: packaged,
    skipped,
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  await archive.finalize();
  await stored;

  return { fileCount: packaged.length, skipped, sizeBytes };
}
