import express, { Router, type Request, type Response } from "express";
import fs from "node:fs";
import { z } from "zod";
import { eq, and, desc, lt, inArray } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  liveViewerSamplesTable,
  creatorProfilesTable,
  generatedClipsTable,
  type LiveStream,
  type CreatorProfile,
  type LiveIngestKey,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  createLiveInput,
  deleteLiveInput,
  playbackUrlsFromWhip,
  StreamNotConfiguredError,
  StreamProviderError,
} from "../lib/cloudflare-stream";
import { selectedLiveTransport, isLiveTransportReady } from "../lib/live-config";
import { closeBackstage } from "../lib/live-backstage";
import { stopAllRelays } from "../lib/multistream";
import { attemptFanOut } from "../lib/fanout";
import { fanOutGoLiveAlerts } from "../lib/live-alerts";
import {
  initRtmpIngest,
  getIngestKeyRow,
  getOrCreateIngestKey,
  regenerateIngestKey,
  revokeIngestKey,
  setIngestStreamTitle,
  dropIngestConnectionsForUser,
  ingestUrlFor,
  rtmpIngestConfig,
} from "../lib/rtmp-ingest";
import {
  initOwnServerLive,
  beginSession,
  hasSession,
  activeSessionCount,
  ownServerConfig,
  acceptChunk,
  endSession as endOwnServerSession,
  finalizeRecording,
  isLiveFileName,
  liveFilePath,
  liveFileContentType,
  LiveIngestError,
  type StallReason,
} from "../lib/own-server-live";

/* ── Go Live — native on-site broadcasts ───────────────────────────────────
   The stream studio (a tab in the /go-live hub) publishes the creator's
   processed camera feed straight from the browser; viewers watch on
   /live/:id. Sessions live in live_streams (migration 0129) — NOT
   discord_streams, whose rows are schedule/announce records for Discord
   webhook posts.

   The publish transport is selected by env (LIVE_TRANSPORT, see
   lib/live-config) and the studio learns the selection from /status:
   - "own" (default): the site's own service carries the stream — the
     browser POSTs short recording chunks to the ingest endpoint, the
     own-server-live engine remuxes them into a live HLS feed, and the
     same chunk stream becomes the replay. No external keys, no
     per-minute bill; ready unless LIVE_OWN_SERVER=off.
   - "cloudflare": WHIP/WebRTC via Cloudflare Stream (WHEP playback,
     HLS URL as fallback). Credentials (CLOUDFLARE_ACCOUNT_ID /
     CLOUDFLARE_STREAM_TOKEN) arrive via env; until they do, create
     answers an honest 503 STREAM_NOT_CONFIGURED — never a fake success.

   Endpoints:
   GET    /live-streams/status          (auth)  → { configured, transport, live_stream }
   POST   /live-streams                 (auth)  → create session → 201 { stream (owner DTO) }
   POST   /live-streams/:id/end         (auth, owner) → end session (idempotent)
   POST   /live-streams/:id/vod         (auth, owner) → register the browser-recorded VOD
   POST   /live-streams/:id/ingest/segment (auth, owner) → own-server media chunk in
   GET    /live-streams/ingest-key      (auth)  → RTMP ingest key status (never the key)
   POST   /live-streams/ingest-key/reveal (auth) → mints + shows the key ONCE (creates on first ask; an existing key is never re-shown)
   POST   /live-streams/ingest-key/regenerate (auth) → new key; the old one dies at once
   POST   /live-streams/ingest-key/revoke (auth) → key dies + live encoder dropped
   PATCH  /live-streams/ingest-key      (auth)  → standing title for encoder-started streams
   GET    /live-streams/:id/hls/:file   (public) → own-server live playlist/segments
   GET    /live-streams/live            (public) → the "Live now" rail list
   GET    /live-streams/profile/:slug   (public) → that creator's live stream, if any
   GET    /live-streams/:id             (public) → watch-page DTO
   POST   /live-streams/:id/heartbeat   (public) → viewer presence → { viewer_count }

   Going live is FREE at launch: no credit charge exists for
   broadcasting (any running cost is the site's; a streamer charge is an
   owner ruling for later, not something this code invents).

   No status webhook: the provider's live-input notifications are
   configured account-wide in its dashboard and carry no per-stream secret
   we can verify, so lifecycle is driven by our own create/end calls plus
   WHIP session state. A creator who closes the tab mid-stream reconciles
   two ways: the studio resumes/ends via /status, and reads lazily end any
   "live" row older than MAX_LIVE_MS (12h). */

const router = Router();

const MAX_LIVE_MS = 12 * 60 * 60 * 1000;
const VIEWER_TTL_MS = 45_000;

/* ── Viewer presence (in-memory; the API runs as a single instance) ──────
   The watch page heartbeats every ~15s with a random session id. Counts
   are real presence, pruned lazily on read; the peak is persisted to the
   row when it grows. Exported for tests. */
const viewersByStream = new Map<string, Map<string, number>>();

/* Throttle for persisted viewer samples (summary averages). */
const VIEWER_SAMPLE_MS = 20_000;
const lastViewerSampleAt = new Map<string, number>();

export function touchViewer(streamId: string, sessionId: string, now: number = Date.now()): number {
  let sessions = viewersByStream.get(streamId);
  if (!sessions) {
    sessions = new Map();
    viewersByStream.set(streamId, sessions);
  }
  sessions.set(sessionId, now);
  return countViewers(streamId, now);
}

export function countViewers(streamId: string, now: number = Date.now()): number {
  const sessions = viewersByStream.get(streamId);
  if (!sessions) return 0;
  for (const [sessionId, seenAt] of sessions) {
    if (now - seenAt > VIEWER_TTL_MS) sessions.delete(sessionId);
  }
  if (sessions.size === 0) viewersByStream.delete(streamId);
  return sessions.size;
}

