/**
 * Listening Gardens (board item 32) — the second built district,
 * pinned.
 *
 * The Listening Gardens were a MARKER on the promenade — a
 * signpost at (−26, 33.8) naming a district with nothing behind
 * it. This batch builds the district beyond the south wall and
 * reclassifies the marker to an open gate. The laws pinned here:
 *   - the district is a real palace room with exactly one door —
 *     the south gate — whose plane/span are the gate gap's own
 *     numbers (district-gates' DISTRICT_GATE_GAPS);
 *   - the passage walks END TO END with no loading/teleport: a
 *     step sequence crosses the promenade, the portal and the
 *     wall plane into the gardens (membership flips at the
 *     plane), and back again; the wall beside the gate stays
 *     solid and the still-unbuilt Boardwalk gate stays barred;
 *   - every solid the scene builds from listening-gardens.ts
 *     (walls, piers, hedges, benches, lamps, poles, pavilion
 *     posts, the rill) is honestly blocked from the same data;
 *   - the working ground stays walkable: the spawn, the entry
 *     path, the parterre lawn between the rill and the benches,
 *     the nooks' mouths, the pavilion's open floor, the Gardens
 *     Slate station point;
 *   - the ground wears the outdoor system: whole-tile paving
 *     slabs inside the district floor rect, a lawn panel inside
 *     the interior — and the C2 backdrop ring stands clear of
 *     the district it now rings (its south-centre mound moved
 *     west past the gardens' wall).
 */
import { describe, it, expect } from "vitest";
import {
  COURTYARD_ID,
  LISTENING_GARDENS_ID,
  PALACE_DOORS,
  PALACE_LAYOUT,
  cameraPointFree,
  isWalkable,
  pointInRect,
  resolvePalaceMove,
} from "./palace-layout";
import { DISTRICT_GATE_GAPS } from "./district-gates";
import {
  GARDEN_HEDGES,
  GARDENS_BANNER_POLES,
  GARDENS_BLOCKED,
  GARDENS_ENTRY_PATH,
  GARDENS_INTERIOR,
  GARDENS_LAMPS,
  GARDENS_PIERS,
  GARDENS_TALL_BLOCKED,
  GARDENS_WALK,
  GARDENS_WALL_RUNS,
  NOOK_BENCHES,
  PARTERRE_LAWN,
  PAVILION,
  PAVILION_POSTS,
  RILL,
  RILL_BENCHES,
  RILL_BLOCKED,
} from "./listening-gardens";
import { pavingSlabsFor, backdropGroundRects, lawnPlantingSpots } from "./palace-grounds";

const room = PALACE_LAYOUT[LISTENING_GARDENS_ID]!;

