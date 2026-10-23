/**
 * The palace's doors (lib/world/stations) — registry v2. Pure data
 * + proximity, pinned:
 * - every room of the palace has at least one door-station, and
 *   every station stands in a real room, ON that room's walkable
 *   floor (a prompt you can never reach is a broken promise);
 * - station ids are unique and every station carries a name, a
 *   one-line pitch, and a panel target;
 * - REGISTRY V2 (NATIVE-PLAN §3.0): panel kinds are exactly
 *   { native, custom, stepthrough } — "page" is retired, zero
 *   stations auto-open a website page. The 20 former pull-ups are
 *   native with the plan's pattern each; the six customs and the
 *   editor step-through are byte-for-byte what they were;
 * - every station's transfer target (`websitePath`) is the EXACT
 *   string it used to auto-open, deep links included — the full
 *   per-station table is asserted below. Customs carry null (they
 *   never auto-opened a page);
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

  it("ids are unique; every station is fully dressed (name, pitch, panel, transfer)", () => {
    expect(new Set(PALACE_STATIONS.map((s) => s.id)).size).toBe(PALACE_STATIONS.length);
    /* 34 since item 31 (the Stage Grounds' Stage Bill),
     * Stack-100 #61 (the Treasury's Visual Buc Packs desk) and
     * Stack-100 #65 (the Music Hall's Beat Marketplace). */
    expect(PALACE_STATIONS.length).toBe(34);
    for (const s of PALACE_STATIONS) {
      expect(s.name.length, s.id).toBeGreaterThan(0);
      expect(s.tagline.length, s.id).toBeGreaterThan(10);
      if (s.panel.kind === "custom") expect(s.panel.id.length, s.id).toBeGreaterThan(0);
      if (s.panel.kind === "stepthrough") expect(s.panel.path.startsWith("/"), s.id).toBe(true);
      if (s.panel.kind === "native") {
        // A native station MUST carry its transfer target — the
        // footer's href is the exact page it used to auto-open.
        expect(s.websitePath, s.id).not.toBeNull();
        expect(s.websitePath!.startsWith("/"), s.id).toBe(true);
      }
      expect(STATION_BY_ID.get(s.id)).toBe(s);
    }
  });

  it('panel kinds are exactly { native, custom, stepthrough } — zero "page" (pin a)', () => {
    const kinds = new Set(PALACE_STATIONS.map((s) => s.panel.kind));
    expect(kinds).toEqual(new Set(["native", "custom", "stepthrough"]));
    for (const s of PALACE_STATIONS) {
      expect(["native", "custom", "stepthrough"], s.id).toContain(s.panel.kind);
      expect(s.panel.kind, s.id).not.toBe("page");
    }
    expect(PALACE_STATIONS.filter((s) => s.panel.kind === "native").length).toBe(20);
    /* Six original customs + the Creator Rooms arch (Ring 2, 3.5)
     * + the Season Marks Wall (Ring 4) + the Winners' Circle (2.24)
     * + the plaza monument's Kingdom Board (Open World Phase 1)
     * + the Stage Grounds' Stage Bill (item 31, on the same
     * Kingdom Board panel) + the Visual Buc Packs desk
     * (Stack-100 #61) + the Beat Marketplace (Stack-100 #65),
     * born world-native like the six — they never had a page. */
    expect(PALACE_STATIONS.filter((s) => s.panel.kind === "custom").length).toBe(13);
    expect(PALACE_STATIONS.filter((s) => s.panel.kind === "stepthrough").length).toBe(1);
  });

  it("each native station carries the plan's pattern (NATIVE-PLAN §3)", () => {
    const patterns: Record<string, string> = {
      "post-office": "social",
      "listening-booth": "shelf",
      "charts-desk": "board",
      "arcade-cabinets": "games",
      "marble-table": "games",
      "my-studio": "board",
      "song-desk": "create",
      "video-desk": "create",
      "song-video-desk": "create",
      "cover-art-desk": "create",
      "audio-desk": "create",
      "thumbnail-desk": "create",
      "crowns-desk": "shop",
      "branding-kit-desk": "business",
      "branding-shop-desk": "shop",
      "press-kit-desk": "business",
      marketplace: "shop",
      "community-hall": "social",
      "promote-room": "business",
      "get-paid-room": "board",
    };
    expect(Object.keys(patterns).length).toBe(20);
    for (const [id, pattern] of Object.entries(patterns)) {
      expect(STATION_BY_ID.get(id)!.panel, id).toEqual({ kind: "native", pattern });
    }
  });

  it("every station's transfer href is its exact former website path (pin c — the full table)", () => {
    const table: Record<string, string | null> = {
      "kingdom-board": null,
      "post-office": "/messages",
      jukebox: null,
      "listening-booth": "/my-music",
      "beats-desk": "/beats",
      "charts-desk": "/charts",
      "arcade-cabinets": "/arcade",
      "marble-table": "/party",
      "my-studio": "/dashboard",
      "visual-vibes-editor": "/video-editor",
      "song-desk": "/create?panel=song",
      "video-desk": "/create?panel=video",
      "song-video-desk": "/create?panel=song-video",
      "cover-art-desk": "/create?panel=coverart",
      "audio-desk": "/audio-studio",
      "thumbnail-desk": "/thumbnail-studio",
      "daily-drop": null,
      "shark-drops": null,
      "quest-board": null,
      "packs-desk": null,
      "front-row-gallery": null,
      "season-marks-wall": null,
      "crowns-desk": "/memberships",
      "winners-circle": null,
      "branding-kit-desk": "/branding-kit",
      "branding-shop-desk": "/branding-kit?tab=shop",
      "press-kit-desk": "/press-kit",
      "kingdom-board-plaza": null,
      marketplace: "/storefronts",
      "community-hall": "/community",
      "promote-room": "/promote",
      "get-paid-room": "/earnings",
      "creator-rooms": null,
      "stage-bill": null,
    };
    expect(Object.keys(table).length).toBe(PALACE_STATIONS.length);
    for (const s of PALACE_STATIONS) {
      expect(s.websitePath, s.id).toBe(table[s.id]);
    }
  });

  it("the six customs are unchanged — same ids, same rooms (pin d)", () => {
    const byId = (id: string) => STATION_BY_ID.get(id)!;
    expect(byId("kingdom-board").panel).toEqual({ kind: "custom", id: "kingdom-board" });
    expect(byId("jukebox").panel).toEqual({ kind: "custom", id: "jukebox" });
    expect(byId("jukebox").roomId).toBe("world:music-hall");
    expect(byId("front-row-gallery").panel).toEqual({ kind: "custom", id: "front-row" });
    expect(byId("front-row-gallery").roomId).toBe("world:royal-court");
    /* The Season Marks Wall (Ring 4): same chamber, open to
     * everyone — standings are public spectacle, guests included. */
    expect(byId("season-marks-wall").panel).toEqual({ kind: "custom", id: "season-marks" });
    expect(byId("season-marks-wall").roomId).toBe("world:royal-court");
    expect(byId("season-marks-wall").membersOnly).toBe(false);
    for (const [id, customId] of [
      ["daily-drop", "treasury-daily"],
      ["shark-drops", "treasury-shark"],
      ["quest-board", "treasury-quests"],
      ["packs-desk", "treasury-packs"],
    ] as const) {
      expect(byId(id).roomId).toBe("world:treasury");
      expect(byId(id).panel).toEqual({ kind: "custom", id: customId });
      expect(byId(id).membersOnly).toBe(true);
    }
  });

  it("exactly one station is a step-through — the editor, unchanged (pin d)", () => {
    const stepthroughs = PALACE_STATIONS.filter((s) => s.panel.kind === "stepthrough");
    expect(stepthroughs.map((s) => s.id)).toEqual(["visual-vibes-editor"]);
    expect(STATION_BY_ID.get("visual-vibes-editor")!.panel).toEqual({
      kind: "stepthrough",
      path: "/video-editor",
    });
  });

  it("the brief's named doors exist, in their rooms", () => {
    const byId = (id: string) => STATION_BY_ID.get(id)!;
    expect(byId("my-studio").roomId).toBe("world:create-wing");
    expect(byId("post-office").roomId).toBe("world:kings-hall");
    expect(byId("marketplace").roomId).toBe("world:courtyard");
    expect(byId("get-paid-room").roomId).toBe("world:courtyard");
  });

  it("the plaza monument carries the Kingdom Board too (Open World Phase 1)", () => {
    const hall = STATION_BY_ID.get("kingdom-board")!;
    const plaza = STATION_BY_ID.get("kingdom-board-plaza")!;
    expect(plaza.roomId).toBe("world:courtyard");
    expect(plaza.name).toBe(hall.name);
    /* The same panel id as the hall board — StationPanel dispatch
     * on the id hands both stations the identical live board. */
    expect(plaza.panel).toEqual(hall.panel);
    expect(plaza.panel).toEqual({ kind: "custom", id: "kingdom-board" });
    /* Guests may look, matching the hall board — and, like every
     * custom, it never had a website page to transfer to. */
    expect(plaza.membersOnly).toBe(false);
    expect(plaza.websitePath).toBe(hall.websitePath);
    /* The monument stands at (0, 19.7); the station point is on
     * the open plaza just south of its solid plinth (overhaul
     * stage 3), where a walker stands to read its face. */
    expect(plaza.x).toBe(0);
    expect(plaza.z).toBe(22.6);
    /* The plaza census: the monument board plus the colonnade
     * five, in registry order — nothing moved, nothing lost. */
    expect(stationsInRoom("world:courtyard").map((s) => s.id)).toEqual([
      "kingdom-board-plaza",
      "marketplace",
      "community-hall",
      "promote-room",
      "get-paid-room",
      "creator-rooms",
    ]);
    /* Standing at the station point south of the monument offers the board. */
    expect(nearestStation("world:courtyard", 0, 22.6)?.id).toBe("kingdom-board-plaza");
  });

  it("guests never reach the create desks — every create station is members-only (stack-20 round 2, #3/#4 gate)", () => {
    /* The publish rail and the jukebox chip live behind these
       doors; the gate is the registry flag the world enforces at
       walk-up, and it must stay on for all six desks — the two
       song desks (publish + chip) named explicitly. */
    const createStations = PALACE_STATIONS.filter(
      (s) => s.panel.kind === "native" && s.panel.pattern === "create",
    );
    expect(createStations.length).toBe(6);
    for (const s of createStations) expect(s.membersOnly, s.id).toBe(true);
    expect(STATION_BY_ID.get("song-desk")!.membersOnly).toBe(true);
    expect(STATION_BY_ID.get("song-video-desk")!.membersOnly).toBe(true);
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