export function clearViewers(streamId: string): void {
  viewersByStream.delete(streamId);
  /* The viewer-sample throttle entry dies with the stream (Flag S-4:
     lastViewerSampleAt otherwise only ever grew, one entry per stream
     ever run). */
  lastViewerSampleAt.delete(streamId);
}

export function __resetViewerTracker(): void {
  viewersByStream.clear();
}

/* ── DTOs (explicit, snake_case — the house API shape) ──────────────────── */

export interface LiveCreatorDto {
  id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
}

/* ── Multistream destinations ─────────────────────────────────────────────
   Every broadcast carries where it's headed: a list of { platform, label,
   status }. V1 implements exactly one destination — the site itself —
   and the normalizer enforces that honestly: whatever a client sends,
   the site entry comes first with status "active", and any other
   platform is stored "pending" (or "off" if it arrived off), never
   "active". When fan-out ships, the fan-out worker flips its entries
   live and the publisher (transport.ts) is where they plug in. */
export type StreamDestinationStatus = "active" | "pending" | "off" | "live" | "error" | "ended";
export interface StreamDestinationDto {
  platform: string;
  label: string;
  status: StreamDestinationStatus;
  /** Why a destination is in 'error' (or why fan-out can't run) — the
   *  honest reason the UI shows, written by the fan-out worker. */
  error_reason?: string | null;
  /** A stream key is saved for this destination (the key itself is
   *  NEVER in any DTO — this boolean is all a client ever learns). */
  has_key?: boolean;
  /** Save a recording of the stream on this destination (preference). */
  save_recording: boolean;
  /** Where this destination's recording lives after the stream (null until known). */
  vod_url: string | null;
  /**
   * The recording outcome once it's actually known: "saved" is written
   * by the flow that saved it (for the site, the /vod registration);
   * null means not known — never guessed at read time.
   */
  vod_state: "saved" | "not_saved" | null;
}

export const SITE_DESTINATION: StreamDestinationDto = {
  platform: "site",
  label: "Your profile",
  status: "active",
  save_recording: true,
  vod_url: null,
  vod_state: null,
};

type RawDestination = {
  platform?: unknown;
  label?: unknown;
  status?: unknown;
  save_recording?: unknown;
  vod_url?: unknown;
  vod_state?: unknown;
  error_reason?: unknown;
  has_key?: unknown;
};

const DESTINATION_STATUSES: StreamDestinationStatus[] = ["active", "pending", "off", "live", "error", "ended"];
function readStatus(v: unknown): StreamDestinationStatus {
  return typeof v === "string" && (DESTINATION_STATUSES as string[]).includes(v)
    ? (v as StreamDestinationStatus)
    : "pending";
}

function destinationOutcome(
  e: RawDestination,
): Pick<StreamDestinationDto, "save_recording" | "vod_url" | "vod_state"> &
  Partial<Pick<StreamDestinationDto, "error_reason" | "has_key">> {
  // error_reason / has_key keys are OMITTED entirely when there is
  // nothing to report — the destinations shape stays exactly the
  // pre-fan-out one for streams that never fanned out.
  const out: ReturnType<typeof destinationOutcome> = {
    save_recording: typeof e.save_recording === "boolean" ? e.save_recording : true,
    vod_url: typeof e.vod_url === "string" ? e.vod_url : null,
    vod_state: e.vod_state === "saved" || e.vod_state === "not_saved" ? e.vod_state : null,
  };
  if (typeof e.error_reason === "string" && e.error_reason) out.error_reason = e.error_reason;
  if (e.has_key === true) out.has_key = true;
  return out;
}

export function normalizeDestinations(raw: unknown): StreamDestinationDto[] {
  const entries: RawDestination[] = Array.isArray(raw)
    ? raw.filter((e): e is RawDestination => !!e && typeof e === "object")
    : [];
  // The site entry leads, always active; a stored site entry contributes
  // its recording preference + outcome (label stays our canonical name).
  const rawSite = entries.find(
    (e) => typeof e.platform === "string" && e.platform.trim().toLowerCase() === "site",
  );
  const out: StreamDestinationDto[] = [
    { ...SITE_DESTINATION, ...(rawSite ? destinationOutcome(rawSite) : {}) },
  ];
  const seen = new Set<string>(["site"]);
  for (const e of entries) {
    if (typeof e.platform !== "string" || !e.platform.trim()) continue;
    const platform = e.platform.trim().toLowerCase();
    if (seen.has(platform)) continue;
    seen.add(platform);
    out.push({
      platform,
      label: typeof e.label === "string" && e.label.trim() ? e.label.trim() : platform,
      status: readStatus(e.status),
      ...destinationOutcome(e),
    });
  }
  return out;
}

/**
 * What a CLIENT may request at create time: the site entry plus
 * pending/off wishes. A client can never mint "live"/"error"/"ended"
 * — those are written only by the fan-out worker (setDestinationStatus).
 */
export function sanitizeRequestedDestinations(raw: unknown): StreamDestinationDto[] {
  return normalizeDestinations(raw).map((d) =>
    d.platform === "site" ? d : { ...d, status: d.status === "off" ? ("off" as const) : ("pending" as const) },
  );
}

/** Server-side destination transition (fan-out worker, stream end). */
export async function setDestinationStatus(
  streamId: string,
  platform: string,
  patch: Partial<Pick<StreamDestinationDto, "status" | "error_reason" | "has_key">>,
): Promise<void> {
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
  const row = rows[0];
  if (!row) return;
  const destinations = normalizeDestinations(row.destinations).map((d) =>
    d.platform === platform ? { ...d, ...patch } : d,
  );
  await db
    .update(liveStreamsTable)
    .set({ destinations, updated_at: new Date() })
    .where(eq(liveStreamsTable.id, streamId));
}

