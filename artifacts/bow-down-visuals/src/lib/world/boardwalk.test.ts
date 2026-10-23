/**
 * The Boardwalk (board item 35) — the fifth built district,
 * pinned.
 *
 * The Boardwalk was a BARRED GATE in the plaza's south wall — a
 * real gap at (0, 34.0) closed by a gold bar, with the C2
 * backdrop's water beyond. This batch opens the gate and builds
 * the waterfront quarter south of the wall. The laws pinned
 * here:
 *   - the district is a real palace room with exactly one door —
 *     the south gate — whose plane/span are the gate gap's own
 *     numbers (district-gates' DISTRICT_GATE_GAPS);
 *   - the passage walks END TO END with no loading/teleport: a
 *     step sequence crosses the plaza, the portal and the wall
 *     plane into the Boardwalk (membership flips at the plane),
 *     rides the entry corridor onto the deck, and back again;
 *   - the quarter THREADS the Creator Rooms building, which
 *     stands in the strip south of the wall: no Boardwalk walk
 *     rect, ground, floor or interior overlaps the building's
 *     footprint, and the shared boundaries stay coherent — the
 *     Gardens' east wall and the Ateliers' west wall are solid
 *     from the Boardwalk side too;
 *   - every solid the scene builds from boardwalk.ts (walls,
 *     piers, stall posts and benches, the bandstand's whole
 *     footprint, the basin + railing band, benches, planters,
 *     lamps, poles) is honestly blocked from the same data;
 *   - the working ground stays walkable: the spawn, the
 *     corridor, both north strips, the Boardwalk Slate station
 *     point, the stalls' open mouths, the deck's promenade;
 *   - the ground is a TIMBER DECK, not marble: whole
 *     board-length planks inside every floor rect, in a palette
 *     that differs by look (dark warm wood at dusk, pale
 *     sun-bleached by day) — and the C2 backdrop ring stands
 *     clear of the district it now fronts (its south-centre
 *     mound moved south past the Boardwalk's wall, and the moat
 *     it rings passes near the quarter's south edge).
 */
import { describe, it, expect } from "vitest";
import {
  BOARDWALK_ID,
  COURTYARD_ID,
  CREATOR_ROOM_TEMPLATE,
  PALACE_DOORS,
  PALACE_LAYOUT,
  cameraPointFree,
  isWalkable,
  pointInRect,
  resolvePalaceMove,
} from "./palace-layout";
import { DISTRICT_GATE_GAPS } from "./district-gates";
import {
  BANDSTAND,
  BANDSTAND_BLOCKED,
  BANDSTAND_POSTS,
  BANDSTAND_STEPS,
  BASIN_BLOCKED,
  BOARDWALK_BASIN,
  BOARDWALK_BENCHES,
  BOARDWALK_BLOCKED,
  BOARDWALK_DECK_PLANKS,
  BOARDWALK_FLOOR_RECTS,
  BOARDWALK_GROUNDS,
  BOARDWALK_INTERIOR,
  BOARDWALK_LAMPS,
  BOARDWALK_NORTH_FLOORS,
  BOARDWALK_PIERS,
  BOARDWALK_PLANTERS,
  BOARDWALK_PLANTER_CROWNS,
  BOARDWALK_RAILING,
  BOARDWALK_RAILING_POSTS,
  BOARDWALK_BANNER_POLES,
  BOARDWALK_STALL_BENCHES,
  BOARDWALK_STALL_POSTS,
  BOARDWALK_TALL_BLOCKED,
  BOARDWALK_WALK,
  BOARDWALK_WALL_RUNS,
  boardwalkDeckStyle,
  deckPlanksFor,
} from "./boardwalk";
import { BACKDROP, BACKDROP_GARDENS, backdropGroundRects } from "./palace-grounds";

const room = PALACE_LAYOUT[BOARDWALK_ID]!;

