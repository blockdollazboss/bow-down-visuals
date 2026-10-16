import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger";
import { r2Upload, isR2Configured } from "./r2-client";

/* ── Own-server live media engine ─────────────────────────────────────────
   How a broadcast rides the site's existing service, with no new vendor:

   Render (the host) gives a web service exactly ONE public HTTP port
   behind its HTTPS load balancer — WebSocket/HTTP only, no public UDP.
   WebRTC media therefore cannot reach this box, so the browser sends
   the show the way the box CAN be reached: the studio's MediaRecorder
   emits a short chunk every ~2 seconds and POSTs it over HTTPS. This
   engine appends those chunks (they are one continuous recording —
   the concatenation IS the VOD master) while feeding the same bytes to
   a per-stream ffmpeg that REMUXES ONLY (`-c copy`, no re-encode — the
   CPU on a 512 MB box is precious) into a live HLS (fMP4) playlist the
   watch page plays. When the stream ends, the raw master uploads to the
   site's permanent storage and registers as the replay.

   Safety rails for a small shared box:
   - at most MAX_CONCURRENT live sessions (default 3);
   - a publisher that goes quiet for STALL_MS is declared stalled and
     the routes layer ends its row + finalizes what exists;
   - a session that never sends a first chunk is reaped after a grace;
   - per-session byte cap and max duration bound disk + runtime;
   - per-stream state is a few small fields + file streams — chunk
     buffers are written through, never accumulated in the heap.

   FUTURE FAN-OUT: the RTMP multistream relay attaches right here — it
   would tap the same per-session byte stream (raw chunks in, HLS out)
   and push a copy at each connected platform. Nothing about the ingest
   or the studio changes when it lands. */

export interface OwnServerConfig {
  dir: string;
  maxConcurrent: number;
  stallMs: number;
  firstChunkGraceMs: number;
  maxSessionBytes: number;
  maxDurationMs: number;
  retainMs: number;
  hlsTimeSec: number;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function ownServerConfig(env: NodeJS.ProcessEnv = process.env): OwnServerConfig {
  return {
    dir: env["LIVE_MEDIA_DIR"]?.trim() || path.join(os.tmpdir(), "bdv-live"),
    maxConcurrent: intEnv(env, "LIVE_MAX_CONCURRENT", 3),
    stallMs: intEnv(env, "LIVE_STALL_MS", 30_000),
    firstChunkGraceMs: intEnv(env, "LIVE_FIRST_CHUNK_GRACE_MS", 120_000),
    maxSessionBytes: intEnv(env, "LIVE_MAX_SESSION_BYTES", 1_500_000_000),
    maxDurationMs: intEnv(env, "LIVE_MAX_DURATION_MS", 4 * 60 * 60 * 1000),
    retainMs: intEnv(env, "LIVE_RETAIN_MS", 10 * 60 * 1000),
    hlsTimeSec: intEnv(env, "LIVE_HLS_TIME_SEC", 2),
  };
}

/* ── Media process (ffmpeg) behind a minimal interface ───────────────────
   Tests inject a fake factory; production spawns real ffmpeg. */

export interface MediaProcess {
  write(chunk: Buffer): Promise<void>;
  /** Close input and wait for exit (bounded); resolves the exit code. */
  finish(): Promise<number | null>;
  kill(): void;
}

export type MediaProcessFactory = (args: {
  playlistPath: string;
  segmentPattern: string;
  initName: string;
  hlsTimeSec: number;
  listSize: number;
}) => MediaProcess;

const FFMPEG_FINISH_TIMEOUT_MS = 15_000;

export const defaultMediaProcessFactory: MediaProcessFactory = (args) => {
  const child: ChildProcess = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel", "warning",
      "-i", "pipe:0",
      "-map", "0",
      "-c", "copy",
      "-f", "hls",
      "-hls_time", String(args.hlsTimeSec),
      "-hls_list_size", String(args.listSize),
      "-hls_segment_type", "fmp4",
      "-hls_fmp4_init_filename", args.initName,
      "-hls_flags", "delete_segments+append_list+omit_endlist+independent_segments",
      "-hls_segment_filename", args.segmentPattern,
      args.playlistPath,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderrTail = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });
  const closed = new Promise<number | null>((resolve) => {
    child.once("error", () => resolve(null));
    child.once("close", (code) => resolve(code));
  });
  return {
    write(chunk: Buffer): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!child.stdin || child.stdin.destroyed || child.exitCode !== null) {
          reject(new Error("ffmpeg is not accepting input"));
          return;
        }
        const ok = child.stdin.write(chunk, (err) => (err ? reject(err) : resolve()));
        if (!ok) child.stdin.once("drain", () => resolve());
      });
    },
    async finish(): Promise<number | null> {
      try {
        child.stdin?.end();
      } catch {
        /* already closed */
      }
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve(null);
        }, FFMPEG_FINISH_TIMEOUT_MS).unref?.(),
      );
      const code = await Promise.race([closed, timeout]);
      if (code !== 0 && code !== null) {
        logger.warn({ code, stderr: stderrTail.slice(-500) }, "own-server-live: ffmpeg exited non-zero");
      }
      return code;
    },
    kill(): void {
      child.kill("SIGKILL");
    },
  };
};