/** At stream end: relays stop and any 'live' destination honestly ends. */
export async function closeOutDestinations(streamId: string): Promise<void> {
  stopAllRelays(streamId);
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
  const row = rows[0];
  if (!row) return;
  const destinations = normalizeDestinations(row.destinations).map((d) =>
    d.status === "live" ? { ...d, status: "ended" as const, error_reason: null } : d,
  );
  await db
    .update(liveStreamsTable)
    .set({ destinations, updated_at: new Date() })
    .where(eq(liveStreamsTable.id, streamId));
}

export interface LiveStreamDto {
  id: string;
  title: string;
  status: string;
  /** Honest source label: 'camera' (browser studio) | 'rtmp'
   *  (external encoder). Everything else about the stream — chat,
   *  playback, fan-out — is identical either way. */
  source: string;
  started_at: string | null;
  ended_at: string | null;
  viewer_count: number;
  peak_viewers: number;
  vod_url: string | null;
  destinations: StreamDestinationDto[];
  creator: LiveCreatorDto | null;
  playback: { whep_url: string | null; hls_url: string | null } | null;
}

export interface LiveStreamOwnerDto extends LiveStreamDto {
  whip_url: string | null;
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function toCreatorDto(profile: CreatorProfile | null | undefined): LiveCreatorDto | null {
  if (!profile) return null;
  return {
    id: profile.id,
    slug: profile.slug,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl ?? null,
  };
}

export function toStreamDto(
  row: LiveStream,
  profile: CreatorProfile | null | undefined,
  liveViewerCount?: number,
): LiveStreamDto {
  const isLive = row.status === "live";
  const urls = !isLive
    ? { whep_url: null, hls_url: null }
    : row.provider === "own-server"
      ? { whep_url: null, hls_url: `/api/live-streams/${row.id}/hls/playlist.m3u8` }
      : playbackUrlsFromWhip(row.whip_url);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    source: row.ingest_source ?? "camera",
    started_at: iso(row.started_at),
    ended_at: iso(row.ended_at),
    viewer_count: isLive ? Math.max(liveViewerCount ?? 0, 0) : 0,
    peak_viewers: row.peak_viewers ?? 0,
    vod_url: row.vod_url ?? null,
    destinations: normalizeDestinations(row.destinations),
    creator: toCreatorDto(profile),
    playback: isLive && (urls.whep_url || urls.hls_url) ? urls : null,
  };
}

export function toOwnerDto(
  row: LiveStream,
  profile: CreatorProfile | null | undefined,
  liveViewerCount?: number,
): LiveStreamOwnerDto {
  return { ...toStreamDto(row, profile, liveViewerCount), whip_url: row.whip_url ?? null };
}

/* ── DB helpers ─────────────────────────────────────────────────────────── */

