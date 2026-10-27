/* ─── Trend Radar (#178) — UPGRADE of Trends / Trend Predictor ─────────
   The /trends page's forecast is an AI prediction. This delta adds the
   REAL-SIGNAL daily feed the audit scoped next to it:

   - SOUNDS: individual tracks gaining speed right now, attachable in
     one tap (Create opens with the sound attached).
   - TOPICS: genres gaining speed across tracks + videos.
   - FORMATS: video format classes gaining speed — shorts, duets,
     stitches, full videos (real columns on profile_videos).

   HONEST-DATA RULE (absolute, from the audit): every number here is a
   real play_events count over real windows — last 24 hours against
   the prior 7 days, the same windows the charts and the spike watch
   read. Nothing is predicted, padded, or labeled "rising" on stale
   data: a family with no qualifying signal returns FEWER rows, or
   none. AI prediction is never a source here.

   A trend qualifies only with real mass AND real lift:
   ≥25 plays in 24h and ≥2.5× its own baseline pace — or a cold start
   (no baseline at all) with ≥50 plays in 24h. */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

export const TREND_RADAR = {
  /** Minimum plays in the last 24h for any trend to qualify. */
  minCurrentPlays: 25,
  /** Minimum lift over the item's own baseline daily pace. */
  minVelocity: 2.5,
  /** Cold start (zero baseline): the 24h mass that qualifies alone. */
  coldStartPlays: 50,
  /** Rows per family, max. Fewer is an honest answer. */
  limit: 10,
} as const;

export interface TrendVelocity {
  currentPlays: number;
  baselineDaily: number;
  /** current / baselineDaily, or null for a cold start (no baseline). */
  velocity: number | null;
  coldStart: boolean;
}

/** The shared qualification rule. Pure — the feed's honesty lives here. */
export function evaluateTrend(currentPlays: number, baselinePlays: number): TrendVelocity | null {
  const baselineDaily = baselinePlays / 7;
  if (currentPlays < TREND_RADAR.minCurrentPlays) return null;
  if (baselinePlays === 0) {
    if (currentPlays < TREND_RADAR.coldStartPlays) return null;
    return { currentPlays, baselineDaily: 0, velocity: null, coldStart: true };
  }
  const velocity = currentPlays / baselineDaily;
  if (velocity < TREND_RADAR.minVelocity) return null;
  return { currentPlays, baselineDaily, velocity, coldStart: false };
}

function byVelocityThenMass<T extends { trend: TrendVelocity }>(a: T, b: T): number {
  const av = a.trend.velocity ?? Number.POSITIVE_INFINITY;
  const bv = b.trend.velocity ?? Number.POSITIVE_INFINITY;
  if (bv !== av) return bv - av;
  return b.trend.currentPlays - a.trend.currentPlays;
}

/* ── Sounds ─────────────────────────────────────────────────────────── */

export interface SoundWindowRow {
  mediaId: string;
  title: string;
  genre: string | null;
  slug: string;
  currentPlays: number;
  baselinePlays: number;
}

export interface SoundTrend extends SoundWindowRow {
  trend: TrendVelocity;
  /** One tap into Create with the sound attached. */
  createLink: string;
}

export function soundCreateLink(mediaId: string): string {
  return `/create?panel=video&sound=track:${mediaId}&intent=trend`;
}

export function rankSoundTrends(rows: SoundWindowRow[]): SoundTrend[] {
  const out: SoundTrend[] = [];
  for (const row of rows) {
    const trend = evaluateTrend(row.currentPlays, row.baselinePlays);
    if (!trend) continue;
    out.push({ ...row, trend, createLink: soundCreateLink(row.mediaId) });
  }
  return out.sort(byVelocityThenMass).slice(0, TREND_RADAR.limit);
}

/* ── Topics (genres) ────────────────────────────────────────────────── */

export interface TopicWindowRow {
  genre: string;
  currentPlays: number;
  baselinePlays: number;
}

export interface TopicTrend extends TopicWindowRow {
  trend: TrendVelocity;
  createLink: string;
}

