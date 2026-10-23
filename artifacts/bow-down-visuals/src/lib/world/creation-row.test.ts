/**
 * Creation Row (board item 33) — the third built district,
 * pinned.
 *
 * Creation Row was a MARKER on the plaza floor — a signpost at
 * (27.0, 14.5) naming a district with nothing behind it. This
 * batch builds the district beyond the east wall and
 * reclassifies the marker to an open gate. The laws pinned here:
 *   - the district is a real palace room with exactly one door —
 *     the east gate — whose plane/span are the gate gap's own
 *     numbers (district-gates' DISTRICT_GATE_GAPS);
 *   - the passage walks END TO END with no loading/teleport: a
 *     step sequence crosses the plaza, the portal and the wall
 *     plane into the Row (membership flips at the plane), and
 *     back again; the wall beside the gate stays solid and the
 *     Boardwalk gate stayed barred then — it opened in item 35,
 *     and this suite's pin moved with it;
 *   - every solid the scene builds from creation-row.ts (walls,
 *     piers, stall posts and benches, plinths, crates, canvas
 *     stacks, tool benches, planters, lamps, poles) is honestly
 *     blocked from the same data;
 *   - the working ground stays walkable: the spawn, the street,
 *     the stalls' open mouths, the Row Slate station point, the
 *     street's far end;
 *   - the ground wears the outdoor system: whole-tile paving
 *     slabs inside the district floor rect, the street and the
 *     planters inside the interior — and the C2 backdrop ring
 *     stands clear of the district it now rings (its east mound
 *     moved east past the Row's wall).
 */
import { describe, it, expect } from "vitest";
import {
  COURTYARD_ID,
  CREATION_ROW_ID,
  PALACE_DOORS,
  PALACE_LAYOUT,
  cameraPointFree,
  isWalkable,
  pointInRect,
  resolvePalaceMove,
} from "./palace-layout";
import { DISTRICT_GATE_GAPS } from "./district-gates";
import {
  ROW_BANNER_POLES,
  ROW_BLOCKED,
  ROW_CANVAS_STACKS,
  ROW_CRATES,
  ROW_INTERIOR,
  ROW_LAMPS,
  ROW_STALLS,
  ROW_PIERS,
  ROW_PLANTERS,
  ROW_PLANTER_CROWNS,
  ROW_PLINTHS,
  ROW_STALL_BENCHES,
  ROW_STALL_POSTS,
  ROW_STREET,
  ROW_TALL_BLOCKED,
  ROW_TOOL_BENCHES,
  ROW_WALK,
  ROW_WALL_RUNS,
} from "./creation-row";
import { pavingSlabsFor, backdropGroundRects } from "./palace-grounds";
import { readFileSync } from "node:fs";
import { propVariation } from "./prop-variation";

const sceneSrc = readFileSync(new URL("./hall-scene.ts", import.meta.url), "utf8");

const room = PALACE_LAYOUT[CREATION_ROW_ID]!;

describe("Creation Row — the room and its door (item 33)", () => {
  it("is a registered palace room named for the district", () => {
    expect(room).toBeDefined();
    expect(room.name).toBe("Creation Row");
    expect(room.walk).toEqual(ROW_WALK);
    expect(room.interior).toEqual(ROW_INTERIOR);
    expect(room.spawn).toEqual({ x: 30.2, z: 14.5 });
  });

  it("has exactly one door: the east gate, at the gate gap's own numbers", () => {
    const doors = PALACE_DOORS.filter((d) => d.roomId === CREATION_ROW_ID);
    expect(doors).toHaveLength(1);
    const door = doors[0]!;
    const gap = DISTRICT_GATE_GAPS["CREATION ROW"]!;
    expect(door.axis).toBe("x");
    expect(door.plane).toBe(gap.at);
    expect(door.spanMin).toBe(gap.min);
    expect(door.spanMax).toBe(gap.max);
    expect(door.negRoom).toBe(COURTYARD_ID);
    expect(door.posRoom).toBe(CREATION_ROW_ID);
    /* The portal covers the wall band with aprons on both faces,
     * and its span stops inside the gate posts' footprints. */
    expect(door.portal.minX).toBeLessThan(door.plane);
    expect(door.portal.maxX).toBeGreaterThan(door.plane);
    expect(door.portal.minZ).toBeGreaterThan(gap.min);
    expect(door.portal.maxZ).toBeLessThan(gap.max);
  });

  it("walks from the plaza through the gate into the Row — no teleport, membership flips at the wall plane", () => {
    /* A stroll east along the gate's line, in ordinary steps. */
    let pos = { x: 25.8, z: 14.5, room: COURTYARD_ID };
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const step = resolvePalaceMove(pos, pos.x + 0.6, pos.z);
      expect(step.x).toBeGreaterThan(pos.x); // every step lands — the way is never blocked
      pos = { x: step.x, z: step.z, room: step.room };
      if (step.entered) seen.push(step.entered);
    }
    expect(seen).toEqual([CREATION_ROW_ID]);
    expect(pos.room).toBe(CREATION_ROW_ID);
    expect(pos.x).toBeGreaterThan(30);
    /* And onward, down the street past the stalls — every
     * intermediate step landing. */
    let walk = { x: pos.x, z: pos.z, room: pos.room };
    for (let i = 0; i < 16; i++) {
      const step = resolvePalaceMove(walk, walk.x + 0.6, walk.z + 0.1);
      expect(step.x).toBeGreaterThan(walk.x);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.room).toBe(CREATION_ROW_ID);
    expect(walk.x).toBeGreaterThan(40);
  });

  it("walks back west through the gate onto the plaza", () => {
    const back = resolvePalaceMove({ x: 28.4, z: 14.5, room: CREATION_ROW_ID }, 27.6, 14.5);
    expect(back.room).toBe(COURTYARD_ID);
    expect(back.entered).toBe(COURTYARD_ID);
  });

  it("the wall beside the gate stays solid (the Boardwalk gate: opened in item 35 — see below)", () => {
    expect(isWalkable(28.2, 18.0)).toBe(false);
    const bonk = resolvePalaceMove({ x: 27.6, z: 18.0, room: COURTYARD_ID }, 28.4, 18.0);
    expect(bonk.x).toBe(27.6);
    expect(bonk.entered).toBeNull();
    /* The gate posts themselves are solid — the passage is
     * BETWEEN them, never through them. */
    expect(isWalkable(28.2, 13.4)).toBe(false);
    expect(isWalkable(28.2, 15.6)).toBe(false);
    /* DELIBERATELY moved in item 35: the Boardwalk gate is
     * OPEN — its gap is a true passage now, so (0, 34.0) walks;
     * the Boardwalk suite pins the passage end to end. */
    expect(isWalkable(0, 34.0)).toBe(true);
  });
});

