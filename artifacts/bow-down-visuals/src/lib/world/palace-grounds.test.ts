/**
 * The World — palace grounds tests (lib/world/palace-grounds).
 *
 * Stage C batch C2, board items 5 (backdrop ring), 6 (outdoor
 * ground system), 8 (lawns & planting), 17 (monument scale &
 * sculpture) and 38 (elevation). The grounds are pure placement
 * data, so the laws are pinned here without a GL context:
 *   - paving slabs are whole texture tiles inside the courtyard
 *     floor rects (integral repeats, per the texture manifest);
 *   - lawns keep their shipped footprints and walk semantics;
 *   - the monument grew AROUND its heart: the plate drum is
 *     exactly item 16's, while plinth/crown/urns outgrew the old
 *     build — and its blocked rect grew in the same batch;
 *   - elevation masses flank the walk paths, never enter them,
 *     and are honestly blocked from the same data;
 *   - the backdrop stands beyond every walk rect, inside the
 *     camera's far plane from the plaza's viewpoints.
 */
import { describe, it, expect } from "vitest";
import {
  COURTYARD_ID,
  PALACE_LAYOUT,
  PLAZA_BLOCKED,
  PLAZA_TALL_BLOCKED,
  isWalkable,
  type PalaceRect,
} from "./palace-layout";
import {
  COURTYARD_FLOOR_RECTS,
  PAVING_SLAB_M,
  PAVING_SLABS,
  pavingSlabsFor,
  LAWN_PANELS,
  LAWN_BED,
  lawnEdgingRuns,
  lawnPlantingSpots,
  PARTERRE_MEDALLION,
  MONUMENT,
  MONUMENT_BLOCKED,
  HALL_STEPS,
  HALL_STEPS_BLOCKED,
  hallStepRuns,
  TERRACES,
  TERRACE_BLOCKED,
  terraceRuns,
  BACKDROP,
  BACKDROP_WINGS,
  BACKDROP_GARDENS,
  backdropGroundRects,
  backdropWindowStyle,
} from "./palace-grounds";

const overlaps = (a: PalaceRect, b: PalaceRect) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

const plaza = PALACE_LAYOUT[COURTYARD_ID]!;
const walkRects: PalaceRect[] = [plaza.walk, ...(plaza.grounds ?? [])];

describe("outdoor ground system (item 6)", () => {
  it("the paving plan covers exactly the courtyard's three floor rects", () => {
    expect(COURTYARD_FLOOR_RECTS).toEqual([
      { minX: -28.2, maxX: 28.2, minZ: 12.4, maxZ: 26.0 },
      { minX: -28.2, maxX: 2.6, minZ: 26.0, maxZ: 34.0 },
      { minX: 16.4, maxX: 28.2, minZ: 26.0, maxZ: 34.0 },
    ]);
  });

  it("every paving slab is exactly one whole texture tile, inside a floor rect", () => {
    expect(PAVING_SLABS.length).toBe(60); // 14×3 + 7×2 + 2×2 whole tiles
    for (const s of PAVING_SLABS) {
      expect(s.w).toBe(PAVING_SLAB_M);
      expect(s.d).toBe(PAVING_SLAB_M);
      const inside = COURTYARD_FLOOR_RECTS.some(
        (r) => s.cx - s.w / 2 >= r.minX - 1e-9 && s.cx + s.w / 2 <= r.maxX + 1e-9
          && s.cz - s.d / 2 >= r.minZ - 1e-9 && s.cz + s.d / 2 <= r.maxZ + 1e-9,
      );
      expect(inside).toBe(true);
    }
    // Whole tiles per rect: the grid never invents a partial slab.
    for (const r of COURTYARD_FLOOR_RECTS) {
      const slabs = pavingSlabsFor(r);
      const expectN = Math.floor((r.maxX - r.minX) / PAVING_SLAB_M)
        * Math.floor((r.maxZ - r.minZ) / PAVING_SLAB_M);
      expect(slabs.length).toBe(expectN);
    }
  });
});

