/**
 * Stage Grounds (board item 31) — the first built district, pinned.
 *
 * The Stage Grounds were a barred gate in the plaza's west wall.
 * This batch builds the district beyond it and opens the gate.
 * The laws pinned here:
 *   - the district is a real palace room with exactly one door —
 *     the west gate — whose plane/span are the gate gap's own
 *     numbers (district-gates' DISTRICT_GATE_GAPS);
 *   - the passage walks END TO END with no loading/teleport: a
 *     step sequence crosses the plaza, the portal and the wall
 *     plane into the district (membership flips at the plane),
 *     and back again; the wall beside the gate stays solid and
 *     the still-unbuilt Boardwalk gate stays barred;
 *   - every solid the scene builds from stage-grounds.ts (stage,
 *     shell, stacks, truss, benches, lamps, poles, piers, the
 *     quarter's own walls) is honestly blocked from the same data;
 *   - the working ground stays walkable: the spawn, the entry
 *     path, the audience lawn between the benches, the Stage Bill
 *     station point;
 *   - the ground wears the outdoor system: whole-tile paving
 *     slabs inside the district floor rect, a lawn panel inside
 *     the interior — and the C2 backdrop ring stands clear of the
 *     district it now rings (its west mounds moved beyond it).
 */
import { describe, it, expect } from "vitest";
import {
  COURTYARD_ID,
  PALACE_DOORS,
  PALACE_LAYOUT,
  STAGE_GROUNDS_ID,
  cameraPointFree,
  isWalkable,
  pointInRect,
  resolvePalaceMove,
} from "./palace-layout";
import { DISTRICT_GATE_GAPS } from "./district-gates";
import {
  AUDIENCE_LAWN,
  BANNER_POLES,
  ENTRY_PATH,
  SPEAKER_STACKS,
  STAGE_BENCHES,
  STAGE_BLOCKED,
  STAGE_GROUNDS_INTERIOR,
  STAGE_GROUNDS_WALK,
  STAGE_LAMPS,
  STAGE_PIERS,
  STAGE_PLATFORM,
  STAGE_SHELL_BACK,
  STAGE_SHELL_RETURNS,
  STAGE_TALL_BLOCKED,
  STAGE_WALL_RUNS,
  TRUSS,
} from "./stage-grounds";
import { pavingSlabsFor, backdropGroundRects } from "./palace-grounds";

const room = PALACE_LAYOUT[STAGE_GROUNDS_ID]!;

