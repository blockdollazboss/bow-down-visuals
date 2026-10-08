import { mediaUrl } from "@/lib/media-cdn";

/* ─── Creator Streaming Platform — shared types + API client ───
   Worker 2 (streaming player). Mirrors Worker 1's DB/API contract:
   tables profile_tracks / profile_videos / playlists, endpoints
   GET /api/creator-profiles/:slug, POST /api/media/:kind/:id/play,
   like/unlike, repost/unrepost, GET/POST /api/media/:kind/:id/comments.
   Media-neutral: covers every vertical (music, podcast, gaming, film…).
   Audio = track rows, video = video rows — series/episode aware. */

export type MediaKind = "track" | "video";

export interface StreamTrack {
  id: string;
  profile_id: string;
  title: string;
  audio_url: string;
  artwork_url: string | null;
  genre: string | null;
  tags: string[] | null;
  duration_sec: number | null;
  download_price_cents: number | null;
  play_count: number;
  like_count: number;
  repost_count: number;
  comment_count: number;
  is_published: boolean;
  /** Ownership (when the API provides it) — drives the Get Paid finale. */
  is_owner?: boolean;
  owner_user_id?: string | null;
}

export interface StreamVideo {
  id: string;
  profile_id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  duration_sec: number | null;
  description: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  is_published: boolean;
  /** Ownership (when the API provides it) — drives the Get Paid finale. */
  is_owner?: boolean;
  owner_user_id?: string | null;
  /** Series/episode metadata (optional — shown as "S1 E3" when present). */
  season_number?: number | null;
  episode_number?: number | null;
  series_title?: string | null;
  /** Linked sound (server resolves sound_track_id). */
  sound?: {
    id: string;
    title: string;
    audio_url: string;
    artwork_url: string | null;
    profile_slug: string;
  } | null;
}

export interface PlaylistItemRef {
  kind: MediaKind;
  id: string;
}

export interface StreamPlaylist {
  id: string;
  owner_profile_id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  items: PlaylistItemRef[];
  follower_count: number;
  /** Playlist flavor: "series" playlists group items by season. */
  kind?: string | null;
  /** Resolved items (server expands ids). Present when the API returns them. */
  resolved_items?: Array<
    | { kind: "track"; item: StreamTrack }
    | { kind: "video"; item: StreamVideo }
  >;
}

export interface StreamProfileRef {
  id: string;
  slug: string | null;
  display_name: string;
  avatar_url: string | null;
}

export interface MediaComment {
  id: string;
  user_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  body: string;
  created_at: string;
}

/**
 * Resolve a media URL from the DB. Absolute URLs pass through untouched;
 * relative paths (e.g. "audio/x.mp3" or "/audio/x.mp3") go through the
 * CDN-aware mediaUrl() helper. Empty input yields "".
 */
