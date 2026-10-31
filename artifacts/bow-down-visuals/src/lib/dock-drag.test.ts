/**
 * dock-drag.test.ts — stack1000 M5, surface 2 (TimelineDock handles).
 *
 * lib/dock-drag holds the value math extracted verbatim from
 * TimelineDock's pointer-move handler; the keyboard handle path feeds
 * it converted deltas / absolute times. These tests pin the math itself:
 * clamps, the 0.1 rounding, beat snapping applied to the handle's
 * ABSOLUTE timeline position (not the delta), and the min-gap rules —
 * including the extreme-delta values the keyboard Home/End keys produce.
 */
import { describe, expect, it } from "vitest";
import { cropDragNext, fadeDragValue, loopDragNext, rangeDragNext, trimDragValue } from "./dock-drag";

const id = (t: number) => t; // snapping off
const snap05 = (t: number) => Math.round(t / 0.5) * 0.5; // half-second beat grid stub

describe("trimDragValue", () => {
  it("start edge: value grows with a rightward drag; end edge: value shrinks", () => {
    expect(trimDragValue("start", 1, 0.5, 10, 20, id)).toBeCloseTo(1.5, 10);
    expect(trimDragValue("end", 1, 0.5, 10, 20, id)).toBeCloseTo(0.5, 10);
    expect(trimDragValue("end", 1, -0.5, 10, 20, id)).toBeCloseTo(1.5, 10);
  });
  it("clamps to [0, 45% of the clip] and rounds to 0.1", () => {
    expect(trimDragValue("start", 4, 5, 10, 20, id)).toBe(4.5);
    expect(trimDragValue("start", 1, -5, 10, 20, id)).toBe(0);
    expect(trimDragValue("start", 1.03, 0, 10, 20, id)).toBe(1);
  });
  it("extreme deltas (the keyboard Home/End path) land on the same bounds", () => {
    expect(trimDragValue("start", 2, -100, 10, 20, id)).toBe(0);
    expect(trimDragValue("end", 2, 100, 10, 20, id)).toBe(0);
    expect(trimDragValue("start", 2, 100, 10, 20, id)).toBe(4.5);
    expect(trimDragValue("end", 2, -100, 10, 20, id)).toBe(4.5);
  });
  it("snapping applies to the handle's absolute position, then converts back", () => {
    // clip starts at 20s; trim 1.0 + 0.3 drag → edge at 21.3 → snaps to 21.5 → trim 1.5
    expect(trimDragValue("start", 1, 0.3, 10, 20, snap05)).toBe(1.5);
    // end edge: trim 1.0, drag left 0.3 (delta -0.3 → value 1.3) → edge at 20+10-1.3=28.7 → snaps 28.5 → trim 1.5
    expect(trimDragValue("end", 1, -0.3, 10, 20, snap05)).toBe(1.5);
  });
});

describe("fadeDragValue", () => {
  it("in grows rightward, out grows leftward (delta sign flips)", () => {
    expect(fadeDragValue("in", 2, 0.5, 60, id)).toBeCloseTo(2.5, 10);
    expect(fadeDragValue("out", 2, -0.5, 60, id)).toBeCloseTo(2.5, 10);
    expect(fadeDragValue("out", 2, 0.5, 60, id)).toBeCloseTo(1.5, 10);
  });
  it("caps at 15s, or half the timeline when shorter", () => {
    expect(fadeDragValue("in", 14, 5, 60, id)).toBe(15);
    expect(fadeDragValue("in", 9, 5, 20, id)).toBe(10);
    expect(fadeDragValue("out", 2, 100, 60, id)).toBe(0); // Home path for fade-out
    expect(fadeDragValue("out", 2, -100, 60, id)).toBe(15); // End path for fade-out
  });
  it("snaps the handle's absolute position (fade-out handle sits at totalDur - fadeOut)", () => {
    // fadeOut 2 → handle at 58; drag right 0.3 → value 1.7 → handle 58.3 → snaps 58.5 → value 1.5
    expect(fadeDragValue("out", 2, 0.3, 60, snap05)).toBe(1.5);
  });
});

describe("cropDragNext / rangeDragNext / loopDragNext — absolute edges with min gaps", () => {
  it("crop: dragging enables it and keeps a 0.5s gap", () => {
    expect(cropDragNext({ startSec: 5, endSec: 40 }, "start", 12)).toEqual({ enabled: true, startSec: 12, endSec: 40 });
    expect(cropDragNext({ startSec: 5, endSec: 40 }, "start", 99)).toEqual({ enabled: true, startSec: 39.5, endSec: 40 });
    expect(cropDragNext({ startSec: 5, endSec: 40 }, "end", 1)).toEqual({ enabled: true, startSec: 5, endSec: 5.5 });
  });
  it("range: always lands in custom mode and keeps a 0.3s gap", () => {
    expect(rangeDragNext({ customStartSec: 5, customEndSec: 40 }, "start", 39.9)).toEqual({
      mode: "custom", customStartSec: 39.7, customEndSec: 40,
    });
    expect(rangeDragNext({ customStartSec: 5, customEndSec: 40 }, "end", 2)).toEqual({
      mode: "custom", customStartSec: 5, customEndSec: 5.3,
    });
  });
  it("loop: keeps a 0.3s gap", () => {
    expect(loopDragNext({ startSec: 5, endSec: 40 }, "end", 5.1)).toEqual({ startSec: 5, endSec: 5.3 });
    expect(loopDragNext({ startSec: 5, endSec: 40 }, "start", 12)).toEqual({ startSec: 12, endSec: 40 });
  });
});
