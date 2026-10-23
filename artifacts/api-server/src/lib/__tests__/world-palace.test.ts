/**
 * The palace (lib/world-palace) — multi-room presence protocol tests.
 *
 * Drives WorldPalace the way routes/world.ts does: fake sockets,
 * frames in through palace.handleFrame, frames out. Pinned contract:
 * - everyone enters through the hall; the welcome names the room;
 *   a palace.directory snapshot follows admission.
 * - room.enter transfers: the old room sees a despawn, the new room
 *   a join; the walker gets a fresh welcome for the new room with
 *   the SAME peerId, their character and voice flags carried.
 * - presence/voice are room-scoped: moves, chat and voice signals
 *   never cross a doorway; walking through one ends the voice
 *   session (the mesh is the room's).
 * - the stage lives in the hall only: rooms refuse stage frames.
 * - a full destination refuses with room.unavailable and the walker
 *   keeps their place — nobody is kicked out of the palace.
 * - the directory tracks every move (counts + names + hall LIVE).
 */
import { describe, it, expect } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldPalace, PALACE_ROOM_DEFS, WORLD_PLAZA_ROOM_ID } from "../world-palace";
import {
  WORLD_ROOM_ID,
  WORLD_PEER_STALE_MS,
  WORLD_REPLACED_CLOSE_CODE,
  type WorldIdentity,
} from "../world-room";

interface FakeSocket extends WsClientSocket {
  sent: any[];
  closedWith: { code?: number; reason?: string } | null;
}

function fakeSocket(): FakeSocket {
  const s: FakeSocket = {
    readyState: 1,
    sent: [],
    closedWith: null,
    send(data: string) {
      s.sent.push(JSON.parse(data));
    },
    close(code?: number, reason?: string) {
      s.closedWith = { code, reason };
      s.readyState = 3;
    },
    terminate() {
      s.readyState = 3;
    },
    ping() {},
    on() {
      return s;
    },
  };
  return s;
}

const member = (name: string): WorldIdentity => ({
  userId: `user-${name}`,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
});

const MUSIC = "world:music-hall";
/** The front door since Open World Phase 1: admission lands here. */
const PLAZA = WORLD_PLAZA_ROOM_ID;

function enter(palace: WorldPalace, socket: FakeSocket, name: string): void {
  /* Mirrors routes/world.ts: enterHall alone — the directory rides
   * the attach's change broadcast, no explicit send after. */
  expect(palace.enterHall(socket, member(name))).toBe(true);
}

function frame(palace: WorldPalace, socket: FakeSocket, payload: unknown, now?: number) {
  palace.handleFrame(socket, JSON.stringify(payload), now);
}

describe("admission + directory", () => {
  it("enters through the plaza; the welcome names the room and a directory follows", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    enter(palace, a, "Alpha");
    const welcome = a.sent.find((m) => m.type === "welcome");
    /* Open World Phase 1: the front door is the King's Plaza —
     * arrival faces the palace, spawn on the promenade. */
    expect(welcome.room).toEqual({ id: PLAZA, name: "The King's Plaza" });
    /* The spawn arc fans arrivals across the promenade's head —
     * z is the def's spawn line, x spreads by arrival slot. */
    expect(welcome.you.z).toBe(31.5);
    expect(Math.abs(welcome.you.x)).toBeLessThanOrEqual(5);
    const directory = a.sent.filter((m) => m.type === "palace.directory").pop();
    expect(directory.rooms).toHaveLength(PALACE_ROOM_DEFS.length);
    expect(directory.rooms.find((r: any) => r.id === PLAZA)).toMatchObject({
      count: 1,
      members: ["Alpha"],
      live: false,
    });
    expect(palace.totalPopulation()).toBe(1);
  });

  it("sends the joiner exactly one palace.directory on entry, after the welcome", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    enter(palace, a, "Alpha");
    const types = a.sent.map((m) => m.type);
    expect(types.filter((t) => t === "palace.directory")).toHaveLength(1);
    expect(types.indexOf("palace.directory")).toBeGreaterThan(types.indexOf("welcome"));
  });

  it("a second joiner means exactly one new directory for everyone inside", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    enter(palace, a, "Alpha");
    a.sent = [];
    enter(palace, b, "Beta");
    // The room change broadcasts once: Alpha hears it once, and the
    // joiner's own copy is that same broadcast — never a duplicate.
    expect(a.sent.filter((m) => m.type === "palace.directory")).toHaveLength(1);
    expect(b.sent.filter((m) => m.type === "palace.directory")).toHaveLength(1);
  });
});

