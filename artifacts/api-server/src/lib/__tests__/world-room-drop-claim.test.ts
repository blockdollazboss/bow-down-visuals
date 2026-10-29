/**
 * Drop spectacle claims — the room handler's reservation machine
 * (Stack800 Lane 7, item 3).
 *
 * world-events.test.ts pins the claim flow end-to-end through the
 * palace (guests / first-come / already-claimed / claimed-out /
 * no-drop / budget rollback), and world-events-drop-claim.test.ts
 * pins the payout rail itself. What neither covers is the room
 * handler's own timing contract — the part the client's claim
 * book (bow-down-visuals lib/world/drop-spectacle) is built
 * against:
 *
 * - the reservation moves SYNCHRONOUSLY, before the async payout:
 *   two fast claims can never both take the last spot, and the
 *   second is refused "claimed-out" without the rails moving;
 * - "already-claimed" is checked BEFORE the cap: the member who
 *   took the LAST spot and taps again hears "already-claimed"
 *   (which the client's book reads as proof the claim landed),
 *   never "claimed-out";
 * - a THROWN payout rolls back exactly like a "budget" refusal —
 *   denied "error", spot restored, retry allowed;
 * - with no claimer wired the answer is "error" and NO
 *   reservation is taken at all;
 * - a drop swept mid-payout resolves silently: the grant stands
 *   (the claimer ran), but no claimed/denied frame follows — the
 *   room has moved on.
 */
import { describe, it, expect } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldRoom, type WorldIdentity } from "../world-room";

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

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type ClaimResult = { ok: true } | { ok: false; reason: "budget" | "error" };

function claimFrame(room: WorldRoom, socket: FakeSocket) {
  room.handleFrame(socket, JSON.stringify({ type: "drop.claim" }));
}

function deniedReasons(socket: FakeSocket): string[] {
  return socket.sent.filter((m) => m.type === "drop.denied").map((m) => m.reason as string);
}

const DROP = { eventId: "evt-claim", title: "Test Drop", amountVb: 200, claimCap: 1 };

describe("drop.claim — the reservation machine", () => {
  it("two fast claims for the last spot: the reservation is synchronous — one pays, one is refused, the rails move once", async () => {
    const gate = deferred<ClaimResult>();
    const calls: Array<{ userId: string; amountVb: number; eventId: string }> = [];
    const room = new WorldRoom(new RoomHub(), {
      claimWorldDrop: (userId, amountVb, eventId) => {
        calls.push({ userId, amountVb, eventId });
        return gate.promise;
      },
    });
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    expect(room.landDrop(DROP)).toBe(true);
    a.sent = [];
    b.sent = [];

    // Both claims land before the first payout resolves.
    claimFrame(room, a);
    claimFrame(room, b);
    expect(calls).toEqual([{ userId: "user-Alpha", amountVb: 200, eventId: "evt-claim" }]);
    expect(deniedReasons(b)).toEqual(["claimed-out"]);
    expect(room.dropBroadcast()?.claimsLeft).toBe(0);

    gate.resolve({ ok: true });
    await flush();
    const witnessed = a.sent.filter((m) => m.type === "drop.claimed").pop();
    expect(witnessed?.claim).toEqual({ name: "Alpha", amountVb: 200 });
    expect(witnessed?.drop.claimsLeft).toBe(0);
    expect(deniedReasons(a)).toEqual([]);
  });

  it("the member who took the LAST spot hears already-claimed on a re-tap — never claimed-out", async () => {
    const room = new WorldRoom(new RoomHub(), {
      claimWorldDrop: async () => ({ ok: true }) as ClaimResult,
    });
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    room.landDrop(DROP);
    claimFrame(room, a);
    await flush();
    expect(room.dropBroadcast()?.claimsLeft).toBe(0);
    a.sent = [];
    claimFrame(room, a);
    expect(deniedReasons(a)).toEqual(["already-claimed"]);
  });

  it("a thrown payout rolls the reservation back — denied error, spot restored, retry lands", async () => {
    let shouldThrow = true;
    let calls = 0;
    const room = new WorldRoom(new RoomHub(), {
      claimWorldDrop: async () => {
        calls++;
        if (shouldThrow) throw new Error("rails down");
        return { ok: true } as ClaimResult;
      },
    });
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    room.landDrop(DROP);
    a.sent = [];

    claimFrame(room, a);
    await flush();
    expect(deniedReasons(a)).toEqual(["error"]);
    expect(room.dropBroadcast()?.claimsLeft).toBe(1);

    shouldThrow = false;
    claimFrame(room, a);
    await flush();
    expect(calls).toBe(2);
    expect(a.sent.filter((m) => m.type === "drop.claimed")).toHaveLength(1);
    expect(room.dropBroadcast()?.claimsLeft).toBe(0);
  });

  it("with no claimer wired the answer is error and no reservation is taken", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    room.landDrop(DROP);
    a.sent = [];
    claimFrame(room, a);
    expect(deniedReasons(a)).toEqual(["error"]);
    expect(room.dropBroadcast()?.claimsLeft).toBe(1);
  });

  it("a drop swept mid-payout resolves silently — no claimed frame, no denial, the room has moved on", async () => {
    const gate = deferred<ClaimResult>();
    let calls = 0;
    const room = new WorldRoom(new RoomHub(), {
      claimWorldDrop: () => {
        calls++;
        return gate.promise;
      },
    });
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    room.landDrop(DROP);
    claimFrame(room, a);
    expect(calls).toBe(1);
    expect(room.endDrop(DROP.eventId)).toBe(true);
    a.sent = [];

    gate.resolve({ ok: true });
    await flush();
    expect(a.sent.filter((m) => m.type === "drop.claimed")).toHaveLength(0);
    expect(deniedReasons(a)).toEqual([]);
    expect(room.dropBroadcast()).toBeNull();
  });

  it("guests are refused before any reservation or rail movement", () => {
    let calls = 0;
    const room = new WorldRoom(new RoomHub(), {
      claimWorldDrop: async () => {
        calls++;
        return { ok: true } as ClaimResult;
      },
    });
    const g = fakeSocket();
    room.attach(g, guest());
    room.landDrop(DROP);
    g.sent = [];
    claimFrame(room, g);
    expect(deniedReasons(g)).toEqual(["guests"]);
    expect(calls).toBe(0);
    expect(room.dropBroadcast()?.claimsLeft).toBe(1);
  });
});
