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
 *   GET /api/discovery/brands           (for-brands scouting rows)
 *   GET /api/discovery/following?ids=…   (the walker's follow state)
 *   GET /api/discovery/likes?ids=…       (the walker's like state)
 *   GET /api/discovery/reposts?ids=…     (the walker's repost state)
 *   POST   /api/creator-profiles/:id/follow
 *   DELETE /api/creator-profiles/:id/unfollow
 * One read was added with the 2.15 listening-extras tail:
 * GET /api/discovery/reposts is the repost twin of the /likes read
 * (same shape, same discipline) — no other new back-end.
 * The For Brands tab's actions (P3) ride two more of the site's own
 * rails, the same ones the website's surfaces post to:
 *   POST   /api/brand-deals/outreach  (the pitch draft — 100 VB)
 *   POST   /api/ugc-briefs            (a brief on the Promote board)
 */

import { resolveMedia, type MediaKind } from "@/lib/streaming";
import { VERTICALS, VERTICAL_META, type VerticalKey } from "@/lib/verticals";
import { getCreditCost } from "@/lib/credit-costs";
import { UGC_STYLES, type UgcStyleKey } from "@/lib/ugc-ads";
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
  /** The row's repost counter (the Charts Repost button's starting
   *  count; the track repost rail returns the authoritative count). */
  repostCount: number;
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
  /** Brand rows only: the creator's most-published genre, and how
   *  much published work stands behind the audience (the /brands
   *  DTO's scouting fields). Null on every other creator read —
   *  those payloads don't carry them and nothing is guessed. */
  topGenre: string | null;
  trackCount: number | null;
  videoCount: number | null;
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
      repostCount: num(r["repost_count"] ?? r["repostCount"]) ?? 0,
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
      topGenre: str(r["top_genre"] ?? r["topGenre"]),
      trackCount: num(r["track_count"] ?? r["trackCount"]),
      videoCount: num(r["video_count"] ?? r["videoCount"]),
    });
  }
  return out;
}

/* ─── The window switcher seam ────────────────────────────────────────
   The board's windows are the charts API's own three — the same
   Today / This week / All time the website's /charts page offers.
   Windowed charts aggregate the play_events log (one row per play,
   timestamped), so Today and This week are real counts from the
   server, never the all-time list re-sliced on the client; the
   rows' `plays` already prefer window_plays (see the normalizers).
   Rising and Earners keep their own server-fixed spans (7 and 30
   days by definition) — the switcher never pretends to move them,
   so their paths below take no window at all. */

export type ChartWindow = "today" | "week" | "all";

export const CHART_WINDOWS: Array<{ key: ChartWindow; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All time" },
];

/** The noun board titles and empty states speak with:
 *  "Top tracks — today" / "Nothing is charting this week — yet." */
export function chartWindowNoun(window: ChartWindow): string {
  return window === "today" ? "today" : window === "week" ? "this week" : "all time";
}

/** The one charts read behind the Tracks + Videos tabs (both keys
 *  ride a single payload), at the walker's chosen window. Switching
 *  windows re-queries this path — the server aggregates per window. */
export function chartsMediaPath(window: ChartWindow, vertical: ChartVertical = "all"): string {
  return `/api/discovery/charts?window=${window}&limit=10${chartVerticalSuffix(vertical)}`;
}

/** The creators chart at the walker's chosen window. */
export function chartsCreatorsPath(window: ChartWindow, vertical: ChartVertical = "all"): string {
  return `/api/discovery/charts/creators?window=${window}&limit=10${chartVerticalSuffix(vertical)}`;
}

/* ─── The vertical switcher seam ──────────────────────────────────────
   The website /charts page's other switcher: the creator vertical
   (music, video, gaming…). Every discovery read the board rides
   accepts the same `vertical` query the page sends — the server
   filters its rows by the profile's stored vertical (an unknown
   value would silently unfilter, so ONLY the canonical keys from
   lib/verticals ever ride the path). Switching re-queries, exactly
   like the window switcher: a vertical's rows are the server's own
   filtered read, never the all-verticals list re-sliced on the
   client. "all" is the board's no-filter state and rides no param
   at all, keeping the unfiltered paths byte-identical to before. */

export type ChartVertical = VerticalKey | "all";

/** The switcher's choices, in the canonical order: the no-filter
 *  state first, then every vertical under its display label. */
export const CHART_VERTICALS: Array<{ key: ChartVertical; label: string }> = [
  { key: "all", label: "All verticals" },
  ...VERTICALS.map((key) => ({ key: key as ChartVertical, label: VERTICAL_META[key].label })),
];

