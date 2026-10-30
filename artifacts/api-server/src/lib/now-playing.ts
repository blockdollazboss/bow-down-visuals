import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  db,
  liveNowPlayingTable,
  liveStreamsTable,
  type LiveNowPlaying,
} from "@workspace/db";
import { logger } from "./logger";

/* ── Live now playing (stack900 lane D3) ─────────────────────────────────
   The truthful feed lane C2's stream overlays were missing. The
   studio's media playback is client-side canvas state (the stream-kit
   stage pool) that was never reported anywhere; C2 scoped the
   now-playing overlay OUT rather than fake a feed. This module is
   the feed:

     - the studio reports the track on its program (POST
       /api/live/:id/now-playing, owner-only, live streams only) and
       clears it on stop (DELETE) — routes/now-playing.ts;
     - the state is ONE row per stream (live_now_playing, migration
       0302): current track only, replaced on change, deleted on
       stop and in the stream-end close-out;
     - the overlay read (GET /api/overlay/now-playing?token=…)
       resolves the creator's overlay token and carries title +
       artist + duration + timing ONLY — no user ids, no stream ids,
       nothing the creator's own stream doesn't already show.

   ── THE TTL DEFENCE ───────────────────────────────────────────────────
   Every report carries an expiry, computed here and nowhere else:

     known duration   → report time + duration + 45s grace
     unknown duration → report time + 5 minutes
     either way       → never more than 30 minutes past the report

   The studio heartbeats a refresh every ~30s while the track is on
   the program, so a genuinely playing track never lapses. A crashed
   or closed tab sends nothing more, so a dead "now playing" dies
   within one track length + 45s of the last report (5 minutes when
   the length is unknown) — it can NEVER sit on a stream forever.
   The 30-minute horizon caps any single report's reach, so even a
   stuck client that keeps reporting a wrong duration can't pin the
   state further than 30 minutes past its last word. Reads treat an
   expired row as "nothing playing" and delete it opportunistically,
   so the table stays as small as the truth. */

export const NOW_PLAYING_GRACE_SEC = 45;
export const NOW_PLAYING_UNKNOWN_TTL_SEC = 5 * 60;
export const NOW_PLAYING_MAX_HORIZON_SEC = 30 * 60;

/** The expiry one report earns. Pure — the TTL rules live here and
 *  the tests pin them here. */
export function computeNowPlayingExpiry(
  reportAt: Date,
  durationSec: number | null,
): Date {
  const horizonMs = NOW_PLAYING_MAX_HORIZON_SEC * 1000;
  const wantedMs =
    durationSec != null && durationSec > 0
      ? (durationSec + NOW_PLAYING_GRACE_SEC) * 1000
      : NOW_PLAYING_UNKNOWN_TTL_SEC * 1000;
  return new Date(reportAt.getTime() + Math.min(wantedMs, horizonMs));
}

export interface NowPlayingDto {
  title: string;
  artist: string;
  /** Null when the studio doesn't know the track's length — the
   *  overlay shows no progress bar rather than a guessed one. */
  durationSec: number | null;
  startedAt: string;
  /** When the state stops being true unless refreshed. */
  expiresAt: string;
}

/** Row → DTO, or null when the row has expired (an expired row is
 *  not a now-playing fact, whatever the table still holds). */
export function toNowPlayingDto(
  row: LiveNowPlaying,
  now: Date = new Date(),
): NowPlayingDto | null {
  const expires = new Date(row.expires_at);
  if (!(expires.getTime() > now.getTime())) return null;
  return {
    title: row.title,
    artist: row.artist,
    durationSec: row.duration_sec ?? null,
    startedAt: new Date(row.started_at).toISOString(),
    expiresAt: expires.toISOString(),
  };
}

/** Record (or refresh) the track playing on one stream. A report
 *  naming the same track (same title + artist) is a heartbeat: it
 *  keeps the original started_at and only extends the expiry. A new
 *  track replaces the row wholesale and starts its own clock. */
