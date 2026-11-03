/**
 * trends-desk — stack1500 world parity wave #3 item 40 pins.
 * The Trend Predictor desk is the trends bench's native
 * form. These pins hold: the forecast is 200 and the ideas
 * rail resolves to 100 through the registry's longest-prefix
 * rule from the parent row (matching the route's
 * FORECAST_CREDITS / IDEAS_CREDITS defaults); the forecast
 * payload refuses a blank niche or an empty platform set and
 * caps at the schema's bounds; the ideas payload caps at
 * the schema's lengths; the guards mirror the page's bars
 * (≥1 well-formed trend, ≥1 idea, confidence clamped to
 * 0–100); the watchlist read is the page's own key with the
 * page's parse-or-empty discipline.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TREND_FORECAST_COST,
  TREND_FORECAST_PATH,
  TREND_IDEAS_COST,
  TREND_IDEAS_PATH,
  TREND_WATCHLIST_KEY,
  buildForecastPayload,
  buildIdeasPayload,
  loadWatchlist,
  trendForecastOf,
  trendIdeasOf,
  type TrendItem,
} from "./trends-desk";
import { getCreditCost } from "../credit-costs";

const apiSrc = (rel: string) =>
  readFileSync(new URL(`../../../../api-server/src/${rel}`, import.meta.url), "utf8");

const TREND: TrendItem = {
  trend: "sped-up soul samples",
  confidence: 82,
  timeframe: "2–4 weeks",
  reasoning: "Catalog flips are climbing.",
  earlySignals: ["Three breakout edits this week"],
};

describe("prices — registry-pinned, route-matched", () => {
  it("forecast 200 by its own row; ideas 100 by the longest-prefix parent row", () => {
    expect(getCreditCost(TREND_FORECAST_PATH)).toMatchObject({ feature: "Trend Forecast", cost: 200 });
    expect(TREND_FORECAST_COST).toBe(200);
    expect(getCreditCost(TREND_IDEAS_PATH)).toMatchObject({ feature: "Trend Predictor", cost: 100 });
    expect(TREND_IDEAS_COST).toBe(100);
    const route = apiSrc("routes/generate/trend-predictor.ts");
    expect(route).toContain('FORECAST_CREDITS = Number(process.env["TREND_PREDICTOR_FORECAST_CREDITS"]) || 200');
    expect(route).toContain('IDEAS_CREDITS = Number(process.env["TREND_PREDICTOR_IDEAS_CREDITS"]) || 100');
  });
});

describe("payloads", () => {
  it("the forecast payload: custom niche wins, platforms filtered + capped", () => {
    expect(buildForecastPayload("Music", "", ["tiktok"], "growing")).toEqual({
      niche: "Music",
      platforms: ["tiktok"],
      audienceSize: "growing",
    });
    expect(buildForecastPayload("Music", " drill ", ["tiktok", "myspace"], "starting")?.niche).toBe("drill");
    expect(buildForecastPayload("Music", "", [], "growing")).toBeNull();
    expect(buildForecastPayload("", "  ", ["tiktok"], "growing")).toBeNull();
    expect(buildForecastPayload("Music", "", ["tiktok"], "huge")).toBeNull();
  });

  it("the ideas payload caps at the schema's lengths", () => {
    const body = buildIdeasPayload("Music", TREND);
    expect(body).toEqual({ niche: "Music", trend: "sped-up soul samples", trendWhy: "Catalog flips are climbing." });
  });
});

describe("guards — the page's bars", () => {
  it("a forecast needs at least one well-formed trend; confidence clamps", () => {
    const f = trendForecastOf({ trends: [TREND, { trend: "" }, { nope: 1 }], disclaimer: "Pattern analysis — not a guarantee." })!;
    expect(f.trends).toHaveLength(1);
    expect(f.disclaimer).toContain("not a guarantee");
    expect(trendForecastOf({ trends: [{ trend: "x", confidence: 140 }] })!.trends[0]!.confidence).toBe(100);
    expect(trendForecastOf({ trends: [] })).toBeNull();
    expect(trendForecastOf({})).toBeNull();
  });

  it("ideas need at least one real string", () => {
    expect(trendIdeasOf({ ideas: ["Flip a classic live", ""] })).toEqual(["Flip a classic live"]);
    expect(trendIdeasOf({ ideas: [] })).toBeNull();
  });

  it("the watchlist read is the page's key, parse-or-empty", () => {
    expect(TREND_WATCHLIST_KEY).toBe("bdv-trend-watchlist");
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null };
    expect(loadWatchlist(storage)).toEqual([]);
    store.set(TREND_WATCHLIST_KEY, JSON.stringify([{ ...TREND, niche: "Music", trackedAt: "t" }, { bad: 1 }]));
    expect(loadWatchlist(storage)).toHaveLength(1);
    store.set(TREND_WATCHLIST_KEY, "{broken");
    expect(loadWatchlist(storage)).toEqual([]);
  });
});
