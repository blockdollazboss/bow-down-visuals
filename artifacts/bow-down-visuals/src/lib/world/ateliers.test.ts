/**
 * The Ateliers (board item 34) — the fourth built district,
 * pinned.
 *
 * The Ateliers were a MARKER on the plaza floor — a signpost at
 * (27.0, 22.5) naming a district with nothing behind it. This
 * batch builds the district south of Creation Row and
 * reclassifies the marker to an open gate. The laws pinned here:
 *   - the district is a real palace room with exactly one door —
 *     the east gate — whose plane/span are the gate gap's own
 *     numbers (district-gates' DISTRICT_GATE_GAPS);
 *   - the gate stands at z 30.5, NOT on the marker's old line:
 *     east of z 22.5 is Creation Row's built quarter, and the
 *     wall there stays solid — the Ateliers' north wall is the
 *     Row's own south wall, solid from this side too;
 *   - the passage walks END TO END with no loading/teleport: a
 *     step sequence crosses the plaza's south-east yard (walkable
 *     plaza ground since this batch), the portal and the wall
 *     plane into the Ateliers (membership flips at the plane),
 *     and back again; the Boardwalk gate stayed barred then —
 *     it opened in item 35, and this suite's pin moved with it;
 *     barred;
 *   - every solid the scene builds from ateliers.ts (walls,
 *     piers, bay posts, tables and glazed panels, vitrines,
 *     plinths, crates, stone stacks, tool benches, planters,
 *     lamps, poles) is honestly blocked from the same data;
 *   - the working ground stays walkable: the spawn, the lane,
 *     the bays' open mouths, the Ateliers Slate station point,
 *     the lane's far end;
 *   - the ground wears the outdoor system: whole-tile paving
 *     slabs inside the district floor rect, the lane and the
 *     planters inside the interior — and the C2 backdrop ring
 *     stands clear of the district it now rings (its south-east
 *     wing and mound moved south past the Ateliers' wall).
 */
import { describe, it, expect } from "vitest";
import {
  ATELIERS_ID,
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
  ATELIER_BAY_PANELS,
  ATELIER_BAY_POSTS,
  ATELIER_BAY_TABLES,
  ATELIER_CRATES,
  ATELIER_PLINTHS,
  ATELIER_STONE_STACKS,
  ATELIER_TOOL_BENCHES,
  ATELIER_VITRINES,
  ATELIERS_BANNER_POLES,
  ATELIERS_BLOCKED,
  ATELIERS_INTERIOR,
  ATELIERS_LAMPS,
  ATELIERS_LANE,
  ATELIERS_PIERS,
  ATELIERS_PLANTERS,
  ATELIERS_PLANTER_CROWNS,
  ATELIERS_TALL_BLOCKED,
  ATELIERS_WALK,
  ATELIERS_WALL_RUNS,
} from "./ateliers";
import { pavingSlabsFor, backdropGroundRects } from "./palace-grounds";

const room = PALACE_LAYOUT[ATELIERS_ID]!;