/* ── Upload (the recording's trip to permanent storage) ────────────────── */

export type LiveUploadFn = (
  key: string,
  body: fs.ReadStream,
  contentType: string,
) => Promise<string>;

const defaultUpload: LiveUploadFn = async (key, body, contentType) => r2Upload(key, body, contentType);

/* ── Sessions ──────────────────────────────────────────────────────────── */

export type StallReason = "stalled" | "no_signal" | "duration" | "full";

export interface OwnServerHandlers {
  onStall?: (streamId: string, reason: StallReason) => void;
}

export class LiveIngestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LiveIngestError";
    this.code = code; // NO_SESSION | SESSION_ENDED | SESSION_FULL | UNSUPPORTED_MIME
  }
}

type SessionState = "waiting" | "live" | "ending" | "ended";

interface Session {
  streamId: string;
  dir: string;
  liveDir: string;
  state: SessionState;
  startedAt: number;
  lastChunkAt: number;
  lastSeq: number;
  bytes: number;
  chunks: number;
  mime: string | null;
  ext: string | null;
  rawPath: string | null;
  rawStream: fs.WriteStream | null;
  proc: MediaProcess | null;
  procFailed: boolean;
  chain: Promise<void>;
  stallNotified: boolean;
  endedAt: number | null;
}

interface EngineDeps {
  processFactory: MediaProcessFactory;
  upload: LiveUploadFn;
  now: () => number;
}

const deps: EngineDeps = {
  processFactory: defaultMediaProcessFactory,
  upload: defaultUpload,
  now: () => Date.now(),
};

const handlers: OwnServerHandlers = {};
const sessions = new Map<string, Session>();
let watchdog: NodeJS.Timeout | null = null;

/** Routes wire their lifecycle handler here once at module load. */
export function initOwnServerLive(h: OwnServerHandlers): void {
  handlers.onStall = h.onStall;
}

/** Test seam: swap the process factory / uploader / clock. */
export function __setOwnServerDeps(partial: Partial<EngineDeps>): void {
  Object.assign(deps, partial);
}

export function activeSessionCount(): number {
  let n = 0;
  for (const s of sessions.values()) {
    if (s.state === "waiting" || s.state === "live" || s.state === "ending") n++;
  }
  return n;
}

export function hasSession(streamId: string): boolean {
  const s = sessions.get(streamId);
  return !!s && s.state !== "ended";
}

export function getSession(streamId: string): Readonly<Session> | null {
  return sessions.get(streamId) ?? null;
}

function sessionPaths(cfg: OwnServerConfig, streamId: string): { dir: string; liveDir: string } {
  const dir = path.join(cfg.dir, streamId);
  return { dir, liveDir: path.join(dir, "live") };
}

export function beginSession(streamId: string): { ok: boolean; code?: "CAPACITY" } {
  const cfg = ownServerConfig();
  if (sessions.has(streamId)) return { ok: true };
  if (activeSessionCount() >= cfg.maxConcurrent) return { ok: false, code: "CAPACITY" };
  const { dir, liveDir } = sessionPaths(cfg, streamId);
  fs.mkdirSync(liveDir, { recursive: true });
  sessions.set(streamId, {
    streamId,
    dir,
    liveDir,
    state: "waiting",
    startedAt: deps.now(),
    lastChunkAt: 0,
    lastSeq: -1,
    bytes: 0,
    chunks: 0,
    mime: null,
    ext: null,
    rawPath: null,
    rawStream: null,
    proc: null,
    procFailed: false,
    chain: Promise.resolve(),
    stallNotified: false,
    endedAt: null,
  });
  ensureWatchdog(cfg);
  return { ok: true };
}

