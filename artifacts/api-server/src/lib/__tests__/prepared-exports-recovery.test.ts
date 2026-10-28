/**
 * prepared-exports-recovery.test.ts — stack600 export-recovery, rung 2.
 *
 * The gate re-run #3 branded-export failure (diagnosis:
 * gate3-branded-session-diagnosis.md): prepare sessions lived ONLY in an
 * in-memory Map, so any process restart (memory-watchdog controlled
 * restart / container OOM) between prepare and execute destroyed every
 * session while its files survived on disk — and the next lookup
 * hard-stopped PREPARE_STALE.
 *
 * Pinned behavior (this rung):
 *  - registering a session persists a session.json seed into its
 *    exportDir (the durable fields only — no runtime refcount state);
 *  - a fresh process (fresh module state) rebuilds the registry from
 *    those seeds via rehydratePreparedExports, and the restored session
 *    is fully usable (lookup / acquire / release / delete);
 *  - an expired session is NOT rehydrated and its files are cleaned;
 *  - a corrupt or foreign seed is skipped and cleaned without throwing,
 *    and never blocks a valid sibling from restoring;
 *  - rehydration never overwrites a live registration.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as pe from "../prepared-exports";

type PE = typeof pe;

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pe-recovery-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop()!;
    rmSync(root, { recursive: true, force: true });
  }
});

/** A fresh module instance = a fresh process's empty registry. */
async function freshModule(): Promise<PE> {
  vi.resetModules();
  return import("../prepared-exports");
}

function makeClip(localPath: string, resolvedUrl: string): pe.PreparedClipEntry {
  return {
    sceneNumber: 1,
    sceneTitle: "Scene 1",
    clipDbId: null,
    provider: null,
    approved: true,
    selected: true,
    sourceFieldName: "scene.demoClipUrl",
    originalUrl: resolvedUrl,
    resolvedUrl,
    sourceType: "upload",
    sourceUrlStartsWithHttp: true,
    sourceUrlDownloadable: true,
    localPath,
    fileWritten: true,
    fileExistsAfterWrite: true,
    fileSize: 1234,
    duration: 3,
    width: 720,
    height: 1280,
    fps: 30,
    codec: "h264",
    ffprobeValid: true,
    readyForFFmpeg: true,
    error: null,
    responseStatus: 200,
    contentType: "video/mp4",
  };
}

function makeEntry(
  exportDir: string,
  overrides: Partial<pe.PreparedExportEntry> = {},
): Omit<pe.PreparedExportEntry, "inFlightCount" | "pendingDeletion"> {
  const clipPath = join(exportDir, "clip-scene-1.mp4");
  return {
    projectId: "proj-1",
    exportDir,
    clips: [makeClip(clipPath, "https://example.test/clip.mp4")],
    audio: null,
    allReady: true,
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Create an exportDir on disk with its clip file present, as prepare does. */
function makeExportDir(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "clip-scene-1.mp4"), "fake-clip-bytes");
  return dir;
}

