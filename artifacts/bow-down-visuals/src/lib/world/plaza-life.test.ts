/**
 * plaza-life — Stage C batch C3 (board items 26, 28, 29, 30, 40).
 *
 * Pins:
 * - item 26: banner sway is gentle and bounded; the pollen field
 *   is deterministic, stays inside the courtyard air, and its
 *   count follows the ladder's particle scale;
 * - item 28: the pool sits in the promenade grounds, clear of the
 *   spine and every station, solid underfoot (its centre is NOT
 *   walkable), and its water animation loops;
 * - item 29: the lamps carry no real lights (data + a scene
 *   source pin: the plaza-life build registers lantern-glow
 *   sprites and adds no PointLight);
 * - item 30: every furniture piece is blocked from the same data
 *   the scene builds, no piece overlaps another solid, the spine
 *   and station points stay walkable, and a step into a bench
 *   stops instead of passing;
 * - item 40: the spawn dressing is centred exactly on the
 *   courtyard spawn, the spawn point itself does NOT move, and
 *   the dressing is flat inlay — absent from the blocked list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  POOL, POOL_BLOCKED, FOUNTAIN, PLAZA_LAMPS, LAMP, PLAZA_BENCHES, PLAZA_TABLE_SETS,
  PLAZA_URNS, PLAZA_STALLS, SPAWN_DRESSING, PLAZA_LIFE_BLOCKED,
  bannerSwayAt, createPollenField, pollenCountForScale, pollenPositionAt, POLLEN_FIELD,
  waterSurfaceAt, poolWaterTint, lampGlassStyle,
} from "./plaza-life";
import {
  COURTYARD_ID, PALACE_LAYOUT, PLAZA_BLOCKED, PLAZA_WALL_RUNS,
  isWalkable, pointInRect, resolvePalaceMove,
} from "./palace-layout";
import { MONUMENT_BLOCKED } from "./palace-grounds";
import { PALACE_STATIONS } from "./stations";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const overlaps = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** The spine: the arch→monument→Boardwalk walk line. */
const SPINE = { minX: -1.8, maxX: 1.8, minZ: 12.4, maxZ: 34.0 };

describe("plaza-life — item 26 daylight life", () => {
  it("banner sway is gentle, bounded and phase-shifted", () => {
    for (let t = 0; t < 60; t += 0.31) {
      const s = bannerSwayAt(t, 0.7);
      expect(Math.abs(s.rotX)).toBeLessThanOrEqual(0.076);
      expect(Math.abs(s.rotZ)).toBeLessThanOrEqual(0.031);
    }
    expect(bannerSwayAt(3, 0)).not.toEqual(bannerSwayAt(3, 1.9));
  });

  it("pollen counts follow the particle scale", () => {
    expect(pollenCountForScale(1)).toBe(130);
    expect(pollenCountForScale(0.6)).toBe(78);
    expect(pollenCountForScale(0.3)).toBe(39);
    expect(pollenCountForScale(0)).toBe(0);
  });

  it("the pollen field is deterministic and never leaves the courtyard air", () => {
    expect(createPollenField(20, "courtyard")).toEqual(createPollenField(20, "courtyard"));
    const field = createPollenField(40, "courtyard");
    for (const m of field) {
      for (let t = 0; t < 120; t += 3.7) {
        const p = pollenPositionAt(m, t);
        expect(p.x).toBeGreaterThanOrEqual(POLLEN_FIELD.minX - 1);
        expect(p.x).toBeLessThanOrEqual(POLLEN_FIELD.maxX + 1);
        expect(p.y).toBeGreaterThanOrEqual(POLLEN_FIELD.minY);
        expect(p.y).toBeLessThanOrEqual(POLLEN_FIELD.maxY);
        expect(p.z).toBeGreaterThanOrEqual(POLLEN_FIELD.minZ - 1);
        expect(p.z).toBeLessThanOrEqual(POLLEN_FIELD.maxZ + 1);
      }
    }
  });
});

