/**
 * Quality ladder tests (lib/world/quality) — items 22 + 99.
 * The ladder must protect frame rate on weak devices without ever
 * oscillating, the user preference must pin/persist correctly, and
 * the rung table must stay meaningful — including the item-99 fix:
 * LOW keeps the brazier lights (the night plaza's only lights).
 */
import { describe, it, expect } from "vitest";
import {
  QUALITY_RUNGS,
  FrameTimeMonitor,
  FRAME_MONITOR,
  detectInitialTier,
  loadQualityPreference,
  nextQualityPreference,
  normalizeQualityPreference,
  qualityPreferenceLabel,
  resolveTier,
  rungFor,
  stepDownTier,
  stepUpTier,
  storeQualityPreference,
  WORLD_QUALITY_STORAGE_KEY,
  type QualityPreference,
} from "./quality";

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

/** Feed `n` frames of `ms` at 16.7ms wall-clock steps from t0. */
function feed(mon: FrameTimeMonitor, ms: number, n: number, t0: number): { stepped: unknown; t: number } {
  let t = t0;
  let stepped: unknown = null;
  for (let i = 0; i < n; i++) {
    t += 16.7;
    stepped = mon.sample(ms, t) ?? stepped;
  }
  return { stepped, t };
}

describe("detectInitialTier (the boot guess, unchanged heuristic)", () => {
  it("coarse pointer starts a rung lower", () => {
    expect(detectInitialTier(true, 8)).toBe("medium");
    expect(detectInitialTier(true, 6)).toBe("medium");
    expect(detectInitialTier(true, 4)).toBe("low");
    expect(detectInitialTier(true, 2)).toBe("low");
  });
  it("fine pointer trusts core count", () => {
    expect(detectInitialTier(false, 8)).toBe("high");
    expect(detectInitialTier(false, 4)).toBe("high");
    expect(detectInitialTier(false, 2)).toBe("medium");
  });
  it("degenerate core counts fall back sanely", () => {
    expect(detectInitialTier(false, 0)).toBe("high"); // unknown → 4-core default
    expect(detectInitialTier(true, Number.NaN)).toBe("low");
  });
});

describe("preference resolve + persistence", () => {
  it("an explicit preference pins the rung; auto defers", () => {
    expect(resolveTier("auto", "medium")).toBe("medium");
    expect(resolveTier("high", "low")).toBe("high");
    expect(resolveTier("low", "high")).toBe("low");
  });
  it("normalizes junk to auto", () => {
    expect(normalizeQualityPreference("high")).toBe("high");
    expect(normalizeQualityPreference("ultra")).toBe("auto");
    expect(normalizeQualityPreference(null)).toBe("auto");
    expect(normalizeQualityPreference("")).toBe("auto");
  });
  it("round-trips through storage; auto clears the key", () => {
    const s = memStorage();
    storeQualityPreference("low", s);
    expect(s.map.get(WORLD_QUALITY_STORAGE_KEY)).toBe("low");
    expect(loadQualityPreference(s)).toBe("low");
    storeQualityPreference("auto", s);
    expect(s.map.has(WORLD_QUALITY_STORAGE_KEY)).toBe(false);
    expect(loadQualityPreference(s)).toBe("auto");
  });
  it("the control cycles Auto → High → Medium → Low → Auto with labels", () => {
    const cycle: QualityPreference[] = ["auto", "high", "medium", "low"];
    for (let i = 0; i < cycle.length; i++) {
      expect(nextQualityPreference(cycle[i]!)).toBe(cycle[(i + 1) % cycle.length]!);
    }
    expect(qualityPreferenceLabel("auto")).toBe("Auto");
    expect(qualityPreferenceLabel("low")).toBe("Low");
  });
  it("tier stepping clamps at both ends", () => {
    expect(stepDownTier("high")).toBe("medium");
    expect(stepDownTier("low")).toBeNull();
    expect(stepUpTier("low")).toBe("medium");
    expect(stepUpTier("high")).toBeNull();
  });
});

