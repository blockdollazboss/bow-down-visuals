/**
 * The World — palace exterior tests (lib/world/palace-exterior).
 *
 * Stage C batch C1, board items 1 (palace façade) and 2 (roofline
 * & silhouette). The exterior is pure placement data, so the laws
 * are pinned here without a GL context:
 *   - the façade skins the hall's back wall from OUTSIDE: its back
 *     abuts the wall's outer face (z 12.40) and no ground-level
 *     piece crosses the plaza walk line (z 12.55, palace-layout's
 *     courtyard walk minZ) — no walk rect or door logic changes;
 *   - the arch opening stays exactly the hall's own (x −2.2..2.2
 *     up to the 3.6 m lintel): the doorway seam is untouched;
 *   - windows/banners/pilasters never collide in plan;
 *   - window glass follows the look (lit at night, pale by day);
 *   - the roofline stands at/above the 6.5 m ceiling line and the
 *     hall slab covers the whole hall block, so the palace reads
 *     solid from any raised angle.
 */
import { describe, it, expect } from "vitest";
import { PALACE_DOOR_HEIGHT, PALACE_LAYOUT, COURTYARD_ID } from "./palace-layout";
import {
  HALL_BLOCK,
  PLAZA_WALK_MIN_Z,
  FACADE,
  facadeSkinRuns,
  facadePlinthRuns,
  facadePilaster,
  FACADE_PILASTER_XS,
  FACADE_WINDOWS,
  FACADE_WINDOW_GLASS_Z,
  facadeWindowFrameBars,
  facadeWindowStyle,
  FACADE_BANNERS,
  BANNER,
  PEDIMENT,
  ROOF_SLABS,
  ROOF_PARAPETS,
  TURRETS,
  TURRET,
  DOME,
  facadeGroundRects,
  type ExteriorBox,
} from "./palace-exterior";

const front = (b: ExteriorBox) => b.cz + b.d / 2;
const back = (b: ExteriorBox) => b.cz - b.d / 2;

describe("façade skin (item 1)", () => {
  it("abuts the back wall's outer face — no gap, no coplanar overlap", () => {
    for (const run of facadeSkinRuns()) {
      expect(back(run)).toBeCloseTo(HALL_BLOCK.backWallOuterZ, 6);
      expect(front(run)).toBeCloseTo(FACADE.skinFrontZ, 6);
      expect(front(run)).toBeLessThanOrEqual(PLAZA_WALK_MIN_Z);
    }
  });

  it("leaves the arch opening exactly the hall's own", () => {
    // No skin below the lintel inside the arch span.
    for (const run of facadeSkinRuns()) {
      const overlapsSpan = run.cx - run.w / 2 < FACADE.archSpanMax && run.cx + run.w / 2 > FACADE.archSpanMin;
      if (overlapsSpan) expect(run.cy - run.h / 2).toBeGreaterThanOrEqual(PALACE_DOOR_HEIGHT - 1e-9);
    }
    expect(FACADE.archSpanMin).toBe(-2.2);
    expect(FACADE.archSpanMax).toBe(2.2);
    expect(FACADE.archTopY).toBe(PALACE_DOOR_HEIGHT);
    // …and the full width is skinned at the top (the lintel run).
    const top = facadeSkinRuns().filter((r) => r.cy - r.h / 2 >= PALACE_DOOR_HEIGHT - 1e-9);
    expect(top.length).toBeGreaterThan(0);
  });

  it("rises past the hall wall line to the parapet, wall to wall", () => {
    const runs = facadeSkinRuns();
    expect(Math.min(...runs.map((r) => r.cx - r.w / 2))).toBeCloseTo(HALL_BLOCK.minX, 6);
    expect(Math.max(...runs.map((r) => r.cx + r.w / 2))).toBeCloseTo(HALL_BLOCK.maxX, 6);
    expect(Math.max(...runs.map((r) => r.cy + r.h / 2))).toBeCloseTo(FACADE.topY, 6);
    expect(FACADE.topY).toBeGreaterThan(HALL_BLOCK.wallHeight);
  });

  it("the plinth flanks the arch and stays inside the walk line", () => {
    for (const run of facadePlinthRuns()) {
      expect(front(run)).toBeLessThanOrEqual(PLAZA_WALK_MIN_Z);
      const overlapsSpan = run.cx - run.w / 2 < FACADE.archSpanMax && run.cx + run.w / 2 > FACADE.archSpanMin;
      expect(overlapsSpan).toBe(false);
    }
  });
});

