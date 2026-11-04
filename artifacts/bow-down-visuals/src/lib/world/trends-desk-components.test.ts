/**
 * trends-desk-components — stack1500 world parity wave #3
 * item 40 source-contract pins. The Trend Predictor desk
 * must sit in the Promote Room stack as a
 * ({ isLight, isGuest }) desk with the house GuestGate, with:
 * - both runs riding the confirmed-spend seam at the
 *   registry prices (forecast 200, ideas 100) with the
 *   page's own bearer-header shape, a decline running
 *   nothing and a 402 landing in the out-of-Bucs state;
 * - the forecast rendered whole (confidence, timeframe,
 *   reasoning, early signals) with the rail's disclaimer,
 *   content ideas per trend, and the watchlist read/written
 *   through the page's own localStorage key;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/TrendsDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the desk shape + the Promote Room mount", () => {
  it("is a named ({ isLight, isGuest }) desk rooted at its testid, guests gated", () => {
    expect(desk).toContain("export function TrendsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean })");
    expect(desk).toContain('data-testid="world-trends-desk"');
    expect(desk).toContain("if (isGuest) return <GuestGate isLight={isLight} />;");
    expect(desk).toContain('data-testid="world-trends-desk-signin"');
  });

  it("StationPanel stacks it in the Promote Room behind a DeskDoor", () => {
    expect(panel).toContain('const TrendsDesk = lazy(() => import("@/components/world/native/TrendsDesk")');
    expect(panel).toContain("<TrendsDesk isLight={isLight} isGuest={isGuest} />");
  });
});

describe("the runs ride the confirmed-spend seam", () => {
  it("both rails go through confirmedFetch with registry overrides", () => {
    expect(desk).toContain("confirmedFetch(TREND_FORECAST_PATH, {");
    expect(desk).toContain("overrideCost: TREND_FORECAST_COST");
    expect(desk).toContain("overrideFeature: TREND_FEATURE_FORECAST");
    expect(desk).toContain("confirmedFetch(TREND_IDEAS_PATH, {");
    expect(desk).toContain("overrideCost: TREND_IDEAS_COST");
    expect(desk).toContain("overrideFeature: TREND_FEATURE_IDEAS");
    expect(desk).toContain("res.status === 402");
    /* Since locale unit 44 the out-of-Bucs line renders through the
       catalog (a MONEY line — en verbatim in every locale); the desk
       references the key and en carries the Treasury words. */
    expect(desk).toContain('t("worldLivePromo.trendsOutOfBucs", { feature: TREND_FEATURE_FORECAST })');
    const en = JSON.parse(read("../../locales/en.json")) as { worldLivePromo?: Record<string, string> };
    expect(en.worldLivePromo?.trendsOutOfBucs).toContain("Treasury");
  });

  it("the forecast renders whole; the watchlist is the page's own list", () => {
    for (const needle of [
      'data-testid="world-trends-desk-results"',
      "forecast.disclaimer",
      "trend.earlySignals.join",
      'data-testid="world-trends-desk-ideas"',
      'data-testid="world-trends-desk-watchlist"',
      "loadWatchlist(window.localStorage)",
      "window.localStorage.setItem(TREND_WATCHLIST_KEY, JSON.stringify(list))",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
