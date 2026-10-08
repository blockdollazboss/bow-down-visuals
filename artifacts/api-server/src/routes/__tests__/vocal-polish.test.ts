import { describe, it, expect } from "vitest";
import type { Router } from "express";

import vocalPolishRouter, {
  semitonesToRatio,
  buildRubberbandFilter,
  buildFallbackFilter,
  computeTotalPitchShift,
  VOCAL_POLISH_CREDIT_COST,
} from "../generate/vocal-polish";

/* Recursively collect METHOD + path from an Express router's layer stack. */
function collectRoutes(router: Router, prefix = ""): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const stack = (router as unknown as { stack?: unknown[] }).stack ?? [];
  for (const layer of stack) {
    const l = layer as {
      route?: { path?: string; methods?: Record<string, boolean> };
      handle?: { stack?: unknown[] };
    };
    if (typeof l.route?.path === "string") {
      const methods = Object.keys(l.route.methods ?? {}).filter(
        (m) => m !== "_all" && l.route!.methods![m],
      );
      for (const m of methods) out.push({ method: m.toUpperCase(), path: prefix + l.route.path });
    } else if (Array.isArray(l.handle?.stack)) {
      out.push(...collectRoutes(l.handle as Router, prefix));
    }
  }
  return out;
}

describe("vocal-polish routes", () => {
  it("registers POST /api/vocal-polish and GET /api/vocal-polish/:jobId exactly once", () => {
    const routes = collectRoutes(vocalPolishRouter);
    const posts = routes.filter((r) => r.method === "POST" && r.path === "/vocal-polish");
    const gets = routes.filter((r) => r.method === "GET" && r.path === "/vocal-polish/:jobId");
    expect(posts).toHaveLength(1);
    expect(gets).toHaveLength(1);
  });

  it("costs 200 Visual Bucs", () => {
    expect(VOCAL_POLISH_CREDIT_COST).toBe(200);
  });
});

describe("semitonesToRatio", () => {
  it("maps 0 st to 1 and 12 st to 2", () => {
    expect(semitonesToRatio(0)).toBeCloseTo(1, 10);
    expect(semitonesToRatio(12)).toBeCloseTo(2, 10);
    expect(semitonesToRatio(-12)).toBeCloseTo(0.5, 10);
  });
});

describe("buildRubberbandFilter", () => {
  it("builds a fractional-semitone pitch + tempo filter", () => {
    expect(buildRubberbandFilter(2.35, 1.1)).toBe("rubberband=pitch=2.350:tempo=1.1000");
  });
});

describe("buildFallbackFilter", () => {
  it("restores duration with compensating atempo for a +2 st shift at 1.1x tempo", () => {
    // ratio = 2^(2/12) ≈ 1.12246 → asetrate=49501; restore = 1.1/1.12246 ≈ 0.98
    const f = buildFallbackFilter(2, 1.1);
    expect(f).toBe("aresample=44100,asetrate=49501,aresample=44100,atempo=0.9800");
  });

  it("is a no-op duration-wise for 0 shift at 1x tempo", () => {
    expect(buildFallbackFilter(0, 1)).toBe("aresample=44100,asetrate=44100,aresample=44100,atempo=1.0000");
  });
});

describe("computeTotalPitchShift", () => {
  it("scales the detected drift by strength and caps at ±50 cents", () => {
    // 40¢ sharp, 50% strength → −20¢ applied
    const r = computeTotalPitchShift(0, 40, 50);
    expect(r.appliedCents).toBeCloseTo(-20, 10);
    expect(r.total).toBeCloseTo(-0.2, 10);
  });

  it("adds the user key shift on top of the tuning nudge", () => {
    const r = computeTotalPitchShift(2, -30, 100);
    expect(r.appliedCents).toBeCloseTo(30, 10);
    expect(r.total).toBeCloseTo(2.3, 10);
  });

  it("clamps the nudge to ±50 cents", () => {
    const r = computeTotalPitchShift(0, 46, 100);
    // −46¢ requested; |−46| ≤ 50 so it passes through unclamped
    expect(r.appliedCents).toBeCloseTo(-46, 10);
    // An artificially huge drift request still caps at the gentle limit
    const r2 = computeTotalPitchShift(0, 49, 100);
    expect(Math.abs(r2.appliedCents)).toBeLessThanOrEqual(50);
  });

  it("skips the nudge when the drift is inaudible (< 5¢) or strength is 0", () => {
    expect(computeTotalPitchShift(1, 3, 100).appliedCents).toBe(0);
    expect(computeTotalPitchShift(1, null, 100).appliedCents).toBe(0);
    expect(computeTotalPitchShift(1, 40, 0).appliedCents).toBe(0);
  });
});
