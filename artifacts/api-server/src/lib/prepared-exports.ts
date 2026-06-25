import { rmSync, existsSync } from "fs";
import path from "path";

export interface PreparedClipEntry {
  sceneNumber: number;
  originalUrl: string;
  resolvedUrl: string;
  sourceType: string;
  localPath: string;
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

export interface PreparedExportEntry {
  projectId: string;
  exportDir: string;
  clips: PreparedClipEntry[];
  allReady: boolean;
  createdAt: number;
}

const registry = new Map<string, PreparedExportEntry>();

export function registerPreparedExport(id: string, entry: PreparedExportEntry): void {
  registry.set(id, entry);
}

export function getPreparedExport(id: string): PreparedExportEntry | undefined {
  return registry.get(id);
}

export function deletePreparedExport(id: string): void {
  const entry = registry.get(id);
  if (entry) {
    try {
      if (existsSync(entry.exportDir)) {
        rmSync(entry.exportDir, { recursive: true, force: true });
      }
    } catch { }
    registry.delete(id);
  }
}

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, entry] of registry.entries()) {
    if (entry.createdAt < cutoff) {
      try {
        if (existsSync(entry.exportDir)) {
          rmSync(entry.exportDir, { recursive: true, force: true });
        }
      } catch { }
      registry.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();
