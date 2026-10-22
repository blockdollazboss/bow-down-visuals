/**
 * Tutorial verbs in the rooms (lib/world-room + lib/world-palace,
 * Ring 3, Phase 6).
 *
 * Pinned contract — the room WITNESSES, the rail decides:
 * - Walking into the throne zone (the hall's stage end) notes
 *   "meet-king", once per session (the peer latch), members only.
 * - Walking anywhere else in the hall notes nothing.
 * - Entering the Treasury notes "quest-board" (the board's room).
 * - Clapping or cheering while a show holds the room's stage
 *   notes "applaud"; the same actions in an empty room note
 *   nothing. A landed stage tip notes "applaud" for the tipper.
 * - Guests never note anything (they hold no hand to guide).
 */
import { describe, it, expect, vi } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldPalace } from "../world-palace";
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
const guest = (): WorldIdentity => ({
  userId: null,
  displayName: "Guest",
  avatarUrl: null,
  profileSlug: null,
});

const flush = () => new Promise<void>((r) => setImmediate(r));
const T0 = 6_000_000;

function palaceWithSpy() {
  const note = vi.fn();
  const palace = new WorldPalace(new RoomHub(), {
    noteTutorialAction: note,
    resolveStageStream: async (userId, streamId) =>
      streamId === "stream-1"
        ? {
            streamId,
            title: "Friday Set",
            performerName: userId.replace("user-", ""),
            performerSlug: userId.replace("user-", "").toLowerCase(),
          }
        : null,
    tipStagePerformer: async () => ({ ok: true as const }),
  });
  return { palace, note };
}

const move = (palace: WorldPalace, sock: FakeSocket, x: number, z: number, at: number) =>
  palace.handleFrame(sock, JSON.stringify({ type: "move", x, z, rotY: 0 }), at);

/** Admission lands on the King's Plaza (Open World Phase 1); the
 *  throne, the stage and the applause these tests exercise all
 *  live in the hall — walk the peer in through the doors first. */
const intoHall = (palace: WorldPalace, sock: FakeSocket, at: number) =>
  palace.handleFrame(sock, JSON.stringify({ type: "room.enter", roomId: WORLD_ROOM_ID, x: 0, z: 9.5 }), at);

describe("tutorial verbs in the rooms", () => {
  it("walking to the throne notes meet-king once per session; the middle of the hall notes nothing", () => {
    const { palace, note } = palaceWithSpy();
    const sock = fakeSocket();
    palace.enterHall(sock, member("New"));
    intoHall(palace, sock, T0);
    move(palace, sock, 0, 0, T0); // the middle of the hall
    expect(note).not.toHaveBeenCalled();
    move(palace, sock, 2, -12, T0 + 100); // the throne zone
    expect(note).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledWith("user-New", "meet-king");
    move(palace, sock, 1, -14, T0 + 200); // still in the zone — latched
    move(palace, sock, 0, 0, T0 + 300);
    move(palace, sock, 0, -15, T0 + 400); // back in — still once this session
    expect(note).toHaveBeenCalledTimes(1);
  });

  it("a guest at the throne notes nothing", () => {
    const { palace, note } = palaceWithSpy();
    const sock = fakeSocket();
    palace.enterHall(sock, guest());
    intoHall(palace, sock, T0);
    move(palace, sock, 0, -12, T0);
    expect(note).not.toHaveBeenCalled();
  });

  it("entering the Treasury notes quest-board; entering another side room does not", () => {
    const { palace, note } = palaceWithSpy();
    const sock = fakeSocket();
    palace.enterHall(sock, member("New"));
    palace.handleFrame(sock, JSON.stringify({ type: "room.enter", roomId: "world:arcade" }), T0);
    expect(note).not.toHaveBeenCalled();
    palace.handleFrame(sock, JSON.stringify({ type: "room.enter", roomId: "world:treasury" }), T0 + 100);
    expect(note).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledWith("user-New", "quest-board");
  });

  it("applause counts only while a show holds the stage", async () => {
    const { palace, note } = palaceWithSpy();
    const star = fakeSocket();
    const fan = fakeSocket();
    palace.enterHall(star, member("Star"));
    palace.enterHall(fan, member("Fan"));
    intoHall(palace, star, T0);
    intoHall(palace, fan, T0);
    // Empty stage: clapping is just exercise.
    palace.handleFrame(fan, JSON.stringify({ type: "action", action: "clap" }), T0);
    expect(note).not.toHaveBeenCalled();
    // The show takes the stage; now the applause lands.
    palace.handleFrame(star, JSON.stringify({ type: "stage.live", streamId: "stream-1" }), T0 + 100);
    await flush();
    palace.handleFrame(fan, JSON.stringify({ type: "action", action: "cheer" }), T0 + 1_200);
    expect(note).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledWith("user-Fan", "applaud");
  });

  it("a landed stage tip notes applaud for the tipper", async () => {
    const { palace, note } = palaceWithSpy();
    const star = fakeSocket();
    const fan = fakeSocket();
    palace.enterHall(star, member("Star"));
    palace.enterHall(fan, member("Fan"));
    intoHall(palace, star, T0);
    intoHall(palace, fan, T0);
    palace.handleFrame(star, JSON.stringify({ type: "stage.live", streamId: "stream-1" }), T0);
    await flush();
    palace.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 250 }), T0 + 100);
    await flush();
    expect(note).toHaveBeenCalledWith("user-Fan", "applaud");
  });

  it("without the notifier wired, the rooms run exactly as before (hall attaches, moves, applauds silently)", async () => {
    const palace = new WorldPalace(new RoomHub(), {});
    const sock = fakeSocket();
    palace.enterHall(sock, member("Solo"));
    move(palace, sock, 0, -12, T0);
    palace.handleFrame(sock, JSON.stringify({ type: "room.enter", roomId: "world:treasury" }), T0 + 100);
    expect(palace.room(WORLD_ROOM_ID)).toBeTruthy();
    expect(sock.closedWith).toBeNull();
  });
});