export function topicCreateLink(genre: string, trend: TrendVelocity): string {
  const pace = trend.coldStart
    ? `${trend.currentPlays} plays in its first 24 hours`
    : `${trend.currentPlays} plays in 24 hours, ${trend.velocity!.toFixed(1)}x its usual pace`;
  const concept = `Riding the ${genre} wave on Bow Down right now: ${pace}. Build a song in this lane while it is rising.`;
  return `/create?panel=song&concept=${encodeURIComponent(concept)}&intent=trend`;
}

export function rankTopicTrends(rows: TopicWindowRow[]): TopicTrend[] {
  const out: TopicTrend[] = [];
  for (const row of rows) {
    if (!row.genre.trim()) continue;
    const trend = evaluateTrend(row.currentPlays, row.baselinePlays);
    if (!trend) continue;
    out.push({ ...row, trend, createLink: topicCreateLink(row.genre, trend) });
  }
  return out.sort(byVelocityThenMass).slice(0, TREND_RADAR.limit);
}

/* ── Formats ────────────────────────────────────────────────────────── */

export type VideoFormat = "short" | "duet" | "stitch" | "full";

export const VIDEO_FORMATS: readonly VideoFormat[] = ["short", "duet", "stitch", "full"];

export interface FormatWindowRow {
  format: VideoFormat;
  currentPlays: number;
  baselinePlays: number;
}

export interface FormatTrend extends FormatWindowRow {
  trend: TrendVelocity;
  createLink: string;
}

export function formatCreateLink(format: VideoFormat, trend: TrendVelocity): string {
  const pace = trend.coldStart
    ? `${trend.currentPlays} plays in its first 24 hours`
    : `${trend.currentPlays} plays in 24 hours, ${trend.velocity!.toFixed(1)}x its usual pace`;
  const concept = `Format on the rise: ${formatLabel(format)} — ${pace} on Bow Down right now. Scaffold this format while it is climbing.`;
  return `/create?panel=video&concept=${encodeURIComponent(concept)}&intent=trend`;
}

export function formatLabel(format: VideoFormat): string {
  switch (format) {
    case "short":
      return "Shorts";
    case "duet":
      return "Duets";
    case "stitch":
      return "Stitches";
    case "full":
      return "Full videos";
  }
}

export function rankFormatTrends(rows: FormatWindowRow[]): FormatTrend[] {
  const out: FormatTrend[] = [];
  for (const row of rows) {
    const trend = evaluateTrend(row.currentPlays, row.baselinePlays);
    if (!trend) continue;
    out.push({ ...row, trend, createLink: formatCreateLink(row.format, trend) });
  }
  return out.sort(byVelocityThenMass).slice(0, TREND_RADAR.limit);
}

/* ── Window collection (the only DB read) ─────────────────────────────
   Same windows as the spike watch: current = last 24h, baseline =
   the 7 days before that. Only published items on public profiles —
   the same population the charts chart. */

const CURRENT = sql`(e.played_at >= NOW() - INTERVAL '24 hours')`;
const BASELINE = sql`(e.played_at >= NOW() - INTERVAL '8 days' AND e.played_at < NOW() - INTERVAL '24 hours')`;

async function collectSoundWindows(genre?: string): Promise<SoundWindowRow[]> {
  const gf = genre ? sql`AND t.genre ILIKE ${genre}` : sql``;
  const rows = await db.execute(sql`
    SELECT t.id AS media_id, t.title, t.genre, p.slug,
           COUNT(*) FILTER (WHERE ${CURRENT})::int AS current_plays,
           COUNT(*) FILTER (WHERE ${BASELINE})::int AS baseline_plays
    FROM play_events e
    JOIN profile_tracks t ON t.id = e.media_id
    JOIN creator_profiles p ON p.id = t.profile_id
    WHERE e.kind = 'track'
      AND e.played_at >= NOW() - INTERVAL '8 days'
      AND t.is_published AND p.is_public ${gf}
    GROUP BY t.id, p.slug
    HAVING COUNT(*) FILTER (WHERE ${CURRENT}) >= ${TREND_RADAR.minCurrentPlays}`);
  return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    mediaId: String(r["media_id"]),
    title: String(r["title"]),
    genre: r["genre"] == null ? null : String(r["genre"]),
    slug: String(r["slug"]),
    currentPlays: Number(r["current_plays"]),
    baselinePlays: Number(r["baseline_plays"]),
  }));
}

