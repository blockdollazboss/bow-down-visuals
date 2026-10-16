/**
 * Own-server live media engine tests (lib/own-server-live).
 *
 * Two layers:
 *  - Unit: a fake MediaProcess stands in for ffmpeg — chunk flow,
 *    duplicate-seq no-ops, capacity + byte caps, unsupported formats,
 *    the stall watchdog on an injected clock, finalize upload shape.
 *  - Integration: the REAL ffmpeg (this repo's box has it, and the
 *    deploy image ships it) remuxes a synthetic WebM fed in ~2s
 *    chunks; a playlist with a real segment must appear, and the
 *    first-chunk → first-segment latency is measured + logged (it is
 *    the honest viewer-lag floor for chunked HLS).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  beginSession,
  acceptChunk,
  endSession,
  finalizeRecording,
  activeSessionCount,
  hasSession,
  getSession,
  isLiveFileName,
  liveFilePath,
  liveFileContentType,
  ownServerConfig,
  initOwnServerLive,
  LiveIngestError,
  __setOwnServerDeps,
  __resetOwnServerLive,
  type MediaProcess,
} from "../own-server-live";

const run = promisify(execFile);
const hasFfmpeg = fs.existsSync("/usr/bin/ffmpeg");

let dir: string;

class FakeProc implements MediaProcess {
  writes: Buffer[] = [];
  finished = false;
  killed = false;
  async write(chunk: Buffer): Promise<void> {
    this.writes.push(Buffer.from(chunk));
  }
  async finish(): Promise<number | null> {
    this.finished = true;
    return 0;
  }
  kill(): void {
    this.killed = true;
  }
}

let procs: FakeProc[] = [];
const fakeFactory = () => {
  const p = new FakeProc();
  procs.push(p);
  return p;
};

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "bdv-live-test-"));
  process.env.LIVE_MEDIA_DIR = dir;
  delete process.env.LIVE_MAX_CONCURRENT;
  delete process.env.LIVE_MAX_SESSION_BYTES;
  procs = [];
  await __resetOwnServerLive();
  __setOwnServerDeps({ processFactory: fakeFactory });
});

afterEach(async () => {
  await __resetOwnServerLive();
  delete process.env.LIVE_MEDIA_DIR;
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("config", () => {
  it("defaults ride the existing box; env overrides land", () => {
    const c = ownServerConfig({} as NodeJS.ProcessEnv);
    expect(c.maxConcurrent).toBe(3);
    expect(c.stallMs).toBe(30_000);
    expect(c.maxSessionBytes).toBe(1_500_000_000);
    const o = ownServerConfig({ LIVE_MAX_CONCURRENT: "1", LIVE_STALL_MS: "5000" } as NodeJS.ProcessEnv);
    expect(o.maxConcurrent).toBe(1);
    expect(o.stallMs).toBe(5000);
  });
});

describe("chunk ingest (fake remuxer)", () => {
  it("writes chunks through to the raw master and the remuxer, in order", async () => {
    expect(beginSession("s1")).toEqual({ ok: true });
    const a = Buffer.from("chunk-zero");
    const b = Buffer.from("chunk-one!");
    await acceptChunk("s1", 0, a, "video/webm;codecs=vp9,opus");
    await acceptChunk("s1", 1, b, "video/webm;codecs=vp9,opus");
    expect(procs).toHaveLength(1);
    expect(Buffer.concat(procs[0].writes).toString()).toBe("chunk-zerochunk-one!");
    await endSession("s1");
    const raw = await fsp.readFile(path.join(dir, "s1", "raw.webm"));
    expect(raw.toString()).toBe("chunk-zerochunk-one!");
    expect(procs[0].finished).toBe(true);
    expect(hasSession("s1")).toBe(false);
    expect(activeSessionCount()).toBe(0);
  });

  it("a re-sent seq is a no-op duplicate (client retry after a timeout)", async () => {
    beginSession("s1");
    await acceptChunk("s1", 0, Buffer.from("aaa"), "video/webm");
    const dup = await acceptChunk("s1", 0, Buffer.from("aaa"), "video/webm");
    expect(dup).toEqual({ duplicate: true });
    expect(procs[0].writes).toHaveLength(1);
    const next = await acceptChunk("s1", 1, Buffer.from("bbb"), "video/webm");
    expect(next).toEqual({ duplicate: false });
    await endSession("s1");
  });

  it("rejects unknown sessions and unsupported first-chunk formats", async () => {
    await expect(acceptChunk("nope", 0, Buffer.from("x"), "video/webm")).rejects.toMatchObject({
      code: "NO_SESSION",
    });
    beginSession("s1");
    await expect(acceptChunk("s1", 0, Buffer.from("x"), "video/x-msvideo")).rejects.toBeInstanceOf(
      LiveIngestError,
    );
    await expect(acceptChunk("s1", 0, Buffer.from("x"), "video/x-msvideo")).rejects.toMatchObject({
      code: "UNSUPPORTED_MIME",
    });
    await endSession("s1");
  });

  it("enforces the concurrency cap and the per-session byte cap", async () => {
    process.env.LIVE_MAX_CONCURRENT = "1";
    expect(beginSession("s1").ok).toBe(true);
    expect(beginSession("s2")).toEqual({ ok: false, code: "CAPACITY" });
    process.env.LIVE_MAX_SESSION_BYTES = "8";
    await expect(acceptChunk("s1", 0, Buffer.alloc(9), "video/webm")).rejects.toMatchObject({
      code: "SESSION_FULL",
    });
    await endSession("s1");
  });

  it("endSession is idempotent", async () => {
    beginSession("s1");
    await acceptChunk("s1", 0, Buffer.from("aaa"), "video/mp4");
    await endSession("s1");
    await expect(endSession("s1")).resolves.toBeUndefined();
    expect(getSession("s1")?.state).toBe("ended");
  });
});

describe("stall watchdog (injected clock)", () => {
  it("reports a publisher that goes quiet past the stall window", async () => {
    let fakeNow = 1_000_000;
    __setOwnServerDeps({ now: () => fakeNow });
    const stalls: Array<{ id: string; reason: string }> = [];
    initOwnServerLive({ onStall: (id, reason) => stalls.push({ id, reason }) });
    beginSession("s1");
    await acceptChunk("s1", 0, Buffer.from("aaa"), "video/webm");
    fakeNow += 31_000; // past the 30s stall window
    await vi.waitFor(() => expect(stalls).toEqual([{ id: "s1", reason: "stalled" }]), {
      timeout: 9_000,
      interval: 250,
    });
    await endSession("s1");
  }, 15_000);
});

describe("HLS file serving helpers", () => {
  it("whitelists only playlist / init / segment names", () => {
    expect(isLiveFileName("playlist.m3u8")).toBe(true);
    expect(isLiveFileName("init.mp4")).toBe(true);
    expect(isLiveFileName("seg00001.m4s")).toBe(true);
    expect(isLiveFileName("../secret")).toBe(false);
    expect(isLiveFileName("seg.m4s")).toBe(false);
    expect(isLiveFileName("raw.webm")).toBe(false);
    expect(isLiveFileName("playlist.m3u8.bak")).toBe(false);
    expect(liveFileContentType("playlist.m3u8")).toBe("application/vnd.apple.mpegurl");
    expect(liveFileContentType("init.mp4")).toBe("video/mp4");
    expect(liveFileContentType("seg00001.m4s")).toBe("video/iso.segment");
  });

  it("resolves real files inside the session's live dir only", async () => {
    beginSession("s1");
    const liveDir = getSession("s1")!.liveDir;
    await fsp.writeFile(path.join(liveDir, "playlist.m3u8"), "#EXTM3U\n");
    expect(liveFilePath("s1", "playlist.m3u8")).toBe(path.join(liveDir, "playlist.m3u8"));
    expect(liveFilePath("s1", "seg00001.m4s")).toBeNull(); // whitelisted but absent
    expect(liveFilePath("s1", "raw.webm")).toBeNull();
    expect(liveFilePath("ghost", "playlist.m3u8")).toBeNull();
    await endSession("s1");
  });
});

describe("finalizeRecording", () => {
  it("uploads the raw master under the owner's live prefix", async () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    try {
      vi.resetModules();
      const fresh = await import("../own-server-live");
      const uploads: Array<{ key: string; contentType: string; bytes: number }> = [];
      fresh.__setOwnServerDeps({
        processFactory: fakeFactory,
        upload: async (key, body, contentType) => {
          let bytes = 0;
          for await (const c of body as AsyncIterable<Buffer>) bytes += c.length;
          uploads.push({ key, contentType, bytes });
          return `https://media.example/${key}`;
        },
      });
      fresh.beginSession("s9");
      await fresh.acceptChunk("s9", 0, Buffer.from("webm-bytes"), "video/webm");
      await fresh.endSession("s9");
      const out = await fresh.finalizeRecording("s9", "user-1");
      expect(out).toEqual({ vodUrl: "https://media.example/user-1/live/s9.webm", contentType: "video/webm" });
      expect(uploads).toEqual([{ key: "user-1/live/s9.webm", contentType: "video/webm", bytes: 10 }]);
      await fresh.__resetOwnServerLive();
    } finally {
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
      vi.resetModules();
    }
  });

  it("returns null when nothing was recorded", async () => {
    beginSession("s1");
    await endSession("s1");
    expect(await finalizeRecording("s1", "user-1")).toBeNull();
    expect(await finalizeRecording("ghost", "user-1")).toBeNull();
  });
});

describe.skipIf(!hasFfmpeg)("real ffmpeg remux (integration)", () => {
  it("turns ~2s WebM chunks into a playable fMP4 HLS playlist", async () => {
    await __resetOwnServerLive(); // restores the REAL ffmpeg factory
    await fsp.mkdir(dir, { recursive: true }); // (the reset clears the media dir)
    const fixture = path.join(dir, "fixture.webm");
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=duration=6:size=640x360:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
      "-c:v", "libvpx-vp9", "-b:v", "400k", "-c:a", "libopus",
      "-shortest", fixture,
    ]);
    const bytes = await fsp.readFile(fixture);
    const third = Math.floor(bytes.length / 3);
    const chunks = [bytes.subarray(0, third), bytes.subarray(third, third * 2), bytes.subarray(third * 2)];

    expect(beginSession("live1").ok).toBe(true);
    const t0 = Date.now();
    for (let i = 0; i < chunks.length; i++) {
      await acceptChunk("live1", i, chunks[i], "video/webm;codecs=vp9,opus");
    }
    const liveDir = getSession("live1")!.liveDir;
    let playlist = "";
    let firstSegMs = -1;
    await vi.waitFor(
      async () => {
        playlist = await fsp.readFile(path.join(liveDir, "playlist.m3u8"), "utf8").catch(() => "");
        expect(playlist).toContain("seg00000.m4s");
        firstSegMs = Date.now() - t0;
      },
      { timeout: 25_000, interval: 250 },
    );
    // The measured floor for viewer lag: first chunk in → first segment out.
    console.log(`[own-server-live] first chunk → first HLS segment: ${firstSegMs}ms`);
    expect(playlist).toContain("#EXTM3U");
    expect(playlist).toContain("init.mp4");
    expect(fs.existsSync(path.join(liveDir, "init.mp4"))).toBe(true);

    // The init+segment pair must probe as real VP9/Opus media.
    const probeFile = path.join(dir, "probe.mp4");
    const init = await fsp.readFile(path.join(liveDir, "init.mp4"));
    const seg = await fsp.readFile(path.join(liveDir, "seg00000.m4s"));
    await fsp.writeFile(probeFile, Buffer.concat([init, seg]));
    const { stdout } = await run("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", probeFile,
    ]);
    expect(stdout).toContain("vp9");
    expect(stdout).toContain("opus");

    await endSession("live1");
    const raw = await fsp.readFile(path.join(dir, "live1", "raw.webm"));
    expect(raw.length).toBe(bytes.length); // the concat IS the master
  }, 60_000);
});