describe("The Ateliers — the room and its door (item 34)", () => {
  it("is a registered palace room named for the district", () => {
    expect(room).toBeDefined();
    expect(room.name).toBe("The Ateliers");
    expect(room.walk).toEqual(ATELIERS_WALK);
    expect(room.interior).toEqual(ATELIERS_INTERIOR);
    expect(room.spawn).toEqual({ x: 30.2, z: 40.5 });
  });

  it("has exactly one door: the east gate, at the gate gap's own numbers", () => {
    const doors = PALACE_DOORS.filter((d) => d.roomId === ATELIERS_ID);
    expect(doors).toHaveLength(1);
    const door = doors[0]!;
    const gap = DISTRICT_GATE_GAPS["THE ATELIERS"]!;
    expect(door.axis).toBe("x");
    expect(door.plane).toBe(gap.at);
    expect(door.spanMin).toBe(gap.min);
    expect(door.spanMax).toBe(gap.max);
    expect(door.negRoom).toBe(COURTYARD_ID);
    expect(door.posRoom).toBe(ATELIERS_ID);
    /* The portal covers the wall band with aprons on both faces,
     * and its span stops inside the gate posts' footprints. */
    expect(door.portal.minX).toBeLessThan(door.plane);
    expect(door.portal.maxX).toBeGreaterThan(door.plane);
    expect(door.portal.minZ).toBeGreaterThan(gap.min);
    expect(door.portal.maxZ).toBeLessThan(gap.max);
  });

  it("the quarter stands south of Creation Row, sharing its wall — and the old marker line stays solid", () => {
    /* The Row's quarter ends at z 27.5; the Ateliers begin there. */
    expect(ATELIERS_INTERIOR.minZ).toBe(27.5);
    expect(ATELIERS_INTERIOR.minX).toBe(28.2);
    /* East of the marker's old line (z 22.5) is the Row's built
     * quarter: the plaza's east wall there is solid, and the
     * ground beyond it belongs to Creation Row, not the Ateliers. */
    expect(isWalkable(28.2, 22.5)).toBe(false);
    /* The shared wall (the Row's south run, z 27.5) is solid
     * from the Ateliers side: a step north out of the quarter
     * stops at it — the districts meet at a wall, never bleed. */
    expect(isWalkable(41.2, 27.5)).toBe(false);
    const bonk = resolvePalaceMove({ x: 41.2, z: 28.2, room: ATELIERS_ID }, 41.2, 27.2);
    expect(bonk.z).toBe(28.2);
    expect(bonk.entered).toBeNull();
    expect(bonk.room).toBe(ATELIERS_ID);
    expect(CREATION_ROW_ID).not.toBe(ATELIERS_ID);
  });

  it("walks from the plaza across the south-east yard through the gate into the Ateliers — no teleport, membership flips at the wall plane", () => {
    /* The yard is plaza ground — but the stroll's first leg was
     * DELIBERATELY rerouted in item 36: the old direct line
     * south at x 24 now meets the Creator Heights enclave, whose
     * south wall stands across it. The yard is reached as the
     * plaza now routes it: south off the arch spur onto the
     * bridge lane between the enclave's south wall and the
     * Creator Rooms building, then east across the bridge into
     * the yard (item 36's own suite walks this same ground). */
    let pos = { x: 12.9, z: 25.65, room: COURTYARD_ID };
    {
      const step = resolvePalaceMove(pos, pos.x, pos.z + 0.32);
      expect(step.z).toBeGreaterThan(pos.z); // the step south onto the bridge lands
      pos = { x: step.x, z: step.z, room: step.room };
    }
    for (let i = 0; i < 7; i++) {
      const step = resolvePalaceMove(pos, pos.x + 0.55, pos.z);
      expect(step.x).toBeGreaterThan(pos.x); // every step east across the bridge lands
      pos = { x: step.x, z: step.z, room: step.room };
    }
    expect(pos.room).toBe(COURTYARD_ID);
    expect(pos.x).toBeGreaterThan(16.6); // across the bridge, in the yard
    expect(pos.z).toBeGreaterThan(25.9);
    /* East through the gate: membership flips at the plane. */
    let gate = { x: 26.2, z: 30.5, room: COURTYARD_ID };
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      const step = resolvePalaceMove(gate, gate.x + 0.6, gate.z);
      expect(step.x).toBeGreaterThan(gate.x); // every step lands — the way is never blocked
      gate = { x: step.x, z: step.z, room: step.room };
      if (step.entered) seen.push(step.entered);
    }
    expect(seen).toEqual([ATELIERS_ID]);
    expect(gate.room).toBe(ATELIERS_ID);
    expect(gate.x).toBeGreaterThan(30);
    /* And onward: south across the north yard, east along the
     * bays' front line, then south to the lane and east down it
     * past the bays — every step landing. (The yard's own
     * dressing is solid and the stroll routes around it, like a
     * walker's: the lamp at (31, 37.8) stands on the direct
     * south line from the gate, so the stroll turns east first.) */
    let walk = { x: gate.x, z: gate.z, room: gate.room };
    for (let i = 0; i < 10; i++) {
      const step = resolvePalaceMove(walk, walk.x, walk.z + 0.6);
      expect(step.z).toBeGreaterThan(walk.z);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.z).toBeGreaterThan(36.0);
    for (let i = 0; i < 18; i++) {
      const step = resolvePalaceMove(walk, walk.x + 0.6, walk.z);
      expect(step.x).toBeGreaterThan(walk.x);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.x).toBeGreaterThan(41.0);
    for (let i = 0; i < 7; i++) {
      const step = resolvePalaceMove(walk, walk.x, walk.z + 0.6);
      expect(step.z).toBeGreaterThan(walk.z);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.z).toBeGreaterThan(40.0);
    for (let i = 0; i < 6; i++) {
      const step = resolvePalaceMove(walk, walk.x + 0.6, 40.5);
      expect(step.x).toBeGreaterThan(walk.x);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.room).toBe(ATELIERS_ID);
    expect(walk.x).toBeGreaterThan(44.0);
  });

  it("walks back west through the gate onto the plaza", () => {
    const back = resolvePalaceMove({ x: 28.4, z: 30.5, room: ATELIERS_ID }, 27.6, 30.5);
    expect(back.room).toBe(COURTYARD_ID);
    expect(back.entered).toBe(COURTYARD_ID);
  });

  it("the wall beside the gate stays solid (the Boardwalk gate: opened in item 35 — see below)", () => {
    expect(isWalkable(28.2, 33.5)).toBe(false);
    const bonk = resolvePalaceMove({ x: 27.6, z: 33.5, room: COURTYARD_ID }, 28.4, 33.5);
    expect(bonk.x).toBe(27.6);
    expect(bonk.entered).toBeNull();
    /* The gate posts themselves are solid — the passage is
     * BETWEEN them, never through them. */
    expect(isWalkable(28.2, 29.4)).toBe(false);
    expect(isWalkable(28.2, 31.6)).toBe(false);
    /* DELIBERATELY moved in item 35: the Boardwalk gate is
     * OPEN — its gap is a true passage now, so (0, 34.0) walks;
     * the Boardwalk suite pins the passage end to end. */
    expect(isWalkable(0, 34.0)).toBe(true);
  });
});