describe("plaza-life — item 28 the water", () => {
  it("the pool stands in the promenade grounds, clear of the spine and the stations", () => {
    const grounds = PALACE_LAYOUT[COURTYARD_ID]!.grounds![0]!;
    expect(pointInRect(POOL.cx, POOL.cz, grounds)).toBe(true);
    expect(overlaps(POOL_BLOCKED, SPINE)).toBe(false);
    for (const st of PALACE_STATIONS.filter((s) => s.roomId === COURTYARD_ID)) {
      expect(Math.hypot(st.x - POOL.cx, st.z - POOL.cz)).toBeGreaterThan(4);
      expect(pointInRect(st.x, st.z, POOL_BLOCKED)).toBe(false);
    }
    /* Room to walk around it on the north and south sides. */
    expect(isWalkable(POOL.cx, POOL_BLOCKED.minZ - 0.7)).toBe(true);
    expect(isWalkable(POOL.cx, POOL_BLOCKED.maxZ + 0.7)).toBe(true);
    expect(isWalkable(-6.2, POOL.cz)).toBe(true); // east of the pool, clear of its facing bench
  });

  it("the pool is solid: its centre and rim are not walkable, and the fountain stands inside it", () => {
    expect(isWalkable(POOL.cx, POOL.cz)).toBe(false);
    expect(PLAZA_BLOCKED).toContainEqual(POOL_BLOCKED);
    expect(pointInRect(FOUNTAIN.x, FOUNTAIN.z, POOL_BLOCKED)).toBe(true);
    expect(FOUNTAIN.basinTopY).toBeGreaterThan(POOL.waterY);
  });

  it("the water animation loops and the tints split by look", () => {
    for (let t = 0; t < 500; t += 7.3) {
      const w = waterSurfaceAt(t);
      expect(w.offsetX).toBeGreaterThanOrEqual(0);
      expect(w.offsetX).toBeLessThan(1);
      expect(w.offsetY).toBeGreaterThanOrEqual(0);
      expect(w.offsetY).toBeLessThan(1);
      expect(w.jetPulse).toBeGreaterThanOrEqual(0.89);
      expect(w.jetPulse).toBeLessThanOrEqual(1.11);
    }
    expect(poolWaterTint("dark").roughness).toBeGreaterThan(poolWaterTint("light").roughness);
    expect(lampGlassStyle("dark").emissiveIntensity).toBeGreaterThan(lampGlassStyle("light").emissiveIntensity);
  });
});

describe("plaza-life — items 29 + 30 lamps and furniture", () => {
  it("every lamp and furniture piece is blocked from the same data, pairwise non-overlapping", () => {
    expect(PLAZA_LAMPS.length).toBeGreaterThanOrEqual(8);
    const count = 1 + PLAZA_LAMPS.length + PLAZA_BENCHES.length + PLAZA_TABLE_SETS.length + PLAZA_URNS.length + PLAZA_STALLS.length;
    expect(PLAZA_LIFE_BLOCKED).toHaveLength(count);
    for (const r of PLAZA_LIFE_BLOCKED) expect(PLAZA_BLOCKED).toContainEqual(r);
    for (let i = 0; i < PLAZA_LIFE_BLOCKED.length; i++) {
      for (let j = i + 1; j < PLAZA_LIFE_BLOCKED.length; j++) {
        expect(overlaps(PLAZA_LIFE_BLOCKED[i]!, PLAZA_LIFE_BLOCKED[j]!)).toBe(false);
      }
      /* …and none of it collides with the older solids. */
      expect(overlaps(PLAZA_LIFE_BLOCKED[i]!, MONUMENT_BLOCKED)).toBe(false);
      for (const w of PLAZA_WALL_RUNS) {
        const wr = { minX: w.x - w.w / 2, maxX: w.x + w.w / 2, minZ: w.z - w.d / 2, maxZ: w.z + w.d / 2 };
        expect(overlaps(PLAZA_LIFE_BLOCKED[i]!, wr)).toBe(false);
      }
    }
  });

  it("the spine, the spur and every courtyard station point stay walkable", () => {
    /* The spine runs clear end to end EXCEPT where the monument
     * itself stands on it (its plinth is blocked by design — the
     * path runs around it, and the bypass lane stays walkable). */
    for (let z = 13; z <= 33.5; z += 0.5) {
      if (z > 17 && z < 22.3) continue;
      expect(isWalkable(0, z)).toBe(true);
    }
    expect(isWalkable(2.6, 19.7)).toBe(true);
    expect(isWalkable(-2.6, 19.7)).toBe(true);
    expect(isWalkable(5, 25.8)).toBe(true);
    expect(isWalkable(9.5, 25.8)).toBe(true);
    for (const st of PALACE_STATIONS.filter((s) => s.roomId === COURTYARD_ID)) {
      expect(isWalkable(st.x, st.z)).toBe(true);
      for (const r of PLAZA_LIFE_BLOCKED) {
        const dx = Math.max(r.minX - st.x, 0, st.x - r.maxX);
        const dz = Math.max(r.minZ - st.z, 0, st.z - r.maxZ);
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(0.45);
      }
    }
  });

  it("a step into a bench, a lamp or a stall stops — never passes through the body", () => {
    const bench = PLAZA_BENCHES[0]!;
    const bonk = resolvePalaceMove({ x: bench.x, z: bench.z - 1.2, room: COURTYARD_ID }, bench.x, bench.z);
    expect(bonk.z).toBeCloseTo(bench.z - 1.2);
    const lamp = PLAZA_LAMPS[0]!;
    const lampBonk = resolvePalaceMove({ x: lamp.x - 1.2, z: lamp.z, room: COURTYARD_ID }, lamp.x, lamp.z);
    expect(lampBonk.x).toBeCloseTo(lamp.x - 1.2);
    const stall = PLAZA_STALLS[0]!;
    const stallBonk = resolvePalaceMove({ x: stall.x, z: stall.z - 1.4, room: COURTYARD_ID }, stall.x, stall.z);
    expect(stallBonk.z).toBeCloseTo(stall.z - 1.4);
    expect(LAMP.blockHalf).toBeGreaterThan(0);
  });
});

