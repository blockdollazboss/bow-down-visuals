/**
 * lyric-stories-bench-components — Stack 300 world parity
 * (Lane B item 10) source-contract pins. The bench must
 * stack at the Hook Desk as an ({ isLight }) bench, price
 * its run per card from the registry behind the confirmed
 * spend seam, render the painted cards with the partial
 * refund note, and branch its surfaces on isLight.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/LyricStoriesBench.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the bench shape + the Hook Desk mount", () => {
  it("is a named ({ isLight }) bench rooted at its testid", () => {
    expect(bench).toContain("export function LyricStoriesBench({ isLight }: { isLight: boolean })");
    expect(bench).toContain('data-testid="world-lyric-stories-bench"');
  });

  it("StationPanel stacks it at the hook-desk station behind a DeskDoor", () => {
    expect(panel).toContain('const LyricStoriesBench = lazy(() => import("@/components/world/native/LyricStoriesBench")');
    expect(panel).toContain("<LyricStoriesBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:lyric-stories`}');
  });
});

describe("the run rides the confirmed-spend seam at the per-card price", () => {
  it("posts through confirmedFetch with the registry-priced total as the override", () => {
    expect(bench).toContain("confirmedFetch(LYRIC_STORIES_PATH, {");
    expect(bench).toContain("overrideCost: totalCost");
    expect(bench).toContain("lyricStoriesTotalCost(count)");
    expect(bench).toContain("overrideFeature: LYRIC_STORIES_FEATURE");
    expect(bench).toContain("lyricStoriesResultOf(data)");
    expect(bench).toContain("res.status === 402");
    expect(bench).toContain('t("lyricStories.partial")');
    expect(bench).toContain('data-testid="world-lyric-stories-results"');
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the bench branches its surfaces on isLight", () => {
    expect(bench).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-black/40"');
    expect(bench).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
