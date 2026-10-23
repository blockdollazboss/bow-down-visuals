/**
 * The palace floor plan (lib/world/palace-layout) — pure geometry.
 *
 * Pinned: the hall's walk bounds are the room's long-standing ones
 * (the palace must not move the hall); walls are solid — no step
 * from any room reaches another room except through a doorway
 * portal; membership flips at the wall plane inside a portal; a
 * blocked diagonal slides along the wall instead of sticking.
 */
import { describe, it, expect } from "vitest";
import {
  PALACE_LAYOUT,
  PALACE_DOORS,
  PLAZA_WALL_RUNS,
  PLAZA_COLUMNS,
  PLAZA_PLANTERS,
  PLAZA_BRAZIERS,
  PLAZA_GATES,
  PLAZA_BLOCKED,
  PLAZA_TALL_BLOCKED,
  MONUMENT_CORE_BLOCKED,
  PLAZA_STEPS,
  LAWN_ZONES,
  HALL_STEP_ZONES,
  TERRACE_ZONES,
  MONUMENT_STEPS,
  BOARDWALK_STEPS,
  STEP_UP_MAX,
  STEP_DOWN_MAX,
  groundHeightAt,
  stepZoneAt,
  isStandable,
  CREATOR_ARCH_PILLARS,
  cameraPointFree,
  pullInCamera,
  pointInRect,
  HALL_ROOM_ID,
  MUSIC_HALL_ID,
  GAME_ROOMS_ID,
  CREATE_WING_ID,
  COURTYARD_ID,
  HEIGHTS_ID,
  TREASURY_ID,
  ROYAL_COURT_ID,
  BRANDING_ATELIER_ID,
  isWalkable,
  roomAt,
  resolvePalaceMove,
  clampToRoom,
} from "./palace-layout";
import { DISTRICT_THRESHOLDS } from "./district-gates";

describe("the hall is unmoved", () => {
  it("keeps its long-standing walk bounds and camera clamp", () => {
    expect(PALACE_LAYOUT[HALL_ROOM_ID]!.walk).toEqual({ minX: -13.1, maxX: 13.1, minZ: -11.6, maxZ: 11.1 });
    expect(PALACE_LAYOUT[HALL_ROOM_ID]!.camClamp).toEqual({
      minX: -13.7,
      maxX: 13.7,
      minZ: -17.7,
      maxZ: 11.75,
    });
  });

  it("has the four first-ring rooms, each reachable by exactly one door", () => {
    for (const id of [MUSIC_HALL_ID, GAME_ROOMS_ID, CREATE_WING_ID, COURTYARD_ID]) {
      expect(PALACE_LAYOUT[id]).toBeDefined();
      expect(PALACE_DOORS.filter((d) => d.roomId === id)).toHaveLength(1);
    }
  });
});

describe("walkability", () => {
  it("room floors and doorways are walkable; walls are not", () => {
    expect(isWalkable(0, 0)).toBe(true); // hall floor
    expect(isWalkable(-20, -2)).toBe(true); // music hall floor
    expect(isWalkable(-14.2, -2)).toBe(true); // inside the music doorway
    expect(isWalkable(-14.2, 1)).toBe(false); // the west wall, away from doors
    expect(isWalkable(-20, 3.3)).toBe(false); // the music/game shared wall
    expect(isWalkable(0, 24)).toBe(true); // courtyard, on the path south of the monument
    expect(isWalkable(0, -15)).toBe(false); // the stage is not floor
  });

  it("every door's portal touches both rooms it joins", () => {
    for (const door of PALACE_DOORS) {
      const mid = {
        x: (door.portal.minX + door.portal.maxX) / 2,
        z: (door.portal.minZ + door.portal.maxZ) / 2,
      };
      expect(isWalkable(mid.x, mid.z)).toBe(true);
      expect(roomAt(mid.x, mid.z, HALL_ROOM_ID)).toBe(
        (door.axis === "x" ? mid.x : mid.z) < door.plane ? door.negRoom : door.posRoom,
      );
      // The destination room's spawn stands on its own floor.
      const spawn = PALACE_LAYOUT[door.roomId]!.spawn;
      expect(roomAt(spawn.x, spawn.z, HALL_ROOM_ID)).toBe(door.roomId);
    }
  });
});