describe("The Ateliers — honest collision (item 34)", () => {
  it("the room's blocked list is the derived ATELIERS_BLOCKED, and its tall list is a subset", () => {
    expect(room.blocked).toEqual([...ATELIERS_BLOCKED]);
    expect(room.camBlocked).toEqual([...ATELIERS_TALL_BLOCKED]);
    for (const b of ATELIERS_TALL_BLOCKED) expect(ATELIERS_BLOCKED).toContainEqual(b);
  });

  it("every built solid's centre is unwalkable", () => {
    const centres: Array<[string, number, number]> = [
      ...ATELIER_BAY_POSTS.map((p, i) => [`bay post ${i}`, p.x, p.z] as [string, number, number]),
      ...ATELIER_BAY_TABLES.map((b, i) => [`bay table ${i}`, b.cx, b.cz] as [string, number, number]),
      ...ATELIER_BAY_PANELS.map((b, i) => [`glazed panel ${i}`, b.cx, b.cz] as [string, number, number]),
      ...ATELIER_VITRINES.map((p, i) => [`vitrine ${i}`, p.x, p.z] as [string, number, number]),
      ...ATELIER_PLINTHS.map((p, i) => [`plinth ${i}`, p.x, p.z] as [string, number, number]),
      ...ATELIER_CRATES.map((c, i) => [`crate ${i}`, c.x, c.z] as [string, number, number]),
      ...ATELIER_STONE_STACKS.map((b, i) => [`stone stack ${i}`, b.cx, b.cz] as [string, number, number]),
      ...ATELIER_TOOL_BENCHES.map((b, i) => [`tool bench ${i}`, b.cx, b.cz] as [string, number, number]),
      ...ATELIERS_PLANTERS.map((p, i) => [`planter ${i}`, p.cx, p.cz] as [string, number, number]),
      ...ATELIERS_LAMPS.map((l, i) => [`lamp ${i}`, l.x, l.z] as [string, number, number]),
      ...ATELIERS_BANNER_POLES.map((p, i) => [`banner pole ${i}`, p.x, p.z] as [string, number, number]),
      ...ATELIERS_PIERS.map((p, i) => [`pier ${i}`, p.x, p.z] as [string, number, number]),
      ...ATELIERS_WALL_RUNS.map((r, i) => [`wall run ${i}`, r.x, r.z] as [string, number, number]),
    ];
    for (const [name, x, z] of centres) {
      expect(isWalkable(x, z), name).toBe(false);
    }
  });

  it("the quarter's working ground stays walkable", () => {
    expect(isWalkable(30.2, 40.5)).toBe(true); // the spawn, on the lane
    expect(isWalkable(41.2, 40.5)).toBe(true); // the lane's heart
    expect(isWalkable(32.8, 40.5)).toBe(true); // the Ateliers Slate station point
    expect(isWalkable(37.0, 34.6)).toBe(true); // a north bay's open mouth
    expect(isWalkable(43.0, 46.4)).toBe(true); // a south bay's open mouth
    expect(isWalkable(30.2, 30.5)).toBe(true); // just inside the gate, the north yard
    expect(isWalkable(51.0, 40.5)).toBe(true); // the lane's far end
    /* The district's own walls hold: a step east out of the
     * quarter stops at its east wall, never leaves the world. */
    const out = resolvePalaceMove({ x: 53.5, z: 40.5, room: ATELIERS_ID }, 54.5, 40.5);
    expect(out.x).toBe(53.5);
  });

  it("the camera keeps off the tall solids and roams the open ground", () => {
    expect(cameraPointFree(ATELIERS_ID, ATELIERS_BANNER_POLES[0]!.x, ATELIERS_BANNER_POLES[0]!.z)).toBe(false);
    expect(cameraPointFree(ATELIERS_ID, ATELIER_BAY_POSTS[0]!.x, ATELIER_BAY_POSTS[0]!.z)).toBe(false);
    expect(cameraPointFree(ATELIERS_ID, ATELIER_BAY_PANELS[0]!.cx, ATELIER_BAY_PANELS[0]!.cz)).toBe(false);
    expect(cameraPointFree(ATELIERS_ID, 41.2, 40.5)).toBe(true);
    expect(cameraPointFree(ATELIERS_ID, 30.2, 40.5)).toBe(true);
  });
});

