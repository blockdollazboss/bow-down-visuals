/* ─── upg-fans FE seam (#175 Collab Match · N16 Audience Room · N17 Fan Links)
   Pure view-model helpers for the three fan/creator panels. The panels own
   fetching; everything testable about how a server payload becomes what
   the creator sees lives here.

   Honesty rules carried over from the server cores:
   - Audience Room fan city is reported unavailable by the API and is
     rendered as unavailable — never mapped, never estimated.
   - Fan Link numbers are proven counts only (clicks / arrivals / signups
     the server recorded); an arrival rate exists only when clicks > 0. */

export const COLLAB_MATCH_PATH = "/api/collab-match";
export const FAN_LINKS_MINE_PATH = "/api/fan-links/mine";
export const FAN_LINKS_FOR_ME_PATH = "/api/fan-links/for-me";
export const FAN_LINKS_MINT_PATH = "/api/fan-links";
export const AUDIENCE_ROOM_PATH = "/api/audience-room";

export function collabMatchMarkPath(id: string): string {
  return `/api/collab-match/${encodeURIComponent(id)}/mark`;
}

/* ── #175 Collab Match ─────────────────────────────────────────────────── */

export interface CollabSuggestion {
  id: string;
  status: "open" | "connected" | "closed";
  score: number;
  reasons: string[];
  myStatus: "pending" | "interested" | "passed";
  introRequestId: string | null;
  createdAt: string;
  other: {
    userId: string;
    displayName: string;
    niche: string;
    platforms: { platform: string; followers: number }[];
  } | null;
}

export interface CollabMatchResponse {
  hasProfile: boolean;
  suggestions: CollabSuggestion[];
}

/* What the viewer can still do with a suggestion. Contact exists ONLY
   through the broker: an open suggestion the viewer hasn't answered can
   be marked; once they've answered, the ball is with the other side (or
   the pair is connected) and no further action is offered. */
export type SuggestionAction = "answer" | "waiting" | "connected" | "none";

export function suggestionAction(s: Pick<CollabSuggestion, "status" | "myStatus">): SuggestionAction {
  if (s.status === "connected") return "connected";
  if (s.status !== "open") return "none";
  return s.myStatus === "pending" ? "answer" : "waiting";
}

/* Score → the same 0–100 banding the collabs page uses for match reports. */
export function suggestionScoreLabel(score: number): string {
  if (score >= 80) return "Strong match";
  if (score >= 60) return "Good match";
  if (score >= 40) return "Possible match";
  return "Long-shot match";
}

/* ── N17 Fan Links ─────────────────────────────────────────────────────── */

export const FAN_LINK_CONTENT_TYPES = [
  "video",
  "song",
  "thumbnail",
  "showcase",
  "image",
  "review_link",
  "winner_card",
  "other",
] as const;
export type FanLinkContentType = (typeof FAN_LINK_CONTENT_TYPES)[number];

export interface FanLinkStats {
  linkId: string;
  clicks: number;
  arrivals: number;
  signups: number;
  arrivalRate: number | null;
}

export interface FanLink {
  id: string;
  code: string;
  fanUserId: string;
  creatorUserId: string;
  contentType: string;
  contentId: string | null;
  createdAt: string;
  path: string;
  stats: FanLinkStats;
}

export interface FanLinksMineResponse {
  links: FanLink[];
}

export interface FanLinkForMe extends Omit<FanLink, "path"> {
  fanDisplayName: string;
}

export interface FanLinksForMeResponse {
  rollup: {
    totalLinks: number;
    totalClicks: number;
    totalArrivals: number;
    totalSignups: number;
  };
  topFans: {
    fanUserId: string;
    clicks: number;
    arrivals: number;
    signups: number;
    displayName: string;
  }[];
  links: FanLinkForMe[];
}

/* The shareable URL a fan copies: the public redirect path on this origin. */
export function fanLinkShareUrl(origin: string, path: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/* "3 clicks · 2 arrivals · 1 signup" — proven counts, in funnel order.
   The arrival rate rides along only when the server could prove one. */
export function fanLinkStatsLine(stats: FanLinkStats): string {
  const parts = [
    `${stats.clicks} click${stats.clicks === 1 ? "" : "s"}`,
    `${stats.arrivals} arrival${stats.arrivals === 1 ? "" : "s"}`,
    `${stats.signups} signup${stats.signups === 1 ? "" : "s"}`,
  ];
  if (stats.arrivalRate !== null) {
    parts.push(`${Math.round(stats.arrivalRate * 100)}% arrived`);
  }
  return parts.join(" · ");
}

export function fanLinkContentLabel(contentType: string, contentId: string | null): string {
  const label = contentType.replace(/_/g, " ");
  return contentId ? `${label} · ${contentId}` : label;
}

/* ── N16 Audience Room ─────────────────────────────────────────────────── */

export interface AudienceRoomResponse {
  windowDays: number;
  totalPlays: number;
  trackedPlays: number;
  untrackedPlays: number;
  hourly: number[];
  peak: { hour: number; plays: number; label: string } | null;
  sources: { source: string; plays: number; pct: number }[];
  fanCity: { available: false; reason: string };
}

/* Bar height as a 0–100 percentage of the busiest hour; an all-zero day
   renders flat instead of dividing by zero. */
export function hourBarPct(plays: number, hourly: number[]): number {
  const max = Math.max(0, ...hourly);
  if (max <= 0 || plays <= 0) return 0;
  return Math.round((plays / max) * 100);
}

export function hourAxisLabel(hour: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hour)}:00`;
}

export const PLAY_SOURCE_LABELS: Record<string, string> = {
  profile: "Creator profile",
  feed: "Feed",
  charts: "Charts",
  search: "Search",
  playlist: "Playlists",
  world: "The World",
  fan_link: "Fan links",
  direct: "Direct plays",
  other: "Other declared sources",
};

export function playSourceLabel(source: string): string {
  return PLAY_SOURCE_LABELS[source] ?? "Other declared sources";
}
