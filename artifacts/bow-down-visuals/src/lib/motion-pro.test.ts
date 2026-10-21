import { describe, it, expect } from "vitest";
import {
  normalizeSpeedSegments, segmentsFromPresetCurve, speedAtSegments,
  outputDurationForSegments, splitSpeedSegment,
  normalizeSpeedCurvePoints, segmentsFromCustomCurve,
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

describe("drawn custom speed curves (Wave 3 #18)", () => {
  const tuples = (segs: { startT: number; endT: number; speed: number }[]) =>
    segs.map((s) => [s.startT, s.endT, s.speed]);

  it("normalizes out-of-order points into a sorted curve", () => {
    expect(normalizeSpeedCurvePoints([
      { t: 1, speed: 2 }, { t: 0, speed: 0.5 }, { t: 0.5, speed: 1 },
    ])).toEqual([
      { t: 0, speed: 0.5 }, { t: 0.5, speed: 1 }, { t: 1, speed: 2 },
    ]);
  });

  it("clamps points to the clip bounds and the rail's speed range", () => {
    expect(normalizeSpeedCurvePoints([
      { t: -0.5, speed: 0 }, { t: 1.7, speed: 99 },
    ])).toEqual([
      { t: 0, speed: 0.25 }, { t: 1, speed: 4 },
    ]);
  });

  it("keeps points at the exact bounds (t=0 and t=1)", () => {
    expect(normalizeSpeedCurvePoints([
      { t: 0, speed: 0.5 }, { t: 1, speed: 2 },
    ])).toEqual([
      { t: 0, speed: 0.5 }, { t: 1, speed: 2 },
    ]);
  });

  it("a single point survives as a one-point curve", () => {
    expect(normalizeSpeedCurvePoints([{ t: 0.3, speed: 2 }])).toEqual([{ t: 0.3, speed: 2 }]);
  });

  it("garbage in, nothing stored: non-finite and empty input normalize to []", () => {
    expect(normalizeSpeedCurvePoints([
      { t: Number.NaN, speed: 1 },
      { t: 0.5, speed: Number.POSITIVE_INFINITY },
      null as never,
      { t: 0.25, speed: 1.5 },
    ])).toEqual([{ t: 0.25, speed: 1.5 }]);
    expect(normalizeSpeedCurvePoints([])).toEqual([]);
    expect(normalizeSpeedCurvePoints(null)).toEqual([]);
    expect(normalizeSpeedCurvePoints(undefined)).toEqual([]);
  });

  it("points sharing a time collapse to the last one drawn", () => {
    expect(normalizeSpeedCurvePoints([
      { t: 0.5, speed: 1 }, { t: 0.5, speed: 2 },
    ])).toEqual([{ t: 0.5, speed: 2 }]);
    expect(normalizeSpeedCurvePoints([
      { t: 0.5, speed: 2 }, { t: 0.5, speed: 1 },
    ])).toEqual([{ t: 0.5, speed: 1 }]);
  });

  it("interior points crowding a neighbour are dropped; the t=1 endpoint always survives", () => {
    expect(normalizeSpeedCurvePoints([
      { t: 0, speed: 1 }, { t: 0.01, speed: 2 }, { t: 0.5, speed: 1.5 }, { t: 1, speed: 1 },
    ])).toEqual([
      { t: 0, speed: 1 }, { t: 0.5, speed: 1.5 }, { t: 1, speed: 1 },
    ]);
    expect(normalizeSpeedCurvePoints([
      { t: 0.99, speed: 2 }, { t: 1, speed: 3 },
    ])).toEqual([{ t: 1, speed: 3 }]);
  });

  it("a single drawn point exports as one constant segment at its speed", () => {
    expect(tuples(segmentsFromCustomCurve([{ t: 0.3, speed: 2 }]))).toEqual([[0, 1, 2]]);
  });

  it("a flat drawn curve merges into a single 1x segment", () => {
    const segs = segmentsFromCustomCurve([{ t: 0, speed: 1 }, { t: 1, speed: 1 }]);
    expect(tuples(segs)).toEqual([[0, 1, 1]]);
  });

  it("a two-point ramp at the exact bounds samples into 8 ascending segments", () => {
    const segs = segmentsFromCustomCurve([{ t: 0, speed: 0.5 }, { t: 1, speed: 2 }]);
    expect(tuples(segs)).toEqual([
      [0, 0.125, 0.59], [0.125, 0.25, 0.78], [0.25, 0.375, 0.97], [0.375, 0.5, 1.16],
      [0.5, 0.625, 1.34], [0.625, 0.75, 1.53], [0.75, 0.875, 1.72], [0.875, 1, 1.91],
    ]);
  });

  it("out-of-order drawn points convert identically to their sorted form", () => {
    const a = segmentsFromCustomCurve([{ t: 1, speed: 2 }, { t: 0, speed: 0.5 }, { t: 0.5, speed: 1 }]);
    const b = segmentsFromCustomCurve([{ t: 0, speed: 0.5 }, { t: 0.5, speed: 1 }, { t: 1, speed: 2 }]);
    expect(tuples(a)).toEqual(tuples(b));
    expect(tuples(b)).toEqual([
      [0, 0.125, 0.56], [0.125, 0.25, 0.69], [0.25, 0.375, 0.81], [0.375, 0.5, 0.94],
      [0.5, 0.625, 1.13], [0.625, 0.75, 1.38], [0.75, 0.875, 1.63], [0.875, 1, 1.88],
    ]);
  });

  it("derived segments tile [0,1] and pass segment normalization unchanged", () => {
    const segs = segmentsFromCustomCurve([
      { t: 0, speed: 1 }, { t: 0.3, speed: 0.25 }, { t: 0.62, speed: 3.5 }, { t: 1, speed: 1 },
    ]);
    expect(segs[0]!.startT).toBe(0);
    expect(segs[segs.length - 1]!.endT).toBe(1);
    expect(tuples(normalizeSpeedSegments(segs))).toEqual(tuples(segs));
  });

  it("an empty curve converts to no segments (caller stores no ramp)", () => {
    expect(segmentsFromCustomCurve([])).toEqual([]);
    expect(segmentsFromCustomCurve(null)).toEqual([]);
  });
});

describe("speed preset regression pins (Wave 3 #18 — presets byte-identical)", () => {
  it("the catalog still ships the same 10 preset curves in order", () => {
    expect(SPEED_CURVE_PRESETS.map((c) => c.id)).toEqual([
      "flat", "ramp-up", "ramp-down", "punch", "wave",
      "bullet-time", "hyper-lapse", "heartbeat", "crescendo", "flashback",
    ]);
    expect(SPEED_CURVE_PRESETS.find((c) => c.id === "heartbeat")!.points).toEqual([
      { t: 0, speed: 1 }, { t: 0.15, speed: 0.5 }, { t: 0.3, speed: 1 }, { t: 0.45, speed: 0.5 },
      { t: 0.6, speed: 1 }, { t: 0.75, speed: 0.5 }, { t: 0.9, speed: 1 }, { t: 1, speed: 1 },
    ]);
  });

  it("preset → segments sampling output is unchanged (wave, punch, flat at 4)", () => {
    const at4 = (id: string) =>
      segmentsFromPresetCurve(SPEED_CURVE_PRESETS.find((c) => c.id === id)!.points, 4)
        .map((s) => [s.startT, s.endT, s.speed]);
    expect(at4("wave")).toEqual([
      [0, 0.25, 1.25], [0.25, 0.5, 1.13], [0.5, 0.75, 1.13], [0.75, 1, 1.25],
    ]);
    // The punch dip's true midpoint value is 0.875 both sides; floating
    // point lands one side a hair under, so the sampler's long-standing
    // output is 0.87 in / 0.88 out — pinned as-is.
    expect(at4("punch")).toEqual([
      [0, 0.25, 1], [0.25, 0.5, 0.87], [0.5, 0.75, 0.88], [0.75, 1, 1],
    ]);
    expect(at4("flat")).toEqual([
      [0, 0.25, 1], [0.25, 0.5, 1], [0.5, 0.75, 1], [0.75, 1, 1],
    ]);
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