async function getProfileByUserId(userId: string): Promise<CreatorProfile | null> {
  const rows = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

async function getProfileById(id: string): Promise<CreatorProfile | null> {
  const rows = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function getProfileBySlug(slug: string): Promise<CreatorProfile | null> {
  const rows = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

async function getStreamById(id: string): Promise<LiveStream | null> {
  const rows = await db
    .select()
    .from(liveStreamsTable)
    .where(eq(liveStreamsTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function getLiveStreamForUser(userId: string): Promise<LiveStream | null> {
  const rows = await db
    .select()
    .from(liveStreamsTable)
    .where(and(eq(liveStreamsTable.user_id, userId), eq(liveStreamsTable.status, "live")))
    .limit(1);
  return rows[0] ?? null;
}

async function getLiveStreamForProfile(profileId: string): Promise<LiveStream | null> {
  const rows = await db
    .select()
    .from(liveStreamsTable)
    .where(and(eq(liveStreamsTable.profile_id, profileId), eq(liveStreamsTable.status, "live")))
    .limit(1);
  return rows[0] ?? null;
}

async function endStreamRow(row: LiveStream, finalViewerCount: number): Promise<LiveStream> {
  /* Ending a stream closes its backstage too (guest invites +
     greenroom, 0202): sockets are told and dropped here; the guest
     sessions themselves stay on record but every guest call checks
     the stream's status, so the passes are dead from this moment. */
  closeBackstage(row.id, "The stream has ended.");
  const now = new Date();
  const updated = await db
    .update(liveStreamsTable)
    .set({
      status: "ended",
      ended_at: now,
      viewer_count: 0,
      peak_viewers: Math.max(row.peak_viewers ?? 0, finalViewerCount),
      updated_at: now,
    })
    .where(eq(liveStreamsTable.id, row.id))
    .returning();
  return updated[0] ?? { ...row, status: "ended", ended_at: now };
}

/** A "live" row older than MAX_LIVE_MS is a zombie (tab closed, WHIP long
 *  gone). End it lazily wherever it's read so the rail never lies. */
async function reconcileStale(row: LiveStream): Promise<LiveStream> {
  if (row.status !== "live") return row;
  const started = row.started_at instanceof Date ? row.started_at.getTime() : Date.parse(String(row.started_at));
  if (!Number.isFinite(started) || Date.now() - started <= MAX_LIVE_MS) return row;
  clearViewers(row.id);
  const ended = await endStreamRow(row, 0);
  /* Ending a stream ALWAYS closes out its destinations (stops the
     fan-out relays, marks them ended) — the stale paths used to skip
     this, leaving relays running against a dead stream (Flag S-3). */
  await closeOutDestinations(row.id).catch(() => undefined);
  return ended;
}

async function sweepStaleLive(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_LIVE_MS);
  const stale = await db
    .select({ id: liveStreamsTable.id })
    .from(liveStreamsTable)
    .where(and(eq(liveStreamsTable.status, "live"), lt(liveStreamsTable.started_at, cutoff)));
  if (stale.length === 0) return;
  await db
    .update(liveStreamsTable)
    .set({ status: "ended", ended_at: new Date(), viewer_count: 0, updated_at: new Date() })
    .where(and(eq(liveStreamsTable.status, "live"), lt(liveStreamsTable.started_at, cutoff)));
  for (const s of stale) {
    clearViewers(s.id);
    await closeOutDestinations(s.id).catch(() => undefined);
  }
}

/* ── VOD registration (shared by the /vod endpoint + own-server finalize) ──
   Registering a recording means: a generated_clips row the creator owns,
   the stream row pointing at it, and the site destination's recording
   outcome recorded as the fact it now is ("saved", at this URL). */
async function registerStreamVod(
  row: LiveStream,
  vodUrl: string,
): Promise<{ row: LiveStream; clipId: string | null }> {
  const clip = await db
    .insert(generatedClipsTable)
    .values({
      user_id: row.user_id,
      title: row.title,
      video_url: vodUrl,
      status: "completed",
    })
    .returning();
  const clipId = clip[0]?.id ?? null;
  const now = new Date();
  const destinations = normalizeDestinations(row.destinations).map((d) =>
    d.platform === "site" ? { ...d, vod_url: vodUrl, vod_state: "saved" as const } : d,
  );
  const updated = await db
    .update(liveStreamsTable)
    .set({ vod_url: vodUrl, vod_clip_id: clipId, destinations, updated_at: now })
    .where(eq(liveStreamsTable.id, row.id))
    .returning();
  return { row: updated[0] ?? row, clipId };
}

/** The flip side, recorded just as honestly: the recording did not save. */
async function markSiteVodNotSaved(row: LiveStream): Promise<void> {
  const destinations = normalizeDestinations(row.destinations).map((d) =>
    d.platform === "site" ? { ...d, vod_state: "not_saved" as const } : d,
  );
  await db
    .update(liveStreamsTable)
    .set({ destinations, updated_at: new Date() })
    .where(eq(liveStreamsTable.id, row.id));
}

/* ── Own-server finalize ──────────────────────────────────────────────────
   When an own-server stream ends (cleanly via /end, or via the engine's
   stall watchdog), the media engine finishes the remux and uploads the
   raw master; the recording then registers exactly like a
   browser-uploaded one. Runs fire-and-forget off the request path — a
   long upload never holds a streamer's End Stream click hostage — and
   every failure lands as a loud log + an honest "not_saved" outcome. */
async function finalizeOwnServerStream(row: LiveStream): Promise<void> {
  try {
    await endOwnServerSession(row.id);
    const rec = await finalizeRecording(row.id, row.user_id);
    const fresh = await getStreamById(row.id);
    if (!fresh || fresh.vod_url) return;
    if (rec) {
      await registerStreamVod(fresh, rec.vodUrl);
    } else {
      await markSiteVodNotSaved(fresh).catch(() => undefined);
    }
  } catch (err) {
    logger.error({ err, streamId: row.id }, "live-streams: own-server finalize failed");
    const fresh = await getStreamById(row.id).catch(() => null);
    if (fresh && !fresh.vod_url) {
      await markSiteVodNotSaved(fresh).catch(() => undefined);
    }
  }
}

/** The engine's publisher went quiet (or hit a cap): end the row the
 *  same way /end would, then finalize whatever media exists. */
async function handleOwnServerStall(streamId: string, _reason: StallReason): Promise<void> {
  const row = await getStreamById(streamId).catch(() => null);
  if (!row) {
    await endOwnServerSession(streamId).catch(() => undefined);
    return;
  }
  if (row.status === "live") {
    const finalCount = countViewers(row.id);
    await endStreamRow(row, finalCount).catch(() => undefined);
    clearViewers(row.id);
    /* A stalled stream's fan-out relays stop here too — before this,
       only the manual /end route closed destinations out, so a relay
       could outlive its stream until the session files aged out
       (Flag S-3). */
    await closeOutDestinations(row.id).catch(() => undefined);
  }
  if (row.provider === "own-server") {
    await finalizeOwnServerStream(row);
  }
}

initOwnServerLive({
  onStall: (streamId, reason) => {
    void handleOwnServerStall(streamId, reason);
  },
});

/* ── RTMP ingest host (lib/rtmp-ingest) ───────────────────────────────────
   An accepted encoder publish lands HERE, on the same lifecycle as a
   studio go-live: same row shape (provider 'own-server'), same engine
   slot + capacity honesty, same go-live alerts, same end + finalize.
   The only differences are the honest ones: ingest_source 'rtmp',
   and the title comes from the creator's standing ingest title (an
   encoder can't type one) or "<display name> live". */

async function startRtmpIngestStream(input: {
  userId: string;
  profileId: string;
  title: string | null;
}): Promise<{ ok: true; streamId: string } | { ok: false; message: string }> {
  const transport = selectedLiveTransport();
  if (transport !== "own" || !isLiveTransportReady(transport)) {
    return { ok: false, message: "This stage isn't accepting program feeds right now." };
  }
  const profile = await getProfileById(input.profileId);
  if (!profile || profile.userId !== input.userId) {
    return { ok: false, message: "That stream key isn't tied to a creator profile." };
  }
  const existing = await getLiveStreamForUser(input.userId);
  if (existing) {
    const reconciled = await reconcileStale(existing);
    if (reconciled.status === "live") {
      return {
        ok: false,
        message: "You're already live. End that stream before your program can take the stage.",
      };
    }
  }
  if (activeSessionCount() >= ownServerConfig().maxConcurrent) {
    return {
      ok: false,
      message: "The live stage is full right now — a few creators are already on. Try again in a little while.",
    };
  }
  const title = (input.title?.trim() || `${profile.displayName} live`).slice(0, 200);
  try {
    const inserted = await db
      .insert(liveStreamsTable)
      .values({
        user_id: input.userId,
        profile_id: profile.id,
        title,
        status: "live",
        provider: "own-server",
        ingest_source: "rtmp",
        provider_input_id: null,
        playback_id: null,
        whip_url: null,
        destinations: sanitizeRequestedDestinations(undefined),
      })
      .returning();
    const row = inserted[0]!;
    const begun = beginSession(row.id);
    if (!begun.ok) {
      // Lost the capacity race between the check and the insert.
      await endStreamRow(row, 0).catch(() => undefined);
      return {
        ok: false,
        message: "The live stage is full right now — a few creators are already on. Try again in a little while.",
      };
    }
    void fanOutGoLiveAlerts(row, { displayName: profile.displayName, slug: profile.slug });
    return { ok: true, streamId: row.id };
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      return {
        ok: false,
        message: "You're already live. End that stream before your program can take the stage.",
      };
    }
    logger.error({ err }, "live-streams: RTMP ingest start failed");
    return { ok: false, message: "The stage couldn't start this stream." };
  }
}

/** An encoder disconnected (or was dropped): the /end lifecycle,
 *  minus the HTTP — end the row, close destinations out, finalize
 *  the recording through the same own-server path. */
async function endRtmpIngestStream(streamId: string): Promise<void> {
  const row = await getStreamById(streamId).catch(() => null);
  if (!row) {
    await endOwnServerSession(streamId).catch(() => undefined);
    return;
  }
  if (row.status === "live") {
    const finalCount = countViewers(row.id);
    await endStreamRow(row, finalCount).catch(() => undefined);
    clearViewers(row.id);
    await closeOutDestinations(row.id).catch(() => undefined);
  }
  if (row.provider === "own-server") {
    await finalizeOwnServerStream(row);
  }
}

initRtmpIngest({
  startStream: startRtmpIngestStream,
  firstMedia: (streamId) => {
    // Same trigger as the first browser chunk: fan-out starts when
    // real media does, never on a bare connect.
    void attemptFanOut(streamId);
  },
  endStream: endRtmpIngestStream,
});

/* ── Schemas ────────────────────────────────────────────────────────────── */

const createSchema = z.object({
  title: z.string().trim().min(1, "Give your stream a title").max(200),
  /* Optional multistream destinations — stored normalized (site always
     first + active in v1; everything else pending/off, never faked live). */
  destinations: z
    .array(
      z.object({
        platform: z.string().trim().min(1).max(40),
        label: z.string().trim().min(1).max(80),
        status: z.enum(["active", "pending", "off"]).optional(),
        save_recording: z.boolean().optional(),
      }),
    )
    .max(8)
    .optional(),
});

const vodSchema = z.object({
  vod_url: z.string().url().max(2048),
});

const heartbeatSchema = z.object({
  session_id: z.string().min(8).max(64),
});

/* ── Broadcaster endpoints ──────────────────────────────────────────────── */

router.get("/live-streams/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const profile = await getProfileByUserId(req.userId!);
    let live: LiveStream | null = await getLiveStreamForUser(req.userId!);
    if (live) live = await reconcileStale(live);
    const transport = selectedLiveTransport();
    res.json({
      configured: isLiveTransportReady(transport),
      transport,
      live_stream: live && live.status === "live" ? toOwnerDto(live, profile, countViewers(live.id)) : null,
    });
  } catch (err) {
    logger.error({ err }, "live-streams/status failed");
    res.status(500).json({ error: "Could not check live streaming status." });
  }
});

router.post("/live-streams", requireAuth, async (req: Request, res: Response) => {
  try {
    const transport = selectedLiveTransport();
    if (!isLiveTransportReady(transport)) {
      res.status(503).json({
        error: "Live streaming isn't switched on yet. It turns on here the moment the site owner enables it — your camera kit below still works for checking your setup.",
        code: "STREAM_NOT_CONFIGURED",
      });
      return;
    }
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Give your stream a title." });
      return;
    }
    const profile = await getProfileByUserId(req.userId!);
    if (!profile) {
      res.status(400).json({
        error: "Create your creator profile first — your stream lives on it, and viewers follow you there.",
        code: "NO_PROFILE",
      });
      return;
    }
    const existing = await getLiveStreamForUser(req.userId!);
    if (existing) {
      const reconciled = await reconcileStale(existing);
      if (reconciled.status === "live") {
        res.status(409).json({
          error: "You're already live. End that stream before starting a new one.",
          code: "ALREADY_LIVE",
          stream: toOwnerDto(reconciled, profile, countViewers(reconciled.id)),
        });
        return;
      }
    }

    if (transport === "own") {
      /* Own-server session: the row IS the session (no provider input to
         create) and the media engine holds a slot for it. Capacity is a
         real limit of the shared box — say so plainly when it's full. */
      if (activeSessionCount() >= ownServerConfig().maxConcurrent) {
        res.status(503).json({
          error: "The live stage is full right now — a few creators are already on. Try again in a little while.",
          code: "LIVE_CAPACITY",
        });
        return;
      }
      try {
        const inserted = await db
          .insert(liveStreamsTable)
          .values({
            user_id: req.userId!,
            profile_id: profile.id,
            title: parsed.data.title,
            status: "live",
            provider: "own-server",
            ingest_source: "camera",
            provider_input_id: null,
            playback_id: null,
            whip_url: null,
            destinations: sanitizeRequestedDestinations(parsed.data.destinations),
          })
          .returning();
        const row = inserted[0]!;
        const begun = beginSession(row.id);
        if (!begun.ok) {
          // Lost the capacity race between the check and the insert.
          await endStreamRow(row, 0).catch(() => undefined);
          res.status(503).json({
            error: "The live stage is full right now — a few creators are already on. Try again in a little while.",
            code: "LIVE_CAPACITY",
          });
          return;
        }
        // Go-live alerts fan out off the response path (dedupe-safe).
        void fanOutGoLiveAlerts(row, { displayName: profile.displayName, slug: profile.slug });
        res.status(201).json({ stream: toOwnerDto(row, profile, 0) });
        return;
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "23505") {
          const liveNow = await getLiveStreamForUser(req.userId!);
          res.status(409).json({
            error: "You're already live. End that stream before starting a new one.",
            code: "ALREADY_LIVE",
            stream: liveNow ? toOwnerDto(liveNow, profile, countViewers(liveNow.id)) : null,
          });
          return;
        }
        throw err;
      }
    }

    let input;
    try {
      input = await createLiveInput(parsed.data.title);
    } catch (err) {
      if (err instanceof StreamNotConfiguredError) {
        res.status(503).json({ error: "Live streaming isn't switched on yet.", code: "STREAM_NOT_CONFIGURED" });
        return;
      }
      if (err instanceof StreamProviderError) {
        logger.error({ err }, "live-streams create: provider failed");
        res.status(502).json({
          error: "The streaming provider couldn't start your stream. Give it a moment and try again.",
          code: "PROVIDER_ERROR",
        });
        return;
      }
      throw err;
    }

    try {
      const inserted = await db
        .insert(liveStreamsTable)
        .values({
          user_id: req.userId!,
          profile_id: profile.id,
          title: parsed.data.title,
          status: "live",
          provider: "cloudflare-stream",
          provider_input_id: input.providerInputId,
          playback_id: input.playbackId,
          whip_url: input.whipUrl,
          destinations: sanitizeRequestedDestinations(parsed.data.destinations),
        })
        .returning();
      const row = inserted[0]!;
      // Go-live alerts fan out off the response path (dedupe-safe).
      void fanOutGoLiveAlerts(row, { displayName: profile.displayName, slug: profile.slug });
      res.status(201).json({ stream: toOwnerDto(row, profile, 0) });
    } catch (err) {
      // Lost a race against the one-live-per-user unique index: clean up
      // the provider input we just made and report the real live stream.
      const code = (err as { code?: string })?.code;
      if (code === "23505") {
        await deleteLiveInput(input.providerInputId).catch(() => undefined);
        const liveNow = await getLiveStreamForUser(req.userId!);
        res.status(409).json({
          error: "You're already live. End that stream before starting a new one.",
          code: "ALREADY_LIVE",
          stream: liveNow ? toOwnerDto(liveNow, profile, countViewers(liveNow.id)) : null,
        });
        return;
      }
      // The row never landed — don't leak the provider input.
      await deleteLiveInput(input.providerInputId).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    logger.error({ err }, "live-streams create failed");
    res.status(500).json({ error: "Could not start your stream." });
  }
});

router.post("/live-streams/:id/end", requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await getStreamById(String(req.params.id));
    if (!row) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (row.user_id !== req.userId) {
      res.status(403).json({ error: "That's not your stream." });
      return;
    }
    const profile = await getProfileById(row.profile_id);
    if (row.status === "ended") {
      res.json({ stream: toStreamDto(row, profile) });
      return;
    }
    const finalCount = countViewers(row.id);
    const ended = await endStreamRow(row, finalCount);
    clearViewers(row.id);
    await closeOutDestinations(row.id).catch(() => undefined);
    if (row.provider === "own-server") {
      // The engine finishes the remux + uploads the recording in the
      // background; the replay registers on the row when it's ready.
      void finalizeOwnServerStream(row);
    } else if (row.provider_input_id) {
      await deleteLiveInput(row.provider_input_id).catch((err) => {
        logger.warn({ err }, "live-streams end: provider input delete failed (stream already ended locally)");
      });
    }
    res.json({ stream: toStreamDto(ended, profile) });
  } catch (err) {
    logger.error({ err }, "live-streams end failed");
    res.status(500).json({ error: "Could not end your stream." });
  }
});