describe("prepared-export sessions survive restarts (rung 2)", () => {
  it("registering a session persists a session.json seed with only the durable fields", () => {
    const root = makeRoot();
    const exportDir = makeExportDir(root, "export-proj-1-1000");
    const entry = makeEntry(exportDir);

    pe.registerPreparedExport("sess-seed", entry);

    const seedPath = join(exportDir, pe.PREPARED_SESSION_FILENAME);
    expect(existsSync(seedPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(seedPath, "utf8")) as {
      id: string;
      entry: Record<string, unknown>;
    };
    expect(parsed.id).toBe("sess-seed");
    expect(parsed.entry["projectId"]).toBe("proj-1");
    expect(parsed.entry["exportDir"]).toBe(exportDir);
    expect(parsed.entry["createdAt"]).toBe(entry.createdAt);
    expect(parsed.entry["allReady"]).toBe(true);
    expect(Array.isArray(parsed.entry["clips"])).toBe(true);
    // Runtime-only refcount state is never persisted.
    expect(parsed.entry).not.toHaveProperty("inFlightCount");
    expect(parsed.entry).not.toHaveProperty("pendingDeletion");
  });

  it("a fresh process rehydrates the session and the restored entry is fully usable", async () => {
    const root = makeRoot();
    const exportDir = makeExportDir(root, "export-proj-1-2000");
    const audioPath = join(exportDir, "audio.mp3");
    writeFileSync(audioPath, "fake-audio-bytes");
    const entry = makeEntry(exportDir, {
      audio: {
        requested: true,
        sourceUrl: "https://example.test/song.mp3",
        localPath: audioPath,
        fileWritten: true,
        fileExistsAfterWrite: true,
        fileSize: 4321,
        duration: 5,
        ffprobeValid: true,
        ready: true,
        error: null,
        responseStatus: 200,
        contentType: "audio/mpeg",
      },
    });
    pe.registerPreparedExport("sess-survives", entry);

    // Simulate the restart: brand-new module state, empty registry.
    const fresh = await freshModule();
    expect(fresh.getPreparedExport("sess-survives")).toBeUndefined();

    const restored = fresh.rehydratePreparedExports([root]);
    expect(restored).toBe(1);

    const got = fresh.getPreparedExport("sess-survives");
    expect(got).toBeDefined();
    expect(got!.projectId).toBe("proj-1");
    expect(got!.exportDir).toBe(exportDir);
    expect(got!.allReady).toBe(true);
    expect(got!.createdAt).toBe(entry.createdAt);
    expect(got!.clips).toHaveLength(1);
    expect(got!.clips[0]!.localPath).toBe(join(exportDir, "clip-scene-1.mp4"));
    expect(got!.audio?.localPath).toBe(audioPath);
    // Runtime state starts clean on the restored entry.
    expect(got!.inFlightCount).toBe(0);
    expect(got!.pendingDeletion).toBe(false);

    // Fully usable: the refcount + delete lifecycle works on it.
    expect(fresh.acquirePreparedExport("sess-survives")).toBe(true);
    fresh.releasePreparedExport("sess-survives");
    fresh.deletePreparedExport("sess-survives");
    expect(fresh.getPreparedExport("sess-survives")).toBeUndefined();
    expect(existsSync(exportDir)).toBe(false);
  });

  it("an expired session is not rehydrated and its files are cleaned up", async () => {
    const root = makeRoot();
    const exportDir = makeExportDir(root, "export-proj-1-3000");
    const entry = makeEntry(exportDir, {
      createdAt: Date.now() - pe.PREPARE_TTL_MS - 60_000,
    });
    pe.registerPreparedExport("sess-expired", entry);
    expect(existsSync(join(exportDir, pe.PREPARED_SESSION_FILENAME))).toBe(true);

    const fresh = await freshModule();
    const restored = fresh.rehydratePreparedExports([root]);

    expect(restored).toBe(0);
    expect(fresh.getPreparedExport("sess-expired")).toBeUndefined();
    // The reaper's job, done at boot: the whole session dir is gone.
    expect(existsSync(exportDir)).toBe(false);
  });

  it("a corrupt seed is skipped and cleaned without throwing; a valid sibling still restores", async () => {
    const root = makeRoot();
    const badDir = makeExportDir(root, "export-proj-1-4000");
    writeFileSync(join(badDir, pe.PREPARED_SESSION_FILENAME), "this is not json{");
    const goodDir = makeExportDir(root, "export-proj-1-5000");
    pe.registerPreparedExport("sess-good", makeEntry(goodDir));
    // A subdirectory with no seed at all must be ignored silently.
    mkdirSync(join(root, "unrelated-dir"), { recursive: true });

    const fresh = await freshModule();
    let restored = -1;
    expect(() => {
      restored = fresh.rehydratePreparedExports([root]);
    }).not.toThrow();

    expect(restored).toBe(1);
    expect(fresh.getPreparedExport("sess-good")).toBeDefined();
    // Corrupt seed file cleaned; its directory is left in place.
    expect(existsSync(join(badDir, pe.PREPARED_SESSION_FILENAME))).toBe(false);
    expect(existsSync(badDir)).toBe(true);
  });

  it("a seed whose exportDir points at a different directory is rejected and cleaned", async () => {
    const root = makeRoot();
    const dir = makeExportDir(root, "export-proj-1-6000");
    const foreign = makeExportDir(root, "export-proj-1-7000");
    const entry = makeEntry(foreign);
    writeFileSync(
      join(dir, pe.PREPARED_SESSION_FILENAME),
      JSON.stringify({ id: "sess-foreign", entry }),
      "utf8",
    );

    const fresh = await freshModule();
    const restored = fresh.rehydratePreparedExports([root]);

    expect(restored).toBe(0);
    expect(fresh.getPreparedExport("sess-foreign")).toBeUndefined();
    expect(existsSync(join(dir, pe.PREPARED_SESSION_FILENAME))).toBe(false);
    // The foreign directory itself is untouched.
    expect(existsSync(foreign)).toBe(true);
  });

  it("rehydration never overwrites a live registration; unreadable roots are ignored", async () => {
    const root = makeRoot();
    const liveDir = makeExportDir(root, "export-proj-1-8000");
    pe.registerPreparedExport("sess-dup", makeEntry(liveDir, { projectId: "proj-live" }));

    // A second, stale seed for the same id elsewhere under the root.
    const staleDir = makeExportDir(root, "export-proj-1-9000");
    writeFileSync(
      join(staleDir, pe.PREPARED_SESSION_FILENAME),
      JSON.stringify({
        id: "sess-dup",
        entry: makeEntry(staleDir, { projectId: "proj-stale-copy" }),
      }),
      "utf8",
    );

    const restored = pe.rehydratePreparedExports([root, join(root, "no-such-root")]);
    expect(restored).toBe(0);
    expect(pe.getPreparedExport("sess-dup")!.projectId).toBe("proj-live");
  });
});
