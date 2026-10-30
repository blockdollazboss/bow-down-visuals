/**
 * arrangement-drag.test.ts — stack1000 M5, surface 3 (ArrangementStudio).
 *
 * dragClipBy is the clip-drag step shared by ArrangementStudio's pointer
 * move handler and its keyboard path. These tests pin the extracted math
 * against the original handler's formulas: move rounding/floor, the
 * trimStart startTime shift (audible content stays put), both trims'
 * 0.1s minimum play length, and the no-duration edge case.
 */
import { describe, expect, it } from "vitest";
import { dragClipBy, type ArrangementClip } from "./arrangement";

const clip = (patch: Partial<ArrangementClip> = {}): ArrangementClip => ({
  id: "c1", url: "https://x/clip.wav", name: "Clip",
  startTime: 4, trimStart: 1, trimEnd: 1, durationSec: 10, ...patch,
}); // playLen = 10 - 1 - 1 = 8

describe("dragClipBy — move", () => {
  it("shifts startTime by dx on the 0.01s grid, floored at 0", () => {
    expect(dragClipBy(clip(), "move", 0.5).startTime).toBe(4.5);
    expect(dragClipBy(clip(), "move", -0.25).startTime).toBe(3.75);
    expect(dragClipBy(clip({ startTime: 1.234 }), "move", 0.1).startTime).toBe(1.33);
    expect(dragClipBy(clip(), "move", -100).startTime).toBe(0);
  });
  it("leaves trims untouched", () => {
    const next = dragClipBy(clip(), "move", 1);
    expect(next.trimStart).toBe(1);
    expect(next.trimEnd).toBe(1);
  });
});

describe("dragClipBy — trimStart moves the clip with the trim", () => {
  it("growing the head trim shifts startTime by the same delta", () => {
    const next = dragClipBy(clip(), "trimStart", 0.3);
    expect(next.trimStart).toBe(1.3);
    expect(next.startTime).toBe(4.3);
  });
  it("shrinking the head trim pulls startTime back, floored at 0", () => {
    const next = dragClipBy(clip(), "trimStart", -0.5);
    expect(next.trimStart).toBe(0.5);
    expect(next.startTime).toBe(3.5);
    const floored = dragClipBy(clip({ startTime: 0.2 }), "trimStart", -0.5);
    expect(floored.trimStart).toBe(0.5);
    expect(floored.startTime).toBe(0);
  });
  it("clamps so 0.1s of play length always remains", () => {
    const next = dragClipBy(clip(), "trimStart", 100);
    expect(next.trimStart).toBe(8.9); // 1 + 8 - 0.1
    expect(next.startTime).toBe(11.9); // 4 + (8.9 - 1)
  });
});

describe("dragClipBy — trimEnd opposes the drag direction", () => {
  it("positive dx lengthens (less tail trim), negative dx shortens", () => {
    expect(dragClipBy(clip(), "trimEnd", 0.4).trimEnd).toBe(0.6);
    expect(dragClipBy(clip(), "trimEnd", -0.4).trimEnd).toBe(1.4);
    expect(dragClipBy(clip(), "trimEnd", 0.4).startTime).toBe(4); // tail trim never moves the head
  });
  it("clamps to [0, trim + playLen - 0.1]", () => {
    expect(dragClipBy(clip(), "trimEnd", 100).trimEnd).toBe(0);
    expect(dragClipBy(clip(), "trimEnd", -100).trimEnd).toBe(8.9);
  });
  it("a clip with unknown duration cannot grow either trim", () => {
    const noDur = clip({ durationSec: undefined });
    expect(dragClipBy(noDur, "trimStart", 1).trimStart).toBe(0.9); // max(0, 1 + 0 - 0.1)
    expect(dragClipBy(noDur, "trimEnd", -1).trimEnd).toBe(0.9);
  });
});