describe("Stage Grounds — the room and its door (item 31)", () => {
  it("is a registered palace room named for the district", () => {
    expect(room).toBeDefined();
    expect(room.name).toBe("Stage Grounds");
    expect(room.walk).toEqual(STAGE_GROUNDS_WALK);
    expect(room.interior).toEqual(STAGE_GROUNDS_INTERIOR);
    expect(room.spawn).toEqual({ x: -30.2, z: 19.5 });
  });

  it("has exactly one door: the west gate, at the gate gap's own numbers", () => {
    const doors = PALACE_DOORS.filter((d) => d.roomId === STAGE_GROUNDS_ID);
    expect(doors).toHaveLength(1);
    const door = doors[0]!;
    const gap = DISTRICT_GATE_GAPS["STAGE GROUNDS"]!;
    expect(door.axis).toBe("x");
    expect(door.plane).toBe(gap.at);
    expect(door.spanMin).toBe(gap.min);
    expect(door.spanMax).toBe(gap.max);
    expect(door.negRoom).toBe(STAGE_GROUNDS_ID);
    expect(door.posRoom).toBe(COURTYARD_ID);
    /* The portal covers the wall band with aprons on both faces,
     * and its span stops inside the gate posts' footprints. */
    expect(door.portal.minX).toBeLessThan(door.plane);
    expect(door.portal.maxX).toBeGreaterThan(door.plane);
    expect(door.portal.minZ).toBeGreaterThan(gap.min);
    expect(door.portal.maxZ).toBeLessThan(gap.max);
  });

  it("walks from the plaza through the gate into the district — no teleport, membership flips at the wall plane", () => {
    /* A stroll west along the gate's line, in ordinary steps. */
    let pos = { x: -26.5, z: 19.5, room: COURTYARD_ID };
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const step = resolvePalaceMove(pos, pos.x - 0.6, 19.5);
      expect(step.x).toBeLessThan(pos.x); // every step lands — the way is never blocked
      pos = { x: step.x, z: step.z, room: step.room };
      if (step.entered) seen.push(step.entered);
    }
    expect(seen).toEqual([STAGE_GROUNDS_ID]);
    expect(pos.room).toBe(STAGE_GROUNDS_ID);
    expect(pos.x).toBeLessThan(-30);
    /* And onward, across the entry path to the audience lawn's
     * east edge — every intermediate step landing. */
    const lawnEastEdge = AUDIENCE_LAWN.cx + AUDIENCE_LAWN.w / 2;
    let walk = { x: pos.x, z: pos.z, room: pos.room };
    for (let i = 0; i < 6; i++) {
      const step = resolvePalaceMove(walk, walk.x - 0.6, walk.z + 0.25);
      expect(step.x).toBeLessThan(walk.x);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.room).toBe(STAGE_GROUNDS_ID);
    expect(walk.x).toBeLessThan(lawnEastEdge);
    expect(walk.z).toBeGreaterThan(AUDIENCE_LAWN.cz - AUDIENCE_LAWN.d / 2);
    expect(walk.z).toBeLessThan(AUDIENCE_LAWN.cz + AUDIENCE_LAWN.d / 2);
  });

  it("walks back east through the gate onto the plaza", () => {
    const back = resolvePalaceMove({ x: -28.5, z: 19.5, room: STAGE_GROUNDS_ID }, -27.9, 19.5);
    expect(back.room).toBe(COURTYARD_ID);
    expect(back.entered).toBe(COURTYARD_ID);
  });

  it("the wall beside the gate stays solid, and the unbuilt Boardwalk gate stays barred", () => {
    expect(isWalkable(-28.2, 16.0)).toBe(false);
    const bonk = resolvePalaceMove({ x: -27.5, z: 16.0, room: COURTYARD_ID }, -28.6, 16.0);
    expect(bonk.x).toBe(-27.5);
    expect(bonk.entered).toBeNull();
    /* The gate posts themselves are solid — the passage is
     * BETWEEN them, never through them. */
    expect(isWalkable(-28.2, 18.4)).toBe(false);
    expect(isWalkable(-28.2, 20.6)).toBe(false);
    expect(isWalkable(0, 34.0)).toBe(false);
  });
});

describe("Stage Grounds — honest collision (item 31)", () => {
  it("the room's blocked list is the derived STAGE_BLOCKED, and its tall list is a subset", () => {
    expect(room.blocked).toEqual([...STAGE_BLOCKED]);
    expect(room.camBlocked).toEqual([...STAGE_TALL_BLOCKED]);
    for (const b of STAGE_TALL_BLOCKED) expect(STAGE_BLOCKED).toContainEqual(b);
  });

  it("every built solid's centre is unwalkable", () => {
    const centres: Array<[string, number, number]> = [
      ["stage platform", STAGE_PLATFORM.cx, STAGE_PLATFORM.cz],
      ["shell back wall", STAGE_SHELL_BACK.cx, STAGE_SHELL_BACK.cz],
      ...STAGE_SHELL_RETURNS.map((r, i) => [`shell return ${i}`, r.cx, r.cz] as [string, number, number]),
      ...SPEAKER_STACKS.map((s, i) => [`speaker stack ${i}`, s.x, s.z] as [string, number, number]),
      ...TRUSS.postZs.map((z, i) => [`truss post ${i}`, TRUSS.postX, z] as [string, number, number]),
      ...BANNER_POLES.map((p, i) => [`banner pole ${i}`, p.x, p.z] as [string, number, number]),
      ...STAGE_BENCHES.map((b, i) => [`bench ${i}`, b.x, b.z] as [string, number, number]),
      ...STAGE_LAMPS.map((l, i) => [`lamp ${i}`, l.x, l.z] as [string, number, number]),
      ...STAGE_PIERS.map((p, i) => [`pier ${i}`, p.x, p.z] as [string, number, number]),
      ...STAGE_WALL_RUNS.map((r, i) => [`wall run ${i}`, r.x, r.z] as [string, number, number]),
    ];
    for (const [name, x, z] of centres) {
      expect(isWalkable(x, z), name).toBe(false);
    }
  });

  it("the quarter's working ground stays walkable", () => {
    expect(isWalkable(-30.2, 19.5)).toBe(true); // the spawn, on the entry path
    expect(isWalkable(ENTRY_PATH.fromX + 4, ENTRY_PATH.cz)).toBe(true); // the entry path
    expect(isWalkable(-33.2, 19.5)).toBe(true); // the Stage Bill station point
    expect(isWalkable(-40.5, 21.0)).toBe(true); // the audience lawn, between bench rows
    expect(isWalkable(-39.0, 23.0)).toBe(true); // the aisle between bench columns
    expect(isWalkable(-34.0, 29.0)).toBe(true); // open paving south of the lawn
    /* The district's own walls hold: a step west out of the
     * quarter stops at its west wall, never leaves the world. */
    const out = resolvePalaceMove({ x: -53.6, z: 23.0, room: STAGE_GROUNDS_ID }, -54.6, 23.0);
    expect(out.x).toBe(-53.6);
  });

  it("the camera keeps off the tall solids and roams the open ground", () => {
    expect(cameraPointFree(STAGE_GROUNDS_ID, STAGE_SHELL_BACK.cx, STAGE_SHELL_BACK.cz)).toBe(false);
    expect(cameraPointFree(STAGE_GROUNDS_ID, TRUSS.postX, TRUSS.postZs[0]!)).toBe(false);
    expect(cameraPointFree(STAGE_GROUNDS_ID, -40.5, 23.0)).toBe(true);
    expect(cameraPointFree(STAGE_GROUNDS_ID, -30.2, 19.5)).toBe(true);
  });
});