router.post("/live-streams/:id/vod", requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await getStreamById(String(req.params.id));
    if (!row) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (row.user_id !== req.userId) {
      res.status(403).json({ error: "That's not your stream." });
      return;
    }
    const parsed = vodSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A recording URL is required." });
      return;
    }
    const vodUrl = parsed.data.vod_url;
    /* The recording is uploaded by the broadcaster's browser through the
       site's own storage path under their user prefix — refuse anything
       that doesn't carry it, so a stream can only ever point at its
       owner's own upload. */
    if (!vodUrl.includes(`/${req.userId}/live/`)) {
      res.status(400).json({ error: "That recording doesn't belong to your uploads." });
      return;
    }
    const profile = await getProfileById(row.profile_id);
    if (row.vod_url && row.vod_clip_id) {
      res.json({ stream: toStreamDto(row, profile), clip_id: row.vod_clip_id });
      return;
    }
    const { row: updated, clipId } = await registerStreamVod(row, vodUrl);
    res.json({ stream: toStreamDto(updated, profile), clip_id: clipId });
  } catch (err) {
    logger.error({ err }, "live-streams vod failed");
    res.status(500).json({ error: "Could not save your recording." });
  }
});

/* ── RTMP ingest keys (owner-only) ────────────────────────────────────────
   The key itself is a secret the server stores only as a one-way
   hash. It leaves the server exactly once — in the create/regenerate
   response that mints it, behind the owner's session; an existing
   key is never re-shown (reveal on an existing key answers with the
   status and stream_key: null). Everything else — status, the
   public stream DTOs, the watch page — sees only that a key exists
   and its last-4 hint. Revoke/regenerate kill the old key in the
   table AND drop a live encoder connection using it, so a
   compromised key stops working the moment the owner acts.
   ─────────────────────────────────────────────────────────────────────
   THE HONESTY GATE: encoder ingest rides a raw-TCP port that the
   current hosting does not route publicly, so the feature is opt-in
   per deployment (LIVE_RTMP_INGEST=on) and SHUT by default. While
   shut: status reports enabled:false (the panel shows its plain
   not-open-yet state and offers no minting), and the two mint doors
   (reveal / regenerate) answer an honest 503 and create nothing.
   Revoke and the standing title keep working while shut — a key
   minted in an open window stays manageable and killable. */