describe("The Ateliers — the outdoor ground system (item 34)", () => {
  it("the district floor takes whole-tile paving slabs, all inside its rect", () => {
    const slabs = pavingSlabsFor(ATELIERS_INTERIOR);
    expect(slabs.length).toBe(36); // 6 × 6 whole 4 m tiles in the 26 × 26 quarter
    for (const s of slabs) {
      expect(s.cx - s.w / 2).toBeGreaterThanOrEqual(ATELIERS_INTERIOR.minX - 1e-9);
      expect(s.cx + s.w / 2).toBeLessThanOrEqual(ATELIERS_INTERIOR.maxX + 1e-9);
      expect(s.cz - s.d / 2).toBeGreaterThanOrEqual(ATELIERS_INTERIOR.minZ - 1e-9);
      expect(s.cz + s.d / 2).toBeLessThanOrEqual(ATELIERS_INTERIOR.maxZ + 1e-9);
    }
  });

  it("the lane runs inside the interior, and every planter crown stands on its bed", () => {
    expect(ATELIERS_LANE.fromX).toBe(ATELIERS_INTERIOR.minX);
    expect(ATELIERS_LANE.toX).toBeLessThan(ATELIERS_INTERIOR.maxX);
    expect(ATELIERS_LANE.cz).toBe((ATELIERS_INTERIOR.minZ + ATELIERS_INTERIOR.maxZ) / 2);
    for (const p of ATELIERS_PLANTERS) {
      const bedRect = {
        minX: p.cx - p.w / 2, maxX: p.cx + p.w / 2,
        minZ: p.cz - p.d / 2, maxZ: p.cz + p.d / 2,
      };
      expect(bedRect.minX).toBeGreaterThan(ATELIERS_INTERIOR.minX);
      expect(bedRect.maxX).toBeLessThan(ATELIERS_INTERIOR.maxX);
      expect(bedRect.minZ).toBeGreaterThan(ATELIERS_INTERIOR.minZ);
      expect(bedRect.maxZ).toBeLessThan(ATELIERS_INTERIOR.maxZ);
    }
    for (const c of ATELIERS_PLANTER_CROWNS) {
      const onBed = ATELIERS_PLANTERS.some((p) =>
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
      expect(overlaps(r, ATELIERS_INTERIOR), JSON.stringify(r)).toBe(false);
      expect(overlaps(r, ATELIERS_WALK), JSON.stringify(r)).toBe(false);
    }
  });
});