describe("the plaza grounds (Open World Phase 1)", () => {
  it("the plaza def carries the grounds plan: name, clamp box, promenade spawn", () => {
    const def = PALACE_ROOM_DEFS.find((d) => d.roomId === PLAZA);
    expect(def?.name).toBe("The King's Plaza");
    expect(def?.bounds).toEqual({ minX: -27.9, maxX: 27.9, minZ: 11.1, maxZ: 33.8 });
    expect(def?.spawn).toEqual({ x: 0, z: 31.5 });
  });

  it("moves roam the whole grounds and clamp at the grounds edge", () => {
    const palace = new WorldPalace(new RoomHub());
    const b = fakeSocket();
    enter(palace, b, "Beta");
    // The west grounds, far outside the old courtyard box.
    frame(palace, b, { type: "move", x: -24, z: 20, rotY: 0 }, 1_000);
    expect(palace.plazaRoom.peerFor(b)?.x).toBe(-24);
    expect(palace.plazaRoom.peerFor(b)?.z).toBe(20);
    // The promenade's south end.
    frame(palace, b, { type: "move", x: -10, z: 33, rotY: 0 }, 2_000);
    expect(palace.plazaRoom.peerFor(b)?.z).toBe(33);
    // Beyond the grounds the clamp holds the edge.
    frame(palace, b, { type: "move", x: -99, z: 99, rotY: 0 }, 3_000);
    expect(palace.plazaRoom.peerFor(b)?.x).toBe(-27.9);
    expect(palace.plazaRoom.peerFor(b)?.z).toBe(33.8);
  });
});

describe("the Stage Grounds district (Stage C item 31)", () => {
  const STAGE = "world:stage-grounds";

  it("the def mirrors the client floor plan (lib/world/stage-grounds.ts): name, clamp box, gate spawn", () => {
    const def = PALACE_ROOM_DEFS.find((d) => d.roomId === STAGE);
    expect(def?.name).toBe("Stage Grounds");
    /* The client's walk rect is x −53.85..−28.55, z 10.35..35.65;
     * the clamp is a touch generous at the gate apron, like every
     * room's, and the spawn is just inside the gate. */
    expect(def?.bounds).toEqual({ minX: -54.4, maxX: -27.8, minZ: 9.6, maxZ: 36.4 });
    expect(def?.spawn).toEqual({ x: -30.2, z: 19.5 });
    /* No stage, no jukebox: the palace's one stage stays in the
     * hall and its one jukebox in the Music Hall. */
    expect(def?.stageEnabled).toBeUndefined();
    expect(def?.jukeboxEnabled).toBeUndefined();
  });

  it("transfers through the west gate: welcome names the district, the crossing point is carried, no screen or jukebox rides it", () => {
    const palace = new WorldPalace(new RoomHub());
    const b = fakeSocket();
    enter(palace, b, "Beta");
    b.sent = [];
    frame(palace, b, { type: "room.enter", roomId: STAGE, x: -28.7, z: 19.5, rotY: -1.6 });
    const welcome = b.sent.find((m) => m.type === "welcome");
    expect(welcome.room).toEqual({ id: STAGE, name: "Stage Grounds" });
    expect(welcome.you.x).toBe(-28.7);
    expect(welcome.you.z).toBe(19.5);
    expect(welcome.screen).toBeUndefined();
    expect(welcome.jukebox).toBeUndefined();
    expect(palace.plazaRoom.peerFor(b)).toBeNull();
    expect(palace.roomOf(b)?.roomId).toBe(STAGE);
    const directory = b.sent.filter((m) => m.type === "palace.directory").pop();
    expect(directory.rooms.find((r: any) => r.id === STAGE)).toMatchObject({
      count: 1,
      members: ["Beta"],
      live: false,
    });
  });

  it("moves roam the whole quarter and clamp at its west wall", () => {
    const palace = new WorldPalace(new RoomHub());
    const b = fakeSocket();
    enter(palace, b, "Beta");
    frame(palace, b, { type: "room.enter", roomId: STAGE, x: -28.7, z: 19.5 });
    const room = palace.room(STAGE)!;
    // The audience lawn's heart.
    frame(palace, b, { type: "move", x: -40, z: 23, rotY: 0 }, 1_000);
    expect(room.peerFor(b)?.x).toBe(-40);
    expect(room.peerFor(b)?.z).toBe(23);
    // Beyond the district the clamp holds the edge.
    frame(palace, b, { type: "move", x: -99, z: 99, rotY: 0 }, 2_000);
    expect(room.peerFor(b)?.x).toBe(-54.4);
    expect(room.peerFor(b)?.z).toBe(36.4);
  });
});

