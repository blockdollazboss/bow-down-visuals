import { rmSync, existsSync } from "fs";

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

const registry = new Map<string, PreparedExportEntry>();

export function registerPreparedExport(
  id: string,
  entry: Omit<PreparedExportEntry, "inFlightCount" | "pendingDeletion">,
): void {
  registry.set(id, { ...entry, inFlightCount: 0, pendingDeletion: false });
}

export function getPreparedExport(id: string): PreparedExportEntry | undefined {
  return registry.get(id);
}

function removeFromDisk(entry: PreparedExportEntry): void {
  try {
    if (existsSync(entry.exportDir)) {
      rmSync(entry.exportDir, { recursive: true, force: true });
    }
  } catch { /* best-effort */ }
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