describe("rung table (item 99: meaningful rungs)", () => {
  it("every rung differs from its neighbour on multiple axes", () => {
    const axes = [
      "pixelRatio",
      "reflectorSize",
      "shadowMapSize",
      "anisotropy",
      "particleScale",
      "lodDrawDistance",
    ] as const;
    for (const [a, b] of [
      ["high", "medium"],
      ["medium", "low"],
    ] as const) {
      const diffs = axes.filter((k) => QUALITY_RUNGS[a][k] !== QUALITY_RUNGS[b][k]);
      expect(diffs.length).toBeGreaterThanOrEqual(4);
    }
  });
  it("LOW keeps the brazier lights — the night plaza's only lights (E7 fix)", () => {
    for (const tier of ["high", "medium", "low"] as const) {
      expect(rungFor(tier).brazierLights).toBe(true);
    }
    // Low cuts the DECORATIVE candle extras instead.
    expect(rungFor("low").candleLights).toBe(false);
    expect(rungFor("medium").candleLights).toBe(true);
  });
  it("low is the genuine weak-hardware rung: no reflector, no shadows, PR 1.25", () => {
    const low = rungFor("low");
    expect(low.reflectorSize).toBe(0);
    expect(low.shadows).toBe(false);
    expect(low.shadowMapSize).toBe(0);
    expect(low.pixelRatio).toBe(1.25);
    expect(low.antialias).toBe(false);
  });
  it("medium keeps shadows with a smaller map and a throttled glimpse reflector", () => {
    const med = rungFor("medium");
    expect(med.shadows).toBe(true);
    expect(med.shadowMapSize).toBe(1024);
    expect(med.reflectorSize).toBe(512);
    expect(med.reflectorGlimpseEveryN).toBe(2);
    expect(rungFor("high").shadowMapSize).toBe(2048);
  });
  it("lod draw distance shrinks with the rung", () => {
    expect(rungFor("high").lodDrawDistance).toBeGreaterThan(rungFor("medium").lodDrawDistance);
    expect(rungFor("medium").lodDrawDistance).toBeGreaterThan(rungFor("low").lodDrawDistance);
  });
});

describe("FrameTimeMonitor (item 22: adaptive ladder)", () => {
  it("steps down after sustained overload, not before", () => {
    const mon = new FrameTimeMonitor("high");
    // Warm the window (needs half a window before judging).
    const warm = feed(mon, 25, FRAME_MONITOR.windowSize, 0);
    expect(mon.current).toBe("high");
    const res = feed(mon, 25, FRAME_MONITOR.downSustainSamples + 5, warm.t);
    expect(res.stepped).toBe("medium");
    expect(mon.current).toBe("medium");
  });
  it("a single hitch changes nothing (outlier samples dropped, dead band holds)", () => {
    const mon = new FrameTimeMonitor("high");
    feed(mon, 16.7, 120, 0);
    expect(mon.sample(500, 5000)).toBeNull();
    const res = feed(mon, 16.7, 300, 5100);
    expect(res.stepped).toBeNull();
    expect(mon.current).toBe("high");
  });
  it("60fps (16.7ms) sits in the dead band — neither streak builds", () => {
    const mon = new FrameTimeMonitor("medium");
    const res = feed(mon, 16.7, 2000, 0);
    expect(res.stepped).toBeNull();
    expect(mon.current).toBe("medium");
  });
  it("steps back up only after long headroom, and never above the ceiling", () => {
    const mon = new FrameTimeMonitor("high");
    // Force down to medium first.
    const w = feed(mon, 25, 400, 0);
    expect(mon.current).toBe("medium");
    // Long fast run well past the cooldown: climbs back to high…
    const up = feed(mon, 8, FRAME_MONITOR.upSustainSamples + 700, w.t + FRAME_MONITOR.cooldownMs + 1000);
    expect(up.stepped).toBe("high");
    expect(mon.current).toBe("high");
    // …and stays there no matter how fast it runs.
    const more = feed(mon, 8, 2000, up.t + 10000);
    expect(more.stepped).toBeNull();
    expect(mon.current).toBe("high");
  });
  it("a medium-ceiling device never climbs to high", () => {
    const mon = new FrameTimeMonitor("medium");
    feed(mon, 8, 3000, 0);
    expect(mon.current).toBe("medium");
  });
  it("cooldown + sustain gate every step (no oscillation, no instant double-drop)", () => {
    const mon = new FrameTimeMonitor("high");
    const w = feed(mon, 25, 400, 0);
    expect(mon.current).toBe("medium");
    // A short overload burst right after the step changes nothing:
    // the sustain streak must rebuild AND the cooldown must pass.
    let t = w.t;
    for (let i = 0; i < 40; i++) {
      t += 16.7;
      expect(mon.sample(25, t)).toBeNull();
    }
    expect(mon.current).toBe("medium");
    // But SUSTAINED overload past the cooldown steps again — the
    // ladder keeps protecting the frame rate, one rung at a time.
    const later = feed(mon, 25, FRAME_MONITOR.downSustainSamples + 60, t + FRAME_MONITOR.cooldownMs);
    expect(later.stepped).toBe("low");
    expect(mon.current).toBe("low");
  });
  it("reset() reseats the rung and restarts the cooldown", () => {
    const mon = new FrameTimeMonitor("high");
    mon.reset("low", 1000);
    expect(mon.current).toBe("low");
    const res = feed(mon, 25, 300, 1000);
    expect(res.stepped).toBeNull();
    expect(mon.current).toBe("low");
  });
  it("average tracks the window", () => {
    const mon = new FrameTimeMonitor("high");
    feed(mon, 10, 80, 0);
    expect(mon.averageMs).toBeCloseTo(10, 0);
  });
});