describe("the Listening Gardens district (Stage C item 32)", () => {
  const GARDENS = "world:listening-gardens";

  it("the def mirrors the client floor plan (lib/world/listening-gardens.ts): name, clamp box, gate spawn", () => {
    const def = PALACE_ROOM_DEFS.find((d) => d.roomId === GARDENS);
    expect(def?.name).toBe("Listening Gardens");
    /* The client's walk rect is x −38.65..−13.35, z 34.35..59.65;
     * the clamp is a touch generous at the gate apron, like every
     * room's, and the spawn is just inside the gate. */
    expect(def?.bounds).toEqual({ minX: -39.4, maxX: -12.6, minZ: 33.6, maxZ: 60.4 });
    expect(def?.spawn).toEqual({ x: -26, z: 36.2 });
    /* No stage, no jukebox: the palace's one stage stays in the
     * hall and its one jukebox in the Music Hall. */
    expect(def?.stageEnabled).toBeUndefined();
    expect(def?.jukeboxEnabled).toBeUndefined();
  });

  it("transfers through the south gate: welcome names the district, the crossing point is carried, no screen or jukebox rides it", () => {
    const palace = new WorldPalace(new RoomHub());
    const b = fakeSocket();
    enter(palace, b, "Beta");
    b.sent = [];
    frame(palace, b, { type: "room.enter", roomId: GARDENS, x: -26, z: 34.3, rotY: 0 });
    const welcome = b.sent.find((m) => m.type === "welcome");
    expect(welcome.room).toEqual({ id: GARDENS, name: "Listening Gardens" });
    expect(welcome.you.x).toBe(-26);
    expect(welcome.you.z).toBe(34.3);
    expect(welcome.screen).toBeUndefined();
    expect(welcome.jukebox).toBeUndefined();
    expect(palace.plazaRoom.peerFor(b)).toBeNull();
    expect(palace.roomOf(b)?.roomId).toBe(GARDENS);
    const directory = b.sent.filter((m) => m.type === "palace.directory").pop();
    expect(directory.rooms.find((r: any) => r.id === GARDENS)).toMatchObject({
      count: 1,
      members: ["Beta"],
      live: false,
    });
  });

  it("moves roam the whole quarter and clamp at its south wall", () => {
    const palace = new WorldPalace(new RoomHub());
    const b = fakeSocket();
    enter(palace, b, "Beta");
    frame(palace, b, { type: "room.enter", roomId: GARDENS, x: -26, z: 34.3 });
    const room = palace.room(GARDENS)!;
    // The parterre lawn's heart.
    frame(palace, b, { type: "move", x: -26, z: 47, rotY: 0 }, 1_000);
    expect(room.peerFor(b)?.x).toBe(-26);
    expect(room.peerFor(b)?.z).toBe(47);
    // Beyond the district the clamp holds the edge.
    frame(palace, b, { type: "move", x: -99, z: 99, rotY: 0 }, 2_000);
    expect(room.peerFor(b)?.x).toBe(-39.4);
    expect(room.peerFor(b)?.z).toBe(60.4);
  });
});