describe("Stage Grounds — the outdoor ground system (item 31)", () => {
  it("the district floor takes whole-tile paving slabs, all inside its rect", () => {
    const slabs = pavingSlabsFor(STAGE_GROUNDS_INTERIOR);
    expect(slabs.length).toBe(36); // 6 × 6 whole 4 m tiles in the 26 × 26 quarter
    for (const s of slabs) {
      expect(s.cx - s.w / 2).toBeGreaterThanOrEqual(STAGE_GROUNDS_INTERIOR.minX - 1e-9);
      expect(s.cx + s.w / 2).toBeLessThanOrEqual(STAGE_GROUNDS_INTERIOR.maxX + 1e-9);
      expect(s.cz - s.d / 2).toBeGreaterThanOrEqual(STAGE_GROUNDS_INTERIOR.minZ - 1e-9);
      expect(s.cz + s.d / 2).toBeLessThanOrEqual(STAGE_GROUNDS_INTERIOR.maxZ + 1e-9);
    }
  });

  it("the audience lawn sits inside the interior, clear of the stage and the gate line's walls", () => {
    const lawnRect = {
      minX: AUDIENCE_LAWN.cx - AUDIENCE_LAWN.w / 2,
      maxX: AUDIENCE_LAWN.cx + AUDIENCE_LAWN.w / 2,
      minZ: AUDIENCE_LAWN.cz - AUDIENCE_LAWN.d / 2,
      maxZ: AUDIENCE_LAWN.cz + AUDIENCE_LAWN.d / 2,
    };
    expect(lawnRect.minX).toBeGreaterThan(STAGE_GROUNDS_INTERIOR.minX);
    expect(lawnRect.maxX).toBeLessThan(STAGE_GROUNDS_INTERIOR.maxX);
    expect(lawnRect.minZ).toBeGreaterThan(STAGE_GROUNDS_INTERIOR.minZ);
    expect(lawnRect.maxZ).toBeLessThan(STAGE_GROUNDS_INTERIOR.maxZ);
    /* Every bench stands ON the lawn it serves. */
    for (const b of STAGE_BENCHES) {
      expect(pointInRect(b.x, b.z, lawnRect)).toBe(true);
    }
  });

  it("the C2 backdrop ring stands clear of the district it now rings", () => {
    const overlaps = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a) =>
      a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
    for (const r of backdropGroundRects()) {
      expect(overlaps(r, STAGE_GROUNDS_INTERIOR), JSON.stringify(r)).toBe(false);
      expect(overlaps(r, STAGE_GROUNDS_WALK), JSON.stringify(r)).toBe(false);
    }
  });
});
