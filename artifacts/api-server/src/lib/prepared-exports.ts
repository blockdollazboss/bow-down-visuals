import { rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

export interface PreparedClipEntry {
  sceneNumber: number;
  sceneTitle: string;
  clipDbId: string | null;
  provider: string | null;
  approved: boolean;
  selected: boolean;
  /** Which urlFields key was used to find the download URL */
  sourceFieldName: string;
  originalUrl: string;
  resolvedUrl: string;
  sourceType: string;
  sourceUrlStartsWithHttp: boolean;
  /** HEAD check result before download */
  sourceUrlDownloadable: boolean;
  localPath: string;
  /** True if the file write call completed without throwing */
  fileWritten: boolean;
  /** fs.existsSync(localPath) immediately after the write */
  fileExistsAfterWrite: boolean;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  ffprobeValid: boolean;
  readyForFFmpeg: boolean;
  error: string | null;
  /** HTTP response status from the actual download request */
  responseStatus: number;
  /** Content-Type header returned by the download URL */
  contentType: string;
}

export interface PreparedAudioEntry {
  /** True when the project supplied an audio URL to prepare */
  requested: boolean;
  /** The exact master-player / export audio URL used */
  sourceUrl: string;
  localPath: string;
  fileWritten: boolean;
  fileExistsAfterWrite: boolean;
  fileSize: number;
  duration: number;
  ffprobeValid: boolean;
  /** True when audio file exists and passes ffprobe */
  ready: boolean;
  error: string | null;
  responseStatus: number;
  contentType: string;
}

export interface PreparedExportEntry {
  projectId: string;
  exportDir: string;
  clips: PreparedClipEntry[];
  /** Prepared project audio (null when project has no audio) */
  audio: PreparedAudioEntry | null;
  allReady: boolean;
  createdAt: number;
  /**
   * Number of export requests currently reading this session's files.
   * Guards against a concurrent/duplicate export request (or the TTL
   * reaper) deleting files out from under a request that is still
   * mid-flight. Not persisted — in-memory only, reset on server restart.
   */
  inFlightCount: number;
  /** Set when eviction was attempted while inFlightCount > 0; the last releaser deletes it. */
  pendingDeletion: boolean;
}

/** How long a prepared-export session stays valid before the reaper evicts it. */
export const PREPARE_TTL_MS = 30 * 60 * 1000;

/**
 * Name of the on-disk seed written into every session's exportDir at
 * registration time. The registry below is process memory and dies with
 * the process — but the prepared files live on disk and survive a
 * restart on the same instance, so the seed lets a fresh process rebuild
 * the index at boot (see `rehydratePreparedExports`). The in-memory Map
 * remains the runtime source of truth; the seed is only a boot input.
 */
export const PREPARED_SESSION_FILENAME = "session.json";

const registry = new Map<string, PreparedExportEntry>();

interface PersistedPreparedSession {
  id: string;
  entry: Omit<PreparedExportEntry, "inFlightCount" | "pendingDeletion">;
}

/**
 * Write the session's seed file into its exportDir. Best-effort by
 * design: a failed write (e.g. the dir is already gone) must never break
 * registration — the session simply won't survive a restart.
 */
function persistSession(id: string, entry: PreparedExportEntry): void {
  try {
    const payload: PersistedPreparedSession = {
      id,
      entry: {
        projectId: entry.projectId,
        exportDir: entry.exportDir,
        clips: entry.clips,
        audio: entry.audio,
        allReady: entry.allReady,
        createdAt: entry.createdAt,
      },
    };
    writeFileSync(join(entry.exportDir, PREPARED_SESSION_FILENAME), JSON.stringify(payload), "utf8");
  } catch { /* best-effort — the in-memory registry stays the source of truth */ }
}

export function registerPreparedExport(
  id: string,
  entry: Omit<PreparedExportEntry, "inFlightCount" | "pendingDeletion">,
): void {
  const full: PreparedExportEntry = { ...entry, inFlightCount: 0, pendingDeletion: false };
  registry.set(id, full);
  persistSession(id, full);
}

export function getPreparedExport(id: string): PreparedExportEntry | undefined {
  return registry.get(id);
}

function removeDirFromDisk(dir: string): void {
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch { /* best-effort */ }
}

function removeFromDisk(entry: PreparedExportEntry): void {
  removeDirFromDisk(entry.exportDir);
}

function removeSeedFile(seedPath: string): void {
  try {
    rmSync(seedPath, { force: true });
  } catch { /* best-effort */ }
}

/**
 * Shape-check a parsed seed. A seed is only trusted for the directory it
 * was found in: its recorded exportDir must resolve to that directory,
 * so a stray or copied session.json can never point the registry at
 * foreign files. Anything else the render path depends on (per-file
 * existence) is re-verified by executeExport itself at lookup time.
 */
function isPersistedSession(value: unknown, dir: string): value is PersistedPreparedSession {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v["id"] !== "string" || (v["id"] as string).length === 0) return false;
  const e = v["entry"];
  if (e == null || typeof e !== "object") return false;
  const entry = e as Record<string, unknown>;
  if (typeof entry["projectId"] !== "string") return false;
  if (typeof entry["exportDir"] !== "string") return false;
  if (resolve(entry["exportDir"] as string) !== resolve(dir)) return false;
  if (typeof entry["createdAt"] !== "number" || !Number.isFinite(entry["createdAt"] as number)) return false;
  if (typeof entry["allReady"] !== "boolean") return false;
  if (!Array.isArray(entry["clips"])) return false;
  for (const c of entry["clips"] as unknown[]) {
    if (c == null || typeof c !== "object") return false;
    if (typeof (c as Record<string, unknown>)["localPath"] !== "string") return false;
  }
  const audio = entry["audio"];
  if (audio !== null) {
    if (typeof audio !== "object") return false;
    if (typeof (audio as Record<string, unknown>)["localPath"] !== "string") return false;
  }
  return true;
}