describe("doorway transfers", () => {
  it("moves the peer: despawn there, join here, same peerId, character + flags carried", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    enter(palace, a, "Alpha");
    enter(palace, b, "Beta");
    const betaId = palace.plazaRoom.peerFor(b)!.peerId;
    // Beta walks in as a house guard with voice off.
    frame(palace, b, { type: "character", characterId: "house:palace-guard" });
    frame(palace, b, { type: "voice.off", off: true });

    a.sent = [];
    b.sent = [];
    frame(palace, b, { type: "room.enter", roomId: MUSIC, x: -15.2, z: -2, rotY: 1.5 });

    const welcome = b.sent.find((m) => m.type === "welcome");
    expect(welcome.room).toEqual({ id: MUSIC, name: "Music Hall" });
    expect(welcome.peerId).toBe(betaId);
    expect(welcome.you.character?.id).toBe("house:palace-guard");
    expect(welcome.you.voiceOff).toBe(true);
    expect(welcome.you.x).toBe(-15.2);
    expect(welcome.you.z).toBe(-2);
    // Non-stage rooms carry no screen state in the welcome.
    expect(welcome.screen).toBeUndefined();
    // Alpha watched Beta leave the plaza; Beta is gone from it.
    expect(a.sent.map((m) => m.type)).toContain("peer.leave");
    expect(palace.plazaRoom.peerFor(b)).toBeNull();
    expect(palace.roomOf(b)?.roomId).toBe(MUSIC);
  });

  it("clamps the entry point into the destination's bounds", () => {
    const palace = new WorldPalace(new RoomHub());
    const b = fakeSocket();
    enter(palace, b, "Beta");
    frame(palace, b, { type: "room.enter", roomId: MUSIC, x: 99, z: -2 });
    const welcome = b.sent.filter((m) => m.type === "welcome").pop();
    expect(welcome.you.x).toBe(-13.0); // the Music Hall's east clamp
  });

  it("ignores enters for the current room and unknown rooms", () => {
    const palace = new WorldPalace(new RoomHub());
    const b = fakeSocket();
    enter(palace, b, "Beta");
    b.sent = [];
    frame(palace, b, { type: "room.enter", roomId: PLAZA, x: 0, z: 20 });
    frame(palace, b, { type: "room.enter", roomId: "world:nowhere", x: 0, z: 0 });
    expect(b.sent.filter((m) => m.type === "welcome")).toEqual([]);
    expect(palace.roomOf(b)?.roomId).toBe(PLAZA);
  });

  it("refuses a full destination honestly — the walker keeps their place", () => {
    const palace = new WorldPalace(new RoomHub());
    const music = palace.room(MUSIC)!;
    for (let i = 0; i < 30; i++) {
      expect(music.attach(fakeSocket(), member(`Filler${i}`))).toBe(true);
    }
    const b = fakeSocket();
    enter(palace, b, "Beta");
    b.sent = [];
    frame(palace, b, { type: "room.enter", roomId: MUSIC, x: -15, z: -2 });
    expect(b.sent).toEqual([{ type: "room.unavailable", roomId: MUSIC, name: "Music Hall", cap: 30 }]);
    expect(b.closedWith).toBeNull();
    expect(palace.roomOf(b)?.roomId).toBe(PLAZA);
  });
});