export function resolveMedia(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  if (/^(https?:|blob:|data:)/i.test(s)) return s;
  return mediaUrl(s);
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatCount(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(v);
}

/** "S1 E3" style label when season/episode metadata is present, else "". */
export function formatSeriesLabel(season?: number | null, episode?: number | null): string {
  const s = season != null && Number.isFinite(season) ? `S${season}` : "";
  const e = episode != null && Number.isFinite(episode) ? `E${episode}` : "";
  return [s, e].filter(Boolean).join(" ");
}

/**
 * Checkout path for a paid download. Worker 5 owns the storefront — this is
 * the agreed handoff surface. Update here if the checkout route changes.
 */
export function downloadCheckoutPath(kind: MediaKind, id: string): string {
  return `/checkout/${kind}/${encodeURIComponent(id)}`;
}

/* ─── Share helpers (virality) ─── */

let myReferralCode: string | null | undefined;

/** The viewer's own referral code, for ?ref=CODE share links. Cached. */
export async function getMyReferralCode(getAccessToken?: () => Promise<string | null>): Promise<string | null> {
  if (myReferralCode !== undefined) return myReferralCode;
  myReferralCode = null;
  try {
    const token = getAccessToken ? await getAccessToken() : null;
    if (!token) return null;
    const r = await fetch("/api/referrals/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    if (typeof d.code === "string" && d.code) myReferralCode = d.code.toUpperCase();
  } catch { /* guests simply share without a code */ }
  return myReferralCode;
}

/** Canonical share URL for a media page, carrying the viewer's referral code. */
export function shareUrl(path: string, refCode?: string | null): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://bowdownvisuals.com";
  const base = path.startsWith("/") ? path : `/${path}`;
  return refCode ? `${origin}${base}?ref=${encodeURIComponent(refCode)}` : `${origin}${base}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/* ─── API client ───
   Every endpoint is best-effort — Worker 1's API may still be landing, so
   all callers degrade to local fallbacks. */

export function unwrap<T>(d: any): T | null {
  if (!d) return null;
  if (d.track) return d.track as T;
  if (d.video) return d.video as T;
  if (d.playlist) return d.playlist as T;
  if (d.item) return d.item as T;
  return d as T;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchTrack(id: string): Promise<{ track: StreamTrack; artist?: StreamProfileRef } | null> {
  const d = await getJson<any>(`/api/media/track/${encodeURIComponent(id)}`);
  if (!d) return null;
  const track = unwrap<StreamTrack>(d);
  if (!track || !track.id) return null;
  return { track, artist: d.artist ?? d.profile ?? undefined };
}

export async function fetchVideo(id: string): Promise<{ video: StreamVideo; artist?: StreamProfileRef } | null> {
  const d = await getJson<any>(`/api/media/video/${encodeURIComponent(id)}`);
  if (!d) return null;
  const video = unwrap<StreamVideo>(d);
  if (!video || !video.id) return null;
  return { video, artist: d.artist ?? d.profile ?? undefined };
}

export async function fetchPlaylist(id: string): Promise<{ playlist: StreamPlaylist; owner?: StreamProfileRef } | null> {
  const d = await getJson<any>(`/api/playlists/${encodeURIComponent(id)}`);
  if (!d) return null;
  const playlist = unwrap<StreamPlaylist>(d);
  if (!playlist || !playlist.id) return null;
  return { playlist, owner: d.owner ?? d.profile ?? undefined };
}

export async function fetchMoreFromArtist(
  profileId: string,
  kind: MediaKind,
  excludeId: string,
  limit = 8,
): Promise<Array<{ kind: MediaKind; id: string; title: string; thumb: string | null; plays: number; season?: number | null; episode?: number | null }>> {
  // Primary: profile-scoped media listing (Worker 1 contract via creator-profiles).
  const profile = await getJson<any>(
    `/api/creator-profiles/${encodeURIComponent(profileId)}/media?kind=${kind}&limit=${limit + 1}`,
  );
  const items = profile?.items ?? profile?.media ?? profile?.[kind === "track" ? "tracks" : "videos"] ?? null;
  if (Array.isArray(items)) {
    return items
      .filter((m: any) => String(m.id) !== String(excludeId))
      .slice(0, limit)
      .map((m: any) => ({
        kind,
        id: String(m.id),
        title: m.title ?? "Untitled",
        thumb: m.artwork_url ?? m.thumbnail_url ?? null,
        plays: m.play_count ?? m.view_count ?? 0,
        season: m.season_number ?? null,
        episode: m.episode_number ?? null,
      }));
  }
  return [];
}

/** Fire-and-forget play count. Safe to call blindly — never throws. */
export function recordPlay(kind: MediaKind, id: string): void {
  try {
    fetch(`/api/media/${kind}/${encodeURIComponent(id)}/play`, { method: "POST" }).catch(() => {});
  } catch { /* noop */ }
}

/** Toggle like. Returns the server's like_count when available, else null.
    Worker 1 API: POST /api/media/:kind/:id/like, DELETE .../unlike. */
export async function toggleLike(
  kind: MediaKind,
  id: string,
  liked: boolean,
  headers: Record<string, string>,
): Promise<{ liked: boolean; count: number | null }> {
  const path = `/api/media/${kind}/${encodeURIComponent(id)}/${liked ? "unlike" : "like"}`;
  const r = await fetch(path, { method: liked ? "DELETE" : "POST", headers: { ...headers, "Content-Type": "application/json" } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Like failed");
  return {
    liked: typeof d.liked === "boolean" ? d.liked : !liked,
    count: typeof d.like_count === "number" ? d.like_count : null,
  };
}

/** Toggle repost (tracks only).
    Worker 1 API: POST /api/tracks/:id/repost, DELETE /api/tracks/:id/unrepost. */
export async function toggleRepost(
  id: string,
  reposted: boolean,
  headers: Record<string, string>,
): Promise<{ reposted: boolean; count: number | null }> {
  const path = `/api/tracks/${encodeURIComponent(id)}/${reposted ? "unrepost" : "repost"}`;
  const r = await fetch(path, { method: reposted ? "DELETE" : "POST", headers: { ...headers, "Content-Type": "application/json" } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Repost failed");
  return {
    reposted: typeof d.reposted === "boolean" ? d.reposted : !reposted,
    count: typeof d.repost_count === "number" ? d.repost_count : null,
  };
}

export async function fetchComments(kind: MediaKind, id: string): Promise<MediaComment[]> {
  const d = await getJson<any>(`/api/media/${kind}/${encodeURIComponent(id)}/comments`);
  if (!d) return [];
  const list = Array.isArray(d) ? d : d.comments ?? [];
  return Array.isArray(list) ? list : [];
}

export async function postComment(
  kind: MediaKind,
  id: string,
  body: string,
  headers: Record<string, string>,
): Promise<MediaComment> {
  const r = await fetch(`/api/media/${kind}/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Comment failed");
  return unwrap<MediaComment>(d) ?? ({ body, created_at: new Date().toISOString() } as MediaComment);
}

export async function togglePlaylistFollow(
  playlistId: string,
  following: boolean,
  headers: Record<string, string>,
): Promise<{ following: boolean; count: number | null }> {
  const r = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/${following ? "unfollow" : "follow"}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Follow failed");
  return {
    following: typeof d.following === "boolean" ? d.following : !following,
    count: typeof d.follower_count === "number" ? d.follower_count : null,
  };
}

/* ─── Viewer playlists (add-to-playlist) ───
   PROPOSED contract for Worker 1 — not yet on the server (2026-10-07):
   GET  /api/playlists/mine          -> { playlists: [{id,title,cover_url,item_count}] }
   POST /api/playlists               -> { playlist }            (body: {title})
   POST /api/playlists/:id/items     -> { ok: true }            (body: {kind, id})
   All require auth. Every caller degrades gracefully when 404. */

export interface MyPlaylist {
  id: string;
  title: string;
  cover_url: string | null;
  item_count?: number;
}

async function authedJson<T>(path: string, headers: Record<string, string>, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(path, {
      ...init,
      headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchMyPlaylists(headers: Record<string, string>): Promise<MyPlaylist[] | null> {
  const d = await authedJson<any>("/api/playlists/mine", headers);
  if (!d) return null;
  const list = Array.isArray(d) ? d : d.playlists ?? [];
  return Array.isArray(list) ? list : null;
}

export async function createPlaylist(title: string, headers: Record<string, string>): Promise<MyPlaylist | null> {
  const d = await authedJson<any>("/api/playlists", headers, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  if (!d) return null;
  return unwrap<MyPlaylist>(d);
}

export async function addItemToPlaylist(
  playlistId: string,
  kind: MediaKind,
  id: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const d = await authedJson<any>(`/api/playlists/${encodeURIComponent(playlistId)}/items`, headers, {
    method: "POST",
    body: JSON.stringify({ kind, id }),
  });
  return d !== null;
}

/** Resolve a creator's storefront slug (best-effort; null when none). */
export async function resolveStoreSlug(artistSlug: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/storefronts/slug/${encodeURIComponent(artistSlug)}`);
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    const slug = d?.storefront?.slug ?? d?.slug ?? null;
    return typeof slug === "string" && slug ? slug : null;
  } catch {
    return null;
  }
}
