import net from "node:net";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, liveIngestKeysTable, type LiveIngestKey } from "@workspace/db";
import { acceptChunk, LiveIngestError } from "./own-server-live";
import { logger } from "./logger";
import {
  RTMP_MSG,
  RtmpChunkParser,
  amfDecodeAll,
  buildHandshakeResponse,
  commandMessage,
  flvHeader,
  flvScriptData,
  flvTag,
  setChunkSizeMessage,
  setPeerBandwidthMessage,
  streamBeginMessage,
  streamEofMessage,
  userControlMessage,
  windowAckSizeMessage,
  OUTBOUND_CHUNK_SIZE,
  HANDSHAKE_BYTES,
  type RtmpMessage,
} from "./rtmp-protocol";

/* ── RTMP stream-key ingest for Go Live (migration 0194) ──────────────
   The fan-out rails push RTMP OUT to a creator's other platforms;
   this is the door IN. A creator gets ONE personal stream key; an
   external encoder (OBS, VirtualDJ, Serato, djay — everything in the
   DJ/creator world speaks RTMP) pushes to the ingest endpoint with
   that key and becomes a first-class Go Live source: the publish
   creates the same live_streams row (provider 'own-server',
   ingest_source 'rtmp'), the FLV byte stream feeds the same media
   engine sessions the browser studio feeds, and playback (HLS),
   chat, fan-out, replay finalize are the site's existing rails,
   unchanged.

   PASSTHROUGH GRADE, by design and stated in the UI: the shared box
   never re-encodes. The encoder's single rendition is the rendition
   viewers get — no transcoding ladder. The engine's remux is -c copy
   end to end; the only extra step is a copy-remux of the FLV master
   to MP4 when the stream ends so the replay can play in a browser.

   Keys are secrets, stored HASHED only: the table holds a one-way
   SHA-256 of the key plus its last-4 hint — the plain key itself is
   never stored, so a database read yields no working key. The plain
   key is shown to the owner exactly once, in the owner-authenticated
   response that creates or regenerates it; after that it cannot be
   shown again (a lost key is replaced by regenerating), and it never
   appears in any stream DTO. Publish auth resolves by the lookup
   hash, and revocation is checked on every publish AND drops a live
   encoder connection for that creator the moment it lands.

   The row lifecycle (create row / end row / fan-out trigger) belongs
   to the routes layer, which registers it via initRtmpIngest — the
   same pattern as initOwnServerLive. This module never imports a
   route. */

