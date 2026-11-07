/**
 * trends-radar — the seam behind the Promote Room's native
 * Trend Radar bench (stack200 world parity lane B1, census
 * item 1; the Nov 2 census counted tab-trends PARTIAL — the
 * TrendsDesk beside it is the paid Predictor, and the radar
 * itself had no World consumer).
 *
 * Source of truth: artifacts/api-server/src/routes/trend-radar.ts
 * and lib/trend-radar.ts, rendered on the website by
 * components/TrendRadar.tsx. ONE free rail, read-only:
 *   GET /api/trend-radar (requireAuth)
 *     → { generatedAt, window, sounds[], topics[], formats[],
 *         outsideHeat }
 * Every on-site row is a REAL play_events count (last 24h vs
 * the prior 7 days) behind the server's verified-count gates
 * (≥25 plays/24h and ≥2.5× baseline, or a ≥50-play cold start).
 * Nothing here is predicted, and this seam never estimates: a
 * row whose numbers are missing or malformed is DROPPED, and
 * a payload that isn't the feed's shape parses to null so the
 * bench shows its error state — never a dressed-up empty list.
 *
 * C-30's outside-heat family rides the same response as its
 * own additive `outsideHeat` block (YouTube's most-popular
 * music chart, YouTube's own numbers, labeled on the family
 * and every row). It is null whenever the YouTube key is
 * unconfigured or the chart is unreachable — the bench then
 * renders exactly as if the family didn't exist. This seam
 * keeps that dormancy total: no videos after honest filtering
 * → outsideHeat is null, and no velocity is ever computed
 * from the outside rows.
 *
 * No charge seam: the rail is free, the bench confirms no
 * spend, and there is deliberately no "use this trend"
 * action — the bench is the radar, read-only, mirroring the
 * census's build sketch. Copy rides the website rail's own
 * catalog namespace (trends.radar.*) so the labels can never
 * drift from the page's; the desk's palace framing lives in
 * worldTrendsRadar.*.
 */

export const TREND_RADAR_PATH = "/api/trend-radar";

export interface RadarVelocity {
  currentPlays: number;
  baselineDaily: number;
  /** current / baselineDaily, or null for a cold start. */
  velocity: number | null;
  coldStart: boolean;
}

export interface RadarSound {
  mediaId: string;
  title: string;
  genre: string | null;
  slug: string;
  trend: RadarVelocity;
}

export interface RadarTopic {
  genre: string;
  trend: RadarVelocity;
}

export type RadarFormatKind = "short" | "duet" | "stitch" | "full";

export interface RadarFormat {
  format: RadarFormatKind;
  trend: RadarVelocity;
}

/** C-30 outside heat — deliberately NOT shaped like the
 *  on-site families: no velocity, no pace, no create link.
 *  A snapshot with a click-through to the video on YouTube. */
export interface OutsideHeatVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  viewCount: number;
  thumbnailUrl: string | null;
  url: string;
  source: string;
}

export interface OutsideHeat {
  source: string;
  region: string;
  videos: OutsideHeatVideo[];
}

export interface TrendRadarFeed {
  generatedAt: string;
  sounds: RadarSound[];
  topics: RadarTopic[];
  formats: RadarFormat[];
  /** Null whenever the outside family is dormant. */
  outsideHeat: OutsideHeat | null;
}

