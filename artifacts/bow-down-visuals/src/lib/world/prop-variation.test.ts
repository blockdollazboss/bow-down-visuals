/**
 * prop-variation — board item 18's arithmetic.
 *
 * Pins:
 * - deterministic: the same (kind, index) yields the same
 *   variation on every call — the world never reshuffles
 *   between visits;
 * - varied: neighbouring instances actually differ (rotation,
 *   scale, tint, variant), so clones stop reading as clones;
 * - bounded: structural kinds (column, gate) never yaw, and
 *   every jitter stays inside its envelope;
 * - variants cover 0–2 across a run of instances.
 */
import { describe, it, expect } from "vitest";
import { hashSeed, propVariation, seededRandom, type PropKind } from "./prop-variation";

describe("prop-variation", () => {
  it("is deterministic per (kind, index)", () => {
    for (const kind of ["crown", "trough", "column", "gate", "finial"] as PropKind[]) {
      for (let i = 0; i < 12; i++) {
        expect(propVariation(kind, i)).toEqual(propVariation(kind, i));
      }
    }
  });

  it("gives neighbouring instances different faces", () => {
    const crowns = Array.from({ length: 9 }, (_, i) => propVariation("crown", i));
    const keys = new Set(crowns.map((v) => JSON.stringify(v)));
    expect(keys.size).toBe(9);
    const variants = new Set(crowns.map((v) => v.variant));
    expect(variants.size).toBeGreaterThanOrEqual(2);
  });

  it("keeps structural props square and every jitter in envelope", () => {
    for (let i = 0; i < 40; i++) {
      expect(propVariation("column", i).rotY).toBe(0);
      expect(propVariation("gate", i).rotY).toBe(0);
      const c = propVariation("crown", i);
      expect(Math.abs(c.rotY)).toBeLessThanOrEqual(Math.PI);
      expect(c.scale).toBeGreaterThanOrEqual(0.84);
      expect(c.scale).toBeLessThanOrEqual(1.16);
      expect(Math.abs(c.hueShift)).toBeLessThanOrEqual(0.03);
      expect(Math.abs(c.lightnessShift)).toBeLessThanOrEqual(0.05);
      expect([0, 1, 2]).toContain(c.variant);
      const t = propVariation("trough", i);
      expect(Math.abs(t.rotY)).toBeLessThanOrEqual(0.012);
    }
  });

  it("hash + rng streams are stable and in [0,1)", () => {
    expect(hashSeed("prop:crown:0")).toBe(hashSeed("prop:crown:0"));
    expect(hashSeed("prop:crown:0")).not.toBe(hashSeed("prop:crown:1"));
    const rng = seededRandom(42);
    const again = seededRandom(42);
    for (let i = 0; i < 8; i++) {
      const v = rng();
      expect(v).toBe(again());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