const overlaps = (
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

describe("The Boardwalk — the room and its door (item 35)", () => {
  it("is a registered palace room named for the district, grounds and all", () => {
    expect(room).toBeDefined();
    expect(room.name).toBe("The Boardwalk");
    expect(room.walk).toEqual(BOARDWALK_WALK);
    expect(room.grounds).toEqual([...BOARDWALK_GROUNDS]);
    expect(room.interior).toEqual(BOARDWALK_INTERIOR);
    expect(room.spawn).toEqual({ x: 0, z: 36.2 });
  });

  it("has exactly one door: the south gate, at the gate gap's own numbers", () => {
    const doors = PALACE_DOORS.filter((d) => d.roomId === BOARDWALK_ID);
    expect(doors).toHaveLength(1);
    const door = doors[0]!;
    const gap = DISTRICT_GATE_GAPS["THE BOARDWALK"]!;
    expect(door.axis).toBe("z");
    expect(door.plane).toBe(gap.at);
    expect(door.spanMin).toBe(gap.min);
    expect(door.spanMax).toBe(gap.max);
    expect(door.negRoom).toBe(COURTYARD_ID);
    expect(door.posRoom).toBe(BOARDWALK_ID);
    /* The portal covers the wall band with aprons on both faces,
     * and its span stops inside the gate posts' footprints. */
    expect(door.portal.minZ).toBeLessThan(door.plane);
    expect(door.portal.maxZ).toBeGreaterThan(door.plane);
    expect(door.portal.minX).toBeGreaterThan(gap.min);
    expect(door.portal.maxX).toBeLessThan(gap.max);
  });

  it("threads the Creator Rooms building: no Boardwalk rect overlaps its footprint", () => {
    const building = CREATOR_ROOM_TEMPLATE.interior;
    for (const r of [BOARDWALK_WALK, BOARDWALK_INTERIOR, ...BOARDWALK_GROUNDS, ...BOARDWALK_FLOOR_RECTS]) {
      expect(overlaps(r, building), JSON.stringify(r)).toBe(false);
    }
    /* The strips stop at the building's wall lines: the entry
     * strip at its west wall, the pocket at its east wall. */
    expect(BOARDWALK_GROUNDS[0]!.maxX).toBeLessThan(building.minX);
    expect(BOARDWALK_GROUNDS[1]!.minX).toBeGreaterThan(building.maxX);
    /* And both grounds overlap the main walk's north edge — a
     * step may only pass through walkable ground. */
    for (const gr of BOARDWALK_GROUNDS) {
      expect(gr.maxZ).toBeGreaterThan(BOARDWALK_WALK.minZ);
    }
  });

  it("walks from the plaza through the gate, down the corridor, onto the deck — no teleport, membership flips at the wall plane", () => {
    /* South off the promenade, through the gate. */
    let pos = { x: 0, z: 31.5, room: COURTYARD_ID };
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      const step = resolvePalaceMove(pos, pos.x, pos.z + 0.6);
      expect(step.z).toBeGreaterThan(pos.z); // every step lands — the way is never blocked
      pos = { x: step.x, z: step.z, room: step.room };
      if (step.entered) seen.push(step.entered);
    }
    expect(seen).toEqual([BOARDWALK_ID]);
    expect(pos.room).toBe(BOARDWALK_ID);
    expect(pos.z).toBeGreaterThan(36.0); // down the corridor, past the spawn
    /* South onto the deck, past the Slate, then east along the
     * promenade and south to the water benches — every step
     * landing. (The deck's dressing is solid and the stroll
     * routes around it, like a walker's: it turns east north of
     * the lamp at (0, 44) and south east of the bandstand.) */
    let walk = { x: pos.x, z: pos.z, room: pos.room };
    for (let i = 0; i < 6; i++) {
      const step = resolvePalaceMove(walk, walk.x, walk.z + 0.6);
      expect(step.z).toBeGreaterThan(walk.z);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.z).toBeGreaterThan(39.5); // the Slate's line
    for (let i = 0; i < 5; i++) {
      const step = resolvePalaceMove(walk, walk.x, walk.z + 0.6);
      expect(step.z).toBeGreaterThan(walk.z);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.z).toBeGreaterThan(42.5);
    for (let i = 0; i < 37; i++) {
      const step = resolvePalaceMove(walk, walk.x + 0.6, 43.0);
      expect(step.x).toBeGreaterThan(walk.x);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.x).toBeGreaterThan(22.0);
    for (let i = 0; i < 19; i++) {
      const step = resolvePalaceMove(walk, walk.x, walk.z + 0.6);
      expect(step.z).toBeGreaterThan(walk.z);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.room).toBe(BOARDWALK_ID);
    expect(walk.z).toBeGreaterThan(54.0); // at the railing, above the basin
    expect(walk.z).toBeLessThan(55.5); // — and stopped by it, honestly
  });

  it("walks back north through the gate onto the plaza", () => {
    const back = resolvePalaceMove({ x: 0, z: 34.3, room: BOARDWALK_ID }, 0, 33.7);
    expect(back.room).toBe(COURTYARD_ID);
    expect(back.entered).toBe(COURTYARD_ID);
  });

  it("the wall beside the gate stays solid, and the gate posts are solid — the passage is between them", () => {
    expect(isWalkable(-5, 34.0)).toBe(false);
    expect(isWalkable(24, 34.0)).toBe(false);
    const bonk = resolvePalaceMove({ x: -5, z: 33.4, room: COURTYARD_ID }, -5, 34.2);
    expect(bonk.z).toBe(33.4);
    expect(bonk.entered).toBeNull();
    expect(isWalkable(-1.1, 34.0)).toBe(false);
    expect(isWalkable(1.1, 34.0)).toBe(false);
    /* The gap itself, once barred, now walks. */
    expect(isWalkable(0, 34.0)).toBe(true);
  });

  it("the shared boundaries stay coherent: the Gardens' and Ateliers' walls are solid from this side", () => {
    /* The Gardens' east wall closes the strips' and deck's west
     * edge north of the Boardwalk's own west run. */
    expect(isWalkable(-13.0, 36.0)).toBe(false);
    const west = resolvePalaceMove({ x: -12.4, z: 36.0, room: BOARDWALK_ID }, -13.2, 36.0);
    expect(west.x).toBe(-12.4);
    /* The Ateliers' west wall closes the pocket's and deck's
     * east edge south to z 53.5; the Boardwalk's own east run
     * closes it from there to the water. */
    expect(isWalkable(28.2, 45.0)).toBe(false);
    expect(isWalkable(28.2, 57.0)).toBe(false);
    const out = resolvePalaceMove({ x: 27.5, z: 49.0, room: BOARDWALK_ID }, 28.5, 49.0);
    expect(out.x).toBe(27.5);
    /* The Creator Rooms building's flanks are solid too: a step
     * east out of the corridor stops at the building's line. */
    expect(isWalkable(2.6, 36.0)).toBe(false);
    expect(isWalkable(16.4, 36.0)).toBe(false);
  });
});

