/**
 * TrendsRadarDesk (the in-World Trend Radar) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A native desk on the shared states: the feed load throws
 * on non-ok ("trend radar load failed") and the payload
 * passes through its feed parser (trendRadarFeedOf) before
 * anything renders — failure lands on NativeErrorState with
 * the radar's own loadError copy, loading on
 * NativeLoadingState. Trend data (whose families the parser
 * keeps separate and labeled, per the C-30 ruling) is never
 * painted from an error body or blended from an unproven
 * payload.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TrendsRadarDesk.tsx");

describe("the feed loads proven, parsed, or error — in that order", () => {
  it("the throw, the parser, and the error state are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("trend radar load failed");');
    expect(src).toContain("const parsed = trendRadarFeedOf(await res.json().catch(() => null));");
    expect(src).toContain('message={t("trends.radar.loadError")}');
  });
});