export async function reportNowPlaying(input: {
  streamId: string;
  creatorUserId: string;
  title: string;
  artist: string;
  durationSec: number | null;
  now?: Date;
}): Promise<LiveNowPlaying> {
  const now = input.now ?? new Date();
  const expiresAt = computeNowPlayingExpiry(now, input.durationSec);
  const existing = await db
    .select()
    .from(liveNowPlayingTable)
    .where(eq(liveNowPlayingTable.stream_id, input.streamId))
    .limit(1);
  const sameTrack =
    existing[0] != null &&
    existing[0].title === input.title &&
    existing[0].artist === input.artist;
  const startedAt = sameTrack ? new Date(existing[0].started_at) : now;
  const rows = await db
    .insert(liveNowPlayingTable)
    .values({
      stream_id: input.streamId,
      creator_user_id: input.creatorUserId,
      title: input.title,
      artist: input.artist,
      duration_sec: input.durationSec,
      started_at: startedAt,
      expires_at: expiresAt,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: liveNowPlayingTable.stream_id,
      set: {
        creator_user_id: input.creatorUserId,
        title: input.title,
        artist: input.artist,
        duration_sec: input.durationSec,
        started_at: startedAt,
        expires_at: expiresAt,
        updated_at: now,
      },
    })
    .returning();
  return rows[0]!;
}

/** Clear a stream's now-playing state (stop report, stream end).
 *  Best-effort by design at the stream-end call sites: ending a
 *  stream must never fail because a widget feed hiccuped. */
export async function clearNowPlaying(streamId: string): Promise<void> {
  await db
    .delete(liveNowPlayingTable)
    .where(eq(liveNowPlayingTable.stream_id, streamId));
}

/** The now-playing DTO for one stream, or null. An expired row is
 *  cleared as it is read past, so stale state never accumulates. */
export async function readNowPlayingForStream(
  streamId: string,
  now: Date = new Date(),
): Promise<NowPlayingDto | null> {
  const rows = await db
    .select()
    .from(liveNowPlayingTable)
    .where(eq(liveNowPlayingTable.stream_id, streamId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const dto = toNowPlayingDto(row, now);
  if (!dto) {
    await clearNowPlaying(streamId).catch(() => undefined);
    return null;
  }
  return dto;
}

/** The now-playing DTO for a creator: their LIVE stream's row. A
 *  stream that has ended has no now playing, whatever a lost stop
 *  report left behind (the stream-end close-out deletes the row;
 *  this live-only read is the second lock). */
export async function readNowPlayingForCreator(
  creatorUserId: string,
  now: Date = new Date(),
): Promise<NowPlayingDto | null> {
  const live = await db
    .select({ id: liveStreamsTable.id })
    .from(liveStreamsTable)
    .where(
      and(
        eq(liveStreamsTable.user_id, creatorUserId),
        eq(liveStreamsTable.status, "live"),
      ),
    )
    .orderBy(desc(liveStreamsTable.created_at))
    .limit(1);
  const streamId = live[0]?.id;
  if (!streamId) return null;
  return readNowPlayingForStream(streamId, now);
}

/* ── Overlay token seam ──────────────────────────────────────────────────
   JOIN SEAM (stack900): the overlay token table and its canonical
   resolver are lane C2's (creator_overlay_tokens, migration 0300 on
   C2's branch; resolveOverlayToken in lib/overlay-events.ts). C2 is
   not on this lane's base, so the resolution is done here against
   the same table with the same rules: the 43-char base64url shape
   check first (junk never reaches the database), one indexed lookup,
   null for anything unknown. AT THE JOIN: delete this function and
   import resolveOverlayToken from ./overlay-events — the call sites
   (routes/now-playing.ts) name the seam so the swap is one line. */
const OVERLAY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function resolveOverlayTokenForNowPlaying(
  token: string,
): Promise<string | null> {
  if (!OVERLAY_TOKEN_RE.test(token)) return null;
  try {
    const result = await db.execute(
      sql`SELECT user_id FROM creator_overlay_tokens WHERE token = ${token} LIMIT 1`,
    );
    const row = (result.rows as Array<Record<string, unknown>>)[0];
    const userId = row?.["user_id"];
    return typeof userId === "string" ? userId : null;
  } catch (err) {
    logger.warn({ err }, "now-playing token resolution failed");
    return null;
  }
}