describe("The Boardwalk — honest collision (item 35)", () => {
  it("the room's blocked list is the derived BOARDWALK_BLOCKED, and its tall list is a subset", () => {
    expect(room.blocked).toEqual([...BOARDWALK_BLOCKED]);
    expect(room.camBlocked).toEqual([...BOARDWALK_TALL_BLOCKED]);
    for (const b of BOARDWALK_TALL_BLOCKED) expect(BOARDWALK_BLOCKED).toContainEqual(b);
  });

  it("every built solid's centre is unwalkable", () => {
    const centres: Array<[string, number, number]> = [
      ...BOARDWALK_STALL_POSTS.map((p, i) => [`stall post ${i}`, p.x, p.z] as [string, number, number]),
      ...BOARDWALK_STALL_BENCHES.map((b, i) => [`stall bench ${i}`, b.cx, b.cz] as [string, number, number]),
      [`bandstand platform`, BANDSTAND.cx, BANDSTAND.cz],
      ...BANDSTAND_POSTS.map((p, i) => [`bandstand post ${i}`, p.x, p.z] as [string, number, number]),
      [`water basin`, BOARDWALK_BASIN.cx, BOARDWALK_BASIN.cz],
      [`railing line`, BOARDWALK_RAILING_POSTS[0]!.x, BOARDWALK_RAILING_POSTS[0]!.z],
      ...BOARDWALK_BENCHES.map((b, i) => [`bench ${i}`, b.x, b.z] as [string, number, number]),
      ...BOARDWALK_PLANTERS.map((p, i) => [`planter ${i}`, p.cx, p.cz] as [string, number, number]),
      ...BOARDWALK_LAMPS.map((l, i) => [`lamp ${i}`, l.x, l.z] as [string, number, number]),
      ...BOARDWALK_BANNER_POLES.map((p, i) => [`banner pole ${i}`, p.x, p.z] as [string, number, number]),
      ...BOARDWALK_PIERS.map((p, i) => [`pier ${i}`, p.x, p.z] as [string, number, number]),
      ...BOARDWALK_WALL_RUNS.map((r, i) => [`wall run ${i}`, r.x, r.z] as [string, number, number]),
    ];
    for (const [name, x, z] of centres) {
      expect(isWalkable(x, z), name).toBe(false);
    }
  });

  it("the quarter's working ground stays walkable", () => {
    expect(isWalkable(0, 36.2)).toBe(true); // the spawn, on the corridor
    expect(isWalkable(0, 39.8)).toBe(true); // the Boardwalk Slate station point
    expect(isWalkable(7.6, 44.0)).toBe(true); // the promenade's heart, north of the bandstand
    expect(isWalkable(3.0, 41.3)).toBe(true); // a north stall's open mouth
    expect(isWalkable(18.0, 52.5)).toBe(true); // a south stall's open mouth
    expect(isWalkable(-11.0, 37.0)).toBe(true); // the entry strip's west end
    expect(isWalkable(22.0, 36.0)).toBe(true); // the east pocket
    expect(isWalkable(24.0, 54.5)).toBe(true); // the deck at the railing, east end
    expect(isWalkable(-11.5, 49.0)).toBe(true); // the deck's west promenade
  });

  it("the bandstand's steps stand inside its blocked footprint — ceremony, never a climb", () => {
    for (const s of BANDSTAND_STEPS) {
      expect(s.cx - s.w / 2).toBeGreaterThanOrEqual(BANDSTAND_BLOCKED.minX);
      expect(s.cx + s.w / 2).toBeLessThanOrEqual(BANDSTAND_BLOCKED.maxX);
      expect(s.cz - s.d / 2).toBeGreaterThanOrEqual(BANDSTAND_BLOCKED.minZ);
      expect(s.cz + s.d / 2).toBeLessThanOrEqual(BANDSTAND_BLOCKED.maxZ);
    }
  });

  it("the camera keeps off the tall solids and roams the open deck", () => {
    expect(cameraPointFree(BOARDWALK_ID, BOARDWALK_BANNER_POLES[0]!.x, BOARDWALK_BANNER_POLES[0]!.z)).toBe(false);
    expect(cameraPointFree(BOARDWALK_ID, BOARDWALK_STALL_POSTS[0]!.x, BOARDWALK_STALL_POSTS[0]!.z)).toBe(false);
    expect(cameraPointFree(BOARDWALK_ID, BANDSTAND_POSTS[0]!.x, BANDSTAND_POSTS[0]!.z)).toBe(false);
    expect(cameraPointFree(BOARDWALK_ID, 7.6, 44.0)).toBe(true);
    expect(cameraPointFree(BOARDWALK_ID, 0, 36.2)).toBe(true);
  });
});

