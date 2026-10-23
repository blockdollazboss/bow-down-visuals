/**
 * Creator Rooms in the palace registry (Ring 2, item 3.5).
 *
 * Pins the dynamic ring's contract:
 * - a creator room is a room instance keyed `creator:<slug>`,
 *   materialized on demand (noteCreatorRoom from the HTTP reads,
 *   or the injected resolver on a cold room.enter);
 * - doorway transfers into it behave like any room: fresh welcome
 *   naming the creator's room, same peerId, room-scoped presence;
 * - it has NO stage and NO jukebox — those authorities stay
 *   hall-locked / Music-Hall-locked, and the room refuses the
 *   frames exactly like the other side rooms do;
 * - the directory lists a creator room only while someone stands
 *   in it, with its slug riding the entry;
 * - an unknown or private slug (resolver → null) never transfers:
 *   the walker keeps their place and no room materializes.
 */
import { describe, it, expect, vi } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import {
  WorldPalace,
  creatorRoomIdForSlug,
  creatorSlugFromRoomId,
  creatorRoomName,
} from "../world-palace";
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

function frame(palace: WorldPalace, socket: FakeSocket, payload: unknown, now?: number) {
  palace.handleFrame(socket, JSON.stringify(payload), now);
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("creator room ids", () => {
  it("round-trips slug ↔ room id and rejects non-creator ids", () => {
    expect(creatorRoomIdForSlug("nova-reyes")).toBe("creator:nova-reyes");
    expect(creatorSlugFromRoomId("creator:nova-reyes")).toBe("nova-reyes");
    expect(creatorSlugFromRoomId("world:kings-hall")).toBeNull();
    expect(creatorSlugFromRoomId("creator:")).toBeNull();
    expect(creatorRoomName("Nova Reyes")).toBe("Nova Reyes's Room");
    expect(creatorRoomName("  ")).toBe("Creator's Room");
  });
});

describe("materialized creator rooms", () => {
  it("noteCreatorRoom is idempotent and the room joins/leaves like any room", () => {
    const palace = new WorldPalace(new RoomHub());
    const room = palace.noteCreatorRoom("nova-reyes", "Nova Reyes");
    expect(palace.noteCreatorRoom("nova-reyes", "Nova Reyes")).toBe(room);
    expect(palace.creatorRoom("nova-reyes")).toBe(room);
    expect(room.roomId).toBe("creator:nova-reyes");
    expect(room.roomName).toBe("Nova Reyes's Room");
    expect(room.stageEnabled).toBe(false);
    expect(room.jukeboxEnabled).toBe(false);

    const a = fakeSocket();
    expect(palace.enterHall(a, member("Alpha"))).toBe(true);
    frame(palace, a, { type: "room.enter", roomId: "creator:nova-reyes", x: 9.5, z: 28.6 });
    const welcome = a.sent.filter((m) => m.type === "welcome").pop();
    expect(welcome.room).toEqual({ id: "creator:nova-reyes", name: "Nova Reyes's Room" });
    expect(palace.roomOf(a)).toBe(room);
    expect(room.size()).toBe(1);

    /* Back out through the hall door — an ordinary transfer. */
    frame(palace, a, { type: "room.enter", roomId: WORLD_ROOM_ID });
    expect(palace.roomOf(a)).toBe(palace.hallRoom);
    expect(room.size()).toBe(0);
  });

  it("clamps entry points into the creator room template bounds", () => {
    const palace = new WorldPalace(new RoomHub());
    palace.noteCreatorRoom("nova-reyes", "Nova Reyes");
    const a = fakeSocket();
    palace.enterHall(a, member("Alpha"));
    frame(palace, a, { type: "room.enter", roomId: "creator:nova-reyes", x: 999, z: -999 });
    const welcome = a.sent.filter((m) => m.type === "welcome").pop();
    expect(welcome.you.x).toBeLessThanOrEqual(16.6);
    expect(welcome.you.z).toBeGreaterThanOrEqual(26.2);
  });

  it("presence stays room-scoped: the hall never sees the creator room's crowd", () => {
    const palace = new WorldPalace(new RoomHub());
    palace.noteCreatorRoom("nova-reyes", "Nova Reyes");
    const host = fakeSocket();
    const guest = fakeSocket();
    palace.enterHall(host, member("Nova"));
    palace.enterHall(guest, member("Guest"));
    frame(palace, host, { type: "room.enter", roomId: "creator:nova-reyes" });
    frame(palace, guest, { type: "room.enter", roomId: "creator:nova-reyes" });
    host.sent = [];
    guest.sent = [];
    frame(palace, guest, { type: "move", x: 10, y: 0, z: 30, rotY: 0 });
    /* The roommate sees the move; the hall (nobody home) is not
     * involved — and a hall walker hears nothing either. */
    expect(host.sent.some((m) => m.type === "peer.move")).toBe(true);
    const hallWalker = fakeSocket();
    palace.enterHall(hallWalker, member("Hallway"));
    hallWalker.sent = [];
    frame(palace, guest, { type: "move", x: 11, y: 0, z: 31, rotY: 0 });
    expect(hallWalker.sent.some((m) => m.type === "peer.move")).toBe(false);
  });

  it("refuses the stage; a jukebox offer forwards to the Music Hall (item 47)", async () => {
    const stageResolver = vi.fn(async () => null);
    const jukeboxResolver = vi.fn(async () => null);
    const palace = new WorldPalace(new RoomHub(), {
      resolveStageStream: stageResolver as never,
      resolveJukeboxTrack: jukeboxResolver as never,
    });
    palace.noteCreatorRoom("nova-reyes", "Nova Reyes");
    const a = fakeSocket();
    palace.enterHall(a, member("Alpha"));
    frame(palace, a, { type: "room.enter", roomId: "creator:nova-reyes" });
    a.sent = [];
    frame(palace, a, { type: "stage.claim", streamId: "00000000-0000-4000-8000-000000000000" });
    frame(palace, a, { type: "jukebox.add", trackId: "track:00000000-0000-4000-8000-000000000000" });
    await flush();
    /* The stage authority never leaves the hall — a creator room's
     * claim is refused outright, its resolver never consulted. */
    expect(stageResolver).not.toHaveBeenCalled();
    expect(a.sent.some((m) => m.type === "stage.state")).toBe(false);
    /* The jukebox is different by design (the Portrait Card's
     * contract: a press in ANY room offers the track to the Music
     * Hall jukebox): the offer forwards, the Music Hall's one
     * authority consults the resolver, and its refusal — this pick
     * doesn't verify — travels back to the asker here. The creator
     * room itself still runs no box: no jukebox.state ever lands. */
    expect(jukeboxResolver).toHaveBeenCalledTimes(1);
    expect(a.sent.filter((m) => m.type === "jukebox.denied").pop()?.reason).toBe("unplayable");
    expect(a.sent.some((m) => m.type === "jukebox.state")).toBe(false);
  });
});

describe("the directory", () => {
  it("lists a creator room only while someone stands in it, with its slug", () => {
    const palace = new WorldPalace(new RoomHub());
    palace.noteCreatorRoom("nova-reyes", "Nova Reyes");
    expect(palace.directory().some((r) => r.id === "creator:nova-reyes")).toBe(false);
    const a = fakeSocket();
    palace.enterHall(a, member("Alpha"));
    frame(palace, a, { type: "room.enter", roomId: "creator:nova-reyes" });
    const entry = palace.directory().find((r) => r.id === "creator:nova-reyes");
    expect(entry).toMatchObject({
      name: "Nova Reyes's Room",
      count: 1,
      members: ["Alpha"],
      live: false,
      slug: "nova-reyes",
    });
    /* The fixed eight carry no slug. */
    expect(palace.directory().find((r) => r.id === WORLD_ROOM_ID)?.slug).toBeUndefined();
    palace.detach(a);
    expect(palace.directory().some((r) => r.id === "creator:nova-reyes")).toBe(false);
  });
});

describe("cold room.enter resolution", () => {
  it("resolves a public slug, materializes the room, and transfers", async () => {
    const resolveCreatorRoom = vi.fn(async (slug: string) =>
      slug === "nova-reyes" ? { displayName: "Nova Reyes" } : null,
    );
    const palace = new WorldPalace(new RoomHub(), {}, { resolveCreatorRoom });
    const a = fakeSocket();
    palace.enterHall(a, member("Alpha"));
    frame(palace, a, { type: "room.enter", roomId: "creator:nova-reyes" });
    await flush();
    expect(resolveCreatorRoom).toHaveBeenCalledWith("nova-reyes");
    expect(palace.creatorRoom("nova-reyes")).toBeDefined();
    expect(palace.roomOf(a)?.roomId).toBe("creator:nova-reyes");
    const welcome = a.sent.filter((m) => m.type === "welcome").pop();
    expect(welcome.room).toEqual({ id: "creator:nova-reyes", name: "Nova Reyes's Room" });
  });

  it("an unknown or private slug never transfers and never materializes", async () => {
    const resolveCreatorRoom = vi.fn(async () => null);
    const palace = new WorldPalace(new RoomHub(), {}, { resolveCreatorRoom });
    const a = fakeSocket();
    palace.enterHall(a, member("Alpha"));
    a.sent = [];
    frame(palace, a, { type: "room.enter", roomId: "creator:secret-creator" });
    await flush();
    /* The walker keeps their place — the plaza, where admission
     * lands since Open World Phase 1. */
    expect(palace.roomOf(a)).toBe(palace.plazaRoom);
    expect(palace.creatorRoom("secret-creator")).toBeUndefined();
    expect(a.sent.some((m) => m.type === "welcome" && m.room?.id !== "world:courtyard")).toBe(false);
  });

  it("a burst of enters for one cold room resolves the profile once", async () => {
    let release!: (v: { displayName: string }) => void;
    const gate = new Promise<{ displayName: string }>((res) => (release = res));
    const resolveCreatorRoom = vi.fn(() => gate);
    const palace = new WorldPalace(new RoomHub(), {}, { resolveCreatorRoom });
    const a = fakeSocket();
    const b = fakeSocket();
    palace.enterHall(a, member("Alpha"));
    palace.enterHall(b, member("Beta"));
    frame(palace, a, { type: "room.enter", roomId: "creator:nova-reyes" });
    frame(palace, b, { type: "room.enter", roomId: "creator:nova-reyes" });
    expect(resolveCreatorRoom).toHaveBeenCalledTimes(1);
    release({ displayName: "Nova Reyes" });
    await flush();
    /* The first walker lands; the second's frame was folded into
     * the same resolution — they knock again (or walk the arch)
     * now that the room exists. Alpha is home either way. */
    expect(palace.creatorRoom("nova-reyes")).toBeDefined();
    expect(palace.roomOf(a)?.roomId).toBe("creator:nova-reyes");
  });

  it("without a resolver, a cold creator room.enter is a no-op (the fixed palace behavior)", async () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    palace.enterHall(a, member("Alpha"));
    frame(palace, a, { type: "room.enter", roomId: "creator:nova-reyes" });
    await flush();
    expect(palace.roomOf(a)).toBe(palace.plazaRoom);
  });
});
