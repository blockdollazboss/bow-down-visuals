/**
 * QC-200 PRE-PROOF — Q170 access law, API half.
 *
 * The ledger marks Q170 BLOCKED-signed-in: the live guest/lock
 * walk is the owner's verdict and is NOT claimed here. This file
 * pins the server-side CODE CORE the ledger line states, driven
 * through the real WorldRoom with fake sockets + a fake
 * WorldLockChecker (the room's injected door):
 * - guests are look-only: a guest's `say` frame is refused
 *   server-side (never broadcast), while a member's say IS
 *   witnessed by the guest (guests listen);
 * - person lock + room lock are enforced AT ATTACH via
 *   WorldLockChecker, closing 4415 (person) / 4416 (door) after a
 *   room.locked frame carrying the same kind;
 * - admins bypass the DOOR lock; a PERSON lock has no bypass;
 * - the door lock binds guests too.
 *
 * Standing suites: world-locks.test.ts pins the durable store +
 * palace end-to-end; world-room.test.ts pins the room broadly;
 * world-client.test.ts pins the client cards for 4415/4416.
 */
import { describe, it, expect } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import {
  WorldRoom,
  WORLD_LOCKED_OUT_CLOSE_CODE,
  WORLD_DOOR_LOCKED_CLOSE_CODE,
  type WorldIdentity,
  type WorldLockChecker,
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

const member = (name: string, admin = false): WorldIdentity => ({
  userId: `user-${name}`,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
  ...(admin ? { admin: true } : {}),
});
const guest = (): WorldIdentity => ({
  userId: null,
  displayName: "Guest",
  avatarUrl: null,
  profileSlug: null,
});

const UNTIL = Date.parse("2026-11-02T12:00:00.000Z");

/** A checker naming one locked member and (optionally) a locked door. */
function checker(opts: { doorLocked?: boolean } = {}): WorldLockChecker {
  return {
    personLockedUntil: (_roomId, userId) => (userId === "user-Locked" ? UNTIL : null),
    isDoorLocked: () => opts.doorLocked === true,
  };
}

function sayBodies(socket: FakeSocket): string[] {
  return socket.sent.filter((m) => m.type === "peer.say").map((m) => m.body as string);
}

describe("Q170 — guests are look-only, enforced server-side", () => {
  it("a guest's say frame is refused: it is broadcast to NOBODY, not even echoed", () => {
    const room = new WorldRoom(new RoomHub(), {});
    const g = fakeSocket();
    const m = fakeSocket();
    expect(room.attach(g, guest())).toBe(true);
    expect(room.attach(m, member("Member"))).toBe(true);
    g.sent = [];
    m.sent = [];

    room.handleFrame(g, JSON.stringify({ type: "say", body: "guest-words" }));
    expect(sayBodies(m)).toEqual([]);
    expect(sayBodies(g)).toEqual([]);
  });

  it("a member's say IS witnessed by the guest — guests listen", () => {
    const room = new WorldRoom(new RoomHub(), {});
    const g = fakeSocket();
    const m = fakeSocket();
    room.attach(g, guest());
    room.attach(m, member("Member"));
    g.sent = [];
    m.sent = [];

    room.handleFrame(m, JSON.stringify({ type: "say", body: "member-words" }));
    expect(sayBodies(g)).toEqual(["member-words"]);
  });

  it("a guest carries no voice: the voice join is denied with the guests reason", () => {
    const room = new WorldRoom(new RoomHub(), {});
    const g = fakeSocket();
    room.attach(g, guest());
    g.sent = [];
    room.handleFrame(g, JSON.stringify({ type: "voice.join" }));
    const denied = g.sent.filter((x) => x.type === "voice.denied");
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[0].reason).toBe("guests");
  });
});

describe("Q170 — locks enforced at attach via WorldLockChecker (4415 person / 4416 door)", () => {
  it("the close-code constants are 4415 / 4416", () => {
    expect(WORLD_LOCKED_OUT_CLOSE_CODE).toBe(4415);
    expect(WORLD_DOOR_LOCKED_CLOSE_CODE).toBe(4416);
  });

  it("a person-locked member is refused at attach: room.locked kind=person with the lift time, closed 4415, never inside", () => {
    const room = new WorldRoom(new RoomHub(), { locks: checker() });
    const s = fakeSocket();
    expect(room.attach(s, member("Locked"))).toBe(false);
    const locked = s.sent.find((x) => x.type === "room.locked");
    expect(locked).toMatchObject({ kind: "person", roomId: room.roomId });
    expect(locked.until).toBe(new Date(UNTIL).toISOString());
    expect(s.closedWith?.code).toBe(4415);
    expect(room.size()).toBe(0);
    expect(room.admissionBlock(member("Locked"))).toEqual({ kind: "person", until: UNTIL });
  });

  it("a PERSON lock has no admin bypass — it binds the named account whoever they are", () => {
    const room = new WorldRoom(new RoomHub(), { locks: checker() });
    const s = fakeSocket();
    expect(room.attach(s, member("Locked", true))).toBe(false);
    expect(s.closedWith?.code).toBe(4415);
  });

  it("a door-locked room refuses a new member: room.locked kind=door, closed 4416", () => {
    const room = new WorldRoom(new RoomHub(), { locks: checker({ doorLocked: true }) });
    const s = fakeSocket();
    expect(room.attach(s, member("Member"))).toBe(false);
    const locked = s.sent.find((x) => x.type === "room.locked");
    expect(locked).toMatchObject({ kind: "door", roomId: room.roomId });
    expect(locked.until).toBeUndefined();
    expect(s.closedWith?.code).toBe(4416);
    expect(room.size()).toBe(0);
  });

  it("admins bypass the DOOR lock — the admin walks in", () => {
    const room = new WorldRoom(new RoomHub(), { locks: checker({ doorLocked: true }) });
    const s = fakeSocket();
    expect(room.attach(s, member("Admin", true))).toBe(true);
    expect(s.closedWith).toBeNull();
    expect(room.size()).toBe(1);
    expect(room.admissionBlock(member("Admin", true))).toBeNull();
  });

  it("the door lock binds guests too (no account is not a bypass)", () => {
    const room = new WorldRoom(new RoomHub(), { locks: checker({ doorLocked: true }) });
    const s = fakeSocket();
    expect(room.attach(s, guest())).toBe(false);
    expect(s.closedWith?.code).toBe(4416);
  });

  it("with no locks standing, members and guests attach normally", () => {
    const room = new WorldRoom(new RoomHub(), { locks: checker() });
    expect(room.attach(fakeSocket(), member("Member"))).toBe(true);
    expect(room.attach(fakeSocket(), guest())).toBe(true);
    expect(room.admissionBlock(member("Member"))).toBeNull();
    expect(room.admissionBlock(guest())).toBeNull();
  });
});