/** The recording container for a recorder mime type. Null = unsupported. */
export function extForMime(mime: string): string | null {
  const m = mime.toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("webm")) return "webm";
  return null;
}

function startPipeline(s: Session, cfg: OwnServerConfig): void {
  s.rawPath = path.join(s.dir, `raw.${s.ext}`);
  s.rawStream = fs.createWriteStream(s.rawPath, { flags: "w" });
  s.rawStream.on("error", (err) => {
    logger.error({ err, streamId: s.streamId }, "own-server-live: raw write failed");
    s.procFailed = true;
  });
  s.proc = deps.processFactory({
    playlistPath: path.join(s.liveDir, "playlist.m3u8"),
    segmentPattern: path.join(s.liveDir, "seg%05d.m4s"),
    initName: "init.mp4",
    hlsTimeSec: cfg.hlsTimeSec,
    listSize: 10,
  });
}

function writeThrough(s: Session, data: Buffer): Promise<void> {
  const raw = s.rawStream;
  const proc = s.proc;
  const jobs: Array<Promise<unknown>> = [];
  if (raw) {
    jobs.push(
      new Promise<void>((resolve, reject) => {
        const ok = raw.write(data, (err) => (err ? reject(err) : resolve()));
        if (!ok) raw.once("drain", () => resolve());
      }),
    );
  }
  if (proc && !s.procFailed) {
    jobs.push(
      proc.write(data).catch((err) => {
        // A dead remuxer must not kill the recording: the raw master is
        // still accumulating and becomes the replay.
        logger.warn({ err, streamId: s.streamId }, "own-server-live: remuxer write failed");
        s.procFailed = true;
      }),
    );
  }
  return Promise.all(jobs).then(() => undefined);
}

/**
 * Accept one recorder chunk. Chunks are one continuous byte stream, so
 * writes serialize per session; a re-sent seq (client retry) is a no-op.
 */
export async function acceptChunk(
  streamId: string,
  seq: number,
  data: Buffer,
  contentType: string,
): Promise<{ duplicate: boolean }> {
  const cfg = ownServerConfig();
  const s = sessions.get(streamId);
  if (!s || s.state === "ended" || s.state === "ending") {
    throw new LiveIngestError("NO_SESSION", "This stream isn't accepting video right now.");
  }
  if (seq <= s.lastSeq) return { duplicate: true };
  if (s.bytes + data.length > cfg.maxSessionBytes) {
    throw new LiveIngestError("SESSION_FULL", "This stream reached its size limit and is wrapping up.");
  }
  const job = s.chain.then(async () => {
    if (s.chunks === 0) {
      const ext = extForMime(contentType);
      if (!ext) {
        throw new LiveIngestError(
          "UNSUPPORTED_MIME",
          "This browser's recording format can't be carried — try Chrome or Safari.",
        );
      }
      s.mime = contentType;
      s.ext = ext;
      startPipeline(s, cfg);
    }
    if (seq > s.lastSeq + 1 && s.lastSeq >= 0) {
      logger.warn({ streamId, expected: s.lastSeq + 1, got: seq }, "own-server-live: chunk sequence gap");
    }
    await writeThrough(s, data);
    s.lastSeq = seq;
    s.bytes += data.length;
    s.chunks += 1;
    s.lastChunkAt = deps.now();
    s.state = "live";
  });
  // Keep the chain alive across a failed chunk; the caller still sees it.
  s.chain = job.catch(() => undefined);
  await job;
  return { duplicate: false };
}

/** Stop ingest, finish the remux, keep files for the retention window. */
export async function endSession(streamId: string): Promise<void> {
  const s = sessions.get(streamId);
  if (!s || s.state === "ended" || s.state === "ending") return;
  s.state = "ending";
  await s.chain.catch(() => undefined);
  if (s.rawStream) {
    await new Promise<void>((resolve) => {
      s.rawStream!.end(() => resolve());
    });
    s.rawStream = null;
  }
  if (s.proc) {
    await s.proc.finish().catch(() => null);
    s.proc = null;
  }
  s.state = "ended";
  s.endedAt = deps.now();
}

