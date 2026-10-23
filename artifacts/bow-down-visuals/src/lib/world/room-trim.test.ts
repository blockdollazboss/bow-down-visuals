/**
 * Room trim identity (Stack-100 #2 item 41) — pinned: every wing
 * room used to wear the identical trim line; now each room's
 * profile derives deterministically from its own id.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { HOUSE_TRIM, roomTrimProfile } from "./room-trim";
import {
  BRANDING_ATELIER_ID,
  CREATE_WING_ID,
  GAME_ROOMS_ID,
  MUSIC_HALL_ID,
  ROYAL_COURT_ID,
  TREASURY_ID,
} from "./palace-layout";

const sceneSrc = readFileSync(new URL("./hall-scene.ts", import.meta.url), "utf8");

const WING_ROOMS = [MUSIC_HALL_ID, GAME_ROOMS_ID, CREATE_WING_ID, TREASURY_ID, ROYAL_COURT_ID, BRANDING_ATELIER_ID];

describe("room trim identity (item 41)", () => {
  it("is deterministic per room and the house default is the hall's historic line", () => {
    for (const id of WING_ROOMS) expect(roomTrimProfile(id)).toEqual(roomTrimProfile(id));
    expect(HOUSE_TRIM).toEqual({ y: 5.7, double: false, dark: false });
  });

  it("the six wing rooms do not all wear one trim — at least three distinct profiles", () => {
    const keys = new Set(WING_ROOMS.map((id) => JSON.stringify(roomTrimProfile(id))));
    expect(keys.size).toBeGreaterThanOrEqual(3);
  });

  it("every profile fits the room: above the door head, inside the 6.5 m wall", () => {
    for (const id of WING_ROOMS) {
      const p = roomTrimProfile(id);
      expect(p.y).toBeGreaterThan(3.6);
      expect(p.y).toBeLessThan(6.5);
      if (p.double) expect(p.y - 0.18).toBeGreaterThan(3.6);
    }
  });

  it("the indoor shells build with their room's profile; the hall keeps the default parameter", () => {
    expect(sceneSrc).toContain("roomTrimProfile(roomId)");
    expect(sceneSrc).toContain("trimProfile: RoomTrimProfile = HOUSE_TRIM");
  });
});