describe("crossings", () => {
  it("walking west through the music door flips membership at the plane", () => {
    const before = resolvePalaceMove({ x: -13.6, z: -2, room: HALL_ROOM_ID }, -14.0, -2);
    expect(before.room).toBe(HALL_ROOM_ID);
    expect(before.entered).toBeNull();
    const after = resolvePalaceMove({ x: -14.0, z: -2, room: HALL_ROOM_ID }, -14.35, -2);
    expect(after.room).toBe(MUSIC_HALL_ID);
    expect(after.entered).toBe(MUSIC_HALL_ID);
  });

  it("walking into the west wall away from a door goes nowhere", () => {
    const res = resolvePalaceMove({ x: -13.05, z: 1, room: HALL_ROOM_ID }, -14.3, 1);
    expect(res.x).toBe(-13.05);
    expect(res.entered).toBeNull();
  });

  it("a diagonal into a wall corner slides along the wall", () => {
    // North-west toward the wall at z=1 (solid): x is blocked, z is
    // free — the step keeps its z component instead of sticking.
    const res = resolvePalaceMove({ x: -13.05, z: 0.8, room: HALL_ROOM_ID }, -14.0, 0.2);
    expect(res.x).toBe(-13.05);
    expect(res.z).toBeCloseTo(0.2);
  });

  it("the back arch leads to the courtyard, and only through the arch", () => {
    const through = resolvePalaceMove({ x: 0, z: 11.05, room: HALL_ROOM_ID }, 0, 12.6);
    expect(through.room).toBe(COURTYARD_ID);
    expect(through.entered).toBe(COURTYARD_ID);
    const beside = resolvePalaceMove({ x: 6, z: 11.05, room: HALL_ROOM_ID }, 6, 12.6);
    expect(beside.entered).toBeNull();
    expect(beside.z).toBe(11.05);
  });

  it("no path crosses from the Music Hall into the Game Rooms — there is no door", () => {
    const res = resolvePalaceMove({ x: -20, z: 2.7, room: MUSIC_HALL_ID }, -20, 4.2);
    expect(res.room).toBe(MUSIC_HALL_ID);
    expect(res.z).toBe(2.7);
  });

  it("clamping lands inside the named room", () => {
    const p = clampToRoom(GAME_ROOMS_ID, 0, 0);
    expect(roomAt(p.x, p.z, HALL_ROOM_ID)).toBe(GAME_ROOMS_ID);
  });
});

describe("the King's Plaza (Open World Phase 1)", () => {
  it("the courtyard keeps its id and takes the plaza's name, grounds and spawn", () => {
    const plaza = PALACE_LAYOUT[COURTYARD_ID]!;
    expect(plaza.name).toBe("The King's Plaza");
    /* DELIBERATELY moved in item 36: the main walk rect ends at
     * the Creator Heights enclave's west wall face (x 13.15) —
     * the enclave stands on the north-east quadrant now — and
     * the north-east lane + south bridge lane ride as grounds,
     * keeping the Row and Ateliers gates reachable on foot. */
    expect(plaza.walk).toEqual({ minX: -27.85, maxX: 13.15, minZ: 12.55, maxZ: 25.7 });
    expect(plaza.grounds).toEqual([
      { minX: -27.85, maxX: 2.35, minZ: 25.6, maxZ: 33.6 },
      /* The south-east yard (item 34) — the enclosed floor east
       * of the Creator Room, walkable since the Ateliers batch:
       * the way to the Ateliers gate in the east wall. Its north
       * edge was DELIBERATELY trimmed in item 36 to start south
       * of the Heights enclave's south wall. */
      { minX: 16.6, maxX: 27.85, minZ: 25.9, maxZ: 33.6 },
      /* The arch spur (item 41) — added by Stage B cluster 4. */
      { minX: 2.35, maxX: 10.65, minZ: 25.6, maxZ: 26.0 },
      /* The north-east lane (item 36) — the plaza strip north
       * of the Heights enclave: the way to the Row gate. */
      { minX: 13.15, maxX: 27.85, minZ: 12.55, maxZ: 15.45 },
      /* The south bridge lane (item 36) — the plaza strip
       * between the enclave's south wall and the Creator Rooms
       * building, in two overlapping bands: the way to the
       * south-east yard. */
      { minX: 10.65, maxX: 13.3, minZ: 25.6, maxZ: 26.2 },
      { minX: 13.3, maxX: 16.75, minZ: 25.88, maxZ: 26.2 },
    ]);
    expect(plaza.spawn).toEqual({ x: 0, z: 31.5 });
  });

  it("the grounds are one room: east lawns, west lawns and the promenade all read plaza", () => {
    expect(isWalkable(-24, 20)).toBe(true); // west grounds
    /* DELIBERATELY moved in item 36: the old east-lawn point
     * (24, 20) stands inside the Creator Heights enclave now —
     * a residents'-court bench stands exactly there, solid like
     * every bench — and the enclave's open court beside it reads
     * HEIGHTS, not plaza. The plaza's own east ground is the
     * north-east lane and the south-east yard now. */
    expect(isWalkable(24, 20)).toBe(false); // the Heights bench
    expect(isWalkable(24, 17)).toBe(true); // the enclave's court edge
    expect(roomAt(24, 17, HALL_ROOM_ID)).toBe(HEIGHTS_ID);
    expect(isWalkable(-20, 30)).toBe(true); // the promenade
    expect(roomAt(-24, 20, HALL_ROOM_ID)).toBe(COURTYARD_ID);
    expect(roomAt(0, 31.5, HALL_ROOM_ID)).toBe(COURTYARD_ID);
    /* A walk from the promenade up to the palace doors never
     * crosses a room line — no doorway fires inside the grounds.
     * (The stroll's end stands south of the monument: the plinth
     * itself is solid since the overhaul — see the next test.) */
    const stroll = resolvePalaceMove({ x: 0, z: 31, room: COURTYARD_ID }, 0, 23.5);
    expect(stroll.room).toBe(COURTYARD_ID);
    expect(stroll.entered).toBeNull();
    expect(stroll.z).toBe(23.5);
  });

  it("the Kingdom Board monument: tiers climbable, the stele core solid (Stack-100 #2)", () => {
    /* Overhaul stage 3 made the whole footprint a blocked rect;
     * Stage C item 17 grew it. DELIBERATELY moved by Stack-100 #2
     * (the climbable-Y finish of item 38): the three plinth tiers
     * are step zones now — a walker climbs them tier by tier —
     * and only the stele/drum core stays solid. */
    expect(isWalkable(0, 19.7)).toBe(false); // the stele itself — still a wall
    expect(isStandable(0, 19.7)).toBe(false);
    expect(isWalkable(0, 21.4)).toBe(true); // the plinth's south edge — the tiers stand here now
    expect(groundHeightAt(0, 21.4)).toBe(0.48); // tier 2's apron (its square reaches z 21.45)
    /* Stage C item 17's pins stand: the board station point and a
     * reader's stance at the face are open plaza. */
    expect(isWalkable(0, 22.15)).toBe(true);
    expect(isWalkable(0, 22.6)).toBe(true);
    /* The climb, tier by tier (each rise ≤ STEP_UP_MAX)… */
    const t1 = resolvePalaceMove({ x: 0, z: 22.4, room: COURTYARD_ID }, 0, 21.6);
    expect(t1.z).toBe(21.6);
    expect(groundHeightAt(t1.x, t1.z)).toBe(0.24);
    const t2 = resolvePalaceMove({ x: 0, z: 21.6, room: COURTYARD_ID }, 0, 21.2);
    expect(t2.z).toBe(21.2);
    expect(groundHeightAt(t2.x, t2.z)).toBe(0.48);
    const t3 = resolvePalaceMove({ x: 0, z: 21.2, room: COURTYARD_ID }, 0, 20.9);
    expect(t3.z).toBe(20.9);
    expect(groundHeightAt(t3.x, t3.z)).toBe(0.7);
    /* …and the core stops the climb dead (the bonk). */
    const bonk = resolvePalaceMove({ x: 0, z: 20.9, room: COURTYARD_ID }, 0, 20.4);
    expect(bonk.x).toBe(0);
    expect(bonk.z).toBe(20.9);
    /* A diagonal step at the core's face slides along it like a wall. */
    const slide = resolvePalaceMove({ x: 0.5, z: 20.9, room: COURTYARD_ID }, -0.5, 20.4);
    expect(slide.x).toBe(-0.5);
    expect(slide.z).toBe(20.9);
    expect(slide.room).toBe(COURTYARD_ID);
  });

  it("the promenade stops at the creator wing's wall — the arch is the only way in", () => {
    /* East of the promenade's end (x > 2.35, z > 25.7) is the
     * creator rooms' ground: not plaza floor, and no step crosses
     * into the template except through its arch portal. */
    expect(isWalkable(6, 30)).toBe(false);
    const res = resolvePalaceMove({ x: 2, z: 30, room: COURTYARD_ID }, 6, 30);
    expect(res.room).toBe(COURTYARD_ID);
    expect(res.entered).toBeNull();
    expect(res.x).toBeLessThanOrEqual(2.35);
  });

  it("the facade is solid away from the arch, even with the grounds against it", () => {
    const beside = resolvePalaceMove({ x: -20, z: 13, room: COURTYARD_ID }, -20, 11.5);
    expect(beside.entered).toBeNull();
    expect(beside.room).toBe(COURTYARD_ID);
    expect(beside.z).toBe(13);
  });
});

