import { spawn, type ChildProcess } from "node:child_process";
import { encryptToken, decryptToken, isSocialTokenKeyConfigured } from "./social-crypto";
import { logger } from "./logger";

/* ── Multistream fan-out (Stack 9 #1) ───────────────────────────────────
   When a stream is live on the OWN-SERVER transport, the media engine
   already holds the program bytes (the raw master being written by
   own-server-live). The relay taps that same byte stream's finished
   file path: an ffmpeg `-c copy` remux from the stream's live HLS /
   raw master to the destination's RTMP ingest.

   CODEC HONESTY (the whole point of relayPlan): `-c copy` into
   RTMP/FLV only works when the source codecs are FLV-carryable —
   H.264 video + AAC/MP3 audio, i.e. an MP4/MediaRecorder-H.264
   session. A WebM session (VP8/VP9 + Opus — what Chrome's
   MediaRecorder produces by default) CANNOT be copy-remuxed to
   RTMP; re-encoding it on the shared 512 MB box is not something
   this code pretends to do. relayPlan says so plainly and the
   destination lands in status 'error' with that reason — the UI
   shows exactly that, never a fake "live".

   Cloudflare-transport streams have no on-box byte stream to tap
   (the media lives at the provider), so fan-out does NOT apply:
   destinations for those streams stay 'pending' with the reason
   recorded, and startFanOut returns that verdict instead of
   spawning anything.

   Stream keys are secrets: protectKey() encrypts at rest when the
   site's token key is configured; the plain key only ever exists in
   memory on its way into the ffmpeg argument list, is never logged
   (relay targets are redacted for logs), and no DTO returns it. */

export interface DestinationKeyMaterial {
  platform: string;
  ingestUrl: string;
  streamKey: string;
}

const ENCRYPTED_PREFIX = "enc:";

/** Encrypt a stream key for storage when the token key is configured.
 *  Without it the key is stored as-is — still server-side only and
 *  never exposed — because refusing to save would break the feature
 *  on installs that haven't set the optional key. */
export function protectKey(plain: string): string {
  if (!isSocialTokenKeyConfigured()) return plain;
  return ENCRYPTED_PREFIX + encryptToken(plain);
}

export function unprotectKey(stored: string): string {
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  return decryptToken(stored.slice(ENCRYPTED_PREFIX.length));
}

/** Join an RTMP ingest base + stream key the way ingest servers expect. */
export function buildRtmpTarget(ingestUrl: string, streamKey: string): string {
  const base = ingestUrl.trim().replace(/\/+$/, "");
  const key = streamKey.trim().replace(/^\/+/, "");
  return key ? `${base}/${key}` : base;
}

/** A target with the key redacted — the only form allowed in logs. */
export function redactRtmpTarget(target: string): string {
  const idx = target.lastIndexOf("/");
  if (idx <= "rtmp://".length) return target;
  return `${target.slice(0, idx + 1)}•••`;
}

export type RelayVerdict =
  | { ok: true; args: string[]; target: string }
  | { ok: false; reason: string; code: "CODEC_UNSUPPORTED" | "NO_SOURCE" | "BAD_INGEST" | "WRONG_TRANSPORT" };

/** Container/codec facts about the own-server session's source. */
export interface RelaySource {
  transport: "own" | "cloudflare";
  /** Session container: 'mp4' | 'webm' | null (no media yet). */
  container: string | null;
  /** Absolute path of the live source ffmpeg should read (the raw
   *  master file the engine is appending, or the live playlist). */
  sourcePath: string | null;
}