describe("Listening Gardens — the room and its door (item 32)", () => {
  it("is a registered palace room named for the district", () => {
    expect(room).toBeDefined();
    expect(room.name).toBe("Listening Gardens");
    expect(room.walk).toEqual(GARDENS_WALK);
    expect(room.interior).toEqual(GARDENS_INTERIOR);
    expect(room.spawn).toEqual({ x: -26, z: 36.2 });
  });

  it("has exactly one door: the south gate, at the gate gap's own numbers", () => {
    const doors = PALACE_DOORS.filter((d) => d.roomId === LISTENING_GARDENS_ID);
    expect(doors).toHaveLength(1);
    const door = doors[0]!;
    const gap = DISTRICT_GATE_GAPS["LISTENING GARDENS"]!;
    expect(door.axis).toBe("z");
    expect(door.plane).toBe(gap.at);
    expect(door.spanMin).toBe(gap.min);
    expect(door.spanMax).toBe(gap.max);
    expect(door.negRoom).toBe(COURTYARD_ID);
    expect(door.posRoom).toBe(LISTENING_GARDENS_ID);
    /* The portal covers the wall band with aprons on both faces,
     * and its span stops inside the gate posts' footprints. */
    expect(door.portal.minZ).toBeLessThan(door.plane);
    expect(door.portal.maxZ).toBeGreaterThan(door.plane);
    expect(door.portal.minX).toBeGreaterThan(gap.min);
    expect(door.portal.maxX).toBeLessThan(gap.max);
  });

  it("walks from the promenade through the gate into the gardens — no teleport, membership flips at the wall plane", () => {
    /* A stroll south along the gate's line, in ordinary steps. */
    let pos = { x: -26, z: 31.5, room: COURTYARD_ID };
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const step = resolvePalaceMove(pos, pos.x, pos.z + 0.6);
      expect(step.z).toBeGreaterThan(pos.z); // every step lands — the way is never blocked
      pos = { x: step.x, z: step.z, room: step.room };
      if (step.entered) seen.push(step.entered);
    }
    expect(seen).toEqual([LISTENING_GARDENS_ID]);
    expect(pos.room).toBe(LISTENING_GARDENS_ID);
    expect(pos.z).toBeGreaterThan(36);
    /* And onward, down the entry path to the parterre's north
     * edge — every intermediate step landing. */
    let walk = { x: pos.x, z: pos.z, room: pos.room };
    for (let i = 0; i < 5; i++) {
      const step = resolvePalaceMove(walk, walk.x + 0.2, walk.z + 0.6);
      expect(step.z).toBeGreaterThan(walk.z);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.room).toBe(LISTENING_GARDENS_ID);
    expect(walk.z).toBeGreaterThan(PARTERRE_LAWN.cz - PARTERRE_LAWN.d / 2);
  });

  it("walks back north through the gate onto the promenade", () => {
    const back = resolvePalaceMove({ x: -26, z: 34.3, room: LISTENING_GARDENS_ID }, -26, 33.7);
    expect(back.room).toBe(COURTYARD_ID);
    expect(back.entered).toBe(COURTYARD_ID);
  });

  it("the wall beside the gate stays solid, and the unbuilt Boardwalk gate stays barred", () => {
    expect(isWalkable(-20, 34.0)).toBe(false);
    const bonk = resolvePalaceMove({ x: -20, z: 33.4, room: COURTYARD_ID }, -20, 34.2);
    expect(bonk.z).toBe(33.4);
    expect(bonk.entered).toBeNull();
    /* The gate posts themselves are solid — the passage is
     * BETWEEN them, never through them. */
    expect(isWalkable(-27.1, 34.0)).toBe(false);
    expect(isWalkable(-24.9, 34.0)).toBe(false);
    expect(isWalkable(0, 34.0)).toBe(false);
  });
});

describe("Listening Gardens — honest collision (item 32)", () => {
  it("the room's blocked list is the derived GARDENS_BLOCKED, and its tall list is a subset", () => {
    expect(room.blocked).toEqual([...GARDENS_BLOCKED]);
    expect(room.camBlocked).toEqual([...GARDENS_TALL_BLOCKED]);
    for (const b of GARDENS_TALL_BLOCKED) expect(GARDENS_BLOCKED).toContainEqual(b);
  });

  it("every built solid's centre is unwalkable", () => {
    const centres: Array<[string, number, number]> = [
      ["rill", RILL.cx, RILL.cz],
      ...GARDEN_HEDGES.map((h, i) => [`hedge ${i}`, h.cx, h.cz] as [string, number, number]),
      ...NOOK_BENCHES.map((b, i) => [`nook bench ${i}`, b.x, b.z] as [string, number, number]),
      ...RILL_BENCHES.map((b, i) => [`rill bench ${i}`, b.x, b.z] as [string, number, number]),
      ...GARDENS_LAMPS.map((l, i) => [`lamp ${i}`, l.x, l.z] as [string, number, number]),
      ...GARDENS_BANNER_POLES.map((p, i) => [`banner pole ${i}`, p.x, p.z] as [string, number, number]),
      ...PAVILION_POSTS.map((p, i) => [`pavilion post ${i}`, p.x, p.z] as [string, number, number]),
      ...GARDENS_PIERS.map((p, i) => [`pier ${i}`, p.x, p.z] as [string, number, number]),
      ...GARDENS_WALL_RUNS.map((r, i) => [`wall run ${i}`, r.x, r.z] as [string, number, number]),
    ];
    for (const [name, x, z] of centres) {
      expect(isWalkable(x, z), name).toBe(false);
    }
  });

  it("the quarter's working ground stays walkable", () => {
    expect(isWalkable(-26, 36.2)).toBe(true); // the spawn, on the entry path
    expect(isWalkable(GARDENS_ENTRY_PATH.cx, 37.5)).toBe(true); // the entry path
    expect(isWalkable(-26, 38.4)).toBe(true); // the Gardens Slate station point
    expect(isWalkable(-26, 40.5)).toBe(true); // the lawn north of the rill's end
    expect(isWalkable(-31.5, 47.0)).toBe(true); // the lawn west of the rill, clear of its bench
    expect(isWalkable(-35.2, 41.5)).toBe(true); // a west nook's open mouth
    expect(isWalkable(-16.8, 52.5)).toBe(true); // an east nook's open mouth
    expect(isWalkable(PAVILION.cx, PAVILION.cz)).toBe(true); // the pavilion's open floor
    expect(isWalkable(-20.0, 57.0)).toBe(true); // open paving east of the pavilion
    /* The district's own walls hold: a step south out of the
     * quarter stops at its south wall, never leaves the world. */
    const out = resolvePalaceMove({ x: -26, z: 59.4, room: LISTENING_GARDENS_ID }, -26, 60.4);
    expect(out.z).toBe(59.4);
  });

  it("the camera keeps off the tall solids and roams the open ground", () => {
    expect(cameraPointFree(LISTENING_GARDENS_ID, GARDENS_BANNER_POLES[0]!.x, GARDENS_BANNER_POLES[0]!.z)).toBe(false);
    expect(cameraPointFree(LISTENING_GARDENS_ID, PAVILION_POSTS[0]!.x, PAVILION_POSTS[0]!.z)).toBe(false);
    expect(cameraPointFree(LISTENING_GARDENS_ID, -26, 47.0)).toBe(true);
    expect(cameraPointFree(LISTENING_GARDENS_ID, -26, 36.2)).toBe(true);
  });
});