describe("Stage B cluster 4 — plaza collision, enclosure, arch, camera (items 39/41/42/43/44)", () => {
  const plaza = PALACE_LAYOUT[COURTYARD_ID]!;
  const inBlocked = (x: number, z: number) => PLAZA_BLOCKED.some((b) => pointInRect(x, z, b));

  it("item 39: every plaza prop's centre is solid, and its footprint rect is in the blocked list", () => {
    for (const p of PLAZA_PLANTERS) {
      expect(isWalkable(p.x, p.z)).toBe(false);
      expect(PLAZA_BLOCKED).toContainEqual({
        minX: p.x - (p.alongZ ? 0.44 : 1.0),
        maxX: p.x + (p.alongZ ? 0.44 : 1.0),
        minZ: p.z - (p.alongZ ? 1.0 : 0.44),
        maxZ: p.z + (p.alongZ ? 1.0 : 0.44),
      });
    }
    for (const b of PLAZA_BRAZIERS) {
      expect(isWalkable(b.x, b.z)).toBe(false);
      expect(PLAZA_BLOCKED).toContainEqual({
        minX: b.x - 0.46, maxX: b.x + 0.46, minZ: b.z - 0.46, maxZ: b.z + 0.46,
      });
    }
    for (const c of PLAZA_COLUMNS) {
      expect(PLAZA_BLOCKED).toContainEqual({
        minX: c.x - 0.45, maxX: c.x + 0.45, minZ: c.z - 0.45, maxZ: c.z + 0.45,
      });
    }
    for (const gate of PLAZA_GATES) {
      if (gate.kind === "marker") {
        /* A marker is one post on a 0.78 m plinth — its footprint
         * is the plinth, not a gate span (item 37 reclassified the
         * four non-gap thresholds as markers at integration). */
        expect(PLAZA_BLOCKED).toContainEqual({
          minX: gate.x - 0.39, maxX: gate.x + 0.39, minZ: gate.z - 0.39, maxZ: gate.z + 0.39,
        });
        expect(inBlocked(gate.x, gate.z)).toBe(true);
        continue;
      }
      const postA = gate.axis === "x" ? { x: gate.x - 1.1, z: gate.z } : { x: gate.x, z: gate.z - 1.1 };
      const postB = gate.axis === "x" ? { x: gate.x + 1.1, z: gate.z } : { x: gate.x, z: gate.z + 1.1 };
      expect(inBlocked(postA.x, postA.z)).toBe(true);
      expect(inBlocked(postB.x, postB.z)).toBe(true);
      /* A CLOSED gate's centre is solid (posts + bar). An OPEN
       * gate's centre is the passage itself — DELIBERATELY moved
       * in item 31 for the Stage Grounds gate, whose district is
       * built: its centre must NOT be blocked. */
      if (gate.open) expect(inBlocked(gate.x, gate.z)).toBe(false);
      else expect(inBlocked(gate.x, gate.z)).toBe(true);
    }
    for (const p of CREATOR_ARCH_PILLARS) {
      expect(isWalkable(p.x, p.z)).toBe(false);
      expect(PLAZA_BLOCKED).toContainEqual({
        minX: p.x - 0.275, maxX: p.x + 0.275, minZ: p.z - 0.275, maxZ: p.z + 0.275,
      });
    }
    for (const run of PLAZA_WALL_RUNS) {
      expect(PLAZA_BLOCKED).toContainEqual({
        minX: run.x - run.w / 2, maxX: run.x + run.w / 2,
        minZ: run.z - run.d / 2, maxZ: run.z + run.d / 2,
      });
    }
    /* Stage C item 17 DELIBERATELY moved this pin (the monument
     * grew, its blocked rect grew to the 4.6 m square); Stack-100
     * #2 DELIBERATELY moved it again: the walker's blocked list
     * carries the stele/drum CORE (1.96 m square) — the tiers are
     * climbable zones — while the 4.6 m square survives as the
     * camera's footprint in PLAZA_TALL_BLOCKED (item 44's test). */
    expect(PLAZA_BLOCKED).toContainEqual(MONUMENT_CORE_BLOCKED);
    expect(PLAZA_BLOCKED).toContainEqual({ minX: -0.98, maxX: 0.98, minZ: 18.72, maxZ: 20.68 });
    expect(plaza.blocked).toBe(PLAZA_BLOCKED);
  });

  it("item 39: a step into a planter, a brazier or the freestanding gate stops or slides — never passes", () => {
    const planterBonk = resolvePalaceMove({ x: -26.4, z: 15.8, room: COURTYARD_ID }, -27.3, 15.8);
    expect(planterBonk.x).toBe(-26.4);
    expect(planterBonk.z).toBe(15.8);
    const brazierBonk = resolvePalaceMove({ x: -3.7, z: 18.6, room: COURTYARD_ID }, -4.6, 18.6);
    expect(brazierBonk.x).toBe(-3.7);
    /* DELIBERATELY moved by Stack-100 #2: this step used to bonk
     * — the samples south of the portal (z 23.6..23.75) stood in
     * a rect sliver no list claimed. The clipped east lawn's
     * strip physically runs to the wall face beside the gate's
     * real gap, so the throat is standing ground at grass height
     * now and the step crosses into the Heights, exactly like
     * the diagonal below. The gate's POSTS stay solid (the
     * postBonk at the end of this test). */
    const gateCross = resolvePalaceMove({ x: 13.5, z: 23.6, room: COURTYARD_ID }, 13.5, 24.6);
    expect(gateCross.z).toBe(24.6);
    expect(gateCross.entered).toBe(HEIGHTS_ID);
    /* DELIBERATELY moved in item 36: the freestanding marker at
     * (13.5, 24.6) is an OPEN gate now — the diagonal that used
     * to slide along the marker's plinth CROSSES through the
     * gate's portal into Creator Heights. The gate's POSTS stay
     * solid: a step aimed at the north post stops dead. */
    const gateSlide = resolvePalaceMove({ x: 12.9, z: 23.9, room: COURTYARD_ID }, 14.1, 24.9);
    expect(gateSlide.x).toBeCloseTo(14.1);
    expect(gateSlide.z).toBeCloseTo(24.9);
    expect(gateSlide.room).toBe(HEIGHTS_ID);
    expect(gateSlide.entered).toBe(HEIGHTS_ID);
    const postBonk = resolvePalaceMove({ x: 12.9, z: 23.6, room: COURTYARD_ID }, 13.5, 23.6);
    expect(postBonk.x).toBe(12.9);
    expect(postBonk.entered).toBeNull();
  });

  it("item 39: the plaza's working points stay walkable — spawn, paths, stations, the arch portal", () => {
    expect(isWalkable(0, 31.5)).toBe(true);
    expect(isWalkable(0, 22.6)).toBe(true);
    expect(isWalkable(0, 30)).toBe(true);
    expect(isWalkable(-20, 20)).toBe(true);
    expect(isWalkable(9.5, 25.8)).toBe(true);
    expect(isWalkable(8.4, 25.9)).toBe(true); // the forecourt's west edge — pillars don't narrow it
    expect(isWalkable(10.6, 25.9)).toBe(true); // the forecourt's east edge
  });

  it("item 41: the spur walks from the promenade to the arch, and the returns are solid", () => {
    expect(isWalkable(2.4, 25.8)).toBe(true);
    expect(isWalkable(5, 25.8)).toBe(true);
    expect(isWalkable(8.6, 25.8)).toBe(true); // the forecourt strip, clear of the west pillar's footprint
    const stroll = resolvePalaceMove({ x: 2.0, z: 25.8, room: COURTYARD_ID }, 7.2, 25.8);
    expect(stroll.x).toBeCloseTo(7.2);
    expect(stroll.room).toBe(COURTYARD_ID);
    expect(stroll.entered).toBeNull();
    // The flanking returns are solid. The west return baffles the
    // spur's straight line: the walk jogs around its north end
    // and enters the forecourt between the returns — every step
    // of the jog walkable, no step crossing a return.
    expect(isWalkable(7.55, 25.55)).toBe(false);
    expect(isWalkable(11.45, 25.55)).toBe(false);
    const bonk = resolvePalaceMove({ x: 7.2, z: 25.8, room: COURTYARD_ID }, 8.2, 25.8);
    expect(bonk.x).toBe(7.2);
    const north = resolvePalaceMove({ x: 7.2, z: 25.8, room: COURTYARD_ID }, 7.2, 24.9);
    expect(north.z).toBeCloseTo(24.9);
    const east = resolvePalaceMove({ x: 7.2, z: 24.9, room: COURTYARD_ID }, 9.5, 24.9);
    expect(east.x).toBeCloseTo(9.5);
    const south = resolvePalaceMove({ x: 9.5, z: 24.9, room: COURTYARD_ID }, 9.5, 25.8);
    expect(south.z).toBeCloseTo(25.8);
    expect(south.room).toBe(COURTYARD_ID);
    expect(isWalkable(5, 26.4)).toBe(false);
    expect(isWalkable(5, 30)).toBe(false);
  });

  it("item 42: the enclosure is complete — wall runs cover every side of the walkable bounds", () => {
    const west = PLAZA_WALL_RUNS.filter((r) => r.x === -28.2 && r.w === 0.35).sort((a, b) => a.z - b.z);
    expect(west[0]!.z - west[0]!.d / 2).toBeCloseTo(12.4);
    expect(west[west.length - 1]!.z + west[west.length - 1]!.d / 2).toBeCloseTo(34.0);
    const westGap = (west[1]!.z - west[1]!.d / 2) - (west[0]!.z + west[0]!.d / 2);
    expect(westGap).toBeCloseTo(2.2); // the Stage Grounds gate gap — a true passage since item 31
    const east = PLAZA_WALL_RUNS.filter((r) => r.x === 28.2 && r.w === 0.35).sort((a, b) => a.z - b.z);
    expect(east[0]!.z - east[0]!.d / 2).toBeCloseTo(12.4);
    expect(east[east.length - 1]!.z + east[east.length - 1]!.d / 2).toBeCloseTo(34.0);
    /* DELIBERATELY moved in item 33: the east wall is no longer
     * continuous — the Creation Row gate gap (z 13.4..15.6, a
     * true passage) pierces it between the first two runs,
     * exactly the west wall's Stage Grounds pattern.
     * DELIBERATELY moved again in item 34: a second gap — the
     * Ateliers gate (z 29.4..31.6, a true passage) — pierces
     * the south run. Between and around the two gaps the runs
     * stay continuous to z 34. */
    const eastGap = (east[1]!.z - east[1]!.d / 2) - (east[0]!.z + east[0]!.d / 2);
    expect(eastGap).toBeCloseTo(2.2); // the Creation Row gate gap — a true passage since item 33
    const eastGaps: number[] = [];
    for (let i = 1; i < east.length; i++) {
      const gap = (east[i]!.z - east[i]!.d / 2) - (east[i - 1]!.z + east[i - 1]!.d / 2);
      if (gap > 1e-9) eastGaps.push(gap);
    }
    expect(eastGaps).toHaveLength(2);
    for (const gap of eastGaps) expect(gap).toBeCloseTo(2.2);
    const south = PLAZA_WALL_RUNS.filter((r) => r.z === 34.0 && r.d === 0.35);
    /* DELIBERATELY moved in item 32: no single run spans
     * −28.2..−1.1 any more — the Listening Gardens gate gap
     * (x −27.1..−24.9, a true passage) pierces that stretch.
     * The wall now covers it as two runs flanking the gap, and
     * the gap is exactly the gate's 2.2 m. */
    expect(south.some((r) => r.x - r.w / 2 <= -28.2 + 1e-9 && r.x + r.w / 2 >= -27.1 - 1e-9)).toBe(true);
    expect(south.some((r) => r.x - r.w / 2 <= -24.9 + 1e-9 && r.x + r.w / 2 >= -1.1 - 1e-9)).toBe(true);
    const gardensRunWest = south.filter((r) => r.x + r.w / 2 <= -24.9).sort((a, b) => a.x - b.x).pop()!;
    const gardensRunEast = south.filter((r) => r.x - r.w / 2 >= -27.1).sort((a, b) => a.x - b.x)[0]!;
    expect((gardensRunEast.x - gardensRunEast.w / 2) - (gardensRunWest.x + gardensRunWest.w / 2)).toBeCloseTo(2.2);
    expect(south.some((r) => r.x - r.w / 2 <= 16.6 + 1e-9 && r.x + r.w / 2 >= 28.2 - 1e-9)).toBe(true);
    /* DELIBERATELY moved in item 34: the notch wall that stood
     * at z 26.05 is gone — it hid the invisible boundary of the
     * then-unwalkable south-east yard, and the yard is walkable
     * plaza ground now (see the agreement test below). */
    expect(PLAZA_WALL_RUNS).not.toContainEqual({ w: 11.8, d: 0.35, x: 22.3, z: 26.05 });
  });

  it("item 42: visible wall and walk clamp agree — no invisible wall, no see-through gap", () => {
    /* DELIBERATELY moved in item 36: (24, 25.5) stands against
     * the Creator Heights enclave's south wall now — the wall's
     * face band, not floor. The wall is a real blocked run (in
     * the Heights' list), so the clamp still agrees with the
     * visible wall; the yard beyond is reached by the south
     * bridge lane, pinned end to end in creator-heights.test. */
    expect(isWalkable(24, 25.5)).toBe(false);
    /* DELIBERATELY moved in item 34: the south-east yard is
     * walkable plaza ground now — the way to the Ateliers gate —
     * so the old notch line and the yard beyond it both walk,
     * and a step south off the main grounds lands in the yard.
     * The yard's own edges stay real walls: south and east
     * (beside the gate) are solid, and the gate line itself is
     * the one true passage east. */
    expect(isWalkable(24, 26.05)).toBe(true);
    expect(isWalkable(24, 30)).toBe(true);
    expect(isWalkable(24, 33.9)).toBe(false);
    expect(isWalkable(28.2, 33.5)).toBe(false);
    /* DELIBERATELY moved in item 36: the straight step south
     * from the old main-grounds line now meets the Heights
     * enclave's south wall and stops at it — the yard is
     * reached around the enclave, by the bridge lane. */
    const res = resolvePalaceMove({ x: 24, z: 25.2, room: HEIGHTS_ID }, 24, 26.4);
    expect(res.z).toBe(25.2);
    expect(res.room).toBe(HEIGHTS_ID);
    /* DELIBERATELY moved in item 31: (−28.0, 19.5) stands in the
     * Stage Grounds gate's portal — the gap is a true passage
     * now, so the point IS walkable. The wall beside the gate
     * stays solid.
     * DELIBERATELY moved in item 35: (0, 33.9) stands in the
     * Boardwalk gate's portal — its barred gap is a true passage
     * now too, so the point IS walkable; the Boardwalk suite
     * pins the passage end to end. */
    expect(isWalkable(-28.0, 19.5)).toBe(true);
    expect(isWalkable(-28.2, 16.0)).toBe(false);
    expect(isWalkable(0, 33.9)).toBe(true);
  });

  it("item 44: the camera collides with tall props only — pull-in stops clear of the monument", () => {
    /* Every camera-tall rect is also walker-blocked — with ONE
     * deliberate exception since Stack-100 #2: the monument's
     * full footprint stays camera-tall (the stele reaches ~5.4 m
     * over climbable tiers), while walkers block only on its
     * core. The camera law itself is untouched: it reads
     * camBlocked, never the walker's list. */
    const MONUMENT_FOOTPRINT = { minX: -2.3, maxX: 2.3, minZ: 17.4, maxZ: 22.0 };
    expect(PLAZA_TALL_BLOCKED).toContainEqual(MONUMENT_FOOTPRINT);
    for (const b of PLAZA_TALL_BLOCKED) {
      if (b.minX === MONUMENT_FOOTPRINT.minX && b.minZ === MONUMENT_FOOTPRINT.minZ) continue;
      expect(PLAZA_BLOCKED).toContainEqual(b);
    }
    expect(cameraPointFree(COURTYARD_ID, -4.6, 18.6)).toBe(true);
    expect(cameraPointFree(COURTYARD_ID, -27.3, 15.8)).toBe(true);
    expect(cameraPointFree(COURTYARD_ID, 0, 19.7)).toBe(false);
    expect(cameraPointFree(COURTYARD_ID, 0, 27)).toBe(true);
    expect(pullInCamera(COURTYARD_ID, { x: 0, z: 31.5 }, { x: 0, z: 27 })).toEqual({ x: 0, z: 27 });
    const pulled = pullInCamera(COURTYARD_ID, { x: 0, z: 23.5 }, { x: 0, z: 17 });
    expect(pulled.z).toBeGreaterThan(21.55 + 0.3 - 0.11);
    expect(pulled.z).toBeLessThan(23.5);
    expect(cameraPointFree(COURTYARD_ID, pulled.x, pulled.z)).toBe(true);
    expect(cameraPointFree(COURTYARD_ID, 0, 40)).toBe(false);
  });
});