async function collectTopicWindows(): Promise<TopicWindowRow[]> {
  const rows = await db.execute(sql`
    SELECT genre,
           COUNT(*) FILTER (WHERE ${CURRENT})::int AS current_plays,
           COUNT(*) FILTER (WHERE ${BASELINE})::int AS baseline_plays
    FROM (
      SELECT t.genre AS genre, e.played_at AS played_at
      FROM play_events e
      JOIN profile_tracks t ON t.id = e.media_id
      JOIN creator_profiles p ON p.id = t.profile_id
      WHERE e.kind = 'track' AND t.is_published AND p.is_public AND t.genre IS NOT NULL AND t.genre <> ''
        AND e.played_at >= NOW() - INTERVAL '8 days'
      UNION ALL
      SELECT v.genre AS genre, e.played_at AS played_at
      FROM play_events e
      JOIN profile_videos v ON v.id = e.media_id
      JOIN creator_profiles p ON p.id = v.profile_id
      WHERE e.kind = 'video' AND v.is_published AND p.is_public AND v.genre IS NOT NULL AND v.genre <> ''
        AND e.played_at >= NOW() - INTERVAL '8 days'
    ) plays
    GROUP BY genre
    HAVING COUNT(*) FILTER (WHERE ${CURRENT}) >= ${TREND_RADAR.minCurrentPlays}`);
  return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    genre: String(r["genre"]),
    currentPlays: Number(r["current_plays"]),
    baselinePlays: Number(r["baseline_plays"]),
  }));
}

async function collectFormatWindows(): Promise<FormatWindowRow[]> {
  const rows = await db.execute(sql`
    SELECT format,
           COUNT(*) FILTER (WHERE ${CURRENT})::int AS current_plays,
           COUNT(*) FILTER (WHERE ${BASELINE})::int AS baseline_plays
    FROM (
      SELECT CASE
               WHEN v.duet_with IS NOT NULL THEN 'duet'
               WHEN v.stitch_with IS NOT NULL THEN 'stitch'
               WHEN v.is_short THEN 'short'
               ELSE 'full'
             END AS format,
             e.played_at AS played_at
      FROM play_events e
      JOIN profile_videos v ON v.id = e.media_id
      JOIN creator_profiles p ON p.id = v.profile_id
      WHERE e.kind = 'video'
        AND v.is_published AND p.is_public
        AND e.played_at >= NOW() - INTERVAL '8 days'
    ) plays
    GROUP BY format`);
  return (rows.rows as Array<Record<string, unknown>>)
    .filter((r) => (VIDEO_FORMATS as readonly string[]).includes(String(r["format"])))
    .map((r) => ({
      format: String(r["format"]) as VideoFormat,
      currentPlays: Number(r["current_plays"]),
      baselinePlays: Number(r["baseline_plays"]),
    }));
}

export interface TrendFeed {
  generatedAt: string;
  /** The honest window every number on the feed comes from. */
  window: "last_24h_vs_prior_7d";
  sounds: SoundTrend[];
  topics: TopicTrend[];
  formats: FormatTrend[];
}

/** The whole feed. A family with no qualifying signal is EMPTY —
 *  never padded. Throws only on a dead DB read; the route answers
 *  an honest 500 then (a fabricated feed would be worse). */
export async function buildTrendFeed(opts?: { genre?: string }): Promise<TrendFeed> {
  const [soundRows, topicRows, formatRows] = await Promise.all([
    collectSoundWindows(opts?.genre),
    collectTopicWindows(),
    collectFormatWindows(),
  ]);
  const feed: TrendFeed = {
    generatedAt: new Date().toISOString(),
    window: "last_24h_vs_prior_7d",
    sounds: rankSoundTrends(soundRows),
    topics: rankTopicTrends(topicRows),
    formats: rankFormatTrends(formatRows),
  };
  logger.debug(
    { sounds: feed.sounds.length, topics: feed.topics.length, formats: feed.formats.length },
    "[trend-radar] feed built",
  );
  return feed;
}