/**
 * Boot seed: rebuild the registry from session.json files left behind
 * by a previous process. Scans each root's immediate subdirectories for
 * a seed, restores every unexpired, well-formed session, and cleans up
 * the rest — expired sessions lose their files too (the TTL reaper
 * would have evicted them had the process lived), corrupt seeds lose
 * just the seed file. Never throws: an unreadable root or a bad seed
 * must not block boot. Returns how many sessions were restored.
 */
export function rehydratePreparedExports(roots: string[] = [tmpdir()]): number {
  let restored = 0;
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      continue; // an unreadable root must never block boot
    }
    for (const name of names) {
      const dir = join(root, name);
      const seedPath = join(dir, PREPARED_SESSION_FILENAME);
      if (!existsSync(seedPath)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(seedPath, "utf8"));
      } catch {
        removeSeedFile(seedPath); // corrupt seed — clean it and move on
        continue;
      }
      if (!isPersistedSession(parsed, dir)) {
        removeSeedFile(seedPath);
        continue;
      }
      const { id, entry } = parsed;
      if (Date.now() - entry.createdAt > PREPARE_TTL_MS) {
        removeDirFromDisk(entry.exportDir); // expired while down — reap it here
        continue;
      }
      if (registry.has(id)) continue; // a live registration always wins
      registry.set(id, { ...entry, inFlightCount: 0, pendingDeletion: false });
      restored += 1;
    }
  }
  return restored;
}

/**
 * Mark a prepared session as actively in use by an export request.
 * Must be paired with `releasePreparedExport(id)` (typically in a
 * `finally` block) once that request is done reading its files.
 * Returns false if the session no longer exists.
 */
export function acquirePreparedExport(id: string): boolean {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.inFlightCount += 1;
  return true;
}

/**
 * Release a previously-acquired prepared session. If deletion was
 * requested while this (or another) request was still in flight, the
 * last releaser performs the actual cleanup.
 */
export function releasePreparedExport(id: string): void {
  const entry = registry.get(id);
  if (!entry) return;
  entry.inFlightCount = Math.max(0, entry.inFlightCount - 1);
  if (entry.pendingDeletion && entry.inFlightCount === 0) {
    removeFromDisk(entry);
    registry.delete(id);
  }
}

/**
 * Request deletion of a prepared session. If it is currently in use by
 * another export request, deletion is deferred until every acquirer has
 * released it (see `releasePreparedExport`), instead of deleting files
 * that request is still reading.
 */
export function deletePreparedExport(id: string): void {
  const entry = registry.get(id);
  if (!entry) return;
  if (entry.inFlightCount > 0) {
    entry.pendingDeletion = true;
    return;
  }
  removeFromDisk(entry);
  registry.delete(id);
}

setInterval(() => {
  const cutoff = Date.now() - PREPARE_TTL_MS;
  for (const [id, entry] of registry.entries()) {
    if (entry.createdAt < cutoff) {
      if (entry.inFlightCount > 0) {
        // Don't evict a session a live export request is still reading from;
        // it will be cleaned up as soon as that request releases it.
        entry.pendingDeletion = true;
        continue;
      }
      removeFromDisk(entry);
      registry.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();
