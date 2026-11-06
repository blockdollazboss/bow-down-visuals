/**
 * youtube-heat.ts — Trend Radar's OUTSIDE-HEAT family (C-30, owner-ruled
 * Nov 6, 2026: "Add it — outside heat in Trend Radar").
 *
 * The radar's other families are 100% on-site by design (real play_events
 * counts behind a verified-count gate). This family is the one deliberate
 * exception: YouTube's current most-popular MUSIC chart, pulled from the
 * official YouTube Data API v3 — the only genuinely free, official,
 * commercially usable outside source (census:
 * ~/workspace/c30-trend-radar-source-census.md). TikTok's trend API is
 * academics-only, X is pay-per-read, Reddit's free tier forbids
 * commercial use, Google Trends has no self-serve API.
 *
 * THE FAMILY IS ADDITIVE AND LABELED — three honesty rules, absolute:
 *   1. Its numbers are YouTube's own, carried under YouTube's name on
 *      every payload (the `source` string below rides every row). They
 *      are NEVER blended into on-site counts and NEVER fed into the
 *      verified-count gates in lib/trend-radar.ts.
 *   2. It is a popularity SNAPSHOT, not velocity math: no growth, no
 *      score, no "rising" claim is computed from it.
 *   3. The paid Trend Predictor (OpenAI forecasts) stays a separate
 *      surface and is never a source here — and this is never a source
 *      for it.
 *
 * SHIP-DARK DORMANCY: the API key does not exist yet — it comes from
 * the owner's Google setup (already on his signup list). Until
 * YOUTUBE_API_KEY is set on the server, getOutsideHeat() returns null,
 * the rail renders exactly as it did before this family existed, and
 * no error, placeholder card, or fabricated number ever appears. When
 * the key lands, the family lights up with NO code change.
 *
 * KEY HOME (codebase convention): server-side env, read via
 * process.env — the same home as TOOLOST_API_KEY / PRINTFUL_API_KEY /
 * GEMINI_API_KEY. There was no pre-existing YOUTUBE_API_KEY anywhere in
 * the tree (the only YOUTUBE_* env, LIVE_CHAT_INGEST_YOUTUBE /
 * YOUTUBE_CHAT_OAUTH_TOKEN, is live-chat ingest — a different feature).
 * The key is read HERE only: never sent to the browser, never placed in
 * any payload, never logged (the request URL carries it, so the URL is
 * never logged either — failures log status/error class only).
 *
 * QUOTA MATH (why this cannot burn the free quota): a videos.list call
 * costs 1 unit against the default 10,000 units/day. The success cache
 * TTL is 20 minutes → at most 72 fetches/day per process = 72 units
 * (0.72% of quota). Failures are negative-cached for 5 minutes → a
 * broken key or a Google outage costs at most 288 units/day and, more
 * importantly, never turns the radar into a retry loop. There are NO
 * retries inside a fetch and NO background cron: the chart is fetched
 * on demand, into the cache, at most once per TTL window, and
 * concurrent requests share one in-flight fetch (single-flight).
 *
 * REGION: no server-side region convention existed in this codebase.
 * Default "US" — the site's home market (USD pricing throughout) — with
 * a YOUTUBE_HEAT_REGION override (ISO 3166-1 alpha-2) for the day the
 * audience says otherwise.
 */

import { logger } from "./logger";

/** The env var the owner's Google setup will provide. Server-side only. */
export const YOUTUBE_API_KEY_ENV = "YOUTUBE_API_KEY";

/** YouTube videoCategoryId 10 = Music — the site's home lane. */
export const YOUTUBE_MUSIC_CATEGORY_ID = "10";

/** Chart size: enough to fill the section, one page, one unit. */
export const YOUTUBE_HEAT_LIMIT = 10;

const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

/** Success cache: 20 minutes (inside the tasked 15–30 window). */
export const YOUTUBE_HEAT_CACHE_TTL_MS = 20 * 60_000;
/** Failure negative-cache: 5 minutes — no retry storms, ever. */
export const YOUTUBE_HEAT_FAILURE_TTL_MS = 5 * 60_000;
/** Hard fetch timeout: a slow Google must never hang the rail. */
export const YOUTUBE_HEAT_TIMEOUT_MS = 4_000;

/**
 * The family's source label — names YouTube plainly. Rides the family
 * AND every row, the same "printed on the card, never hidden" rule the
 * internal families follow in lib/trend-radar.ts.
 */
export const YOUTUBE_HEAT_SOURCE = "YouTube — most popular music videos right now";

export interface YoutubeHeatVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  /** YouTube's own view count for this video — labeled as YouTube's. */
  viewCount: number;
  likeCount: number | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  /** Click-through to the video on YouTube. */
  url: string;
  /** Where the number came from — printed on the card, never hidden. */
  source: string;
}

export interface YoutubeHeat {
  source: string;
  region: string;
  fetchedAt: string;
  videos: YoutubeHeatVideo[];
}

/* ── Env (server-side only) ─────────────────────────────────────────── */

/** Resolved YouTube Data API key, or null when none is configured. */
export function getYoutubeApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = (env[YOUTUBE_API_KEY_ENV] ?? "").trim();
  return key.length > 0 ? key : null;
}

/** True when the outside-heat family can light up. */
export function isYoutubeHeatConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getYoutubeApiKey(env) !== null;
}

