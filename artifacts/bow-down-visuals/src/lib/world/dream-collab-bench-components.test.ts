/**
 * dream-collab-bench-components — Stack 300 world parity
 * (Lane B item 11) source-contract pins. The bench must
 * stack at the My Studio board as an ({ isLight,
 * onOpenStation }) bench, run through the confirmed spend
 * seam at the route's price (the override the panel itself
 * passes), render the whole concept, and hand off to the
 * Song Desk station in-world — surfaces branched on
 * isLight.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/DreamCollabBench.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the bench shape + the My Studio board mount", () => {
  it("is a named ({ isLight, onOpenStation }) bench rooted at its testid", () => {
    expect(bench).toContain("export function DreamCollabBench({");
    expect(bench).toContain("onOpenStation?: (stationId: string) => void;");
    expect(bench).toContain('data-testid="world-dream-collab-bench"');
  });

  it("StationPanel stacks it at the My Studio board behind a DeskDoor", () => {
    expect(panel).toContain('const DreamCollabBench = lazy(() => import("@/components/world/native/DreamCollabBench")');
    expect(panel).toContain("<DreamCollabBench isLight={isLight} onOpenStation={props.onOpenStation} />");
  });
});

describe("the run rides the confirmed-spend seam", () => {
  it("posts through confirmedFetch with the panel's own override", () => {
    expect(bench).toContain("confirmedFetch(DREAM_COLLAB_PATH, {");
    expect(bench).toContain("overrideCost: DREAM_COLLAB_COST");
    expect(bench).toContain("overrideFeature: DREAM_COLLAB_FEATURE");
    expect(bench).toContain("dreamCollabConceptOf(data)");
    expect(bench).toContain("res.status === 402");
    expect(bench).toContain('data-testid="world-dream-collab-result"');
  });

  it("the song hand-off opens the Song Desk station in-world", () => {
    expect(bench).toContain("onOpenStation?.(DREAM_COLLAB_SONG_STATION_ID)");
    expect(bench).toContain('data-testid="world-dream-collab-make-song"');
    expect(bench).toContain("dreamCollabCopyText(concept)");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the bench branches its surfaces on isLight", () => {
    expect(bench).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(bench).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