describe("plaza-life — item 40 spawn arrival", () => {
  it("the dressing is centred on the spawn stance and spawn itself does not move", () => {
    const plaza = PALACE_LAYOUT[COURTYARD_ID]!;
    expect(plaza.spawn).toEqual({ x: 0, z: 31.5 });
    expect(SPAWN_DRESSING.cx).toBe(plaza.spawn.x);
    expect(SPAWN_DRESSING.cz).toBe(plaza.spawn.z);
    /* The first-look axis: medallion, monument and the hall arch
     * all stand on x = 0. */
    expect(MONUMENT_BLOCKED.minX + MONUMENT_BLOCKED.maxX).toBeCloseTo(SPAWN_DRESSING.cx * 2);
    expect(isWalkable(SPAWN_DRESSING.cx, SPAWN_DRESSING.cz)).toBe(true);
  });

  it("the dressing is flat inlay: none of it is in the blocked list", () => {
    for (const r of PLAZA_LIFE_BLOCKED) {
      expect(pointInRect(SPAWN_DRESSING.cx, SPAWN_DRESSING.cz, r)).toBe(false);
      for (const st of SPAWN_DRESSING.stones) expect(pointInRect(st.x, st.z, r)).toBe(false);
    }
    expect(SPAWN_DRESSING.band.cz).toBeGreaterThan(SPAWN_DRESSING.cz);
  });
});

describe("plaza-life — scene wiring (source pins)", () => {
  const scene = read("./hall-scene.ts");

  it("item 29: the plaza-life build adds lantern glows and NO new point lights", () => {
    const start = scene.indexOf("private buildPlazaLife");
    const body = scene.slice(start, scene.indexOf("private buildCreatorRoomsArch"));
    expect(body).toContain("addLanternGlow");
    expect(body).not.toContain("PointLight");
    expect(body).toContain("PLAZA_LAMPS");
    expect(body).toContain("anim.waters.push");
  });

  it("items 26 + 28: reduced motion gates the sway, the pollen and the water", () => {
    const start = scene.indexOf("private buildPlazaLife");
    const body = scene.slice(start, scene.indexOf("private buildCreatorRoomsArch"));
    expect(body).toContain("reducedMotion");
    expect(scene).toContain("bannerSways");
    expect(scene).toContain("if (!this.reducedMotion)");
    expect(scene).toContain("waterSurfaceAt");
  });
});
