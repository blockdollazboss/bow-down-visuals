/**
 * randomizer-bench-components — Stack 300 world parity
 * (Lane B item 8) source-contract pins. The Randomizer
 * bench must stack at the Hook Desk as an ({ isLight })
 * bench; the free roll stays client-side off the seam's
 * lists, and the AI roll rides the confirmed spend seam at
 * the registry price with a 402 landing in the out-of-Bucs
 * state — light/dark parity via isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/RandomizerBench.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the bench shape + the Hook Desk mount", () => {
  it("is a named ({ isLight }) bench rooted at its testid", () => {
    expect(bench).toContain("export function RandomizerBench({ isLight }: { isLight: boolean })");
    expect(bench).toContain('data-testid="world-randomizer-bench"');
  });

  it("StationPanel stacks it at the hook-desk station behind a DeskDoor", () => {
    expect(panel).toContain('const RandomizerBench = lazy(() => import("@/components/world/native/RandomizerBench")');
    expect(panel).toContain("<RandomizerBench isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:randomizer`}');
  });
});

describe("the two rolls", () => {
  it("the free roll is local — the seam's lists, no fetch", () => {
    expect(bench).toContain("freeRollIdea(category, freeIdea ?? undefined)");
    expect(bench).toContain('data-testid="world-randomizer-free-roll"');
    expect(bench).toContain('data-testid="world-randomizer-free-result"');
  });

  it("the AI roll rides confirmedFetch at the registry price; a decline rolls nothing", () => {
    expect(bench).toContain("confirmedFetch(RANDOMIZER_PATH, {");
    expect(bench).toContain("buildRandomizerPayload(category)");
    expect(bench).toContain("randomizerCost()");
    expect(bench).toContain("randomizerIdeasOf(data)");
    expect(bench).toContain("res.status === 402");
    expect(bench).toContain('t("worldBenches300.outOfBucs", { feature: RANDOMIZER_FEATURE })');
    expect(bench).toContain('data-testid="world-randomizer-ai-result"');
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the bench branches its surfaces on isLight", () => {
    expect(bench).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(bench).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