export function relayPlan(source: RelaySource, dest: DestinationKeyMaterial): RelayVerdict {
  if (source.transport !== "own") {
    return {
      ok: false,
      code: "WRONG_TRANSPORT",
      reason:
        "Fan-out needs the stream on the site's own stage — this stream runs on the hosted transport, whose feed never passes through this server, so there is nothing here to relay.",
    };
  }
  if (!source.sourcePath || !source.container) {
    return { ok: false, code: "NO_SOURCE", reason: "No video has reached the stage yet — the relay starts once your camera feed does." };
  }
  if (source.container !== "mp4") {
    return {
      ok: false,
      code: "CODEC_UNSUPPORTED",
      reason:
        "This browser recorded in WebM (VP9/Opus), which can't be copied into an RTMP feed without re-encoding — and this server doesn't re-encode live video. Use a browser/recording format that produces MP4 (H.264) to multistream this destination.",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(dest.ingestUrl);
  } catch {
    return { ok: false, code: "BAD_INGEST", reason: "The ingest URL saved for this destination isn't a valid RTMP address." };
  }
  if (parsed.protocol !== "rtmp:" && parsed.protocol !== "rtmps:") {
    return { ok: false, code: "BAD_INGEST", reason: "The ingest URL saved for this destination isn't an RTMP address." };
  }
  if (!dest.streamKey.trim()) {
    return { ok: false, code: "BAD_INGEST", reason: "No stream key is saved for this destination." };
  }
  const target = buildRtmpTarget(dest.ingestUrl, dest.streamKey);
  return {
    ok: true,
    target,
    args: ["-hide_banner", "-loglevel", "warning", "-re", "-i", source.sourcePath, "-c", "copy", "-f", "flv", target],
  };
}

/* ── Relay processes ────────────────────────────────────────────────────
   One ffmpeg per (stream, platform). Tests inject a fake factory;
   production spawns real ffmpeg. Exit before the stream ends is an
   honest 'error' transition via the onExit callback. */

export interface RelayProcess {
  kill(): void;
  onExit(cb: (code: number | null) => void): void;
}
export type RelayProcessFactory = (args: string[]) => RelayProcess;

export const defaultRelayFactory: RelayProcessFactory = (args) => {
  const child: ChildProcess = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  let tail = "";
  child.stderr?.on("data", (d: Buffer) => {
    tail = (tail + d.toString()).slice(-1000);
  });
  return {
    kill: () => child.kill("SIGKILL"),
    onExit: (cb) => {
      child.once("error", () => cb(null));
      child.once("close", (code) => {
        if (code !== 0 && code !== null) {
          // Never log args (they contain the stream key); tail only.
          logger.warn({ code, stderr: tail.slice(-300) }, "multistream: relay ffmpeg exited non-zero");
        }
        cb(code);
      });
    },
  };
};

let factory: RelayProcessFactory = defaultRelayFactory;
export function __setRelayFactory(f: RelayProcessFactory): void {
  factory = f;
}

const relays = new Map<string, RelayProcess>();
const relayKey = (streamId: string, platform: string) => `${streamId}:${platform}`;

export function startRelay(
  streamId: string,
  platform: string,
  args: string[],
  onExit: (code: number | null) => void,
): { started: boolean } {
  const k = relayKey(streamId, platform);
  if (relays.has(k)) return { started: false };
  const proc = factory(args);
  relays.set(k, proc);
  proc.onExit((code) => {
    relays.delete(k);
    onExit(code);
  });
  return { started: true };
}

export function stopRelay(streamId: string, platform: string): boolean {
  const k = relayKey(streamId, platform);
  const proc = relays.get(k);
  if (!proc) return false;
  relays.delete(k);
  proc.kill();
  return true;
}

export function stopAllRelays(streamId: string): number {
  let n = 0;
  for (const k of [...relays.keys()]) {
    if (k.startsWith(`${streamId}:`)) {
      relays.get(k)?.kill();
      relays.delete(k);
      n++;
    }
  }
  return n;
}

export function activeRelayPlatforms(streamId: string): string[] {
  return [...relays.keys()].filter((k) => k.startsWith(`${streamId}:`)).map((k) => k.slice(streamId.length + 1));
}

export function __resetRelays(): void {
  for (const p of relays.values()) p.kill();
  relays.clear();
}