export interface RtmpIngestConfig {
  /** Encoder ingest is OPT-IN per deployment: open only when ops set
   *  LIVE_RTMP_INGEST=on. The RTMP door is a raw-TCP port, and not
   *  every host routes one — on Render only HTTP is routed, so the
   *  port is unreachable there no matter what the app does. The
   *  honest default is therefore CLOSED: the panel says the door
   *  isn't open yet and the mint endpoints refuse, until the owner
   *  flips the flag on a host that actually carries the port. */
  enabled: boolean;
  port: number;
  app: string;
  /** The public ingest base URL shown to creators (env-set). */
  publicUrl: string | null;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function rtmpIngestConfig(env: NodeJS.ProcessEnv = process.env): RtmpIngestConfig {
  return {
    enabled: env["LIVE_RTMP_INGEST"]?.trim().toLowerCase() === "on",
    port: intEnv(env, "LIVE_RTMP_PORT", 1935),
    app: env["LIVE_RTMP_APP"]?.trim() || "live",
    publicUrl: env["LIVE_RTMP_PUBLIC_URL"]?.trim() || null,
  };
}

/** The ingest URL creators paste into their encoder: the explicit
 *  env URL when ops set one, else derived from the site's public
 *  origin (same host, rtmp scheme, the configured app path). */
export function ingestUrlFor(env: NodeJS.ProcessEnv = process.env): string | null {
  const cfg = rtmpIngestConfig(env);
  if (cfg.publicUrl) return cfg.publicUrl;
  const site = env["PUBLIC_SITE_URL"] ?? env["SITE_URL"];
  if (!site) return null;
  try {
    return `rtmp://${new URL(site).host}/${cfg.app}`;
  } catch {
    return null;
  }
}

/* ══ Stream keys ═════════════════════════════════════════════════════ */

const KEY_PREFIX = "bdv_";

export function generateStreamKey(): string {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function hashStreamKey(plainKey: string): string {
  return createHash("sha256").update(plainKey.trim(), "utf8").digest("hex");
}

export function keyHintOf(plainKey: string): string {
  return plainKey.slice(-4);
}

export async function getIngestKeyRow(userId: string): Promise<LiveIngestKey | null> {
  const rows = await db
    .select()
    .from(liveIngestKeysTable)
    .where(eq(liveIngestKeysTable.user_id, userId))
    .limit(1);
  return rows[0] ?? null;
}

async function insertIngestKey(userId: string, profileId: string): Promise<{ row: LiveIngestKey; plainKey: string }> {
  const plainKey = generateStreamKey();
  const inserted = await db
    .insert(liveIngestKeysTable)
    .values({
      user_id: userId,
      profile_id: profileId,
      key_lookup: hashStreamKey(plainKey),
      key_hint: keyHintOf(plainKey),
    })
    .returning();
  return { row: inserted[0]!, plainKey };
}

/** The owner's key, created on first ask. Storage is hash-only, so
 *  the plain key can be handed back ONLY by the call that mints it:
 *  when a live key already exists, plainKey is null — the key cannot
 *  be shown again, and the owner's path forward is regenerate (the
 *  panel says exactly that). A revoked key is NOT resurrected —
 *  asking again after a revoke mints a fresh key (the old one stays
 *  dead), which is the only sane read of "reveal" on a row whose key
 *  the owner deliberately killed. */
export async function getOrCreateIngestKey(
  userId: string,
  profileId: string,
): Promise<{ row: LiveIngestKey; plainKey: string | null }> {
  const existing = await getIngestKeyRow(userId);
  if (existing && !existing.revoked_at) {
    return { row: existing, plainKey: null };
  }
  if (existing) {
    return regenerateIngestKey(userId, profileId);
  }
  return insertIngestKey(userId, profileId);
}

export async function regenerateIngestKey(
  userId: string,
  profileId: string,
): Promise<{ row: LiveIngestKey; plainKey: string }> {
  const plainKey = generateStreamKey();
  const patch = {
    profile_id: profileId,
    key_lookup: hashStreamKey(plainKey),
    key_hint: keyHintOf(plainKey),
    revoked_at: null,
    updated_at: new Date(),
  };
  const existing = await getIngestKeyRow(userId);
  if (!existing) return insertIngestKey(userId, profileId);
  const updated = await db
    .update(liveIngestKeysTable)
    .set(patch)
    .where(eq(liveIngestKeysTable.user_id, userId))
    .returning();
  return { row: updated[0]!, plainKey };
}

/** Revoke: the key dies in the table (every future publish is
 *  refused) and any live encoder connection for this creator is
 *  dropped by the caller via dropIngestConnectionsForUser — the
 *  routes layer calls both, in that order. */
export async function revokeIngestKey(userId: string): Promise<LiveIngestKey | null> {
  const updated = await db
    .update(liveIngestKeysTable)
    .set({ revoked_at: new Date(), updated_at: new Date() })
    .where(eq(liveIngestKeysTable.user_id, userId))
    .returning();
  return updated[0] ?? null;
}

export async function setIngestStreamTitle(userId: string, title: string | null): Promise<LiveIngestKey | null> {
  const updated = await db
    .update(liveIngestKeysTable)
    .set({ stream_title: title, updated_at: new Date() })
    .where(eq(liveIngestKeysTable.user_id, userId))
    .returning();
  return updated[0] ?? null;
}

export interface ResolvedIngestKey {
  userId: string;
  profileId: string;
  streamTitle: string | null;
}

/** Publish-path authentication. Resolves a presented key to its
 *  creator, or null: unknown, malformed, or revoked — the encoder
 *  learns only "refused", never which. The presented key's hash is
 *  compared against the stored lookup hash in constant time; the
 *  plain key is never stored, so there is nothing else to compare. */
export async function resolveIngestKey(presented: string): Promise<ResolvedIngestKey | null> {
  const candidate = presented.trim();
  if (!candidate || candidate.length > 200) return null;
  const presentedHash = hashStreamKey(candidate);
  const rows = await db
    .select()
    .from(liveIngestKeysTable)
    .where(eq(liveIngestKeysTable.key_lookup, presentedHash))
    .limit(1);
  const row = rows[0];
  if (!row || row.revoked_at) return null;
  const a = Buffer.from(row.key_lookup, "utf8");
  const b = Buffer.from(presentedHash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { userId: row.user_id, profileId: row.profile_id, streamTitle: row.stream_title };
}

/* ══ Row-lifecycle host (registered by the routes layer) ═════════════ */

export interface RtmpIngestHost {
  /** Create the live row + engine session for an accepted publish. */
  startStream(input: {
    userId: string;
    profileId: string;
    title: string | null;
  }): Promise<{ ok: true; streamId: string } | { ok: false; message: string }>;
  /** The publish carried its first real media — fan-out may start. */
  firstMedia(streamId: string): void;
  /** The encoder disconnected / unpublished: end the row + finalize. */
  endStream(streamId: string): Promise<void>;
}

let host: RtmpIngestHost | null = null;

export function initRtmpIngest(h: RtmpIngestHost): void {
  host = h;
}

/* ══ Live connections (revocation drops, one publish per creator) ════ */

interface LiveConnection {
  userId: string;
  streamId: string;
  terminate: () => void;
}

const liveConnections = new Map<string, LiveConnection>();

/** Drop a creator's live encoder connection (key revoked/regenerated).
 *  The connection's own close path ends the stream row + finalizes. */
export function dropIngestConnectionsForUser(userId: string): boolean {
  const conn = liveConnections.get(userId);
  if (!conn) return false;
  conn.terminate();
  return true;
}

export function activeIngestUserIds(): string[] {
  return [...liveConnections.keys()];
}

/* ══ Publish connection ══════════════════════════════════════════════ */

export interface RtmpSocket {
  write(data: Buffer): boolean;
  destroy(): void;
  pause(): void;
  resume(): void;
  on(event: "data", cb: (data: Buffer) => void): unknown;
  on(event: "close", cb: () => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  setTimeout?: (ms: number, cb: () => void) => unknown;
}

export interface RtmpIngestDeps {
  resolveKey: (presented: string) => Promise<ResolvedIngestKey | null>;
  host: RtmpIngestHost;
  feedChunk: typeof acceptChunk;
  app: string;
}

const FLUSH_BYTES = 256 * 1024;
const FLUSH_INTERVAL_MS = 750;
const PAUSE_ABOVE_BYTES = 8 * 1024 * 1024;
const RESUME_BELOW_BYTES = 2 * 1024 * 1024;

type Phase = "hs1" | "hs2" | "established";

export class RtmpPublishConnection {
  private phase: Phase = "hs1";
  private hsBuffer: Buffer = Buffer.alloc(0);
  private parser: RtmpChunkParser;
  private closed = false;

  private app = "";
  private publish: {
    userId: string;
    streamId: string;
    streamName: string;
    messageStreamId: number;
    seq: number;
    pending: Buffer[];
    pendingBytes: number;
    queuedFlushBytes: number;
    flushChain: Promise<void>;
    flushTimer: NodeJS.Timeout | null;
    firstMediaFired: boolean;
    ended: boolean;
  } | null = null;
  private publishPending = false;

  constructor(
    private readonly socket: RtmpSocket,
    private readonly deps: RtmpIngestDeps,
  ) {
    this.parser = new RtmpChunkParser((msg) => this.onMessage(msg));
    socket.on("data", (data) => this.onData(data));
    socket.on("close", () => void this.onClose());
    socket.on("error", (err) => {
      logger.warn({ err: err.message }, "rtmp-ingest: socket error");
      void this.onClose();
    });
    socket.setTimeout?.(90_000, () => {
      logger.info({}, "rtmp-ingest: idle connection timed out");
      this.terminate();
    });
  }

  terminate(): void {
    try {
      this.socket.destroy();
    } catch {
      /* already gone */
    }
    void this.onClose();
  }

  /* ── Handshake + byte routing ─────────────────────────────────── */

  private onData(data: Buffer): void {
    if (this.closed) return;
    try {
      if (this.phase === "established") {
        this.parser.feed(data);
        return;
      }
      this.hsBuffer = this.hsBuffer.length === 0 ? data : Buffer.concat([this.hsBuffer, data]);
      if (this.phase === "hs1") {
        if (this.hsBuffer.length < 1 + HANDSHAKE_BYTES) return;
        const c1 = this.hsBuffer.subarray(1, 1 + HANDSHAKE_BYTES);
        this.socket.write(buildHandshakeResponse(Buffer.from(c1)));
        this.hsBuffer = this.hsBuffer.subarray(1 + HANDSHAKE_BYTES);
        this.phase = "hs2";
      }
      if (this.phase === "hs2") {
        if (this.hsBuffer.length < HANDSHAKE_BYTES) return;
        const rest = this.hsBuffer.subarray(HANDSHAKE_BYTES);
        this.hsBuffer = Buffer.alloc(0);
        this.phase = "established";
        if (rest.length > 0) this.parser.feed(Buffer.from(rest));
      }
    } catch (err) {
      logger.warn({ err }, "rtmp-ingest: protocol error — dropping connection");
      this.terminate();
    }
  }

  /* ── Message dispatch ───────────────────────────────────────────── */

  private onMessage(msg: RtmpMessage): void {
    switch (msg.typeId) {
      case RTMP_MSG.COMMAND_AMF0:
        this.onCommand(msg.payload, msg.messageStreamId);
        return;
      case RTMP_MSG.COMMAND_AMF3: {
        // AMF3 command messages open with a 0x00 "use AMF0" marker.
        const payload = msg.payload.length > 0 && msg.payload[0] === 0 ? msg.payload.subarray(1) : msg.payload;
        this.onCommand(payload, msg.messageStreamId);
        return;
      }
      case RTMP_MSG.AUDIO:
      case RTMP_MSG.VIDEO:
        this.onMedia(msg.typeId, msg.timestamp, msg.payload);
        return;
      case RTMP_MSG.DATA_AMF0:
        if (this.publish) {
          this.pushFlv(flvTag(18, msg.timestamp, flvScriptData(msg.payload)));
        }
        return;
      case RTMP_MSG.USER_CONTROL: {
        // Ping request (event 6) → ping response (event 7), same body.
        if (msg.payload.length >= 6 && msg.payload.readUInt16BE(0) === 6) {
          this.socket.write(userControlMessage(7, msg.payload.readUInt32BE(2)));
        }
        return;
      }
      default:
        // Set Chunk Size is consumed by the parser itself; acks,
        // bandwidth notices, shared objects and aggregates need no
        // answer from a receive-only stage.
        return;
    }
  }

  private onCommand(payload: Buffer, messageStreamId: number): void {
    let values;
    try {
      values = amfDecodeAll(payload);
    } catch {
      logger.warn({}, "rtmp-ingest: undecodable command payload");
      return;
    }
    const name = typeof values[0] === "string" ? values[0] : "";
    const txn = typeof values[1] === "number" ? values[1] : 0;

    switch (name) {
      case "connect": {
        const cmdObj = (values[2] ?? {}) as Record<string, unknown>;
        const rawApp = typeof cmdObj["app"] === "string" ? cmdObj["app"] : "";
        this.app = rawApp.replace(/^\/+/, "").split("/")[0]!.split("?")[0]!;
        const out = Buffer.concat([
          windowAckSizeMessage(5_000_000),
          setPeerBandwidthMessage(5_000_000, 0),
          setChunkSizeMessage(OUTBOUND_CHUNK_SIZE),
          commandMessage(0, [
            "_result",
            txn,
            { fmsVer: "FMS/3,5,7,7009", capabilities: 31 },
            {
              level: "status",
              code: "NetConnection.Connect.Success",
              description: "Connection succeeded.",
              data: { version: "3,5,7,7009" },
            },
          ]),
        ]);
        this.socket.write(out);
        return;
      }
      case "createStream": {
        this.socket.write(commandMessage(0, ["_result", txn, null, 1]));
        return;
      }
      case "publish": {
        const rawName = typeof values[3] === "string" ? values[3] : "";
        void this.beginPublish(rawName, messageStreamId);
        return;
      }
      case "deleteStream":
      case "closeStream":
      case "FCUnpublish":
      case "fcUnpublish": {
        void this.endPublish();
        return;
      }
      case "play": {
        this.socket.write(
          commandMessage(messageStreamId, [
            "onStatus",
            0,
            null,
            {
              level: "error",
              code: "NetStream.Play.Failed",
              description: "This stage only receives broadcasts — watching happens on the site.",
            },
          ]),
        );
        return;
      }
      default: {
        // releaseStream / FCPublish / FCSubscribe and friends expect
        // at most a null result; answer only real transactions.
        if (txn > 0 && name) {
          this.socket.write(commandMessage(messageStreamId, ["_result", txn, null, null]));
        }
        return;
      }
    }
  }

  /* ── Publish lifecycle ──────────────────────────────────────────── */

  private async beginPublish(rawName: string, messageStreamId: number): Promise<void> {
    if (this.publish || this.publishPending) {
      this.publishStatus(messageStreamId, "error", "NetStream.Publish.AlreadyPublishing", "This connection is already publishing.");
      return;
    }
    // The stream name IS the key (OBS "Stream Key" field). Encoders
    // that append a path or query get normalized the same forgiving
    // way: last path segment, no query string.
    const cleaned = rawName.trim().replace(/^\/+/, "");
    const presented = (cleaned.split("/").pop() ?? "").split("?")[0]!;
    if (this.app && this.deps.app && this.app !== this.deps.app) {
      this.publishStatus(messageStreamId, "error", "NetStream.Publish.BadName", "That ingest address isn't this stage's — check the stream URL from your Go Live panel.");
      this.terminateSoon();
      return;
    }
    this.publishPending = true;
    try {
      const resolved = await this.deps.resolveKey(presented);
      if (!resolved) {
        this.publishStatus(messageStreamId, "error", "NetStream.Publish.BadName", "That stream key isn't recognized.");
        this.terminateSoon();
        return;
      }
      if (liveConnections.has(resolved.userId)) {
        this.publishStatus(messageStreamId, "error", "NetStream.Publish.AlreadyPublishing", "Another program is already streaming with this key.");
        this.terminateSoon();
        return;
      }
      const started = await this.deps.host.startStream({
        userId: resolved.userId,
        profileId: resolved.profileId,
        title: resolved.streamTitle,
      });
      if (!started.ok) {
        this.publishStatus(messageStreamId, "error", "NetStream.Publish.Failed", started.message);
        this.terminateSoon();
        return;
      }
      if (this.closed) {
        // The encoder hung up while the stage was being set up — end
        // the just-created stream instead of leaking a live row.
        await this.deps.host.endStream(started.streamId).catch(() => undefined);
        return;
      }
      const header = flvHeader();
      this.publish = {
        userId: resolved.userId,
        streamId: started.streamId,
        streamName: presented,
        messageStreamId,
        seq: 0,
        pending: [header],
        pendingBytes: header.length,
        queuedFlushBytes: 0,
        flushChain: Promise.resolve(),
        flushTimer: null,
        firstMediaFired: false,
        ended: false,
      };
      liveConnections.set(resolved.userId, {
        userId: resolved.userId,
        streamId: started.streamId,
        terminate: () => this.terminate(),
      });
      this.publish.flushTimer = setInterval(() => this.queueFlush(), FLUSH_INTERVAL_MS);
      this.publish.flushTimer.unref?.();
      // Stream Begin, then Publish.Start — the order OBS/ffmpeg
      // expect to consider the publish live.
      this.socket.write(streamBeginMessage(messageStreamId));
      this.publishStatus(messageStreamId, "status", "NetStream.Publish.Start", "Started publishing.");
      logger.info({ streamId: started.streamId }, "rtmp-ingest: publish started");
    } catch (err) {
      logger.error({ err }, "rtmp-ingest: publish setup failed");
      this.publishStatus(messageStreamId, "error", "NetStream.Publish.Failed", "The stage couldn't start this stream.");
      this.terminateSoon();
    } finally {
      this.publishPending = false;
    }
  }

  private publishStatus(streamId: number, level: string, code: string, description: string): void {
    try {
      this.socket.write(
        commandMessage(streamId, [
          "onStatus",
          0,
          null,
          { level, code, description, clientid: 1 },
        ]),
      );
    } catch {
      /* socket already gone */
    }
  }

  /** Refusals get a beat to reach the encoder's log before the drop. */
  private terminateSoon(): void {
    setTimeout(() => this.terminate(), 250).unref?.();
  }

  private onMedia(typeId: number, timestamp: number, payload: Buffer): void {
    if (!this.publish) return; // pre-publish media is not a thing — drop
    this.pushFlv(flvTag(typeId, timestamp, payload));
  }

  private pushFlv(tag: Buffer): void {
    const p = this.publish;
    if (!p || p.ended) return;
    p.pending.push(tag);
    p.pendingBytes += tag.length;
    if (p.pendingBytes >= FLUSH_BYTES) this.queueFlush();
  }

  private queueFlush(force = false): void {
    const p = this.publish;
    if (!p || p.pendingBytes === 0) return;
    if (p.ended && !force) return;
    const buf = Buffer.concat(p.pending, p.pendingBytes);
    p.pending = [];
    p.pendingBytes = 0;
    const seq = p.seq;
    p.seq += 1;
    p.queuedFlushBytes += buf.length;
    if (p.queuedFlushBytes > PAUSE_ABOVE_BYTES) {
      try {
        this.socket.pause();
      } catch {
        /* fake sockets may not pause */
      }
    }
    p.flushChain = p.flushChain
      .then(async () => {
        try {
          await this.deps.feedChunk(p.streamId, seq, buf, "video/x-flv");
          if (!p.firstMediaFired) {
            p.firstMediaFired = true;
            try {
              this.deps.host.firstMedia(p.streamId);
            } catch (err) {
              logger.warn({ err, streamId: p.streamId }, "rtmp-ingest: first-media hook failed");
            }
          }
        } catch (err) {
          if (
            err instanceof LiveIngestError &&
            (err.code === "NO_SESSION" || err.code === "SESSION_ENDED" || err.code === "SESSION_FULL")
          ) {
            // The stream ended under the encoder (creator hit End in
            // the studio, hit a cap, or the key was revoked): stop
            // accepting — the encoder's reconnect starts a new show.
            logger.info({ streamId: p.streamId, code: err.code }, "rtmp-ingest: stage ended under encoder — disconnecting");
            this.terminate();
          } else {
            logger.warn({ err, streamId: p.streamId }, "rtmp-ingest: media chunk refused");
          }
        }
      })
      .finally(() => {
        p.queuedFlushBytes -= buf.length;
        if (p.queuedFlushBytes < RESUME_BELOW_BYTES) {
          try {
            this.socket.resume();
          } catch {
            /* ignore */
          }
        }
      });
  }

  private async endPublish(): Promise<void> {
    const p = this.publish;
    if (!p || p.ended) return;
    p.ended = true;
    if (p.flushTimer) clearInterval(p.flushTimer);
    // Final bytes land before the row ends, so finalize sees them all.
    if (p.pendingBytes > 0) this.queueFlush(true);
    await p.flushChain.catch(() => undefined);
    if (liveConnections.get(p.userId)?.streamId === p.streamId) {
      liveConnections.delete(p.userId);
    }
    this.publish = null;
    try {
      this.socket.write(streamEofMessage(p.messageStreamId));
    } catch {
      /* ignore */
    }
    await this.deps.host.endStream(p.streamId).catch((err) => {
      logger.error({ err, streamId: p.streamId }, "rtmp-ingest: end-stream hook failed");
    });
    logger.info({ streamId: p.streamId }, "rtmp-ingest: publish ended");
  }

  private async onClose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.endPublish();
  }
}

/* ══ Server ══════════════════════════════════════════════════════════ */

export function createRtmpIngestServer(deps: RtmpIngestDeps): net.Server {
  return net.createServer((socket) => {
    socket.setNoDelay(true);
    new RtmpPublishConnection(socket as unknown as RtmpSocket, deps);
  });
}

let runningServer: net.Server | null = null;

/** Boot entry (index.ts, after the HTTP listener is up). Inert unless
 *  LIVE_RTMP_INGEST=on or the routes layer hasn't registered its
 *  host hooks — never a half-configured listener. */
export function startRtmpIngestServer(env: NodeJS.ProcessEnv = process.env): net.Server | null {
  const cfg = rtmpIngestConfig(env);
  if (!cfg.enabled) {
    logger.info({}, "rtmp-ingest: door closed — LIVE_RTMP_INGEST is not 'on' for this deployment");
    return null;
  }
  if (!host) {
    logger.warn({}, "rtmp-ingest: no host hooks registered — listener not started");
    return null;
  }
  if (runningServer) return runningServer;
  const server = createRtmpIngestServer({
    resolveKey: resolveIngestKey,
    host,
    feedChunk: acceptChunk,
    app: cfg.app,
  });
  server.on("error", (err) => {
    logger.error({ err }, "rtmp-ingest: listener error");
  });
  server.listen(cfg.port, () => {
    logger.info({ port: cfg.port, app: cfg.app }, "rtmp-ingest: listening for encoder publishes");
  });
  runningServer = server;
  return server;
}

/** Test seam: drop hooks, connections, and the running listener. */
export async function __resetRtmpIngest(): Promise<void> {
  host = null;
  for (const conn of liveConnections.values()) {
    try {
      conn.terminate();
    } catch {
      /* ignore */
    }
  }
  liveConnections.clear();
  if (runningServer) {
    const s = runningServer;
    runningServer = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}