describe("room scoping", () => {
  it("moves and chat stay in their room", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    enter(palace, a, "Alpha");
    enter(palace, b, "Beta");
    frame(palace, b, { type: "room.enter", roomId: MUSIC, x: -16, z: -2 });
    a.sent = [];
    b.sent = [];
    frame(palace, b, { type: "move", x: -20, z: -2, rotY: 0 }, 1_000);
    frame(palace, b, { type: "say", body: "anyone hear this?" }, 2_000);
    expect(a.sent).toEqual([]);
    // (Beta hears only the room's own say echo — say broadcasts to
    // the whole room including its speaker, as it always has.)
    expect(b.sent.map((m) => m.type)).toEqual(["peer.say"]);
    // And the hall's moves never reach the Music Hall either.
    b.sent = [];
    frame(palace, a, { type: "move", x: 2, z: 2, rotY: 0 }, 1_000);
    expect(b.sent).toEqual([]);
  });

  it("walking through a doorway ends the voice session; signals never cross", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    enter(palace, a, "Alpha");
    enter(palace, b, "Beta");
    const betaId = palace.plazaRoom.peerFor(b)!.peerId;
    frame(palace, a, { type: "voice.join" });
    frame(palace, b, { type: "voice.join" });
    a.sent = [];
    frame(palace, b, { type: "room.enter", roomId: MUSIC, x: -16, z: -2 });
    // The plaza heard Beta's voice leave with their presence (the
    // directory updates ride along — filtered out here).
    expect(a.sent.map((m) => m.type).filter((t) => t !== "palace.directory")).toEqual([
      "voice.left",
      "peer.leave",
    ]);
    // Beta's welcome in the new room: not in voice there.
    const welcome = b.sent.filter((m) => m.type === "welcome").pop();
    expect(welcome.you.voice).toBe(false);
    // A signal addressed across the doorway goes nowhere.
    b.sent = [];
    frame(palace, a, { type: "voice.signal", to: betaId, data: { kind: "offer" } });
    expect(b.sent).toEqual([]);
  });

  it("a doorway transfer sends the walker exactly one palace.directory", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    enter(palace, a, "Alpha");
    enter(palace, b, "Beta");
    b.sent = [];
    frame(palace, b, { type: "room.enter", roomId: MUSIC, x: -16, z: -2 });
    // The detach's broadcast passes while Beta stands in no room;
    // the destination attach's broadcast is the walker's one copy.
    expect(b.sent.filter((m) => m.type === "palace.directory")).toHaveLength(1);
    const directory = b.sent.filter((m) => m.type === "palace.directory")[0];
    expect(directory.rooms.find((r: any) => r.id === MUSIC)).toMatchObject({
      count: 1,
      members: ["Beta"],
    });
  });

  it("per-room move clamps use the room's own bounds", () => {
    const palace = new WorldPalace(new RoomHub());
    const b = fakeSocket();
    enter(palace, b, "Beta");
    frame(palace, b, { type: "room.enter", roomId: MUSIC, x: -16, z: -2 });
    frame(palace, b, { type: "move", x: 0, z: -2, rotY: 0 }, 1_000);
    expect(palace.room(MUSIC)!.peerFor(b)?.x).toBe(-13.0);
  });

  it("disconnect despawns from the side room and the directory follows", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    enter(palace, a, "Alpha");
    enter(palace, b, "Beta");
    frame(palace, b, { type: "room.enter", roomId: MUSIC, x: -16, z: -2 });
    a.sent = [];
    palace.detach(b);
    const directory = a.sent.filter((m) => m.type === "palace.directory").pop();
    expect(directory.rooms.find((r: any) => r.id === MUSIC).count).toBe(0);
    expect(palace.totalPopulation()).toBe(1);
  });
});

