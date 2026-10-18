/**
 * The King's moment in the room (lib/world-room, Ring 3).
 *
 * Pinned contract:
 * - The moment stands in the HALL only: beginKingMoment refuses on
 *   a room without the stage, so a second court can never stand.
 * - The welcome carries the moment while its window stands, with
 *   `claimed` answered for the joining peer.
 * - king.claim is members-only, in-window, once per member: the
 *   room's reservation moves synchronously (a double claim inside
 *   one tick pays once), the injected claimer does the paying, a
 *   landed claim is witnessed by the room (king.claimed — name +
 *   amount, server truth), and the claimer's refusal rolls the
 *   reservation back so a retry inside the window still works.
 * - A claim after the deadline sweeps the moment and reads closed.
 */
import { describe, it, expect, vi } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import {
  WorldRoom,
  type WorldIdentity,
  type WorldKingMomentClaimer,
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
const guest = (): WorldIdentity => ({
  userId: null,
  displayName: "Guest",
  avatarUrl: null,
  profileSlug: null,
});

const DATE = "2026-10-17";
const T0 = 1_000_000;
const DEADLINE = T0 + 60 * 60_000;

const flush = () => new Promise<void>((r) => setImmediate(r));

function hallWith(claimer: WorldKingMomentClaimer) {
  const room = new WorldRoom(new RoomHub(), { claimKingMoment: claimer });
  room.beginKingMoment({ date: DATE, claimDeadlineMs: DEADLINE });
  return room;
}

describe("the moment stands in the hall only", () => {
  it("beginKingMoment refuses on a room without the stage; the hall accepts + broadcasts king.state", () => {
    const music = new WorldRoom(new RoomHub(), {}, { roomId: "world:music-hall", name: "Music Hall" });
    expect(music.beginKingMoment({ date: DATE, claimDeadlineMs: DEADLINE })).toBe(false);
    expect(music.activeKingMomentDate()).toBeNull();

    const hall = new WorldRoom(new RoomHub());
    const ear = fakeSocket();
    hall.attach(ear, member("Ear"));
    ear.sent = [];
    expect(hall.beginKingMoment({ date: DATE, claimDeadlineMs: DEADLINE })).toBe(true);
    expect(hall.activeKingMomentDate()).toBe(DATE);
    const state = ear.sent.find((m) => m.type === "king.state");
    expect(state.kingMoment).toMatchObject({ date: DATE, claimDeadlineMs: DEADLINE, claimed: false });
    /* Same day again: idempotent, no second broadcast. */
    ear.sent = [];
    expect(hall.beginKingMoment({ date: DATE, claimDeadlineMs: DEADLINE })).toBe(true);
    expect(ear.sent.filter((m) => m.type === "king.state")).toHaveLength(0);
  });

  it("the welcome carries the moment, with `claimed` answered for the joiner", () => {
    const room = hallWith(async () => ({ ok: true, amountVb: 25 }));
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    const welcome = a.sent.find((m) => m.type === "welcome");
    expect(welcome.kingMoment).toMatchObject({ date: DATE, claimed: false });
  });
});

describe("king.claim", () => {
  it("a guest is refused (guests) and the claimer never runs", async () => {
    const claimer = vi.fn(async () => ({ ok: true as const, amountVb: 25 }));
    const room = hallWith(claimer as WorldKingMomentClaimer);
    const g = fakeSocket();
    room.attach(g, guest());
    g.sent = [];
    room.handleFrame(g, JSON.stringify({ type: "king.claim" }), T0 + 1);
    await flush();
    expect(g.sent.find((m) => m.type === "king.denied")?.reason).toBe("guests");
    expect(claimer).not.toHaveBeenCalled();
  });

  it("with no moment standing, a claim reads no-moment", async () => {
    const room = new WorldRoom(new RoomHub(), {
      claimKingMoment: async () => ({ ok: true, amountVb: 25 }),
    });
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    a.sent = [];
    room.handleFrame(a, JSON.stringify({ type: "king.claim" }), T0 + 1);
    await flush();
    expect(a.sent.find((m) => m.type === "king.denied")?.reason).toBe("no-moment");
  });

  it("a landed claim is witnessed by the room and marks the claimer claimed — once", async () => {
    const claimer = vi.fn(
      async (): Promise<{ ok: true; amountVb: number }> => ({ ok: true, amountVb: 25 }),
    );
    const room = hallWith(claimer as WorldKingMomentClaimer);
    const a = fakeSocket();
    const ear = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(ear, member("Ear"));
    a.sent = [];
    ear.sent = [];

    room.handleFrame(a, JSON.stringify({ type: "king.claim" }), T0 + 1);
    await flush();

    expect(claimer).toHaveBeenCalledTimes(1);
    expect(claimer).toHaveBeenCalledWith("user-Alpha", DATE, T0 + 1);
    const witnessed = ear.sent.find((m) => m.type === "king.claimed");
    expect(witnessed.claim).toEqual({ name: "Alpha", amountVb: 25 });
    /* The claimer's own copy now reads claimed. */
    const ownState = a.sent.filter((m) => m.type === "king.state").pop();
    expect(ownState.kingMoment.claimed).toBe(true);

    /* A second claim: refused by the room, claimer untouched. */
    room.handleFrame(a, JSON.stringify({ type: "king.claim" }), T0 + 2);
    await flush();
    expect(a.sent.filter((m) => m.type === "king.denied").pop()?.reason).toBe("already");
    expect(claimer).toHaveBeenCalledTimes(1);
  });

  it("two claims in the same tick pay once — the reservation is synchronous", async () => {
    let release!: (v: { ok: true; amountVb: number }) => void;
    const claimer = vi.fn(
      () =>
        new Promise<{ ok: true; amountVb: number }>((r) => {
          release = r;
        }),
    );
    const room = hallWith(claimer as unknown as WorldKingMomentClaimer);
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    room.handleFrame(a, JSON.stringify({ type: "king.claim" }), T0 + 1);
    room.handleFrame(a, JSON.stringify({ type: "king.claim" }), T0 + 1);
    expect(claimer).toHaveBeenCalledTimes(1);
    release({ ok: true, amountVb: 25 });
    await flush();
    expect(a.sent.filter((m) => m.type === "king.claimed")).toHaveLength(1);
  });

  it("a claimer refusal (pool) rolls the reservation back — a retry reaches the claimer again", async () => {
    const claimer = vi.fn(async () => ({
      ok: false as const,
      reason: "pool" as const,
    }));
    const room = hallWith(claimer as WorldKingMomentClaimer);
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    a.sent = [];
    room.handleFrame(a, JSON.stringify({ type: "king.claim" }), T0 + 1);
    await flush();
    expect(a.sent.find((m) => m.type === "king.denied")?.reason).toBe("pool");
    room.handleFrame(a, JSON.stringify({ type: "king.claim" }), T0 + 2);
    await flush();
    expect(claimer).toHaveBeenCalledTimes(2);
  });

  it("a claim after the deadline reads closed and sweeps the moment", async () => {
    const claimer = vi.fn(async () => ({ ok: true as const, amountVb: 25 }));
    const room = hallWith(claimer as WorldKingMomentClaimer);
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    a.sent = [];
    room.handleFrame(a, JSON.stringify({ type: "king.claim" }), DEADLINE + 1);
    await flush();
    expect(a.sent.find((m) => m.type === "king.denied")?.reason).toBe("closed");
    expect(room.activeKingMomentDate()).toBeNull();
    expect(claimer).not.toHaveBeenCalled();
  });
});