describe("the walk law (items 1+2 constraints)", () => {
  it("the plan's walk line matches palace-layout's courtyard walk rect", () => {
    expect(PALACE_LAYOUT[COURTYARD_ID]!.walk.minZ).toBe(PLAZA_WALK_MIN_Z);
  });

  it("no ground-level façade piece crosses the walk line", () => {
    for (const rect of facadeGroundRects()) {
      expect(rect.maxZ).toBeLessThanOrEqual(PLAZA_WALK_MIN_Z + 1e-9);
      // …and nothing pokes through into the hall interior either:
      // every piece's front stays south of the wall's centre plane.
      expect(rect.maxZ).toBeGreaterThan(HALL_BLOCK.backWallZ);
    }
  });

  it("roofline pieces stand at or above the ceiling line", () => {
    for (const slab of ROOF_SLABS) expect(slab.cy - slab.h / 2).toBeGreaterThanOrEqual(HALL_BLOCK.wallHeight - 0.02);
    for (const p of ROOF_PARAPETS) expect(p.cy - p.h / 2).toBeGreaterThanOrEqual(HALL_BLOCK.wallHeight);
    expect(TURRET.baseY).toBeGreaterThanOrEqual(HALL_BLOCK.wallHeight);
    expect(DOME.drumBaseY).toBeGreaterThanOrEqual(HALL_BLOCK.wallHeight);
  });
});