describe("the stage stays in the hall", () => {
  it("stage frames from another room change nothing, anywhere", async () => {
    const palace = new WorldPalace(new RoomHub(), {
      resolveStageStream: async () => ({
        streamId: "s1",
        title: "Show",
        performerName: "Beta",
        performerSlug: "beta",
      }),
    });
    const a = fakeSocket();
    const b = fakeSocket();
    enter(palace, a, "Alpha");
    enter(palace, b, "Beta");
    frame(palace, b, { type: "room.enter", roomId: MUSIC, x: -16, z: -2 });
    a.sent = [];
    b.sent = [];
    frame(palace, b, { type: "stage.live", streamId: "s1" });
    frame(palace, b, { type: "screen.reel" });
    await new Promise((r) => setTimeout(r, 10));
    expect(palace.hallRoom.stageHeld()).toBe(false);
    expect(a.sent.filter((m) => m.type === "screen.state")).toEqual([]);
    // The screen remote answers with the honest denial, holder null.
    expect(b.sent).toEqual([{ type: "screen.denied", holderName: null }]);
  });

  it("the directory flags the hall LIVE while a show holds the stage", async () => {
    const palace = new WorldPalace(new RoomHub(), {
      resolveStageStream: async () => ({
        streamId: "s1",
        title: "Show",
        performerName: "Alpha",
        performerSlug: "alpha",
      }),
    });
    const a = fakeSocket();
    enter(palace, a, "Alpha");
    /* The stage is the hall's: the performer walks in first. */
    frame(palace, a, { type: "room.enter", roomId: WORLD_ROOM_ID, x: 0, z: 9.5 });
    frame(palace, a, { type: "stage.live", streamId: "s1" });
    await new Promise((r) => setTimeout(r, 10));
    const hall = palace.directory().find((r) => r.id === WORLD_ROOM_ID);
    expect(hall?.live).toBe(true);
  });
});

const TREASURY = "world:treasury";
const ROYAL_COURT = "world:royal-court";
const BRANDING = "world:branding-atelier";

