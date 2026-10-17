/**
 * charts-board.ts — the data shaping behind the Charts board
 * (NATIVE-PLAN §3.1, the Palace Board pattern's Music Hall use).
 *
 * The Charts station (Music Hall) used to pull up the website's
 * /charts page. In-world it is a board: climbing tracks and
 * creators as rows, one action per row — Play for a track, Follow
 * for a creator. This module owns everything about that board
 * that does not need a DOM: the payload normalizers (the discovery
 * API's rows are raw SQL rows — snake_case, half of them optional),
 * the follow request contract, and the jukebox hand-off id.
 *
 * The endpoints are the page's own (plan §1): the board rides
 *   GET /api/discovery/charts            (tracks)
 *   GET /api/discovery/charts/creators   (top creators)
 *   GET /api/discovery/rising           (breaking creators)
 *   GET /api/discovery/rising-earners   (rising earners)
 *   GET /api/discovery/following?ids=…   (the walker's follow state)
 *   POST   /api/creator-profiles/:id/follow
 *   DELETE /api/creator-profiles/:id/unfollow
 * No new back-end (plan §3.0).
 */

import { resolveMedia } from "@/lib/streaming";
import type { ShelfPlayInput } from "./shelf";

/* ─── Row shapes the board renders ────────────────────────────────── */

export interface ChartTrackRow {
  /** The raw profile-track id (a uuid) — the Play seam prefixes it. */
  id: string;
  title: string;
  creatorName: string | null;
  genre: string | null;
  artworkUrl: string | null;
  /** Plays in the chart window when the row carries them, else the
   *  all-time counter. */
  plays: number;
  durationSec: number | null;
  /** The row's like counter (the Charts Like button's starting
   *  count; the media like rails return the authoritative count). */
  likeCount: number;
  /** The streamable audio URL the discovery SQL already selects
   *  (audio_url, storage-refreshed server-side) — the Shelf player's
   *  Play-here source. Null when the row doesn't carry one. */
  mediaUrl: string | null;
  /** The owning creator profile's id, when the row carries it. */
  profileId: string | null;
}

/** A charting video row (the /charts payload's `videos` key — the
 *  same SQL family as tracks, video fields). Its Play hands it to
 *  the Shelf player in-world (2.27); the jukebox is audio-only, so
 *  videos never take the catalog-id seam. */
export interface ChartVideoRow {
  id: string;
  title: string;
  creatorName: string | null;
  genre: string | null;
  artworkUrl: string | null;
  plays: number;
  durationSec: number | null;
  likeCount: number;
  mediaUrl: string | null;
  profileId: string | null;
}

export interface ChartCreatorRow {
  /** The creator PROFILE id — the follow endpoints' :id. */
  id: string;
  displayName: string;
  vertical: string | null;
  followerCount: number;
  totalPlays: number;
  /** Rising rows only: followers gained in the last 7 days. */
  newFollowers: number | null;
  /** Earner rows only: what fans paid them in the last 30 days. */
  earnedCents30d: number | null;
}

/* ─── Defensive readers (DTO disease is endemic — never guess) ────── */

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function rowsOf(payload: unknown, key: string): Record<string, unknown>[] {
  if (!isObj(payload)) return [];
  const rows = payload[key];
  if (!Array.isArray(rows)) return [];
  return rows.filter(isObj);
}

/* ─── Normalizers ─────────────────────────────────────────────────── */

/** Shape a /discovery/charts payload into track rows. Rows without
 *  a usable id or title are skipped rather than guessed at; server
 *  order (the chart's rank order) is preserved. */
export function normalizeChartTracks(payload: unknown): ChartTrackRow[] {
  const out: ChartTrackRow[] = [];
  for (const r of rowsOf(payload, "tracks")) {
    const id = str(r["id"]);
    const title = str(r["title"]);
    if (!id || !title) continue;
    out.push({
      id,
      title,
      creatorName: str(r["display_name"] ?? r["displayName"]),
      genre: str(r["genre"]),
      artworkUrl: str(r["artwork_url"] ?? r["artworkUrl"]),
      plays: num(r["window_plays"] ?? r["windowPlays"]) ?? num(r["play_count"] ?? r["playCount"]) ?? 0,
      durationSec: num(r["duration_sec"] ?? r["durationSec"]),
      likeCount: num(r["like_count"] ?? r["likeCount"]) ?? 0,
      mediaUrl: str(r["audio_url"] ?? r["audioUrl"]),
      profileId: str(r["profile_id"] ?? r["profileId"]),
    });
  }
  return out;
}

/** Shape a /discovery/charts payload's `videos` key into board rows.
 *  Same defensive discipline as tracks: unusable rows are skipped,
 *  server rank order is preserved, view counters read as plays. */