export interface IngestKeyDto {
  enabled: boolean;
  ingest_url: string | null;
  has_key: boolean;
  key_hint: string | null;
  stream_title: string | null;
  revoked: boolean;
}

/* The one predicate behind the panel's `enabled` flag AND the mint
 *  doors: the deployment has opted in AND the own-server transport —
 *  the one encoder publishes land on — is the selected, ready one. */
function ingestOpen(): boolean {
  return (
    rtmpIngestConfig().enabled &&
    selectedLiveTransport() === "own" &&
    isLiveTransportReady("own")
  );
}

const INGEST_NOT_OPEN_ERROR =
  "Streaming from other software isn't open yet — it arrives with the launch setup. Your built-in studio works today.";

function toIngestKeyDto(row: LiveIngestKey | null): IngestKeyDto {
  const active = !!row && !row.revoked_at;
  return {
    enabled: ingestOpen(),
    ingest_url: ingestUrlFor(),
    has_key: active,
    key_hint: active ? row!.key_hint : null,
    stream_title: row?.stream_title ?? null,
    revoked: !!row?.revoked_at,
  };
}

router.get("/live-streams/ingest-key", requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await getIngestKeyRow(req.userId!);
    res.json({ ingest: toIngestKeyDto(row) });
  } catch (err) {
    logger.error({ err }, "live-streams ingest-key status failed");
    res.status(500).json({ error: "Could not load your stream key status." });
  }
});

