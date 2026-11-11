/**
 * TrendsDesk (World native) — honest load standard
 * (deep-pins tranche 5). No mount server load: the watchlist
 * is the member's own localStorage (a failed persist is a
 * comment-documented best-effort — the in-memory list still
 * updates). The pinned surfaces are the two paid runs,
 * which share one law: a cancelled confirmation returns
 * silently; 402 flips the out-of-credits state (with a
 * balance refresh) and returns; the result is set only from
 * a body parsed under res.ok — anything else throws the
 * server's words into the run's OWN error state (forecast
 * errors and ideas errors never mix, and a failed ideas run
 * clears the ideas list first so stale ideas never pose as
 * the new trend's).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TrendsDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("forecast — the parsed result exists only under ok", () => {
  it("cancel silent; 402 is out; parse gated on res.ok; setForecast sits past the throw", () => {
    const body = slice(src, "async function runForecast() {", "async function runIdeas(");
    expect(body).toContain("if (res === null) return;");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOut(true);");
    expect(body).toContain("const parsed = res.ok ? trendForecastOf(data) : null;");
    expect(body).toContain('if (!parsed) throw new Error(apiErrorMessage(data, t("worldLivePromo.trendsForecastFailed")));');
    expect(body).toContain("setForecast(parsed);");
    expect(body.indexOf('if (!parsed) throw new Error(')).toBeLessThan(body.indexOf("setForecast(parsed);"));
    const s402 = slice(body, "if (res.status === 402) {", "const parsed = res.ok ? trendForecastOf(data) : null;");
    expect(s402).toContain("return;");
    expect(s402).not.toContain("setForecast");
  });
});

describe("ideas — own error state, stale list cleared first", () => {
  it("the run clears ideas + ideasError up front; the same ok-gate guards setIdeas", () => {
    const body = slice(src, "async function runIdeas(trend: TrendItem) {", "return (");
    expect(body).toContain("setIdeasFor(trend.trend);");
    expect(body).toContain("setIdeas([]);");
    expect(body).toContain("setIdeasError(null);");
    expect(body).toContain("const parsed = res.ok ? trendIdeasOf(data) : null;");
    expect(body).toContain('if (!parsed) throw new Error(apiErrorMessage(data, t("worldLivePromo.trendsIdeasFailed")));');
    expect(body).toContain("setIdeas(parsed);");
    expect(body.indexOf("setIdeas([]);")).toBeLessThan(body.indexOf("const parsed = res.ok ? trendIdeasOf(data) : null;"));
    expect(body.indexOf('if (!parsed) throw new Error(')).toBeLessThan(body.indexOf("setIdeas(parsed);"));
    const catchPart = slice(body, "} catch (e) {", "} finally {");
    expect(catchPart).toContain("setIdeasError(plainErrorText(e, t(\"worldLivePromo.trendsIdeasFailed\")));");
    expect(catchPart).not.toContain("setIdeas(parsed)");
  });

  it("the watchlist persist is best-effort by design and never blocks the in-memory list", () => {
    const body = slice(src, "function persistWatchlist(list: TrackedTrend[]) {", "function track(");
    expect(body).toContain("setWatchlist(list);");
    expect(body).toContain("/* storage full/blocked — the watchlist just won't persist */");
    expect(body.indexOf("setWatchlist(list);")).toBeLessThan(body.indexOf("window.localStorage.setItem"));
  });
});
