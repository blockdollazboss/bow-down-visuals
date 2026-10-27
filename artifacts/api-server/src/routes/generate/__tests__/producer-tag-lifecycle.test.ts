/**
 * Your Own Tag (#159 delta) — tests for the pure pieces of the tag
 * lifecycle: the house-gift pricing rule and the two-second sonic logo's
 * musical spec (G-minor triad over a sliding 808, per the signature
 * sounds palette), plus the expression the ffmpeg renderer consumes.
 */
import { describe, expect, it } from "vitest";
import {
  approvalPrice,
  sonicLogoMelodyExpr,
  SONIC_LOGO_SECONDS,
  SONIC_LOGO_NOTES,
  SONIC_LOGO_GLIDE,
  SONIC_LOGO_HAT_INTERVAL_SEC,
} from "../producer-tag-lifecycle";
import { PRODUCER_TAG_COST } from "../producer-tag";

describe("approvalPrice — the house gift", () => {
  it("makes the first approval free", () => {
    expect(approvalPrice(0)).toBe(0);
  });

  it("charges the standard tag price for replacements", () => {
    expect(approvalPrice(1)).toBe(PRODUCER_TAG_COST);
    expect(approvalPrice(3)).toBe(PRODUCER_TAG_COST);
    expect(PRODUCER_TAG_COST).toBe(100);
  });
});

describe("sonic logo spec", () => {
  it("is a two-second form", () => {
    expect(SONIC_LOGO_SECONDS).toBe(2);
  });

  it("plays the G-minor triad (G3, Bb3, D4) as its plucks", () => {
    expect(SONIC_LOGO_NOTES.map((n) => n.hz)).toEqual([196.0, 233.08, 293.66]);
    const starts = SONIC_LOGO_NOTES.map((n) => n.atSec);
    expect(starts).toEqual([0, 0.45, 0.9]);
    for (const n of SONIC_LOGO_NOTES) {
      expect(n.atSec).toBeLessThan(SONIC_LOGO_SECONDS);
    }
  });

  it("slides the 808 from G2 down to G1", () => {
    expect(SONIC_LOGO_GLIDE).toEqual({ fromHz: 98, toHz: 49 });
  });

  it("ticks hats on triplet eighths at 142 BPM", () => {
    // Beat at 142 BPM = 60/142 s; a triplet eighth is a third of a beat.
    expect(SONIC_LOGO_HAT_INTERVAL_SEC).toBeCloseTo(60 / 142 / 3, 3);
  });
});

describe("sonicLogoMelodyExpr", () => {
  it("carries the glide and every note frequency for the renderer", () => {
    const expr = sonicLogoMelodyExpr();
    expect(expr).toContain("98*t");
    for (const n of SONIC_LOGO_NOTES) {
      expect(expr).toContain(`${n.hz}`);
    }
    // Plucks are gated to start at their note time, never before.
    expect(expr).toContain("gte(t,0.45)");
    expect(expr).toContain("gte(t,0.9)");
  });
});
