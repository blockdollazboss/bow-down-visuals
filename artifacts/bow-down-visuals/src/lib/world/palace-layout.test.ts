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
  HALL_ROOM_ID,
  MUSIC_HALL_ID,
  GAME_ROOMS_ID,
  CREATE_WING_ID,
  COURTYARD_ID,
  TREASURY_ID,
  ROYAL_COURT_ID,
  BRANDING_ATELIER_ID,
  isWalkable,
  roomAt,
  resolvePalaceMove,
  clampToRoom,
} from "./palace-layout";

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
    expect(plaza.walk).toEqual({ minX: -27.85, maxX: 27.85, minZ: 12.55, maxZ: 25.7 });
    expect(plaza.grounds).toEqual([{ minX: -27.85, maxX: 2.35, minZ: 25.6, maxZ: 33.6 }]);
    expect(plaza.spawn).toEqual({ x: 0, z: 31.5 });
  });

  it("the grounds are one room: east lawns, west lawns and the promenade all read plaza", () => {
    expect(isWalkable(-24, 20)).toBe(true); // west grounds
    expect(isWalkable(24, 20)).toBe(true); // east grounds
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

  it("the Kingdom Board monument is solid — no walking through the plinth", () => {
    /* Overhaul stage 3 (clipping fix): the monument's footprint is
     * a blocked rect in the plaza's layout. */
    expect(isWalkable(0, 19.7)).toBe(false); // the stele itself
    expect(isWalkable(0, 21.4)).toBe(false); // the plinth's south edge — solid too
    expect(isWalkable(0, 21.7)).toBe(true); // a walker's stance at the face — prompt radius reaches
    expect(isWalkable(0, 22.6)).toBe(true); // the board station point stands on open plaza
    /* A step aimed into the plinth stops dead (the bonk)… */
    const bonk = resolvePalaceMove({ x: 0, z: 21.9, room: COURTYARD_ID }, 0, 21.3);
    expect(bonk.x).toBe(0);
    expect(bonk.z).toBe(21.9);
    /* …and a diagonal step slides along its face like a wall. */
    const slide = resolvePalaceMove({ x: 0.5, z: 22.5, room: COURTYARD_ID }, -0.5, 21.2);
    expect(slide.x).toBe(-0.5);
    expect(slide.z).toBe(22.5);
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

describe("the second ring (palace follow-on)", () => {
  it("adds the Treasury, the Royal Court Chamber and the Branding Atelier, one door each", () => {
    for (const id of [TREASURY_ID, ROYAL_COURT_ID, BRANDING_ATELIER_ID]) {
      expect(PALACE_LAYOUT[id]).toBeDefined();
      expect(PALACE_DOORS.filter((d) => d.roomId === id)).toHaveLength(1);
    }
    expect(Object.keys(PALACE_LAYOUT)).toHaveLength(8);
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