describe("the second ring (palace follow-on)", () => {
  it("the registry serves ten rooms, hall included (eight + the Stage Grounds and Listening Gardens districts, items 31+32)", () => {
    const palace = new WorldPalace(new RoomHub());
    const ids = palace.directory().map((r) => r.id);
    expect(ids).toEqual([
      WORLD_ROOM_ID,
      "world:music-hall",
      "world:game-rooms",
      "world:create-wing",
      "world:courtyard",
      TREASURY,
      ROYAL_COURT,
      BRANDING,
      "world:stage-grounds",
      "world:listening-gardens",
    ]);
    expect(palace.directory().find((r) => r.id === TREASURY)?.name).toBe("Treasury");
    expect(palace.directory().find((r) => r.id === ROYAL_COURT)?.name).toBe("Royal Court Chamber");
    expect(palace.directory().find((r) => r.id === BRANDING)?.name).toBe("Branding Atelier");
  });

  it("doorway transfers land in each new room at the crossing point, clamped to its bounds", () => {
    const palace = new WorldPalace(new RoomHub());
    const cases: Array<{ roomId: string; name: string; x: number; z: number }> = [
      { roomId: TREASURY, name: "Treasury", x: -15.2, z: -13.5 },
      { roomId: ROYAL_COURT, name: "Royal Court Chamber", x: 15.2, z: -13.5 },
      { roomId: BRANDING, name: "Branding Atelier", x: 15.2, z: 5 },
    ];
    for (const [i, c] of cases.entries()) {
      const s = fakeSocket();
      enter(palace, s, `Walker${i}`);
      frame(palace, s, { type: "room.enter", roomId: c.roomId, x: c.x, z: c.z, rotY: 0 });
      const welcome = s.sent.filter((m) => m.type === "welcome").pop();
      expect(welcome.room).toEqual({ id: c.roomId, name: c.name });
      expect(welcome.you.x).toBe(c.x);
      expect(welcome.you.z).toBe(c.z);
      expect(palace.roomOf(s)?.roomId).toBe(c.roomId);
      // No stage, no jukebox in the welcome — each authority lives
      // in exactly one room.
      expect(welcome.screen).toBeUndefined();
      expect(welcome.jukebox).toBeUndefined();
    }
  });

  it("out-of-bounds crossing points clamp into the new rooms", () => {
    const palace = new WorldPalace(new RoomHub());
    const s = fakeSocket();
    enter(palace, s, "Clamper");
    frame(palace, s, { type: "room.enter", roomId: TREASURY, x: -99, z: 99 });
    const welcome = s.sent.filter((m) => m.type === "welcome").pop();
    expect(welcome.you.x).toBe(-27.8); // the Treasury's west clamp
    expect(welcome.you.z).toBe(-9.6); // and its south clamp
  });

  it("the new rooms refuse the stage too — the hall is the one stage", () => {
    const palace = new WorldPalace(new RoomHub(), {
      resolveStageStream: async () => ({
        streamId: "s1",
        title: "Show",
        performerName: "Alpha",
        performerSlug: "alpha",
      }),
    });
    const s = fakeSocket();
    enter(palace, s, "Alpha");
    frame(palace, s, { type: "room.enter", roomId: TREASURY, x: -16, z: -13.5 });
    s.sent = [];
    frame(palace, s, { type: "stage.live", streamId: "s1" });
    expect(palace.hallRoom.stageHeld()).toBe(false);
    expect(s.sent.filter((m) => m.type === "screen.state")).toEqual([]);
  });

  it("the jukebox lives in the Music Hall only — and every room can offer it a song (item 47)", async () => {
    const palace = new WorldPalace(new RoomHub(), {
      resolveJukeboxTrack: async (_userId, trackId) =>
        trackId === "track:good"
          ? {
              id: trackId,
              title: "Good Song",
              url: "https://example.test/good.mp3",
              durationSec: 30,
              creatorName: "Alpha",
              artworkUrl: null,
            }
          : null,
    });
    const s = fakeSocket();
    enter(palace, s, "Alpha");
    /* From the front door, a jukebox.add is not this room's to
     * answer — no state comes back here — but the offer FORWARDS
     * to the Music Hall, whose one authority puts the song on
     * (previously the frame died on the closed door). */
    frame(palace, s, { type: "jukebox.add", trackId: "track:good" });
    await new Promise((r) => setTimeout(r, 10));
    expect(s.sent.filter((m) => m.type === "jukebox.state")).toEqual([]);
    const music = palace.room(MUSIC)!;
    expect(music.jukeboxBroadcast().current?.entry.track.id).toBe("track:good");
    /* Through the music door, the forwarded song is already on;
     * a local add queues behind it like any other. */
    frame(palace, s, { type: "room.enter", roomId: MUSIC, x: -16, z: -2 });
    const musicWelcome = s.sent.filter((m) => m.type === "welcome").pop();
    expect(musicWelcome.jukebox.current.entry.track.id).toBe("track:good");
    expect(musicWelcome.jukebox.queue).toEqual([]);
    frame(palace, s, { type: "jukebox.add", trackId: "track:good" });
    await new Promise((r) => setTimeout(r, 10));
    const state = s.sent.filter((m) => m.type === "jukebox.state").pop();
    expect(state.jukebox.current.entry.track.id).toBe("track:good");
    expect(state.jukebox.current.playback.playing).toBe(true);
    expect(state.jukebox.queue).toHaveLength(1);
  });
});

