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
import { WorldPalace, PALACE_ROOM_DEFS } from "../world-palace";
import { WORLD_ROOM_ID, type WorldIdentity } from "../world-room";

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

function enter(palace: WorldPalace, socket: FakeSocket, name: string): void {
  expect(palace.enterHall(socket, member(name))).toBe(true);
  palace.sendDirectory(socket);
}

function frame(palace: WorldPalace, socket: FakeSocket, payload: unknown, now?: number) {
  palace.handleFrame(socket, JSON.stringify(payload), now);
}

describe("admission + directory", () => {
  it("enters through the hall; the welcome names the room and a directory follows", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    enter(palace, a, "Alpha");
    const welcome = a.sent.find((m) => m.type === "welcome");
    expect(welcome.room).toEqual({ id: WORLD_ROOM_ID, name: "The King's Hall" });
    const directory = a.sent.filter((m) => m.type === "palace.directory").pop();
    expect(directory.rooms).toHaveLength(PALACE_ROOM_DEFS.length);
    expect(directory.rooms.find((r: any) => r.id === WORLD_ROOM_ID)).toMatchObject({
      count: 1,
      members: ["Alpha"],
      live: false,
    });
    expect(palace.totalPopulation()).toBe(1);
  });
});

describe("doorway transfers", () => {
  it("moves the peer: despawn there, join here, same peerId, character + flags carried", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    enter(palace, a, "Alpha");
    enter(palace, b, "Beta");
    const betaId = palace.hallRoom.peerFor(b)!.peerId;
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
    // Alpha watched Beta leave the hall; Beta is gone from it.
    expect(a.sent.map((m) => m.type)).toContain("peer.leave");
    expect(palace.hallRoom.peerFor(b)).toBeNull();
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
    frame(palace, b, { type: "room.enter", roomId: WORLD_ROOM_ID, x: 0, z: 0 });
    frame(palace, b, { type: "room.enter", roomId: "world:nowhere", x: 0, z: 0 });
    expect(b.sent.filter((m) => m.type === "welcome")).toEqual([]);
    expect(palace.roomOf(b)?.roomId).toBe(WORLD_ROOM_ID);
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
    expect(palace.roomOf(b)?.roomId).toBe(WORLD_ROOM_ID);
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
    const betaId = palace.hallRoom.peerFor(b)!.peerId;
    frame(palace, a, { type: "voice.join" });
    frame(palace, b, { type: "voice.join" });
    a.sent = [];
    frame(palace, b, { type: "room.enter", roomId: MUSIC, x: -16, z: -2 });
    // The hall heard Beta's voice leave with their presence (the
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
  it("the registry serves eight rooms, hall included", () => {
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

  it("the jukebox resolver reaches the Music Hall only", async () => {
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
    // In the hall, a jukebox frame is not the hall's to answer.
    frame(palace, s, { type: "jukebox.add", trackId: "track:good" });
    await new Promise((r) => setTimeout(r, 10));
    expect(s.sent.filter((m) => m.type === "jukebox.state")).toEqual([]);
    // Through the music door, the same frame puts the song on.
    frame(palace, s, { type: "room.enter", roomId: MUSIC, x: -16, z: -2 });
    const musicWelcome = s.sent.filter((m) => m.type === "welcome").pop();
    expect(musicWelcome.jukebox).toEqual({ current: null, queue: [] });
    frame(palace, s, { type: "jukebox.add", trackId: "track:good" });
    await new Promise((r) => setTimeout(r, 10));
    const state = s.sent.filter((m) => m.type === "jukebox.state").pop();
    expect(state.jukebox.current.entry.track.id).toBe("track:good");
    expect(state.jukebox.current.playback.playing).toBe(true);
  });
});