router.post("/live-streams/ingest-key/reveal", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!ingestOpen()) {
      // The door isn't open on this deployment — refuse honestly and
      // mint NOTHING (a key handed out here would stream into the void).
      res.status(503).json({ error: INGEST_NOT_OPEN_ERROR, code: "INGEST_NOT_OPEN" });
      return;
    }
    const profile = await getProfileByUserId(req.userId!);
    if (!profile) {
      res.status(400).json({
        error: "Create your creator profile first — your stream key belongs to it.",
        code: "NO_PROFILE",
      });
      return;
    }
    const { row, plainKey } = await getOrCreateIngestKey(req.userId!, profile.id);
    res.setHeader("Cache-Control", "no-store");
    // plainKey is non-null ONLY when this call minted the key (first
    // ask, or first ask after a revoke). For an existing key the hash
    // can't be reversed — stream_key is null and the code tells the
    // panel to point the owner at regenerate instead.
    res.json({
      stream_key: plainKey,
      ...(plainKey ? {} : { code: "KEY_NOT_RESHOWN" }),
      ingest: toIngestKeyDto(row),
    });
  } catch (err) {
    logger.error({ err }, "live-streams ingest-key reveal failed");
    res.status(500).json({ error: "Could not load your stream key." });
  }
});

router.post("/live-streams/ingest-key/regenerate", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!ingestOpen()) {
      // Same honesty gate as reveal: no new key while the door is
      // shut — and the existing key is left exactly as it was.
      res.status(503).json({ error: INGEST_NOT_OPEN_ERROR, code: "INGEST_NOT_OPEN" });
      return;
    }
    const profile = await getProfileByUserId(req.userId!);
    if (!profile) {
      res.status(400).json({
        error: "Create your creator profile first — your stream key belongs to it.",
        code: "NO_PROFILE",
      });
      return;
    }
    const { row, plainKey } = await regenerateIngestKey(req.userId!, profile.id);
    // The old key is dead in the table; an encoder still pushing with
    // it is dropped now, not at its next reconnect.
    dropIngestConnectionsForUser(req.userId!);
    res.setHeader("Cache-Control", "no-store");
    res.json({ stream_key: plainKey, ingest: toIngestKeyDto(row) });
  } catch (err) {
    logger.error({ err }, "live-streams ingest-key regenerate failed");
    res.status(500).json({ error: "Could not regenerate your stream key." });
  }
});

router.post("/live-streams/ingest-key/revoke", requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await revokeIngestKey(req.userId!);
    dropIngestConnectionsForUser(req.userId!);
    res.json({ ingest: toIngestKeyDto(row) });
  } catch (err) {
    logger.error({ err }, "live-streams ingest-key revoke failed");
    res.status(500).json({ error: "Could not revoke your stream key." });
  }
});

const ingestTitleSchema = z.object({
  stream_title: z.string().trim().max(120).nullable().optional(),
});

router.patch("/live-streams/ingest-key", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = ingestTitleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "That title is too long — 120 characters max." });
      return;
    }
    const title = parsed.data.stream_title?.trim() ? parsed.data.stream_title.trim() : null;
    const row = await setIngestStreamTitle(req.userId!, title);
    if (!row) {
      res.status(404).json({
        error: "You don't have a stream key yet — reveal yours first, then set its title.",
        code: "NO_KEY",
      });
      return;
    }
    res.json({ ingest: toIngestKeyDto(row) });
  } catch (err) {
    logger.error({ err }, "live-streams ingest-key title failed");
    res.status(500).json({ error: "Could not save your stream title." });
  }
});

/* ── Own-server media plane ───────────────────────────────────────────────
   Ingest: the broadcaster's browser POSTs one MediaRecorder chunk every
   ~2s (raw body, x-segment-seq header). Only the stream's owner can
   publish to it, only while the row is live, only for own-server rows.
   Playback: the engine's live HLS files, served by name from a strict
   whitelist — the playlist is never cached, segments are immutable. */

const segmentBody = express.raw({ type: () => true, limit: "12mb" });