describe("presence truth — rejoins replace, ghosts get reaped", () => {
  const guestTab = (sid: string | null): WorldIdentity => ({
    userId: null,
    displayName: "Guest",
    avatarUrl: null,
    profileSlug: null,
    guestSessionId: sid,
  });

  function directoryTotal(socket: FakeSocket): number {
    const dir = socket.sent.filter((m) => m.type === "palace.directory").pop();
    expect(dir, "a directory snapshot").toBeTruthy();
    return dir.rooms.reduce((n: number, r: any) => n + r.count, 0);
  }

  it("a member's rejoin evicts their own ghost — the headcount never stacks", () => {
    const palace = new WorldPalace(new RoomHub());
    const watcher = fakeSocket();
    enter(palace, watcher, "Watcher");
    const first = fakeSocket();
    enter(palace, first, "Alpha");
    expect(directoryTotal(watcher)).toBe(2);
    first.sent = [];

    // Same account, new connection (a reload whose old socket's
    // close never reached the server).
    const second = fakeSocket();
    expect(palace.enterHall(second, member("Alpha"))).toBe(true);

    expect(first.sent).toEqual([{ type: "replaced" }]);
    expect(first.closedWith?.code).toBe(WORLD_REPLACED_CLOSE_CODE);
    expect(second.sent.some((m) => m.type === "welcome")).toBe(true);
    expect(palace.plazaRoom.size()).toBe(2); // watcher + ONE Alpha
    expect(directoryTotal(watcher)).toBe(2);
  });

  it("the eviction finds the ghost wherever it stands — a side room is no hiding place", () => {
    const palace = new WorldPalace(new RoomHub());
    const first = fakeSocket();
    enter(palace, first, "Alpha");
    frame(palace, first, { type: "room.enter", roomId: MUSIC, x: -16, z: -2 });
    expect(palace.roomOf(first)?.roomId).toBe(MUSIC);
    first.sent = [];

    const second = fakeSocket();
    expect(palace.enterHall(second, member("Alpha"))).toBe(true);
    expect(first.sent).toEqual([{ type: "replaced" }]);
    expect(first.closedWith?.code).toBe(WORLD_REPLACED_CLOSE_CODE);
    expect(palace.directory().find((r) => r.id === MUSIC)?.count).toBe(0);
    /* The rejoin lands at the front door — the plaza — not back
     * in the side room the ghost was haunting. */
    expect(palace.plazaRoom.size()).toBe(1);
    expect(palace.hallRoom.size()).toBe(0);
  });

  it("guest tabs replace by session id; anonymous guests and other tabs coexist untouched", () => {
    const palace = new WorldPalace(new RoomHub());
    const tabA1 = fakeSocket();
    const tabA2 = fakeSocket();
    const tabB = fakeSocket();
    const anon1 = fakeSocket();
    const anon2 = fakeSocket();
    expect(palace.enterHall(tabA1, guestTab("tab-session-a"))).toBe(true);
    expect(palace.enterHall(tabB, guestTab("tab-session-b"))).toBe(true);
    expect(palace.enterHall(anon1, guestTab(null))).toBe(true);
    expect(palace.enterHall(anon2, guestTab(null))).toBe(true);
    tabA1.sent = [];

    // Tab A reloads: same session id, new socket.
    expect(palace.enterHall(tabA2, guestTab("tab-session-a"))).toBe(true);
    expect(tabA1.sent).toEqual([{ type: "replaced" }]);
    expect(tabA1.closedWith?.code).toBe(WORLD_REPLACED_CLOSE_CODE);
    // Tab B and both anonymous guests are exactly where they were.
    expect(tabB.closedWith).toBeNull();
    expect(palace.plazaRoom.size()).toBe(4);
  });

  it("join/leave storm: twelve enter, seven die silent — one sweep leaves the true five", () => {
    const palace = new WorldPalace(new RoomHub());
    const sockets: FakeSocket[] = [];
    for (let i = 0; i < 12; i++) {
      const s = fakeSocket();
      sockets.push(s);
      expect(palace.enterHall(s, member(`P${i}`))).toBe(true);
    }
    expect(palace.plazaRoom.size()).toBe(12);
    const t0 = Date.now();

    // Five keep living on the client's ping cadence; seven never
    // send another byte (killed tabs whose closes never arrived).
    for (let i = 0; i < 5; i++) {
      frame(palace, sockets[i], { type: "ping" }, t0 + 80_000);
    }
    const reaped = palace.sweepStalePeers(t0 + WORLD_PEER_STALE_MS + 1_000);

    expect(reaped).toBe(7);
    expect(palace.plazaRoom.size()).toBe(5);
    for (let i = 5; i < 12; i++) expect(sockets[i].readyState).toBe(3);
    for (let i = 0; i < 5; i++) expect(sockets[i].readyState).toBe(1);
    // And the directory the room reads agrees with the truth.
    expect(directoryTotal(sockets[0])).toBe(5);
  });

  it("the sweeper lifecycle is safe to start twice and dispose", () => {
    const palace = new WorldPalace(new RoomHub());
    palace.startPresenceSweeper();
    palace.startPresenceSweeper();
    palace.dispose();
    palace.dispose();
  });
});