describe("pilasters, windows, banners (item 1)", () => {
  it("pilasters keep the walk line and clear the arch", () => {
    for (const x of FACADE_PILASTER_XS) {
      const p = facadePilaster(x);
      for (const part of [p.shaft, p.capital, p.base]) {
        expect(front(part)).toBeLessThanOrEqual(PLAZA_WALK_MIN_Z + 1e-9);
      }
      expect(Math.abs(x)).toBeGreaterThan(FACADE.archSpanMax);
    }
    expect(FACADE_PILASTER_XS.length).toBe(8);
  });

  it("windows sit between pilasters, clear of the arch, glass recessed in its frame", () => {
    expect(FACADE_WINDOWS.length).toBe(12);
    const pilasterSpans = FACADE_PILASTER_XS.map((x) => {
      const s = facadePilaster(x).shaft;
      return [s.cx - s.w / 2, s.cx + s.w / 2] as const;
    });
    for (const win of FACADE_WINDOWS) {
      const bars = facadeWindowFrameBars(win);
      const minX = Math.min(...bars.map((b) => b.cx - b.w / 2));
      const maxX = Math.max(...bars.map((b) => b.cx + b.w / 2));
      for (const [a, b] of pilasterSpans) expect(maxX <= a || minX >= b).toBe(true);
      expect(maxX <= FACADE.archSpanMin || minX >= FACADE.archSpanMax).toBe(true);
      for (const bar of bars) expect(front(bar)).toBeLessThanOrEqual(PLAZA_WALK_MIN_Z + 1e-9);
      // Glass: proud of the skin, recessed behind the frame front.
      expect(FACADE_WINDOW_GLASS_Z).toBeGreaterThan(FACADE.skinFrontZ);
      expect(FACADE_WINDOW_GLASS_Z).toBeLessThan(PLAZA_WALK_MIN_Z);
    }
  });

  it("window glass follows the look: lit at night, pale by day", () => {
    const night = facadeWindowStyle("dark");
    const day = facadeWindowStyle("light");
    expect(night.emissiveIntensity).toBeGreaterThan(1.5);
    expect(day.emissiveIntensity).toBeLessThan(0.5);
    expect(night.emissive).toBe(0xffa64d);
  });

  it("banners flank the arch, clear of jambs and pilasters", () => {
    const pilasterSpans = FACADE_PILASTER_XS.map((x) => {
      const s = facadePilaster(x).shaft;
      return [s.cx - s.w / 2, s.cx + s.w / 2] as const;
    });
    for (const banner of FACADE_BANNERS) {
      const a = banner.x - BANNER.w / 2;
      const b = banner.x + BANNER.w / 2;
      // Clear of the arch span + its gold jamb (jamb outer edge ±2.4).
      expect(Math.min(Math.abs(a), Math.abs(b))).toBeGreaterThanOrEqual(2.4);
      for (const [pa, pb] of pilasterSpans) expect(b <= pa || a >= pb).toBe(true);
      expect(BANNER.z).toBeLessThanOrEqual(PLAZA_WALK_MIN_Z);
      expect(BANNER.bottomY).toBeGreaterThan(0);
      expect(BANNER.topY).toBeLessThan(FACADE.topY);
    }
    expect(FACADE_BANNERS.length).toBe(2);
  });

  it("the pediment crowns the arch, centred and inside the façade width", () => {
    expect(PEDIMENT.centerX).toBe(0);
    expect(PEDIMENT.baseY).toBe(FACADE.topY);
    expect(PEDIMENT.apexY).toBeGreaterThan(PEDIMENT.baseY);
    expect(PEDIMENT.halfWidth).toBeLessThan(HALL_BLOCK.maxX);
    expect(PEDIMENT.slabLength).toBeCloseTo(
      Math.hypot(PEDIMENT.halfWidth, PEDIMENT.apexY - PEDIMENT.baseY),
      6,
    );
  });
});

describe("roofline & silhouette (item 2)", () => {
  it("the hall roof slab covers the whole hall block", () => {
    const hall = ROOF_SLABS[0]!;
    expect(hall.cx - hall.w / 2).toBeLessThanOrEqual(HALL_BLOCK.minX);
    expect(hall.cx + hall.w / 2).toBeGreaterThanOrEqual(HALL_BLOCK.maxX);
    expect(hall.cz - hall.d / 2).toBeLessThanOrEqual(HALL_BLOCK.minZ);
    expect(hall.cz + hall.d / 2).toBeGreaterThanOrEqual(HALL_BLOCK.maxZ);
    expect(ROOF_SLABS.length).toBe(4); // hall + west + east + creator blocks
  });

  it("turrets stand on the hall slab, inside its footprint", () => {
    const hall = ROOF_SLABS[0]!;
    expect(TURRETS.length).toBe(4);
    for (const t of TURRETS) {
      expect(Math.abs(t.x) + TURRET.radius).toBeLessThanOrEqual(hall.cx + hall.w / 2);
      expect(Math.abs(t.z - hall.cz) + TURRET.radius).toBeLessThanOrEqual(hall.d / 2);
      expect(TURRET.topY).toBeGreaterThan(TURRET.baseY);
      expect(TURRET.capApexY).toBeGreaterThan(TURRET.topY);
    }
  });

  it("the dome crowns the hall's centre line", () => {
    expect(DOME.cx).toBe(0);
    expect(DOME.cz).toBeGreaterThan(HALL_BLOCK.minZ);
    expect(DOME.cz).toBeLessThan(HALL_BLOCK.maxZ);
    expect(DOME.drumTopY).toBeGreaterThan(DOME.drumBaseY);
    expect(DOME.finialTopY).toBeGreaterThan(DOME.drumTopY + DOME.domeRadius - 0.2);
  });
});