router.post(
  "/live-streams/:id/ingest/segment",
  (req: Request, res: Response, next: () => void) => {
    segmentBody(req, res, (err?: unknown) => {
      if (err) {
        res.status(413).json({ error: "That chunk was too large to carry." });
        return;
      }
      next();
    });
  },
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: "Send the recording chunk as the request body." });
        return;
      }
      const row = await getStreamById(String(req.params.id));
      if (!row) {
        res.status(404).json({ error: "That stream doesn't exist." });
        return;
      }
      if (row.user_id !== req.userId) {
        res.status(403).json({ error: "That's not your stream." });
        return;
      }
      if (row.provider !== "own-server") {
        res.status(400).json({
          error: "This stream doesn't publish through the site's own stage.",
          code: "WRONG_TRANSPORT",
        });
        return;
      }
      if (row.status !== "live") {
        res.status(410).json({ error: "That stream has ended.", code: "STREAM_ENDED" });
        return;
      }
      if (!hasSession(row.id)) {
        res.status(409).json({
          error: "This stream's stage session is gone — end it and go live again.",
          code: "NO_INGEST_SESSION",
        });
        return;
      }
      const seq = Number(req.header("x-segment-seq"));
      if (!Number.isInteger(seq) || seq < 0) {
        res.status(400).json({ error: "A segment sequence number is required." });
        return;
      }
      try {
        const out = await acceptChunk(row.id, seq, req.body, String(req.header("content-type") ?? ""));
        // Multistream fan-out (Stack 9 #1): the first real chunk is
        // when a relay can honestly start — fire-and-forget so a
        // destination problem never breaks the ingest itself.
        if (seq === 0 && !out.duplicate) void attemptFanOut(row.id);
        res.json({ ok: true, duplicate: out.duplicate, seq });
      } catch (err) {
        if (err instanceof LiveIngestError) {
          if (err.code === "SESSION_FULL") {
            // The cap ends the stream properly — row + replay finalize.
            void handleOwnServerStall(row.id, "full");
            res.status(413).json({ error: err.message, code: err.code });
            return;
          }
          res
            .status(err.code === "UNSUPPORTED_MIME" ? 415 : 409)
            .json({ error: err.message, code: err.code });
          return;
        }
        throw err;
      }
    } catch (err) {
      logger.error({ err }, "live-streams ingest segment failed");
      res.status(500).json({ error: "That chunk didn't land. The next one may still carry the show." });
    }
  },
);

router.get("/live-streams/:id/hls/:file", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const name = String(req.params.file);
    const row = await getStreamById(String(req.params.id));
    if (!row || row.provider !== "own-server" || !isLiveFileName(name)) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const filePath = liveFilePath(row.id, name);
    if (!filePath) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.setHeader("Content-Type", liveFileContentType(name));
    res.setHeader("Cache-Control", name === "playlist.m3u8" ? "no-cache" : "public, max-age=30");
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).json({ error: "Not found." });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    logger.error({ err }, "live-streams hls serve failed");
    res.status(500).json({ error: "Could not load the live feed." });
  }
});

/* ── Public watch endpoints ─────────────────────────────────────────────── */

router.get("/live-streams/live", async (_req: Request, res: Response) => {
  try {
    await sweepStaleLive();
    const rows = await db
      .select()
      .from(liveStreamsTable)
      .where(eq(liveStreamsTable.status, "live"))
      .orderBy(desc(liveStreamsTable.viewer_count), desc(liveStreamsTable.started_at))
      .limit(24);
    const profileIds = [...new Set(rows.map((r) => r.profile_id))];
    const profiles = profileIds.length
      ? await db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.id, profileIds))
      : [];
    const byId = new Map(profiles.map((p) => [p.id, p]));
    res.json({
      streams: rows.map((r) => toStreamDto(r, byId.get(r.profile_id), countViewers(r.id))),
    });
  } catch (err) {
    logger.error({ err }, "live-streams/live failed");
    res.status(500).json({ error: "Could not load who's live." });
  }
});

router.get("/live-streams/profile/:slug", async (req: Request, res: Response) => {
  try {
    const profile = await getProfileBySlug(String(req.params.slug));
    if (!profile) {
      res.json({ stream: null });
      return;
    }
    let live = await getLiveStreamForProfile(profile.id);
    if (live) live = await reconcileStale(live);
    res.json({
      stream: live && live.status === "live" ? toStreamDto(live, profile, countViewers(live.id)) : null,
    });
  } catch (err) {
    logger.error({ err }, "live-streams/profile failed");
    res.status(500).json({ error: "Could not check if this creator is live." });
  }
});

router.get("/live-streams/:id", async (req: Request, res: Response) => {
  try {
    let row = await getStreamById(String(req.params.id));
    if (!row) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    row = await reconcileStale(row);
    const profile = await getProfileById(row.profile_id);
    res.json({ stream: toStreamDto(row, profile, countViewers(row.id)) });
  } catch (err) {
    logger.error({ err }, "live-streams get failed");
    res.status(500).json({ error: "Could not load that stream." });
  }
});

router.post("/live-streams/:id/heartbeat", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = heartbeatSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A viewer session id is required." });
      return;
    }
    const row = await getStreamById(String(req.params.id));
    if (!row) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (row.status !== "live") {
      res.status(410).json({ error: "That stream has ended.", code: "STREAM_ENDED" });
      return;
    }
    const count = touchViewer(row.id, parsed.data.session_id);
    // Viewer samples for the post-stream summary's average: one row
    // per stream per SAMPLE_MS window (not one per heartbeat), written
    // off the response path — a sample failure never fails a view.
    const lastSample = lastViewerSampleAt.get(row.id) ?? 0;
    if (Date.now() - lastSample >= VIEWER_SAMPLE_MS) {
      lastViewerSampleAt.set(row.id, Date.now());
      void (async () => {
        try {
          await db.insert(liveViewerSamplesTable).values({ stream_id: row.id, viewer_count: count });
        } catch (err) {
          logger.warn({ err }, "live-streams heartbeat: viewer sample write failed");
        }
      })();
    }
    if (count > (row.peak_viewers ?? 0)) {
      try {
        await db
          .update(liveStreamsTable)
          .set({ viewer_count: count, peak_viewers: count, updated_at: new Date() })
          .where(eq(liveStreamsTable.id, row.id));
      } catch (err) {
        logger.warn({ err }, "live-streams heartbeat: peak persist failed");
      }
    }
    res.json({ viewer_count: count });
  } catch (err) {
    logger.error({ err }, "live-streams heartbeat failed");
    res.status(500).json({ error: "Could not register your view." });
  }
});

export default router;