describe("gate data agreement — layout (collision) vs district-gates (scene build)", () => {
  it("PLAZA_GATES and DISTRICT_THRESHOLDS name the same six thresholds at the same spots with the same kinds", () => {
    expect(PLAZA_GATES).toHaveLength(DISTRICT_THRESHOLDS.length);
    for (const t of DISTRICT_THRESHOLDS) {
      const g = PLAZA_GATES.find((p) => p.name === t.name);
      expect(g, `layout is missing ${t.name}`).toBeDefined();
      expect({ x: g!.x, z: g!.z, kind: g!.kind }).toEqual({ x: t.x, z: t.z, kind: t.kind });
      /* And the same openness (item 31): the scene's gate build
       * and the layout's collision must never disagree about
       * whether a gate is a passage. */
      expect(g!.open ?? false, t.name).toBe(t.open ?? false);
    }
  });
});

describe("the second ring (palace follow-on)", () => {
  it("adds the Treasury, the Royal Court Chamber and the Branding Atelier, one door each", () => {
    for (const id of [TREASURY_ID, ROYAL_COURT_ID, BRANDING_ATELIER_ID]) {
      expect(PALACE_LAYOUT[id]).toBeDefined();
      expect(PALACE_DOORS.filter((d) => d.roomId === id)).toHaveLength(1);
    }
    /* Fourteen since item 36 added the Creator Heights district
     * room (thirteen was item 35's Boardwalk count). */
    expect(Object.keys(PALACE_LAYOUT)).toHaveLength(14);
  });

  it("the front doors open beside the stage, never through it", () => {
    // The stage spans |x| ≤ 11 — the front-door aprons (|x| 13..14.4)
    // are audience floor, and the stage itself stays unwalkable.
    expect(isWalkable(-13.6, -13.5)).toBe(true);
    expect(isWalkable(13.6, -13.5)).toBe(true);
    expect(isWalkable(0, -13.5)).toBe(false);
    // The front walls are solid away from the doors.
    expect(isWalkable(-14.2, -10.5)).toBe(false);
    expect(isWalkable(14.2, -17)).toBe(false);
  });

  it("crossings flip at each new door's plane", () => {
    const toTreasury = resolvePalaceMove({ x: -14.0, z: -13.5, room: HALL_ROOM_ID }, -14.35, -13.5);
    expect(toTreasury.room).toBe(TREASURY_ID);
    expect(toTreasury.entered).toBe(TREASURY_ID);
    const backAgain = resolvePalaceMove({ x: -14.35, z: -13.5, room: TREASURY_ID }, -13.6, -13.5);
    expect(backAgain.room).toBe(HALL_ROOM_ID);
    expect(backAgain.entered).toBe(HALL_ROOM_ID);

    const toCourt = resolvePalaceMove({ x: 14.0, z: -13.5, room: HALL_ROOM_ID }, 14.35, -13.5);
    expect(toCourt.room).toBe(ROYAL_COURT_ID);
    expect(toCourt.entered).toBe(ROYAL_COURT_ID);

    const toBranding = resolvePalaceMove({ x: 14.0, z: 5, room: HALL_ROOM_ID }, 14.35, 5);
    expect(toBranding.room).toBe(BRANDING_ATELIER_ID);
    expect(toBranding.entered).toBe(BRANDING_ATELIER_ID);
  });

  it("the front wall refuses crossings away from the front doors", () => {
    const res = resolvePalaceMove({ x: -13.05, z: -10.5, room: HALL_ROOM_ID }, -14.3, -10.5);
    expect(res.x).toBe(-13.05);
    expect(res.entered).toBeNull();
  });

  it("no path crosses between the Treasury and the Music Hall — the shared wall has no door", () => {
    const res = resolvePalaceMove({ x: -20, z: -9.7, room: TREASURY_ID }, -20, -8.0);
    expect(res.room).toBe(TREASURY_ID);
    expect(res.z).toBe(-9.7);
    // And the band between the two rooms is wall, not floor.
    expect(isWalkable(-20, -9.0)).toBe(false);
  });

  it("no path crosses between the Royal Court Chamber and the Create Wing", () => {
    const res = resolvePalaceMove({ x: 20, z: -9.7, room: ROYAL_COURT_ID }, 20, -8.0);
    expect(res.room).toBe(ROYAL_COURT_ID);
    expect(res.z).toBe(-9.7);
  });
});