/** The display label for a switcher state ("All verticals" / the
 *  vertical's own label) — board titles and empty states speak it. */
export function chartVerticalLabel(vertical: ChartVertical): string {
  return vertical === "all" ? "All verticals" : VERTICAL_META[vertical].label;
}

function chartVerticalSuffix(vertical: ChartVertical): string {
  return vertical === "all" ? "" : `&vertical=${vertical}`;
}

/** The fixed-span reads (Rising / Earners / Brands) at the walker's
 *  chosen vertical — the same server filter as the windowed reads;
 *  their spans stay fixed, only the vertical moves. */
export function chartsRisingPath(vertical: ChartVertical = "all"): string {
  return `/api/discovery/rising?limit=12${chartVerticalSuffix(vertical)}`;
}

export function chartsEarnersPath(vertical: ChartVertical = "all"): string {
  return `/api/discovery/rising-earners?limit=12${chartVerticalSuffix(vertical)}`;
}

export function chartsBrandsPath(vertical: ChartVertical = "all"): string {
  return `/api/discovery/brands?limit=12${chartVerticalSuffix(vertical)}`;
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
    repostCount: row.repostCount,
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

/* ─── The Like contract ───────────────────────────────────────────────
   A row's heart is keyed per kind+id — a track and a video never
   share one. The STARTING state comes from the server, never from a
   local assumption: the count off the chart row's DTO, and the
   walker's own liked flag off the batched like-state read
   (GET /api/discovery/likes — the /following pattern, media twin).
   Without that read a heart could only open unlit, and re-liking an
   already-liked upload would re-fire the like rail against a heart
   that was already the walker's. Toggling rides the media like
   rails (lib/streaming toggleLike: POST …/like, DELETE …/unlike),
   and the fold below takes the SERVER's answer — its count when it
   sends one, its liked verdict either way. */

export function chartLikeKey(kind: MediaKind, id: string): string {
  return `${kind}:${id}`;
}

/** The batched like-state query for the rows on show: one
 *  comma-joined `kind:id` list across both media tabs (they arrive
 *  in a single charts payload), de-duplicated. Null when there is
 *  nothing to ask about — the caller skips the read entirely. */
export function chartLikeIdsParam(tracks: ChartTrackRow[], videos: ChartVideoRow[]): string | null {
  const seen = new Set<string>();
  for (const r of tracks) seen.add(chartLikeKey("track", r.id));
  for (const r of videos) seen.add(chartLikeKey("video", r.id));
  return seen.size ? [...seen].join(",") : null;
}

/** Shape the batched like-state payload ({ "track:<id>": bool })
 *  into a plain map; anything else reads as "unknown" ({}), the
 *  same discipline as the follow-state read. */
export function normalizeLikeStates(payload: unknown): Record<string, boolean> {
  if (!isObj(payload)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Fold a like toggle's outcome into the row's heart. The server's
 *  answer rules: its liked verdict always, its count whenever it
 *  sends one; only when the count is absent does the fold step the
 *  last known count by the server's verdict (±1). A failed toggle
 *  never reaches this fold — the caller keeps the last state, so a
 *  heart never pretends. */
export function likeStateFromToggle(
  current: { liked: boolean; count: number },
  res: { liked: boolean; count: number | null },
): { liked: boolean; count: number } {
  return {
    liked: res.liked,
    count: res.count !== null ? res.count : Math.max(0, current.count + (res.liked ? 1 : -1)),
  };
}

/* ─── The Repost contract (2.15 — the listening-extras tail) ──────────
   A track row's Repost rides the track repost rail (lib/streaming
   toggleRepost: POST /api/tracks/:id/repost, DELETE …/unrepost) —
   the same rail the website's track page and the Now Playing card
   ride. Reposts are tracks-only: the rail has no video form, so
   video rows never carry the button (the card's discipline too).
   The STARTING state comes from the server, never from a local
   assumption: the count off the chart row's DTO, and the walker's
   own reposted flag off the batched repost-state read
   (GET /api/discovery/reposts — the /likes pattern, repost twin).
   Without that read a row could only open unreposted, and pressing
   Repost on an already-reposted track would re-fire the POST rail,
   whose counter bump does not know the repost row already existed.
   The fold takes the SERVER's answer, exactly like the Like fold. */

/** The batched repost-state query for the track rows on show: one
 *  comma-joined `track:<id>` list (tracks only — videos have no
 *  repost state to ask about), de-duplicated. Null when there are
 *  no track rows — the caller skips the read entirely. */
export function chartRepostIdsParam(tracks: ChartTrackRow[]): string | null {
  const seen = new Set<string>();
  for (const r of tracks) seen.add(chartLikeKey("track", r.id));
  return seen.size ? [...seen].join(",") : null;
}

/** Shape the batched repost-state payload ({ "track:<id>": bool })
 *  into a plain map; anything else reads as "unknown" ({}), the
 *  same discipline as the like-state read. */
export function normalizeRepostStates(payload: unknown): Record<string, boolean> {
  return normalizeLikeStates(payload);
}

/** Fold a repost toggle's outcome into the row's state. The
 *  server's answer rules: its reposted verdict always, its count
 *  whenever it sends one; only when the count is absent does the
 *  fold step the last known count by the server's verdict (±1).
 *  A failed toggle never reaches this fold — the caller keeps the
 *  last state, so a row never pretends. */
export function repostStateFromToggle(
  current: { reposted: boolean; count: number },
  res: { reposted: boolean; count: number | null },
): { reposted: boolean; count: number } {
  const folded = likeStateFromToggle(
    { liked: current.reposted, count: current.count },
    { liked: res.reposted, count: res.count },
  );
  return { reposted: folded.liked, count: folded.count };
}

/* ─── The brand outreach seam (For Brands, P3) ────────────────────────
   The For Brands tab used to door outreach to the website. The
   pitch half now happens in-world, on the site's own outreach rail
   — POST /api/brand-deals/outreach, the exact endpoint the Brand
   Deals page's draft button posts to, with the exact body the page
   sends: the brand, the deal type as its display label, the
   creator's name / niche / audience band / platforms / style. The
   rail charges 100 VB per draft (the credit registry's pin, the
   page's own price), auto-refunds a failed generation server-side,
   and answers { outreach: { subject, message }, tips, creditsUsed,
   creditsRemaining }. The vocabularies below mirror the route's
   own (routes/generate/brand-deals.ts AUDIENCE_LABEL /
   DEAL_TYPE_LABEL / the page's platform presets) — the route
   validates audienceSize against its enum and rejects the rest,
   so the builder below refuses an un-sendable form rather than
   letting the walker pay for a 400. */

export const BRAND_OUTREACH_COST_VB =
  getCreditCost("/api/brand-deals/outreach")?.cost ?? 100;

export const BRAND_OUTREACH_AUDIENCE_SIZES = [
  { key: "under-1k", label: "Under 1K followers" },
  { key: "1k-10k", label: "1K – 10K followers" },
  { key: "10k-50k", label: "10K – 50K followers" },
  { key: "50k-250k", label: "50K – 250K followers" },
  { key: "250k-plus", label: "250K+ followers" },
] as const;

export type BrandOutreachAudienceSize =
  (typeof BRAND_OUTREACH_AUDIENCE_SIZES)[number]["key"];

/** Deal types by their finder key; the payload carries the LABEL —
 *  the page sends the deal's display type and the route reads it
 *  as a plain string. "" (Any) sends no dealType at all. */
export const BRAND_OUTREACH_DEAL_TYPES = [
  { key: "sponsored-post", label: "Sponsored Post" },
  { key: "affiliate", label: "Affiliate" },
  { key: "ambassadorship", label: "Ambassadorship" },
  { key: "product-gifting", label: "Product Gifting" },
  { key: "usage-licensing", label: "Usage Licensing" },
] as const;

export type BrandOutreachDealType = (typeof BRAND_OUTREACH_DEAL_TYPES)[number]["key"];

/** The page's platform presets (the finder/outreach shared list). */
export const BRAND_OUTREACH_PLATFORMS = ["TikTok", "Instagram", "YouTube", "Twitch", "X"] as const;

/** The page's own opening selection. */
export const BRAND_OUTREACH_DEFAULT_PLATFORMS: string[] = ["TikTok", "Instagram"];

export interface BrandOutreachInput {
  brand: string;
  /** A BRAND_OUTREACH_DEAL_TYPES key, or "" for no specific type. */
  dealTypeKey: string;
  creatorName: string;
  niche: string;
  audienceSize: string;
  platforms: string[];
  contentStyle: string;
}

/** Shape the form into the outreach rail's exact body, or null
 *  when the form can't honestly send: the route requires a brand,
 *  a creator name, a niche, an audience band from its enum, and
 *  at least one platform. Length caps mirror the route's schema,
 *  so what sends is what the route accepts. */
export function buildBrandOutreachPayload(input: BrandOutreachInput): Record<string, unknown> | null {
  const brand = input.brand.trim().slice(0, 120);
  const creatorName = input.creatorName.trim().slice(0, 100);
  const niche = input.niche.trim().slice(0, 100);
  if (!brand || !creatorName || !niche) return null;
  if (!BRAND_OUTREACH_AUDIENCE_SIZES.some((a) => a.key === input.audienceSize)) return null;
  const platforms = [...new Set(input.platforms.map((p) => p.trim()).filter(Boolean))]
    .map((p) => p.slice(0, 50))
    .slice(0, 8);
  if (platforms.length === 0) return null;
  const deal = BRAND_OUTREACH_DEAL_TYPES.find((d) => d.key === input.dealTypeKey);
  return {
    brand,
    dealType: deal ? deal.label : "",
    creatorName,
    niche,
    audienceSize: input.audienceSize,
    platforms,
    contentStyle: input.contentStyle.trim().slice(0, 200),
  };
}

export interface BrandOutreachResult {
  subject: string;
  message: string;
  tips: string[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/** Read a draft response; null when it carries no usable draft —
 *  the caller then shows the rail's error, never an empty card. */
export function normalizeBrandOutreachResult(payload: unknown): BrandOutreachResult | null {
  if (!isObj(payload) || !isObj(payload["outreach"])) return null;
  const subject = str(payload["outreach"]["subject"]);
  const message = str(payload["outreach"]["message"]);
  if (!subject || !message) return null;
  const tips = Array.isArray(payload["tips"])
    ? payload["tips"].filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  return {
    subject,
    message,
    tips,
    creditsUsed: num(payload["creditsUsed"]),
    creditsRemaining: num(payload["creditsRemaining"]),
  };
}

/** The words for a refused or failed draft: the rail's own message
 *  first (its 402 names the empty purse; its 502 names the refund),
 *  a plain fallback after — the form never invents an outcome. */
export function brandOutreachErrorMessage(payload: unknown, status: number): string {
  if (isObj(payload)) {
    const message = str(payload["message"]);
    if (message) return message;
    const error = str(payload["error"]);
    if (error && error !== "out_of_credits" && error !== "generation_failed") return error;
  }
  if (status === 402) return "You're out of Visual Bucs — top up to draft a pitch.";
  return "The draft didn't go through — try again.";
}

/* ─── The UGC brief seam (For Brands, P3) ─────────────────────────────
   The brief half of the tab's outreach: posting a brief on the
   Promote board, in-world, on the site's own brief rail —
   POST /api/ugc-briefs, the exact endpoint the Promote page posts
   to. A brief carries NO charge (v1 briefs move no money — the
   UGC_PAYMENT_NOTE rides the panel, as it rides the board) and
   answers 201 { brief }. The builder mirrors the route's create
   schema: a product name, at least ten characters of "what you
   want", a style from the UGC style list, and optional http(s)
   product link / deadline. Anything else returns null — the form
   refuses rather than sending the walker into a 400. */

export interface UgcBriefInput {
  productName: string;
  productUrl: string;
  details: string;
  /** A UGC_STYLES key. */
  style: string;
  /** A date string (the form's date input value), or "" for none. */
  deadline: string;
}

export function buildUgcBriefPayload(input: UgcBriefInput): Record<string, unknown> | null {
  const productName = input.productName.trim().slice(0, 120);
  const details = input.details.trim().slice(0, 2000);
  if (!productName || details.length < 10) return null;
  if (!UGC_STYLES.some((s) => s.key === input.style)) return null;
  const productUrl = input.productUrl.trim().slice(0, 2048);
  if (productUrl && !/^https?:\/\//i.test(productUrl)) return null;
  const out: Record<string, unknown> = {
    productName,
    details,
    style: input.style as UgcStyleKey,
  };
  if (productUrl) out["productUrl"] = productUrl;
  const deadline = input.deadline.trim().slice(0, 40);
  if (deadline) out["deadline"] = deadline;
  return out;
}

export interface UgcBriefResult {
  id: string;
  productName: string;
  status: string;
}

/** Read a posted brief's answer; null when it carries no brief —
 *  the caller shows the rail's error instead of a success line. */
export function normalizeUgcBriefResult(payload: unknown): UgcBriefResult | null {
  if (!isObj(payload) || !isObj(payload["brief"])) return null;
  const brief = payload["brief"];
  const id = str(brief["id"]);
  const productName = str(brief["productName"]);
  if (!id || !productName) return null;
  return { id, productName, status: str(brief["status"]) ?? "open" };
}

/** The words for a refused brief: the rail's own error first (its
 *  400s name the field), a plain fallback after. */
export function ugcBriefErrorMessage(payload: unknown, status: number): string {
  if (isObj(payload)) {
    const error = str(payload["error"]);
    if (error) return error;
    const message = str(payload["message"]);
    if (message) return message;
  }
  void status;
  return "That brief couldn't post — try again.";
}
