/**
 * TrendRadar — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The Trends page's real-signal rail
 * loads GET /api/trend-radar through the shared strict parser: a
 * non-ok response throws, and a 200 whose body is not the feed
 * parses to null and throws too — both land on the load-error panel
 * with a retry (retryNonce re-runs the effect), never on the
 * "nothing heating up" empty state. The genuine-empty copy renders
 * only from a successfully parsed, all-empty feed. The C-30
 * "Heating up outside" family renders only when real chart rows
 * arrived — dormant (null) means the section does not exist.
 *
 * Copy rides i18n keys, so the pin asserts the keys and carries the
 * catalog block. The FE suite runs in node (no DOM), so — like the
 * sibling honest-load pins — these tests pin the machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const radar = read("./TrendRadar.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("failure path — a failed radar load never reads as a quiet day", () => {
  it("the loader throws on a non-ok response", () => {
    expect(radar).toContain('fetch("/api/trend-radar", {');
    expect(radar).toContain('if (!res.ok) throw new Error("load failed");');
  });

  it("a 200 that is not the feed parses to null and throws the same way", () => {
    expect(radar).toContain("const parsed = trendRadarFeedOf(await res.json().catch(() => null));");
    expect(radar).toContain('if (!parsed) throw new Error("load failed");');
  });

  it("the catch records the error state", () => {
    expect(radar).toContain("if (!cancelled) setLoadError(true);");
  });

  it("failure renders the error panel with a retry that re-runs the load effect", () => {
    expect(radar).toContain('t("trends.radar.loadError")');
    expect(radar).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(radar).toContain('t("trends.radar.retry")');
    expect(radar).toContain("}, [user, getAccessToken, retryNonce]);");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("render order is error → loading → genuine empty → families", () => {
    const errorAt = radar.indexOf("{loadError ? (");
    const loadingAt = radar.indexOf(") : feed === null ? (");
    const emptyAt = radar.indexOf(") : allEmpty && !showOutside ? (");
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(errorAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
  });

  it("the genuine-empty fact is computed from a parsed feed only", () => {
    expect(radar).toContain("feed !== null && feed.sounds.length === 0 && feed.topics.length === 0 && feed.formats.length === 0");
    expect(radar).toContain('t("trends.radar.allEmpty")');
  });

  it("the outside family exists only when real chart rows arrived", () => {
    expect(radar).toContain("const outsideVideos = feed?.outsideHeat?.videos ?? [];");
    expect(radar).toContain("const showOutside = outsideVideos.length > 0;");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the trend-radar honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of [
      "trends.radar.loadError",
      "trends.radar.retry",
      "trends.radar.loading",
      "trends.radar.allEmpty",
    ]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
