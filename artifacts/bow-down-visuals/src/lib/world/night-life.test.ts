/**
 * night-life — board item 27's arithmetic.
 *
 * Pins:
 * - the ember count follows the quality ladder's spirit: full
 *   on high, fewer on medium, none on low (the rung with no
 *   candle point lights);
 * - a brazier's field is deterministic in its seed key — same
 *   brazier, same embers, every visit;
 * - an ember climbs, loops, and fades: y stays within the rise
 *   height, fade falls as it climbs, and the cycle repeats.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  EMBER_RISE_HEIGHT,
  createEmberField,
  emberCountForTier,
  emberOffsetAt,
  lanternGlowScale,
} from "./night-life";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("night-life embers", () => {
  it("counts follow the quality ladder", () => {
    expect(emberCountForTier("high")).toBeGreaterThan(emberCountForTier("medium"));
    expect(emberCountForTier("medium")).toBeGreaterThan(0);
    expect(emberCountForTier("low")).toBe(0);
  });

  it("fields are deterministic per brazier and differ between braziers", () => {
    expect(createEmberField(9, "-4.6,18.6")).toEqual(createEmberField(9, "-4.6,18.6"));
    expect(createEmberField(9, "-4.6,18.6")).not.toEqual(createEmberField(9, "4.6,18.6"));
    expect(createEmberField(0, "x")).toEqual([]);
  });

  it("embers rise, stay in the column, fade, and loop", () => {
    const [p] = createEmberField(1, "0,0");
    const start = emberOffsetAt(p!, 0);
    expect(start.y).toBeGreaterThanOrEqual(0);
    expect(start.y).toBeLessThan(EMBER_RISE_HEIGHT);
    for (let t = 0; t < 30; t += 0.37) {
      const o = emberOffsetAt(p!, t);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeLessThan(EMBER_RISE_HEIGHT);
      expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(0.4 * 1.7 + 0.001);
      expect(o.fade).toBeCloseTo(1 - o.y / EMBER_RISE_HEIGHT, 5);
    }
    /* One full cycle later the ember is back where it started. */
    const cycleSec = EMBER_RISE_HEIGHT / p!.speed;
    const looped = emberOffsetAt(p!, cycleSec);
    expect(looped.y).toBeCloseTo(start.y, 5);
  });

  it("lantern glow breathes around its base scale", () => {
    for (let t = 0; t < 10; t += 0.3) {
      const s = lanternGlowScale(1.1, t, 0.7);
      expect(s).toBeGreaterThanOrEqual(1.1 * 0.87);
      expect(s).toBeLessThanOrEqual(1.1 * 1.13);
    }
  });

  it("hall-scene consumes the ladder instead of editing it (source pin)", () => {
    const src = read("./hall-scene.ts");
    expect(src).toContain("emberCountForTier");
    expect(src).toContain("createEmberField");
    /* The QUALITY table itself is untouched by this lane. */
    expect(src).toContain('low: { pixelRatio: 1.25, reflectorSize: 0, shadows: false, candleLights: false }');
  });
});
