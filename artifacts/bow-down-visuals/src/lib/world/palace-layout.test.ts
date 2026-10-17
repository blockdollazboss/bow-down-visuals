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
    expect(isWalkable(0, 20)).toBe(true); // courtyard
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
