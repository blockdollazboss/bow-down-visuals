/**
 * trends-desk — the seam behind the Promote Room's native
 * Trend Predictor desk (stack1500 world parity wave #3,
 * census item 40; the census counted the trends bench
 * PARTIAL before this wave).
 *
 * Source of truth: artifacts/api-server/src/routes/generate/
 * trend-predictor.ts and pages/trends.tsx. TWO rails, both
 * on the existing model rail — NO new external source (the
 * C-30 caution): predictions are pattern analysis, not live
 * external data, and the forecast's own disclaimer says so.
 *   POST /api/trend-predictor/forecast { niche (1–120),
 *     platforms (1–3 of tiktok|instagram|youtube),
 *     audienceSize (starting|growing|established) }
 *     → { trends: [{ trend, confidence (0–100), timeframe,
 *         reasoning, earlySignals[] }], disclaimer,
 *         creditsUsed, creditsRemaining }
 *   POST /api/trend-predictor/ideas { niche, trend (≤200),
 *     trendWhy (≤500) } → { ideas: string[], creditsUsed,
 *         creditsRemaining }
 *
 * PRICES from the registry: the forecast row is 200
 * ("Trend Forecast"); the ideas rail has no row of its own —
 * the registry's longest-prefix rule prices it from the
 * parent row "/api/trend-predictor" at 100 ("Trend
 * Predictor"), matching the route's IDEAS_CREDITS (env-
 * overridable, default 100) and the page's badge. Both runs
 * ride the confirmed-spend seam exactly like the page: a
 * decline runs nothing; a 402 lands in the out-of-Bucs state.
 *
 * The watchlist is the page's own localStorage list
 * ("bdv-trend-watchlist") — the desk reads and writes the
 * SAME key, so a trend tracked in the room is tracked on the
 * page and back. Guards mirror the page's bars: a forecast
 * needs at least one well-formed trend; ideas need at least
 * one string.
 */
import { getCreditCost } from "../credit-costs";

export const TREND_FORECAST_PATH = "/api/trend-predictor/forecast";
export const TREND_IDEAS_PATH = "/api/trend-predictor/ideas";
export const TREND_PARENT_PATH = "/api/trend-predictor";
export const TREND_FEATURE_FORECAST = "Trend Forecast";
export const TREND_FEATURE_IDEAS = "Trend Predictor";
export const TREND_WATCHLIST_KEY = "bdv-trend-watchlist";

function registryCost(path: string): number {
  const row = getCreditCost(path);
  if (!row) throw new Error(`trends-desk: no credit-cost registry row for ${path}`);
  return row.cost;
}

export const TREND_FORECAST_COST = registryCost(TREND_FORECAST_PATH);
/** Priced by the registry's longest-prefix rule from the
 *  parent row — getCreditCost resolves it the same way. */
export const TREND_IDEAS_COST = registryCost(TREND_IDEAS_PATH);

export const TREND_NICHES: readonly string[] = [
  "Music",
  "Gaming",
  "Comedy",
  "Fitness",
  "Beauty & Fashion",
  "Tech",
  "Education",
  "Lifestyle",
];

export const TREND_PLATFORMS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
];

export const TREND_AUDIENCES: ReadonlyArray<{ key: string; label: string; blurb: string }> = [
  { key: "starting", label: "Just starting", blurb: "0–1k followers" },
  { key: "growing", label: "Growing", blurb: "1k–50k followers" },
  { key: "established", label: "Established", blurb: "50k+ followers" },
];

export function buildForecastPayload(
  niche: string,
  customNiche: string,
  platforms: string[],
  audience: string,
): { niche: string; platforms: string[]; audienceSize: string } | null {
  const finalNiche = (customNiche.trim() || niche.trim()).slice(0, 120);
  if (!finalNiche) return null;
  const valid = platforms.filter((p) => TREND_PLATFORMS.some((o) => o.key === p));
  if (valid.length === 0) return null;
  if (!TREND_AUDIENCES.some((a) => a.key === audience)) return null;
  return { niche: finalNiche, platforms: valid.slice(0, 3), audienceSize: audience };
}

export function buildIdeasPayload(
  niche: string,
  trend: TrendItem,
): { niche: string; trend: string; trendWhy: string } {
  return {
    niche: niche.slice(0, 120),
    trend: trend.trend.slice(0, 200),
    trendWhy: trend.reasoning.slice(0, 500),
  };
}

export interface TrendItem {
  trend: string;
  confidence: number;
  timeframe: string;
  reasoning: string;
  earlySignals: string[];
}

export interface TrendForecast {
  trends: TrendItem[];
  disclaimer: string;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function trendItemOf(raw: unknown): TrendItem | null {
  const o = obj(raw);
  if (!o) return null;
  const trend = typeof o["trend"] === "string" ? o["trend"].trim() : "";
  if (!trend) return null;
  return {
    trend,
    confidence:
      typeof o["confidence"] === "number" && Number.isFinite(o["confidence"])
        ? Math.max(0, Math.min(100, o["confidence"]))
        : 0,
    timeframe: typeof o["timeframe"] === "string" ? o["timeframe"] : "",
    reasoning: typeof o["reasoning"] === "string" ? o["reasoning"] : "",
    earlySignals: (Array.isArray(o["earlySignals"]) ? o["earlySignals"] : []).filter(
      (s): s is string => typeof s === "string",
    ),
  };
}

/** The page's bar: at least one well-formed trend or the
 *  forecast failed — never a dressed-up empty list. */
export function trendForecastOf(data: unknown): TrendForecast | null {
  const o = obj(data);
  if (!o || !Array.isArray(o["trends"])) return null;
  const trends = o["trends"].map(trendItemOf).filter((t): t is TrendItem => t !== null);
  if (trends.length === 0) return null;
  return {
    trends,
    disclaimer: typeof o["disclaimer"] === "string" ? o["disclaimer"] : "",
  };
}

export function trendIdeasOf(data: unknown): string[] | null {
  const o = obj(data);
  if (!o || !Array.isArray(o["ideas"])) return null;
  const ideas = o["ideas"].filter((i): i is string => typeof i === "string" && i.trim().length > 0);
  return ideas.length > 0 ? ideas : null;
}

export interface TrackedTrend extends TrendItem {
  niche: string;
  trackedAt: string;
}

/** The page's watchlist read, mirrored: parse or empty. */
export function loadWatchlist(storage: Pick<Storage, "getItem">): TrackedTrend[] {
  try {
    const raw = storage.getItem(TREND_WATCHLIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is TrackedTrend =>
        !!t && typeof t === "object" && typeof (t as TrackedTrend).trend === "string",
    );
  } catch {
    return [];
  }
}
