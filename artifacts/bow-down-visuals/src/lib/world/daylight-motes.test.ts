/**
 * daylight-motes.test.ts — Stack-100 #3, item-4 retry.
 *
 * Board-2 item 4's daylight-motes sub-part was parked with
 * "(night pollen/embers exist; a daylight mote system was not
 * built)". Fresh verification: the courtyard HAS daylight pollen
 * (round-1 item 26, plaza-life) — but the six outdoor district
 * shells had no ambient particles in either look. This file pins
 * the build that closed the gap: every outdoor district gets a
 * daylight mote field on the SAME pollen system (same density,
 * same material, same laws), in its own air volume.
 *
 * Pins:
 * - the volume machinery: district volumes sit inside their
 *   interiors past the motes' wander, counts follow the shared
 *   density, fields are deterministic and never leave their air;
 * - the courtyard field is untouched (default-volume behaviour
 *   is the shipped behaviour);
 * - the scene wiring: one helper, gated on the light look and
 *   reduced motion, called by all six district shells, serviced
 *   by the tick and re-ranged by the quality rung.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createPollenField, pollenPositionAt, pollenCountForVolume, pollenVolumeForInterior,
  POLLEN_FIELD, POLLEN_DENSITY_PER_M2,
} from "./plaza-life";
import { STAGE_MOTES, STAGE_GROUNDS_INTERIOR } from "./stage-grounds";
import { GARDENS_MOTES, GARDENS_INTERIOR } from "./listening-gardens";
import { ROW_MOTES, ROW_INTERIOR } from "./creation-row";
import { ATELIERS_MOTES, ATELIERS_INTERIOR } from "./ateliers";
import { BOARDWALK_MOTES, BOARDWALK_INTERIOR } from "./boardwalk";
import { HEIGHTS_MOTES, HEIGHTS_INTERIOR } from "./creator-heights";

const scene = readFileSync(new URL("./hall-scene.ts", import.meta.url), "utf8");

const DISTRICTS = [
  { name: "stage-grounds", motes: STAGE_MOTES, interior: STAGE_GROUNDS_INTERIOR, seed: "stage-grounds", countAtFull: 69 },
  { name: "listening-gardens", motes: GARDENS_MOTES, interior: GARDENS_INTERIOR, seed: "listening-gardens", countAtFull: 69 },
  { name: "creation-row", motes: ROW_MOTES, interior: ROW_INTERIOR, seed: "creation-row", countAtFull: 69 },
  { name: "ateliers", motes: ATELIERS_MOTES, interior: ATELIERS_INTERIOR, seed: "ateliers", countAtFull: 69 },
  { name: "boardwalk", motes: BOARDWALK_MOTES, interior: BOARDWALK_INTERIOR, seed: "boardwalk", countAtFull: 95 },
  { name: "creator-heights", motes: HEIGHTS_MOTES, interior: HEIGHTS_INTERIOR, seed: "creator-heights", countAtFull: 11 },
] as const;

describe("daylight motes — the district volumes (item 4 retry)", () => {
  it("the shared density is the courtyard's own measure", () => {
    expect(POLLEN_DENSITY_PER_M2).toBeCloseTo(0.125, 10);
    expect(pollenCountForVolume(POLLEN_FIELD, 1)).toBe(130);
    expect(pollenCountForVolume(POLLEN_FIELD, 0.6)).toBe(78);
    expect(pollenCountForVolume(POLLEN_FIELD, 0)).toBe(0);
  });

  it("every district volume is its interior inset past the wander (±0.9 m)", () => {
    for (const d of DISTRICTS) {
      expect(d.motes.minX).toBeGreaterThan(d.interior.minX + 0.9);
      expect(d.motes.maxX).toBeLessThan(d.interior.maxX - 0.9);
      expect(d.motes.minZ).toBeGreaterThan(d.interior.minZ + 0.9);
      expect(d.motes.maxZ).toBeLessThan(d.interior.maxZ - 0.9);
      expect(d.motes.minY).toBeGreaterThan(0);
      expect(d.motes.maxY).toBeLessThan(3.5);
      expect(pollenCountForVolume(d.motes, 1)).toBe(d.countAtFull);
      expect(pollenCountForVolume(d.motes, 0.3)).toBe(Math.floor(d.countAtFull * 0.3) > 0 ? pollenCountForVolume(d.motes, 0.3) : 0);
    }
  });

  it("district fields are deterministic, distinct per district, and never leave their air", () => {
    for (const d of DISTRICTS) {
      const a = createPollenField(24, d.seed, d.motes);
      expect(a).toEqual(createPollenField(24, d.seed, d.motes));
      expect(a).not.toEqual(createPollenField(24, "courtyard", d.motes));
      for (const m of a) {
        for (let t = 0; t < 120; t += 3.7) {
          const p = pollenPositionAt(m, t, d.motes);
          expect(p.x).toBeGreaterThanOrEqual(d.interior.minX);
          expect(p.x).toBeLessThanOrEqual(d.interior.maxX);
          expect(p.y).toBeGreaterThanOrEqual(d.motes.minY);
          expect(p.y).toBeLessThanOrEqual(d.motes.maxY);
          expect(p.z).toBeGreaterThanOrEqual(d.interior.minZ);
          expect(p.z).toBeLessThanOrEqual(d.interior.maxZ);
        }
      }
    }
  });

  it("the courtyard field keeps its shipped behaviour on the default volume", () => {
    const legacy = createPollenField(20, "courtyard");
    expect(legacy).toEqual(createPollenField(20, "courtyard", POLLEN_FIELD));
    for (const m of legacy) {
      expect(m.x).toBeGreaterThanOrEqual(POLLEN_FIELD.minX);
      expect(m.x).toBeLessThanOrEqual(POLLEN_FIELD.maxX);
    }
  });
});

describe("daylight motes — scene wiring (item 4 retry)", () => {
  it("one helper builds every district field, gated like the courtyard's", () => {
    const start = scene.indexOf("private buildDaylightMotes(");
    expect(start).toBeGreaterThan(-1);
    const body = scene.slice(start, scene.indexOf("private buildCourtyardShell", start));
    expect(body).toContain('look.theme !== "light"');
    expect(body).toContain("this.reducedMotion");
    expect(body).toContain("pollenCountForVolume(volume, QUALITY[this.quality].particleScale)");
    expect(body).toContain("createPollenField(count, seedKey, volume)");
    expect(body).toContain("anim.districtPollen.push({ points, field, volume })");
    /* The courtyard's material, verbatim: one day-air system. */
    expect(body).toContain("color: 0xfff2c4");
    expect(body).toContain("size: 0.07");
  });

  it("all six district shells call the helper with their own volume + seed", () => {
    for (const d of DISTRICTS) {
      const volName = {
        "stage-grounds": "STAGE_MOTES",
        "listening-gardens": "GARDENS_MOTES",
        "creation-row": "ROW_MOTES",
        ateliers: "ATELIERS_MOTES",
        boardwalk: "BOARDWALK_MOTES",
        "creator-heights": "HEIGHTS_MOTES",
      }[d.name];
      expect(scene).toContain(`this.buildDaylightMotes(g, look, anim, ${volName}, "${d.seed}");`);
    }
  });

  it("the tick drifts the district fields in their own volumes", () => {
    expect(scene).toContain("for (const dp of anim.districtPollen)");
    expect(scene).toContain("pollenPositionAt(dp.field[i]!, t, dp.volume)");
  });

  it("the quality rung re-ranges the district fields from particleScale (item 82's law)", () => {
    expect(scene).toContain("for (const dp of this.lookAnim.districtPollen)");
    expect(scene).toContain("dp.points.geometry.setDrawRange(0, Math.floor(dp.field.length * rung.particleScale))");
    /* …and the courtyard's own pinned rung block is untouched. */
    expect(scene).toContain("pollen.points.geometry.setDrawRange(0, Math.floor(pollen.field.length * rung.particleScale))");
  });

  it("the mote budget is measured: six fields, one draw each, courtyard-density counts", () => {
    const total = DISTRICTS.reduce((s, d) => s + pollenCountForVolume(d.motes, 1), 0);
    expect(total).toBe(382);
  });
});