export function normalizeChartVideos(payload: unknown): ChartVideoRow[] {
  const out: ChartVideoRow[] = [];
  for (const r of rowsOf(payload, "videos")) {
    const id = str(r["id"]);
    const title = str(r["title"]);
    if (!id || !title) continue;
    out.push({
      id,
      title,
      creatorName: str(r["display_name"] ?? r["displayName"]),
      genre: str(r["genre"]),
      artworkUrl: str(r["thumbnail_url"] ?? r["thumbnailUrl"] ?? r["artwork_url"] ?? r["artworkUrl"]),
      plays: num(r["window_plays"] ?? r["windowPlays"]) ?? num(r["view_count"] ?? r["viewCount"]) ?? 0,
      durationSec: num(r["duration_sec"] ?? r["durationSec"]),
      likeCount: num(r["like_count"] ?? r["likeCount"]) ?? 0,
      mediaUrl: str(r["video_url"] ?? r["videoUrl"]),
      profileId: str(r["profile_id"] ?? r["profileId"]),
    });
  }
  return out;
}

/** Shape a creator payload into board rows. One normalizer serves
 *  the three creator endpoints — they differ only in the payload
 *  key (`creators` / `rising` / `earners`) and the extra stat each
 *  carries, both read defensively here. */
export function normalizeChartCreators(
  payload: unknown,
  key: "creators" | "rising" | "earners",
): ChartCreatorRow[] {
  const out: ChartCreatorRow[] = [];
  for (const r of rowsOf(payload, key)) {
    const id = str(r["id"]);
    const displayName = str(r["display_name"] ?? r["displayName"]);
    if (!id || !displayName) continue;
    out.push({
      id,
      displayName,
      vertical: str(r["vertical"]),
      followerCount: num(r["follower_count"] ?? r["followerCount"]) ?? 0,
      totalPlays: num(r["total_plays"] ?? r["totalPlays"]) ?? 0,
      newFollowers: num(r["new_followers"] ?? r["newFollowers"]),
      earnedCents30d: num(r["earned_cents_30d"] ?? r["earnedCents30d"]),
    });
  }
  return out;
}

/* ─── The Play seam ───────────────────────────────────────────────────
   A chart track's Play hands the track to the room's jukebox —
   the same intent the Jukebox panel's catalog uses
   (StationPanel's onJukeboxAdd prop, from pages/world.tsx). The
   jukebox resolver accepts ONLY the `track:<uuid>` catalog form
   and re-verifies the published track server-side; the discovery
   rows carry the raw uuid, so the prefix is applied here, once. */

export function jukeboxTrackId(trackId: string): string {
  return trackId.startsWith("track:") ? trackId : `track:${trackId}`;
}

/* ─── The Shelf-player seam (2.27) ────────────────────────────────────
   A chart row's second Play: play it HERE, on the one in-world
   personal player (lib/world/shelf.ts ShelfPlayInput), from the
   streamable URL the chart row already carries. Null when the row
   carries no playable URL — the board then offers only the jukebox
   Play (tracks) or no Play at all (videos), never a dead button. */

export function chartTrackPlayInput(row: ChartTrackRow): ShelfPlayInput | null {
  if (!row.mediaUrl) return null;
  const src = resolveMedia(row.mediaUrl);
  if (!src) return null;
  return {
    kind: "track",
    id: row.id,
    title: row.title,
    artistName: row.creatorName,
    artworkUrl: row.artworkUrl,
    src,
    pagePath: `/track/${encodeURIComponent(row.id)}`,
    likeCount: row.likeCount,
    commentCount: 0,
    profileId: row.profileId,
  };
}

export function chartVideoPlayInput(row: ChartVideoRow): ShelfPlayInput | null {
  if (!row.mediaUrl) return null;
  const src = resolveMedia(row.mediaUrl);
  if (!src) return null;
  return {
    kind: "video",
    id: row.id,
    title: row.title,
    artistName: row.creatorName,
    artworkUrl: row.artworkUrl,
    src,
    pagePath: `/watch/${encodeURIComponent(row.id)}`,
    likeCount: row.likeCount,
    commentCount: 0,
    profileId: row.profileId,
  };
}


/* ─── The Follow contract ─────────────────────────────────────────────
   POST …/follow joins, DELETE …/unfollow leaves (the server's
   contract — there is no POST unfollow route). The response
   carries the authoritative { followed, follower_count }. */

export function followRequest(following: boolean): { method: "POST" | "DELETE"; suffix: "follow" | "unfollow" } {
  return following ? { method: "DELETE", suffix: "unfollow" } : { method: "POST", suffix: "follow" };
}

export function followUrl(profileId: string, following: boolean): string {
  return `/api/creator-profiles/${encodeURIComponent(profileId)}/${followRequest(following).suffix}`;
}

/** Read a follow response's authoritative state; null when the
 *  payload doesn't carry it (the caller keeps its last state). */
export function followStateFromResponse(payload: unknown): { followed: boolean; followerCount: number | null } | null {
  if (!isObj(payload) || typeof payload["followed"] !== "boolean") return null;
  return { followed: payload["followed"], followerCount: num(payload["follower_count"] ?? payload["followerCount"]) };
}

/** Shape the batched follow-state payload ({ "<profileId>": bool })
 *  into a plain map; anything else reads as "unknown" ({}). */
export function normalizeFollowStates(payload: unknown): Record<string, boolean> {
  if (!isObj(payload)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}