/**
 * Upload the raw master to permanent storage under the owner's live
 * prefix (the same prefix the /vod endpoint polices). Returns the public
 * URL, or null when there is nothing usable or storage isn't configured —
 * callers record that honestly as "not saved", never as a fake success.
 */
export async function finalizeRecording(
  streamId: string,
  userId: string,
): Promise<{ vodUrl: string; contentType: string } | null> {
  const s = sessions.get(streamId);
  if (!s || !s.rawPath || s.bytes === 0 || !s.ext) return null;
  if (!isR2Configured()) {
    logger.warn({ streamId }, "own-server-live: storage not configured — recording kept only on disk");
    return null;
  }
  const key = `${userId}/live/${streamId}.${s.ext}`;
  const contentType = s.ext === "mp4" ? "video/mp4" : "video/webm";
  const url = await deps.upload(key, fs.createReadStream(s.rawPath), contentType);
  return { vodUrl: url, contentType };
}

/* ── HLS file serving ──────────────────────────────────────────────────── */

const LIVE_FILE_RE = /^(playlist\.m3u8|init\.mp4|seg\d{1,6}\.m4s)$/;

export function isLiveFileName(name: string): boolean {
  return LIVE_FILE_RE.test(name);
}

/** Absolute path of a servable live file, or null (bad name / missing). */
export function liveFilePath(streamId: string, name: string): string | null {
  if (!isLiveFileName(name)) return null;
  const s = sessions.get(streamId);
  if (!s) return null;
  const p = path.join(s.liveDir, name);
  return fs.existsSync(p) ? p : null;
}

export function liveFileContentType(name: string): string {
  if (name.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (name.endsWith(".mp4")) return "video/mp4";
  return "video/iso.segment";
}

/* ── Watchdog: stalls, duration cap, retention cleanup, orphan sweep ───── */

function notifyStall(s: Session, reason: StallReason): void {
  if (s.stallNotified) return;
  s.stallNotified = true;
  logger.warn({ streamId: s.streamId, reason }, "own-server-live: session stalled");
  try {
    handlers.onStall?.(s.streamId, reason);
  } catch (err) {
    logger.error({ err, streamId: s.streamId }, "own-server-live: stall handler failed");
  }
}

function tickWatchdog(cfg: OwnServerConfig): void {
  const now = deps.now();
  for (const s of [...sessions.values()]) {
    if (s.state === "waiting" && now - s.startedAt > cfg.firstChunkGraceMs) {
      notifyStall(s, "no_signal");
    } else if (s.state === "live" && now - s.lastChunkAt > cfg.stallMs) {
      notifyStall(s, "stalled");
    }
    if ((s.state === "waiting" || s.state === "live") && now - s.startedAt > cfg.maxDurationMs) {
      notifyStall(s, "duration");
    }
    if (s.state === "ended" && s.endedAt !== null && now - s.endedAt > cfg.retainMs) {
      sessions.delete(s.streamId);
      fsp.rm(s.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function ensureWatchdog(cfg: OwnServerConfig): void {
  if (watchdog) return;
  // A previous process life may have left session dirs behind (deploys
  // restart the box mid-stream). Anything older than the retain window
  // with no live session is debris — remove it once at startup.
  fsp
    .readdir(cfg.dir)
    .then(async (entries) => {
      for (const entry of entries) {
        if (sessions.has(entry)) continue;
        const p = path.join(cfg.dir, entry);
        const stat = await fsp.stat(p).catch(() => null);
        if (stat && stat.isDirectory() && deps.now() - stat.mtimeMs > cfg.retainMs) {
          await fsp.rm(p, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    })
    .catch(() => undefined);
  watchdog = setInterval(() => {
    try {
      tickWatchdog(ownServerConfig());
    } catch (err) {
      logger.error({ err }, "own-server-live: watchdog tick failed");
    }
  }, 5_000);
  watchdog.unref?.();
}

/** Test seam: full reset (kills processes, drops sessions + files). */
export async function __resetOwnServerLive(): Promise<void> {
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
  const cfg = ownServerConfig();
  for (const s of sessions.values()) {
    try {
      s.proc?.kill();
    } catch {
      /* ignore */
    }
    s.rawStream?.destroy();
  }
  sessions.clear();
  handlers.onStall = undefined;
  deps.processFactory = defaultMediaProcessFactory;
  deps.upload = defaultUpload;
  deps.now = () => Date.now();
  await fsp.rm(cfg.dir, { recursive: true, force: true }).catch(() => undefined);
}