describe("Listening Gardens — the outdoor ground system (item 32)", () => {
  it("the district floor takes whole-tile paving slabs, all inside its rect", () => {
    const slabs = pavingSlabsFor(GARDENS_INTERIOR);
    expect(slabs.length).toBe(36); // 6 × 6 whole 4 m tiles in the 26 × 26 quarter
    for (const s of slabs) {
      expect(s.cx - s.w / 2).toBeGreaterThanOrEqual(GARDENS_INTERIOR.minX - 1e-9);
      expect(s.cx + s.w / 2).toBeLessThanOrEqual(GARDENS_INTERIOR.maxX + 1e-9);
      expect(s.cz - s.d / 2).toBeGreaterThanOrEqual(GARDENS_INTERIOR.minZ - 1e-9);
      expect(s.cz + s.d / 2).toBeLessThanOrEqual(GARDENS_INTERIOR.maxZ + 1e-9);
    }
  });

  it("the parterre lawn sits inside the interior, and the rill runs inside the lawn", () => {
    const lawnRect = {
      minX: PARTERRE_LAWN.cx - PARTERRE_LAWN.w / 2,
      maxX: PARTERRE_LAWN.cx + PARTERRE_LAWN.w / 2,
      minZ: PARTERRE_LAWN.cz - PARTERRE_LAWN.d / 2,
      maxZ: PARTERRE_LAWN.cz + PARTERRE_LAWN.d / 2,
    };
    expect(lawnRect.minX).toBeGreaterThan(GARDENS_INTERIOR.minX);
    expect(lawnRect.maxX).toBeLessThan(GARDENS_INTERIOR.maxX);
    expect(lawnRect.minZ).toBeGreaterThan(GARDENS_INTERIOR.minZ);
    expect(lawnRect.maxZ).toBeLessThan(GARDENS_INTERIOR.maxZ);
    expect(pointInRect(RILL.cx, RILL.cz, lawnRect)).toBe(true);
    expect(RILL_BLOCKED.minX).toBeGreaterThan(lawnRect.minX);
    expect(RILL_BLOCKED.maxX).toBeLessThan(lawnRect.maxX);
    expect(RILL_BLOCKED.minZ).toBeGreaterThan(lawnRect.minZ);
    expect(RILL_BLOCKED.maxZ).toBeLessThan(lawnRect.maxZ);
    /* The parterre's planting crowns stand on the lawn, clear of
     * the rill they ring. */
    for (const s of lawnPlantingSpots(PARTERRE_LAWN)) {
      expect(pointInRect(s.x, s.z, lawnRect)).toBe(true);
      expect(pointInRect(s.x, s.z, RILL_BLOCKED)).toBe(false);
    }
    /* Every rill bench stands ON the lawn it serves. */
    for (const b of RILL_BENCHES) {
      expect(pointInRect(b.x, b.z, lawnRect)).toBe(true);
    }
  });

  it("the C2 backdrop ring stands clear of the district it now rings", () => {
    const overlaps = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a) =>
      a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
    for (const r of backdropGroundRects()) {
      expect(overlaps(r, GARDENS_INTERIOR), JSON.stringify(r)).toBe(false);
      expect(overlaps(r, GARDENS_WALK), JSON.stringify(r)).toBe(false);
    }
  });
});