describe("climbable Y — step zones and height-gated movement (Stack-100 #2, items 49/50/55)", () => {
  it("the zone inventory matches the server's mirrored table, count for count", () => {
    /* api-server world-palace.ts carries exactly these zones as
     * its plaza grounds table (19 rects) — pinned there too. */
    expect(LAWN_ZONES).toHaveLength(2);
    expect(HALL_STEP_ZONES).toHaveLength(8);
    expect(TERRACE_ZONES).toHaveLength(6);
    expect(MONUMENT_STEPS).toHaveLength(3);
    expect(PLAZA_STEPS).toHaveLength(19);
    expect(BOARDWALK_STEPS).toHaveLength(3); // main deck + both north strips
    expect(STEP_UP_MAX).toBe(0.4);
    expect(STEP_DOWN_MAX).toBe(0.4);
  });

  it("lawns stand at grass height — the east lawn only where it is actually built", () => {
    expect(groundHeightAt(-16.75, 19.2)).toBe(0.05); // west lawn heart
    expect(groundHeightAt(10.0, 19.2)).toBe(0.05); // the clipped east strip
    expect(LAWN_ZONES.map((z) => z.rect)).toContainEqual({
      minX: 6.5, maxX: 13.5, minZ: 13.7, maxZ: 24.7,
    });
    /* East of the enclave wall (x > 13.5) is the Heights' own
     * ground at floor height — the lawn zone must not leak
     * through the wall (the gate-bonk regression). */
    expect(stepZoneAt(20, 19.2)).toBeNull();
    expect(groundHeightAt(20, 19.2)).toBe(0);
    expect(groundHeightAt(14.5, 24.0)).toBe(0);
    /* Nor may the zone call the wall's own footprint standable:
     * on the wall line north of the gate gap the Heights wall
     * run stands, and a solid from ANY room beats the zone. */
    expect(isStandable(13.5, 20.0)).toBe(false);
    expect(groundHeightAt(13.5, 20.0)).toBe(0);
    /* The gate throat itself stands on the lawn strip's end. */
    expect(groundHeightAt(13.5, 24.0)).toBe(0.05);
  });

  it("the hall steps climb tread by tread, and the platform's edge is one honest drop", () => {
    const climb: Array<[number, number]> = [
      [13.36, 0.12],
      [14.08, 0.24],
      [14.8, 0.36],
      [15.3, 0.36], // the platform (a plaza-life table set stands on its centre — pinned in palace-grounds.test)
    ];
    let from = { x: -3.85, z: 12.9, room: COURTYARD_ID };
    for (const [z, topY] of climb) {
      const res = resolvePalaceMove(from, -3.85, z);
      expect(res.z).toBe(z);
      expect(groundHeightAt(res.x, res.z)).toBe(topY);
      from = { x: res.x, z: res.z, room: res.room };
    }
    /* Off the platform's side: a single 0.36 drop — within
     * STEP_DOWN_MAX, so the step lands on the plaza floor. */
    const off = resolvePalaceMove({ x: -3.85, z: 15.3, room: COURTYARD_ID }, -1.5, 15.3);
    expect(off.x).toBe(-1.5);
    expect(groundHeightAt(off.x, off.z)).toBe(0);
  });

  it("terraces climb by their tiers; the top tier's side refuses like a wall (item 55)", () => {
    /* The climb runs along the west mass's north reach (z 14.2):
     * a planter stands on tier 1 at the mass's centre (z ~15.8)
     * and its footprint is solid there — pinned in
     * palace-grounds.test. */
    const tiers: Array<[number, number]> = [
      [-26.37, 0.3],
      [-27.1, 0.62],
      [-27.83, 0.95],
    ];
    let from = { x: -25.5, z: 14.2, room: COURTYARD_ID };
    for (const [x, topY] of tiers) {
      const res = resolvePalaceMove(from, x, 14.2);
      expect(res.x).toBe(x);
      expect(groundHeightAt(res.x, res.z)).toBe(topY);
      from = { x: res.x, z: res.z, room: res.room };
    }
    /* Off the top tier's south side is a 0.95 m drop — beyond
     * STEP_DOWN_MAX: no void fall, no teleport pop; the step is
     * refused whole, exactly like a wall. */
    const leap = resolvePalaceMove({ x: -27.83, z: 16.4, room: COURTYARD_ID }, -27.83, 17.2);
    expect(leap.x).toBe(-27.83);
    expect(leap.z).toBe(16.4);
    /* And back down is by the tiers, one honest drop at a time. */
    const down = resolvePalaceMove({ x: -27.83, z: 14.2, room: COURTYARD_ID }, -27.1, 14.2);
    expect(down.x).toBe(-27.1);
    expect(groundHeightAt(down.x, down.z)).toBe(0.62);
  });

  it("district lawns and the Boardwalk deck carry their authored heights", () => {
    /* Off-centre probes: the audience lawn's centre carries a
     * bench row and the parterre's centre its rill — both solid
     * there (a solid inside a zone always wins). */
    expect(groundHeightAt(-45.0, 19.0)).toBe(0.05); // Stage Grounds audience lawn
    expect(groundHeightAt(-32.0, 43.0)).toBe(0.05); // Listening Gardens parterre lawn
    expect(groundHeightAt(0, 40.0)).toBe(0.03); // Boardwalk main deck
    expect(groundHeightAt(0, 36.2)).toBe(0.03); // Boardwalk entry strip (its spawn)
    expect(groundHeightAt(0, 31.5)).toBe(0); // the plaza promenade stays floor-flat
    expect(groundHeightAt(0, 0)).toBe(0); // the hall floor
  });
});