export const RADAR_FORMATS: readonly RadarFormatKind[] = ["short", "duet", "stitch", "full"];

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function finiteNonNegative(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function velocityOf(raw: unknown): RadarVelocity | null {
  const o = obj(raw);
  if (!o) return null;
  const currentPlays = finiteNonNegative(o["currentPlays"]);
  const baselineDaily = finiteNonNegative(o["baselineDaily"]);
  if (currentPlays === null || baselineDaily === null) return null;
  const velocity =
    o["velocity"] === null
      ? null
      : typeof o["velocity"] === "number" && Number.isFinite(o["velocity"])
        ? o["velocity"]
        : undefined;
  if (velocity === undefined) return null;
  return { currentPlays, baselineDaily, velocity, coldStart: o["coldStart"] === true };
}

function soundOf(raw: unknown): RadarSound | null {
  const o = obj(raw);
  if (!o) return null;
  const mediaId = typeof o["mediaId"] === "string" ? o["mediaId"] : "";
  const title = typeof o["title"] === "string" ? o["title"].trim() : "";
  const trend = velocityOf(o["trend"]);
  if (!mediaId || !title || !trend) return null;
  return {
    mediaId,
    title,
    genre: typeof o["genre"] === "string" ? o["genre"] : null,
    slug: typeof o["slug"] === "string" ? o["slug"] : "",
    trend,
  };
}

function topicOf(raw: unknown): RadarTopic | null {
  const o = obj(raw);
  if (!o) return null;
  const genre = typeof o["genre"] === "string" ? o["genre"].trim() : "";
  const trend = velocityOf(o["trend"]);
  if (!genre || !trend) return null;
  return { genre, trend };
}

function formatOf(raw: unknown): RadarFormat | null {
  const o = obj(raw);
  if (!o) return null;
  const format = o["format"];
  if (typeof format !== "string" || !(RADAR_FORMATS as readonly string[]).includes(format)) {
    return null;
  }
  const trend = velocityOf(o["trend"]);
  if (!trend) return null;
  return { format: format as RadarFormatKind, trend };
}

/** The server's honesty rule, re-checked at the seam: a row
 *  with no id, no title, or no real view count cannot be
 *  labeled honestly, so it is dropped — never estimated. */
function outsideVideoOf(raw: unknown): OutsideHeatVideo | null {
  const o = obj(raw);
  if (!o) return null;
  const videoId = typeof o["videoId"] === "string" ? o["videoId"] : "";
  const title = typeof o["title"] === "string" ? o["title"].trim() : "";
  const viewCount = finiteNonNegative(o["viewCount"]);
  if (!videoId || !title || viewCount === null) return null;
  return {
    videoId,
    title,
    channelTitle: typeof o["channelTitle"] === "string" ? o["channelTitle"] : "",
    viewCount,
    thumbnailUrl: typeof o["thumbnailUrl"] === "string" ? o["thumbnailUrl"] : null,
    url: typeof o["url"] === "string" ? o["url"] : "",
    source: typeof o["source"] === "string" ? o["source"] : "",
  };
}

function outsideHeatOf(raw: unknown): OutsideHeat | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o["videos"])) return null;
  const videos = o["videos"].map(outsideVideoOf).filter((v): v is OutsideHeatVideo => v !== null);
  /* Dormancy is total: an empty family renders nothing at all. */
  if (videos.length === 0) return null;
  return {
    source: typeof o["source"] === "string" ? o["source"] : "",
    region: typeof o["region"] === "string" ? o["region"] : "",
    videos,
  };
}

/** Parse the rail's answer. Null = the payload is not the
 *  feed (an error body, a shape drift) — the bench shows its
 *  honest error state rather than an empty radar. A genuine
 *  quiet day parses fine with three empty families: fewer
 *  rows is the honest answer, and the page's all-empty copy
 *  says so. */
export function trendRadarFeedOf(data: unknown): TrendRadarFeed | null {
  const o = obj(data);
  if (!o) return null;
  if (!Array.isArray(o["sounds"]) || !Array.isArray(o["topics"]) || !Array.isArray(o["formats"])) {
    return null;
  }
  return {
    generatedAt: typeof o["generatedAt"] === "string" ? o["generatedAt"] : "",
    sounds: o["sounds"].map(soundOf).filter((s): s is RadarSound => s !== null),
    topics: o["topics"].map(topicOf).filter((s): s is RadarTopic => s !== null),
    formats: o["formats"].map(formatOf).filter((s): s is RadarFormat => s !== null),
    outsideHeat: outsideHeatOf(o["outsideHeat"]),
  };
}

/** True when the on-site families are all empty (the outside
 *  family never counts toward "something is moving here"). */
export function radarAllEmpty(feed: TrendRadarFeed): boolean {
  return feed.sounds.length === 0 && feed.topics.length === 0 && feed.formats.length === 0;
}
