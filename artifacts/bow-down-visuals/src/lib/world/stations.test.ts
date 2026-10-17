/**
 * The palace's doors (lib/world/stations) — the access layer's
 * registry. Pure data + proximity, pinned:
 * - every room of the palace has at least one door-station, and
 *   every station stands in a real room, ON that room's walkable
 *   floor (a prompt you can never reach is a broken promise);
 * - station ids are unique and every station carries a name, a
 *   one-line pitch, and a panel target;
 * - the brief's named doors all exist: the Front Row gallery, the
 *   Treasury's three rails (Daily Drop / Shark Drops / quests),
 *   the jukebox, the arcade cabinets + the marble table, the
 *   Create Wing desks (editor as the step-through, My Studio at
 *   the entrance), the Branding Atelier's three desks, and the
 *   Courtyard's four shopfronts;
 * - the prompt is proximity-honest: standing on a station offers
 *   THAT station, the nearest wins in an overlap, and open floor
 *   offers nothing.
 */
import { describe, it, expect } from "vitest";
import { PALACE_STATIONS, STATION_BY_ID, stationsInRoom, nearestStation } from "./stations";
import { PALACE_LAYOUT, isWalkable } from "./palace-layout";

describe("the station registry", () => {
  it("every room has at least one station; every station stands on its room's floor", () => {
    for (const roomId of Object.keys(PALACE_LAYOUT)) {
      expect(stationsInRoom(roomId).length, roomId).toBeGreaterThan(0);
    }
    for (const s of PALACE_STATIONS) {
      const layout = PALACE_LAYOUT[s.roomId];
      expect(layout, s.id).toBeDefined();
      expect(isWalkable(s.x, s.z), s.id).toBe(true);
      expect(s.x, s.id).toBeGreaterThanOrEqual(layout!.walk.minX);
      expect(s.x, s.id).toBeLessThanOrEqual(layout!.walk.maxX);
      expect(s.z, s.id).toBeGreaterThanOrEqual(layout!.walk.minZ);
      expect(s.z, s.id).toBeLessThanOrEqual(layout!.walk.maxZ);
    }
  });

  it("ids are unique; every station is fully dressed (name, pitch, panel)", () => {
    expect(new Set(PALACE_STATIONS.map((s) => s.id)).size).toBe(PALACE_STATIONS.length);
    for (const s of PALACE_STATIONS) {
      expect(s.name.length, s.id).toBeGreaterThan(0);
      expect(s.tagline.length, s.id).toBeGreaterThan(10);
      if (s.panel.kind === "custom") expect(s.panel.id.length, s.id).toBeGreaterThan(0);
      else expect(s.panel.path.startsWith("/"), s.id).toBe(true);
      expect(STATION_BY_ID.get(s.id)).toBe(s);
    }
  });

  it("the brief's named doors exist, in their rooms, with their panel kinds", () => {
    const byId = (id: string) => STATION_BY_ID.get(id)!;
    expect(byId("front-row-gallery").panel).toEqual({ kind: "custom", id: "front-row" });
    expect(byId("front-row-gallery").roomId).toBe("world:royal-court");
    for (const id of ["daily-drop", "shark-drops", "quest-board"]) {
      expect(byId(id).roomId).toBe("world:treasury");
      expect(byId(id).panel.kind).toBe("custom");
      expect(byId(id).membersOnly).toBe(true);
    }
    expect(byId("jukebox").roomId).toBe("world:music-hall");
    expect(byId("jukebox").panel).toEqual({ kind: "custom", id: "jukebox" });
    expect(byId("arcade-cabinets").panel).toEqual({ kind: "page", path: "/arcade" });
    expect(byId("marble-table").panel).toEqual({ kind: "page", path: "/party" });
    expect(byId("visual-vibes-editor").panel).toEqual({ kind: "stepthrough", path: "/video-editor" });
    expect(byId("my-studio").roomId).toBe("world:create-wing");
    expect(byId("song-desk").panel).toEqual({ kind: "page", path: "/create?panel=song" });
    expect(byId("branding-kit-desk").panel).toEqual({ kind: "page", path: "/branding-kit" });
    expect(byId("branding-shop-desk").panel).toEqual({ kind: "page", path: "/branding-kit?tab=shop" });
    expect(byId("press-kit-desk").panel).toEqual({ kind: "page", path: "/press-kit" });
    expect(byId("marketplace").panel).toEqual({ kind: "page", path: "/storefronts" });
    expect(byId("community-hall").panel).toEqual({ kind: "page", path: "/community" });
    expect(byId("promote-room").panel).toEqual({ kind: "page", path: "/promote" });
    expect(byId("get-paid-room").panel).toEqual({ kind: "page", path: "/earnings" });
  });

  it("exactly one station is a step-through — the editor", () => {
    const stepthroughs = PALACE_STATIONS.filter((s) => s.panel.kind === "stepthrough");
    expect(stepthroughs.map((s) => s.id)).toEqual(["visual-vibes-editor"]);
  });
});

describe("the walk-up prompt", () => {
  it("standing on a station offers that station", () => {
    for (const s of PALACE_STATIONS) {
      expect(nearestStation(s.roomId, s.x, s.z)?.id).toBe(s.id);
    }
  });

  it("open floor offers nothing — prompts are earned by walking up", () => {
    expect(nearestStation("world:kings-hall", 0, 0)).toBeNull();
    expect(nearestStation("world:music-hall", -21, -2)).toBeNull();
    expect(nearestStation("world:courtyard", 0, 18)).toBeNull();
  });

  it("the nearest wins where two prompts overlap", () => {
    // The Treasury's counters stand in a row; midway between the
    // Daily Drop and Shark Drops, the closer one speaks.
    expect(nearestStation("world:treasury", -23.4, -16.9)?.id).toBe("daily-drop");
    expect(nearestStation("world:treasury", -22.6, -16.9)?.id).toBe("shark-drops");
  });

  it("a station never calls across a doorway", () => {
    // Just inside the hall, by the Music Hall door: the jukebox
    // (through the wall, ~7m away in its own room) stays silent.
    expect(nearestStation("world:kings-hall", -13.0, -2)).toBeNull();
  });
});