describe("lawns & planting (item 8)", () => {
  it("the lawn panels keep their shipped footprints exactly", () => {
    expect(LAWN_PANELS).toEqual([
      { cx: -16.75, cz: 19.2, w: 20.5, d: 11.0, topY: 0.05 },
      { cx: 16.75, cz: 19.2, w: 20.5, d: 11.0, topY: 0.05 },
    ]);
    // …and lawn ground stays stroll-across walkable, as shipped.
    for (const p of LAWN_PANELS) {
      expect(isWalkable(p.cx, p.cz)).toBe(true);
      expect(isWalkable(p.cx - 8, p.cz + 4)).toBe(true);
    }
  });

  it("edging runs stay on the panel's own rim — no new collision anywhere", () => {
    for (const p of LAWN_PANELS) {
      const runs = lawnEdgingRuns(p);
      expect(runs.length).toBe(4);
      for (const b of runs) {
        expect(b.cx - b.w / 2).toBeGreaterThanOrEqual(p.cx - p.w / 2 - 1e-9);
        expect(b.cx + b.w / 2).toBeLessThanOrEqual(p.cx + p.w / 2 + 1e-9);
        expect(b.cz - b.d / 2).toBeGreaterThanOrEqual(p.cz - p.d / 2 - 1e-9);
        expect(b.cz + b.d / 2).toBeLessThanOrEqual(p.cz + p.d / 2 + 1e-9);
        expect(b.h).toBe(LAWN_BED.rimH);
      }
    }
  });

  it("the parterre planting stays inside the grass, ringed around the medallion", () => {
    expect(PARTERRE_MEDALLION.outerR).toBeGreaterThan(PARTERRE_MEDALLION.innerR);
    for (const p of LAWN_PANELS) {
      const spots = lawnPlantingSpots(p);
      expect(spots.length).toBe(10);
      for (const s of spots) {
        expect(Math.abs(s.x - p.cx)).toBeLessThan(p.w / 2 - LAWN_BED.inset);
        expect(Math.abs(s.z - p.cz)).toBeLessThan(p.d / 2 - LAWN_BED.inset);
        // No crown sits inside the medallion ring itself.
        expect(Math.hypot(s.x - p.cx, s.z - p.cz)).toBeGreaterThan(PARTERRE_MEDALLION.outerR + 0.3);
      }
    }
  });
});

describe("monument scale & sculpture (item 17)", () => {
  it("the plate drum is EXACTLY item 16's — headlines render as today", () => {
    expect(MONUMENT.cx).toBe(0);
    expect(MONUMENT.cz).toBe(19.7);
    expect(MONUMENT.drum).toEqual({
      size: 1.74, h: 2.1, centerY: 2.09, faceOffset: 0.88, faceW: 1.4, faceH: 1.96,
    });
  });

  it("the monument outgrew the old build on every axis", () => {
    // Old build: 3.55 m trim square, stele top 3.69 + cone to
    // ~4.19, 0.09 m corner spheres peaking at 0.40, ring to 2.65.
    expect(MONUMENT.tier1Trim.size).toBeGreaterThan(3.55);
    expect(MONUMENT.crown.spikeTopY).toBeGreaterThan(5);
    expect(MONUMENT.urns.urnTopY).toBeGreaterThan(0.4);
    expect(MONUMENT.urns.urnR).toBeGreaterThan(0.09);
    expect(MONUMENT.ring.outerR).toBeGreaterThan(2.65);
    expect(MONUMENT.stele.topY).toBeGreaterThan(3.69);
    // The stele is bevelled: foot wider than crown, front to back too.
    expect(MONUMENT.stele.baseW).toBeGreaterThan(MONUMENT.stele.topW);
    expect(MONUMENT.stele.baseD).toBeGreaterThan(MONUMENT.stele.topD);
    // The relief bands ride the stele between its foot and crown.
    for (const y of MONUMENT.reliefBandYs) {
      expect(y).toBeGreaterThan(MONUMENT.stele.baseY);
      expect(y).toBeLessThan(MONUMENT.stele.topY);
    }
  });

  it("the blocked rect grew with the plinth — layout and grounds agree", () => {
    // The rect contains the tier-1 trim square (the widest solid).
    const half = MONUMENT.tier1Trim.size / 2;
    expect(MONUMENT_BLOCKED.minX).toBeLessThanOrEqual(MONUMENT.cx - half);
    expect(MONUMENT_BLOCKED.maxX).toBeGreaterThanOrEqual(MONUMENT.cx + half);
    expect(MONUMENT_BLOCKED.minZ).toBeLessThanOrEqual(MONUMENT.cz - half);
    expect(MONUMENT_BLOCKED.maxZ).toBeGreaterThanOrEqual(MONUMENT.cz + half);
    expect(PLAZA_BLOCKED).toContainEqual(MONUMENT_BLOCKED);
    expect(PLAZA_TALL_BLOCKED).toContainEqual(MONUMENT_BLOCKED);
    // The board station + a reader's stance stay on open plaza.
    expect(isWalkable(0, 22.6)).toBe(true);
    expect(isWalkable(0, 22.15)).toBe(true);
    expect(isWalkable(0, 19.7)).toBe(false);
    // The urns stand ON tier 2 (pedestal footprint inside its top).
    expect(Math.abs(MONUMENT.urns.at) + 0.17).toBeLessThanOrEqual(MONUMENT.tier2.size / 2);
    expect(MONUMENT.urns.urnBaseY).toBeCloseTo(MONUMENT.tier2.topY + MONUMENT.urns.pedestalH, 6);
  });
});

