/**
 * setlist-desk-components — stack1500 world parity wave #3
 * item 35 source-contract pins. The Setlist desk must sit in
 * the My Studio stack as a board desk ({ isLight }), with:
 * - the whole builder in-panel: manual add, library picker,
 *   per-song length/energy/stage-note, reorder, runtime line;
 * - the flow run on confirmedFetch with the registry constant
 *   quoted (the page's unconfirmed post is NOT copied), its
 *   result applied through lib/setlist's own applyFlowOrder;
 * - builder logic riding lib/setlist's helpers, not copies;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/SetlistDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the board-desk shape + the My Studio mount", () => {
  it("is a named board desk rooted at its testid", () => {
    expect(desk).toContain("export function SetlistDesk({ isLight }: { isLight: boolean })");
    expect(desk).toContain('data-testid="world-setlist-desk"');
  });

  it("StationPanel stacks it at the My Studio board behind a DeskDoor", () => {
    expect(panel).toContain('const SetlistDesk = lazy(() => import("@/components/world/native/SetlistDesk")');
    expect(panel).toContain("<SetlistDesk isLight={isLight} />");
  });
});

describe("the whole builder in-panel", () => {
  it("add, picker, per-song controls, runtime, show notes", () => {
    for (const needle of [
      'data-testid="world-setlist-desk-add"',
      'data-testid="world-setlist-desk-library-open"',
      'data-testid="world-setlist-desk-library"',
      'data-testid="world-setlist-desk-runtime"',
      'data-testid="world-setlist-desk-show-notes"',
      'data-testid="world-setlist-desk-empty"',
      "Stage note (yours — not sent to the flow)",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("builder logic rides lib/setlist's own helpers", () => {
    for (const needle of [
      "applyFlowOrder(prev, flow.order)",
      "clearFlowAnnotations(prev)",
      "moveSong(prev, i, i - 1)",
      "parseDurationInput(e.target.value)",
      "totalRuntime(songs)",
      "SLOT_LABELS[song.slot]",
      "ENERGY_LABELS[level]",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });
});

describe("spend discipline in source", () => {
  it("the flow rides confirmedFetch with the registry constant quoted; 402 names the Treasury", () => {
    expect(desk).toContain("overrideCost: SETLIST_FLOW_COST");
    expect(desk).toContain("overrideFeature: SETLIST_FEATURE");
    expect(desk).toContain("Visual Buc Packs desk in the Treasury");
    expect(desk).toContain("disabled={flowBusy || !flowReady(songs)}");
  });

  it("the flow result renders with apply/keep and the slot labels", () => {
    expect(desk).toContain('data-testid="world-setlist-desk-flow-result"');
    expect(desk).toContain('data-testid="world-setlist-desk-apply"');
    expect(desk).toContain("Apply this flow");
    expect(desk).toContain("Keep my order");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