/** Chart region: YOUTUBE_HEAT_REGION (alpha-2) or the "US" default. */
export function youtubeHeatRegion(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env["YOUTUBE_HEAT_REGION"] ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : "US";
}

/* ── Chart fetch (exactly one attempt — no retries, by design) ──────── */

interface YoutubeApiItem {
  id?: unknown;
  snippet?: {
    title?: unknown;
    channelTitle?: unknown;
    publishedAt?: unknown;
    thumbnails?: Record<string, { url?: unknown } | undefined>;
  };
  statistics?: { viewCount?: unknown; likeCount?: unknown };
}

function countOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function shapeItem(item: YoutubeApiItem): YoutubeHeatVideo | null {
  const videoId = typeof item.id === "string" ? item.id : "";
  const title = typeof item.snippet?.title === "string" ? item.snippet.title.trim() : "";
  const viewCount = countOrNull(item.statistics?.viewCount);
  /* No id, no title, or no real view count → the row cannot be labeled
     honestly, so it is dropped, never estimated (the radar's rule). */
  if (!videoId || !title || viewCount === null) return null;
  const thumbs = item.snippet?.thumbnails ?? {};
  const thumb = thumbs["medium"]?.url ?? thumbs["high"]?.url ?? thumbs["default"]?.url;
  return {
    videoId,
    title,
    channelTitle:
      typeof item.snippet?.channelTitle === "string" ? item.snippet.channelTitle : "",
    viewCount,
    likeCount: countOrNull(item.statistics?.likeCount),
    thumbnailUrl: typeof thumb === "string" && thumb.startsWith("https://") ? thumb : null,
    publishedAt: typeof item.snippet?.publishedAt === "string" ? item.snippet.publishedAt : null,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    source: YOUTUBE_HEAT_SOURCE,
  };
}

async function fetchYoutubeChart(
  apiKey: string,
  region: string,
  fetchImpl: typeof fetch,
): Promise<YoutubeHeat | null> {
  const params = new URLSearchParams({
    part: "snippet,statistics",
    chart: "mostPopular",
    regionCode: region,
    videoCategoryId: YOUTUBE_MUSIC_CATEGORY_ID,
    maxResults: String(YOUTUBE_HEAT_LIMIT),
    key: apiKey,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YOUTUBE_HEAT_TIMEOUT_MS);
  let res: Response;
  try {
    /* The URL carries the key — it is NEVER logged, on any path. */
    res = await fetchImpl(`${YOUTUBE_VIDEOS_URL}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.name : "unknown" },
      "[youtube-heat] chart fetch failed (transport/timeout) — outside family dormant for this window",
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    /* Status only — Google error bodies can echo request details. */
    logger.warn(
      { status: res.status },
      "[youtube-heat] chart fetch returned non-OK — outside family dormant for this window",
    );
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    logger.warn("[youtube-heat] chart response was not JSON — outside family dormant");
    return null;
  }
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) {
    logger.warn("[youtube-heat] chart response had no items array — outside family dormant");
    return null;
  }
  const videos = items
    .map((it) => shapeItem(it as YoutubeApiItem))
    .filter((v): v is YoutubeHeatVideo => v !== null)
    .slice(0, YOUTUBE_HEAT_LIMIT);
  if (videos.length === 0) return null;
  return {
    source: YOUTUBE_HEAT_SOURCE,
    region,
    fetchedAt: new Date().toISOString(),
    videos,
  };
}

/* ── Cache + single-flight ──────────────────────────────────────────── */

interface CacheEntry {
  at: number;
  ttl: number;
  value: YoutubeHeat | null;
}

let cacheEntry: CacheEntry | null = null;
let inflight: Promise<YoutubeHeat | null> | null = null;

export interface YoutubeHeatDeps {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

/**
 * The outside-heat family, or null when it should not appear: no key
 * configured (ship-dark dormancy), Google unreachable/erroring, or an
 * empty/unusable chart. NEVER throws — a dead outside source must
 * leave the internal rail exactly as it was.
 */
export async function getOutsideHeat(deps: YoutubeHeatDeps = {}): Promise<YoutubeHeat | null> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const apiKey = getYoutubeApiKey(env);
  if (!apiKey) return null; // dormant by design — no fetch, no cache churn

  const t = now();
  if (cacheEntry && t - cacheEntry.at < cacheEntry.ttl) return cacheEntry.value;
  if (inflight) return inflight;

  const region = youtubeHeatRegion(env);
  const fetchImpl = deps.fetchImpl ?? fetch;
  inflight = (async () => {
    try {
      const value = await fetchYoutubeChart(apiKey, region, fetchImpl);
      cacheEntry = {
        at: now(),
        ttl: value ? YOUTUBE_HEAT_CACHE_TTL_MS : YOUTUBE_HEAT_FAILURE_TTL_MS,
        value,
      };
      return value;
    } catch (err) {
      /* fetchYoutubeChart is built not to throw; this is the belt to
         its braces — dormancy, never a 500 for the rail. */
      logger.warn(
        { err: err instanceof Error ? err.name : "unknown" },
        "[youtube-heat] unexpected failure — outside family dormant for this window",
      );
      cacheEntry = { at: now(), ttl: YOUTUBE_HEAT_FAILURE_TTL_MS, value: null };
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test seam: clear the module cache + in-flight handle. */
export function resetYoutubeHeatCache(): void {
  cacheEntry = null;
  inflight = null;
}