describe("elevation (item 38)", () => {
  it("the hall steps flank the path — the 3.6 m marble run stays clear", () => {
    // The path slab is 3.6 m wide (|x| ≤ 1.8); the steps start outboard.
    expect(HALL_STEPS.sideX0).toBeGreaterThan(1.8);
    for (const b of HALL_STEPS_BLOCKED) {
      expect(Math.min(Math.abs(b.minX), Math.abs(b.maxX))).toBeGreaterThanOrEqual(1.8);
      expect(PLAZA_BLOCKED).toContainEqual(b);
      expect(isWalkable((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)).toBe(false);
    }
    // The path between them, and the arch approach, stay walkable.
    expect(isWalkable(0, 14)).toBe(true);
    expect(isWalkable(0, 13)).toBe(true);
    // Every built step box lands inside a blocked rect.
    for (const s of hallStepRuns()) {
      const r: PalaceRect = {
        minX: s.cx - s.w / 2, maxX: s.cx + s.w / 2, minZ: s.cz - s.d / 2, maxZ: s.cz + s.d / 2,
      };
      const covered = HALL_STEPS_BLOCKED.some(
        (b) => r.minX >= b.minX - 1e-9 && r.maxX <= b.maxX + 1e-9 && r.minZ >= b.minZ - 1e-9 && r.maxZ <= b.maxZ + 1e-9,
      );
      expect(covered).toBe(true);
      expect(s.cy + s.h / 2).toBeLessThanOrEqual(HALL_STEPS.platformTopY + 1e-9);
    }
    // Three rises a side, marching up toward the façade.
    const west = hallStepRuns().filter((s) => s.cx < 0);
    expect(west.length).toBe(4); // 3 treads + the platform
  });

  it("the terraces mass the grounds' edges, rising toward the walls, honestly blocked", () => {
    for (const b of TERRACE_BLOCKED) {
      expect(PLAZA_BLOCKED).toContainEqual(b);
      expect(isWalkable((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)).toBe(false);
    }
    const east = terraceRuns().filter((s) => s.cx > 0).sort((a, b) => a.cx - b.cx);
    expect(east.length).toBe(3);
    // Tops ascend as the mass approaches the east wall.
    expect(east.map((s) => s.cy + s.h / 2)).toEqual([...TERRACES.tops]);
    // Terraces clear the lawns (they stand north of them) and the path.
    for (const s of terraceRuns()) {
      expect(s.cz + s.d / 2).toBeLessThanOrEqual(TERRACES.z1);
      expect(Math.abs(s.cx)).toBeGreaterThan(20);
    }
    // The open grounds between the terraces stay walkable.
    expect(isWalkable(24, 15)).toBe(true);
    expect(isWalkable(-24, 20)).toBe(true);
  });
});

describe("backdrop ring (item 5)", () => {
  it("no backdrop solid touches walkable ground — it all stands beyond the walls", () => {
    for (const r of backdropGroundRects()) {
      for (const w of walkRects) expect(overlaps(r, w)).toBe(false);
      // Nor the courtyard's interior shell itself.
      expect(overlaps(r, plaza.interior)).toBe(false);
    }
  });

  it("everything sits inside the far plane from the plaza, and inside the dome from its heart", () => {
    const corners: Array<[number, number]> = [
      [plaza.camClamp.minX, plaza.camClamp.minZ],
      [plaza.camClamp.minX, plaza.camClamp.maxZ],
      [plaza.camClamp.maxX, plaza.camClamp.minZ],
      [plaza.camClamp.maxX, plaza.camClamp.maxZ],
    ];
    const farCorners = (r: PalaceRect): Array<[number, number]> => [
      [r.minX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.minZ], [r.maxX, r.maxZ],
    ];
    for (const r of backdropGroundRects()) {
      for (const [cx, cz] of corners) {
        for (const [px, pz] of farCorners(r)) {
          expect(Math.hypot(px - cx, pz - cz)).toBeLessThan(120);
        }
      }
      // From the plaza's heart (the monument), the 90 m dome holds it.
      for (const [px, pz] of farCorners(r)) {
        expect(Math.hypot(px - MONUMENT.cx, pz - MONUMENT.cz)).toBeLessThan(90);
      }
    }
    // The skirt + moat rings stay inside the dome's reach too.
    expect(BACKDROP.skirtR).toBeLessThanOrEqual(90);
    expect(BACKDROP.moatOuterR).toBeLessThan(BACKDROP.skirtR);
    expect(BACKDROP.moatInnerR).toBeGreaterThan(34); // beyond the south wall line
  });

  it("the wings carry lit windows echoing the façade — lit at night, pale by day", () => {
    expect(BACKDROP_WINGS.length).toBe(3);
    for (const w of BACKDROP_WINGS) expect(w.windows.length).toBeGreaterThanOrEqual(3);
    const night = backdropWindowStyle("dark");
    const day = backdropWindowStyle("light");
    expect(night.emissiveIntensity).toBeGreaterThan(1);
    expect(day.emissiveIntensity).toBeLessThan(0.5);
    expect(night.emissive).toBe(0xffa64d); // the façade's own lit-glass gold
    expect(BACKDROP_GARDENS.length).toBeGreaterThanOrEqual(8);
  });
});
