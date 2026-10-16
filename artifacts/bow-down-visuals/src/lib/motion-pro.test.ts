import { describe, it, expect } from "vitest";
import {
  normalizeSpeedSegments, segmentsFromPresetCurve, speedAtSegments,
  outputDurationForSegments, splitSpeedSegment,
  cubicBezierY, easedFraction, keyframeAtEased, planKeyframeSegments,
} from "./motion-pro";
import { SPEED_CURVE_PRESETS, type Keyframe } from "./editor-settings";

describe("speed segments (Stack 5 #4)", () => {
  it("normalizes gaps/overlaps into a tiling of [0,1]", () => {
    const segs = normalizeSpeedSegments([
      { id: "a", startT: 0.2, endT: 0.6, speed: 2 },
      { id: "b", startT: 0.5, endT: 0.9, speed: 0.5 },
    ]);
    expect(segs[0]!.startT).toBe(0);
    expect(segs[segs.length - 1]!.endT).toBe(1);
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.startT).toBeCloseTo(segs[i - 1]!.endT);
  });
  it("empty input becomes one 1x segment", () => {
    expect(normalizeSpeedSegments(null)).toMatchObject([{ startT: 0, endT: 1, speed: 1 }]);
  });
  it("clamps speeds into the engine range", () => {
    const segs = normalizeSpeedSegments([{ id: "a", startT: 0, endT: 1, speed: 99 }]);
    expect(segs[0]!.speed).toBe(4);
  });
  it("speedAtSegments reads the tiling", () => {
    const segs = normalizeSpeedSegments([
      { id: "a", startT: 0, endT: 0.5, speed: 0.5 },
      { id: "b", startT: 0.5, endT: 1, speed: 2 },
    ]);
    expect(speedAtSegments(segs, 0.25)).toBe(0.5);
    expect(speedAtSegments(segs, 0.75)).toBe(2);
  });
  it("output duration sums slice/speed — half at 0.5x + half at 2x of 10s = 12.5s", () => {
    const segs = normalizeSpeedSegments([
      { id: "a", startT: 0, endT: 0.5, speed: 0.5 },
      { id: "b", startT: 0.5, endT: 1, speed: 2 },
    ]);
    expect(outputDurationForSegments(segs, 10)).toBeCloseTo(12.5);
  });
  it("preset curves become editable segments (starting points preserved)", () => {
    const punch = SPEED_CURVE_PRESETS.find((c) => c.id === "punch")!;
    const segs = segmentsFromPresetCurve(punch.points, 4);
    expect(segs).toHaveLength(4);
    expect(segs[0]!.startT).toBe(0);
    expect(segs[3]!.endT).toBe(1);
    // The slow middle of the punch preset survives sampling.
    expect(Math.min(...segs.map((s) => s.speed))).toBeLessThan(1);
  });
  it("splits a segment at t keeping speeds", () => {
    const segs = splitSpeedSegment([{ id: "a", startT: 0, endT: 1, speed: 2 }], "a", 0.4);
    expect(segs.map((s) => [s.startT, s.endT, s.speed])).toEqual([[0, 0.4, 2], [0.4, 1, 2]]);
  });
});

describe("bézier keyframe easing (Stack 5 #8)", () => {
  const kf = (over: Partial<Keyframe>): Keyframe => ({
    id: "k", time: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, ...over,
  });
  it("cubicBezierY hits endpoints and identity for linear handles", () => {
    expect(cubicBezierY({ x: 0, y: 0 }, { x: 1, y: 1 }, 0)).toBe(0);
    expect(cubicBezierY({ x: 0, y: 0 }, { x: 1, y: 1 }, 1)).toBe(1);
    expect(cubicBezierY({ x: 0, y: 0 }, { x: 1, y: 1 }, 0.3)).toBeCloseTo(0.3, 4);
  });
  it("ease-out handles run ahead of linear mid-segment", () => {
    const y = cubicBezierY({ x: 0.15, y: 0.6 }, { x: 0.45, y: 1 }, 0.5);
    expect(y).toBeGreaterThan(0.5);
  });
  it("no handles = legacy smoothstep, exactly", () => {
    const a = kf({}), b = kf({ time: 2 });
    expect(easedFraction(a, b, 0.25)).toBeCloseTo(0.25 * 0.25 * (3 - 2 * 0.25));
    const v = keyframeAtEased([kf({ scale: 1 }), kf({ time: 2, scale: 2 })], 1);
    expect(v.scale).toBeCloseTo(1.5);
  });
  it("handles change the interpolated value vs smoothstep", () => {
    const a = kf({ scale: 1, easeOutCp: { x: 0.1, y: 0.9 } });
    const b = kf({ time: 2, scale: 2, easeInCp: { x: 0.3, y: 1 } });
    const v = keyframeAtEased([a, b], 1);
    expect(v.scale).toBeGreaterThan(1.5);
  });
  it("adaptive plan: flat spans stay coarse, curved spans get denser, capped", () => {
    const flat = [kf({ scale: 1 }), kf({ time: 4, scale: 1 })];
    expect(planKeyframeSegments(flat, 4)).toBe(12);
    const snap = [
      kf({ scale: 1, easeOutCp: { x: 0.05, y: 0.98 } }),
      kf({ time: 4, scale: 3, easeInCp: { x: 0.95, y: 1 } }),
    ];
    const dense = planKeyframeSegments(snap, 4);
    expect(dense).toBeGreaterThan(12);
    expect(dense).toBeLessThanOrEqual(48);
  });
});