describe("The Boardwalk — the timber deck and the water (item 35)", () => {
  it("the deck takes whole board-length planks, all inside their floor rects", () => {
    const counts = BOARDWALK_FLOOR_RECTS.map((r) => deckPlanksFor(r).length);
    expect(counts).toEqual([253, 16, 12]); // main deck + entry strip + east pocket
    expect(BOARDWALK_DECK_PLANKS.length).toBe(281);
    BOARDWALK_FLOOR_RECTS.forEach((rect, ri) => {
      for (const p of deckPlanksFor(rect)) {
        expect(p.cx - p.w / 2).toBeGreaterThanOrEqual(rect.minX - 1e-9);
        expect(p.cx + p.w / 2).toBeLessThanOrEqual(rect.maxX + 1e-9);
        expect(p.cz - p.d / 2).toBeGreaterThanOrEqual(rect.minZ - 1e-9);
        expect(p.cz + p.d / 2).toBeLessThanOrEqual(rect.maxZ + 1e-9);
        expect(ri).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it("the deck palette is the direction's: dark warm wood at dusk, pale sun-bleached by day", () => {
    const dark = boardwalkDeckStyle("dark");
    const light = boardwalkDeckStyle("light");
    expect(dark.color).toBe(0x4a3018);
    expect(light.color).toBe(0xc9a877);
    expect(dark.color).not.toBe(light.color);
    expect(dark.roughness).toBeGreaterThanOrEqual(0.9); // walked-on timber, never glossy
    expect(light.roughness).toBeGreaterThanOrEqual(0.9);
  });

  it("the basin stands inside the interior, its railing posts inside its blocked band", () => {
    expect(BOARDWALK_BASIN.cx - BOARDWALK_BASIN.w / 2).toBeGreaterThan(BOARDWALK_INTERIOR.minX);
    expect(BOARDWALK_BASIN.cx + BOARDWALK_BASIN.w / 2).toBeLessThan(BOARDWALK_INTERIOR.maxX);
    expect(BOARDWALK_BASIN.cz + BOARDWALK_BASIN.d / 2).toBeLessThan(BOARDWALK_INTERIOR.maxZ);
    expect(BOARDWALK_RAILING_POSTS).toHaveLength(19);
    expect(BOARDWALK_RAILING_POSTS[0]!.x).toBe(BOARDWALK_RAILING.fromX);
    expect(BOARDWALK_RAILING_POSTS[BOARDWALK_RAILING_POSTS.length - 1]!.x).toBe(BOARDWALK_RAILING.toX);
    for (const p of BOARDWALK_RAILING_POSTS) {
      expect(pointInRect(p.x, p.z, BASIN_BLOCKED), JSON.stringify(p)).toBe(true);
    }
  });

  it("every planter crown stands on its bed, and the beds stand in the north strips", () => {
    for (const p of BOARDWALK_PLANTERS) {
      const bedRect = {
        minX: p.cx - p.w / 2, maxX: p.cx + p.w / 2,
        minZ: p.cz - p.d / 2, maxZ: p.cz + p.d / 2,
      };
      const inStrip = BOARDWALK_NORTH_FLOORS.some((f) =>
        bedRect.minX >= f.minX && bedRect.maxX <= f.maxX && bedRect.minZ >= f.minZ && bedRect.maxZ <= f.maxZ);
      expect(inStrip, JSON.stringify(bedRect)).toBe(true);
    }
    for (const c of BOARDWALK_PLANTER_CROWNS) {
      const onBed = BOARDWALK_PLANTERS.some((p) =>
        pointInRect(c.x, c.z, {
          minX: p.cx - p.w / 2, maxX: p.cx + p.w / 2,
          minZ: p.cz - p.d / 2, maxZ: p.cz + p.d / 2,
        }));
      expect(onBed, JSON.stringify(c)).toBe(true);
    }
  });

  it("the C2 backdrop ring stands clear of the district it now fronts — and its moat passes near the south wall", () => {
    for (const r of backdropGroundRects()) {
      expect(overlaps(r, BOARDWALK_INTERIOR), JSON.stringify(r)).toBe(false);
      expect(overlaps(r, BOARDWALK_WALK), JSON.stringify(r)).toBe(false);
      for (const gr of BOARDWALK_GROUNDS) {
        expect(overlaps(r, gr), JSON.stringify(r)).toBe(false);
      }
    }
    /* The displaced south-centre mound rings the Boardwalk's
     * south wall from beyond the moat now. */
    expect(BACKDROP_GARDENS).toContainEqual({ x: 20, z: 68, r: 8, h: 3.4 });
    /* The moat's inner edge on the gate's line (x 0) sits just
     * south of the quarter's south wall — the water is near. */
    const moatSouthZ = BACKDROP.moatCenter.z + BACKDROP.moatInnerR;
    expect(moatSouthZ - BOARDWALK_INTERIOR.maxZ).toBeGreaterThan(0);
    expect(moatSouthZ - BOARDWALK_INTERIOR.maxZ).toBeLessThan(10);
  });
});