describe("Creation Row — honest collision (item 33)", () => {
  it("the room's blocked list is the derived ROW_BLOCKED, and its tall list is a subset", () => {
    expect(room.blocked).toEqual([...ROW_BLOCKED]);
    expect(room.camBlocked).toEqual([...ROW_TALL_BLOCKED]);
    for (const b of ROW_TALL_BLOCKED) expect(ROW_BLOCKED).toContainEqual(b);
  });

  it("every built solid's centre is unwalkable", () => {
    const centres: Array<[string, number, number]> = [
      ...ROW_STALL_POSTS.map((p, i) => [`stall post ${i}`, p.x, p.z] as [string, number, number]),
      ...ROW_STALL_BENCHES.map((b, i) => [`stall bench ${i}`, b.cx, b.cz] as [string, number, number]),
      ...ROW_PLINTHS.map((p, i) => [`plinth ${i}`, p.x, p.z] as [string, number, number]),
      ...ROW_CRATES.map((c, i) => [`crate ${i}`, c.x, c.z] as [string, number, number]),
      ...ROW_CANVAS_STACKS.map((b, i) => [`canvas stack ${i}`, b.cx, b.cz] as [string, number, number]),
      ...ROW_TOOL_BENCHES.map((b, i) => [`tool bench ${i}`, b.cx, b.cz] as [string, number, number]),
      ...ROW_PLANTERS.map((p, i) => [`planter ${i}`, p.cx, p.cz] as [string, number, number]),
      ...ROW_LAMPS.map((l, i) => [`lamp ${i}`, l.x, l.z] as [string, number, number]),
      ...ROW_BANNER_POLES.map((p, i) => [`banner pole ${i}`, p.x, p.z] as [string, number, number]),
      ...ROW_PIERS.map((p, i) => [`pier ${i}`, p.x, p.z] as [string, number, number]),
      ...ROW_WALL_RUNS.map((r, i) => [`wall run ${i}`, r.x, r.z] as [string, number, number]),
    ];
    for (const [name, x, z] of centres) {
      expect(isWalkable(x, z), name).toBe(false);
    }
  });

  it("the quarter's working ground stays walkable", () => {
    expect(isWalkable(30.2, 14.5)).toBe(true); // the spawn, on the street
    expect(isWalkable(41.2, 14.5)).toBe(true); // the street's heart
    expect(isWalkable(32.8, 14.5)).toBe(true); // the Row Slate station point
    expect(isWalkable(37.0, 8.6)).toBe(true); // a north stall's open mouth
    expect(isWalkable(43.0, 20.4)).toBe(true); // a south stall's open mouth
    expect(isWalkable(34.0, 24.0)).toBe(true); // open paving south of the street
    expect(isWalkable(51.0, 14.5)).toBe(true); // the street's far end
    /* The district's own walls hold: a step east out of the
     * quarter stops at its east wall, never leaves the world. */
    const out = resolvePalaceMove({ x: 53.5, z: 14.5, room: CREATION_ROW_ID }, 54.5, 14.5);
    expect(out.x).toBe(53.5);
  });

  it("the camera keeps off the tall solids and roams the open ground", () => {
    expect(cameraPointFree(CREATION_ROW_ID, ROW_BANNER_POLES[0]!.x, ROW_BANNER_POLES[0]!.z)).toBe(false);
    expect(cameraPointFree(CREATION_ROW_ID, ROW_STALL_POSTS[0]!.x, ROW_STALL_POSTS[0]!.z)).toBe(false);
    expect(cameraPointFree(CREATION_ROW_ID, 41.2, 14.5)).toBe(true);
    expect(cameraPointFree(CREATION_ROW_ID, 30.2, 14.5)).toBe(true);
  });
});

describe("Creation Row — the outdoor ground system (item 33)", () => {
  it("the district floor takes whole-tile paving slabs, all inside its rect", () => {
    const slabs = pavingSlabsFor(ROW_INTERIOR);
    expect(slabs.length).toBe(36); // 6 × 6 whole 4 m tiles in the 26 × 26 quarter
    for (const s of slabs) {
      expect(s.cx - s.w / 2).toBeGreaterThanOrEqual(ROW_INTERIOR.minX - 1e-9);
      expect(s.cx + s.w / 2).toBeLessThanOrEqual(ROW_INTERIOR.maxX + 1e-9);
      expect(s.cz - s.d / 2).toBeGreaterThanOrEqual(ROW_INTERIOR.minZ - 1e-9);
      expect(s.cz + s.d / 2).toBeLessThanOrEqual(ROW_INTERIOR.maxZ + 1e-9);
    }
  });

  it("the street runs inside the interior, and every planter crown stands on its bed", () => {
    expect(ROW_STREET.fromX).toBe(ROW_INTERIOR.minX);
    expect(ROW_STREET.toX).toBeLessThan(ROW_INTERIOR.maxX);
    expect(ROW_STREET.cz).toBe((ROW_INTERIOR.minZ + ROW_INTERIOR.maxZ) / 2);
    for (const p of ROW_PLANTERS) {
      const bedRect = {
        minX: p.cx - p.w / 2, maxX: p.cx + p.w / 2,
        minZ: p.cz - p.d / 2, maxZ: p.cz + p.d / 2,
      };
      expect(bedRect.minX).toBeGreaterThan(ROW_INTERIOR.minX);
      expect(bedRect.maxX).toBeLessThan(ROW_INTERIOR.maxX);
      expect(bedRect.minZ).toBeGreaterThan(ROW_INTERIOR.minZ);
      expect(bedRect.maxZ).toBeLessThan(ROW_INTERIOR.maxZ);
    }
    for (const c of ROW_PLANTER_CROWNS) {
      const onBed = ROW_PLANTERS.some((p) =>
        pointInRect(c.x, c.z, {
          minX: p.cx - p.w / 2, maxX: p.cx + p.w / 2,
          minZ: p.cz - p.d / 2, maxZ: p.cz + p.d / 2,
        }));
      expect(onBed, JSON.stringify(c)).toBe(true);
    }
  });

  it("the C2 backdrop ring stands clear of the district it now rings", () => {
    const overlaps = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a) =>
      a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
    for (const r of backdropGroundRects()) {
      expect(overlaps(r, ROW_INTERIOR), JSON.stringify(r)).toBe(false);
      expect(overlaps(r, ROW_WALK), JSON.stringify(r)).toBe(false);
    }
  });
});

describe("Creation Row — Stack-100 #2 finishing (items 34–35)", () => {
  it("item 34: the lamps spread the street's whole run — no three share a 3 m span", () => {
    const xs = ROW_LAMPS.map((l) => l.x).sort((a, b) => a - b);
    expect(xs[xs.length - 1]! - xs[0]!).toBeGreaterThanOrEqual(18);
    for (let i = 0; i + 2 < xs.length; i++) {
      expect(xs[i + 2]! - xs[i]!).toBeGreaterThan(3);
    }
    /* Both street edges are lit along the run. */
    expect(ROW_LAMPS.some((l) => l.z < 14.5)).toBe(true);
    expect(ROW_LAMPS.some((l) => l.z > 14.5)).toBe(true);
  });

  it("item 35: stall variety lives in the variation system — deterministic, square, skin-only", () => {
    const a = propVariation("stall", 0);
    expect(propVariation("stall", 0)).toEqual(a);
    expect(a.rotY).toBe(0);
    expect(Math.abs(a.scale - 1)).toBeLessThanOrEqual(0.03);
    const tints = new Set(ROW_STALLS.map((_, i) => propVariation("stall", i).hueShift));
    expect(tints.size).toBeGreaterThan(1);
    expect(sceneSrc).toContain('propVariation("stall", si + (0))');
    expect(sceneSrc).toContain('propVariation("stall", si + (100))');
  });
});
