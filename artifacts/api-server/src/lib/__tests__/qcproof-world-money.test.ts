/**
 * QC-200 PRE-PROOF — Q172 money moments + Q174 drop claim, API half.
 *
 * The ledger marks both BLOCKED-signed-in: the end-to-end landing
 * (tip from a seat, a live drop event) is the owner's walk and is
 * NOT claimed here. This file pins the server CODE CORE:
 *
 * Q172 — the King's daily moment pays KING_MOMENT_REWARD_VB = 25
 * ONCE per member per day, drawn from the shared weekly envelope
 * WEEKLY_QUEST_POOL_VB = 300 whose spend sums ALL FOUR sources
 * (quests + King gifts + tutorial + daily trio) and refuses at
 * exhaustion — the boundary is exact: spend + 25 ≤ 300 pays,
 * spend + 25 > 300 refuses with reason "pool" and grants nothing.
 * Driven through the real createKingMomentClaimer with fake
 * stores (the world-king-moment.test.ts pattern). Stage tips
 * moving the full amount with no fee are cross-checked by the
 * standing world-stage-tips.test.ts suite (named in the report),
 * per the task's cross-check instruction.
 *
 * Q174 — the room enforces members-only + in-room + first-come on
 * a drop claim (the payout rail's combined-pool budget refusal is
 * pinned by world-events-drop-claim.test.ts; the reservation
 * machine's timing by world-room-drop-claim.test.ts). Pinned here
 * at claim level: the cross-room leg (a member standing in
 * ANOTHER room cannot claim this room's drop — the claim only
 * exists where the claimant stands), the denial ORDER a second
 * claimant meets, and the FE/API pool mirrors agreeing at 1,000.
 */
import { describe, it, expect } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldRoom, type WorldIdentity } from "../world-room";
import {
  createKingMomentClaimer,
  KING_MOMENT_REWARD_VB,
  __setKingGiftEventNotifier,
  type KingMomentStore,
} from "../world-king-moment";
import {
  WEEKLY_QUEST_POOL_VB,
  questPoolSpendVb,
  type QuestPoolStore,
} from "../quest-pool";
import { STREAM_DROP_WEEKLY_CAP_VB } from "../stream-drops";
import type { KingMoment as KingMomentRow } from "@workspace/db";

/* ─── Q172 fakes ────────────────────────────────────────────────── */

const DATE = "2026-11-02";
const NOW_MS = Date.parse("2026-11-02T12:00:00.000Z");

/* The landed-gift tell is best-effort push wiring (pinned by
 * push-king-gift-wiring.test.ts) — stub it so this suite's claims
 * never reach the dummy-DB notifier. */
__setKingGiftEventNotifier(async () => undefined);

class FakeKingStore implements KingMomentStore {
  claims = new Map<string, number>();
  grantCalls: { userId: string; amountVb: number }[] = [];
  async getMoment(date: string) {
    return {
      momentDate: date,
      firedAt: new Date(NOW_MS - 60_000),
      claimDeadline: new Date(NOW_MS + 3_600_000),
      payload: {},
    } as KingMomentRow;
  }
  async markFired() {
    return true;
  }
  async insertClaim(userId: string, date: string, amountVb: number) {
    const key = `${userId}|${date}`;
    if (this.claims.has(key)) return false;
    this.claims.set(key, amountVb);
    return true;
  }
  async deleteClaim(userId: string, date: string) {
    this.claims.delete(`${userId}|${date}`);
  }
  async grant(userId: string, amountVb: number) {
    this.grantCalls.push({ userId, amountVb });
  }
  async momentMaterial() {
    return { kingName: "The King", risers: [], tonight: [] };
  }
}

function pool(spend: {
  quests?: number;
  king?: number;
  tutorial?: number;
  daily?: number;
}): QuestPoolStore {
  return {
    questClaimsVb: async () => spend.quests ?? 0,
    kingClaimsVb: async () => spend.king ?? 0,
    tutorialClaimsVb: async () => spend.tutorial ?? 0,
    dailyClaimsVb: async () => spend.daily ?? 0,
  };
}

describe("Q172 — the King's daily moment + the shared weekly envelope", () => {
  it("the numbers are exact: gift 25 VB, envelope 300 VB", () => {
    expect(KING_MOMENT_REWARD_VB).toBe(25);
    expect(WEEKLY_QUEST_POOL_VB).toBe(300);
  });

  it("the envelope's spend sums ALL FOUR sources — quests + King gifts + tutorial + daily trio", async () => {
    const spend = await questPoolSpendVb(
      pool({ quests: 40, king: 25, tutorial: 100, daily: 60 }),
      "user-A",
      "2026-11-02",
    );
    expect(spend).toBe(225);
  });

  it("a claim inside the window pays exactly 25, ONCE per day — the second claim is 'already' and grants nothing more", async () => {
    const store = new FakeKingStore();
    const claim = createKingMomentClaimer(store, pool({}));
    expect(await claim("user-A", DATE, NOW_MS)).toEqual({ ok: true, amountVb: 25 });
    expect(store.grantCalls).toEqual([{ userId: "user-A", amountVb: 25 }]);
    expect(await claim("user-A", DATE, NOW_MS)).toEqual({ ok: false, reason: "already" });
    expect(store.grantCalls).toHaveLength(1);
    // A different member the same day still claims their own gift.
    expect(await claim("user-B", DATE, NOW_MS)).toEqual({ ok: true, amountVb: 25 });
    expect(store.grantCalls).toHaveLength(2);
  });

  it("the envelope boundary is exact: spend 275 + 25 = 300 pays; spend 276 refuses 'pool' with no claim row and no grant", async () => {
    const storeOk = new FakeKingStore();
    const claimOk = createKingMomentClaimer(storeOk, pool({ quests: 200, tutorial: 75 }));
    expect(await claimOk("user-A", DATE, NOW_MS)).toEqual({ ok: true, amountVb: 25 });

    const storeFull = new FakeKingStore();
    const claimFull = createKingMomentClaimer(storeFull, pool({ quests: 276 }));
    expect(await claimFull("user-A", DATE, NOW_MS)).toEqual({ ok: false, reason: "pool" });
    expect(storeFull.grantCalls).toEqual([]);
    expect(storeFull.claims.size).toBe(0);
  });

  it("exhaustion by ANY source mix refuses — King gifts already drawn count against the next claim", async () => {
    const store = new FakeKingStore();
    const claim = createKingMomentClaimer(store, pool({ king: 300 }));
    expect(await claim("user-A", DATE, NOW_MS)).toEqual({ ok: false, reason: "pool" });
    expect(store.grantCalls).toEqual([]);
  });

  it("outside a fired moment's window the claim is 'closed'", async () => {
    const store = new FakeKingStore();
    store.getMoment = async () => null;
    const claim = createKingMomentClaimer(store, pool({}));
    expect(await claim("user-A", DATE, NOW_MS)).toEqual({ ok: false, reason: "closed" });
    expect(store.grantCalls).toEqual([]);
  });
});

/* ─── Q174 room fakes ───────────────────────────────────────────── */

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
const denied = (s: FakeSocket) =>
  s.sent.filter((m) => m.type === "drop.denied").map((m) => m.reason as string);

describe("Q174 — drop claim: members-only + in-room + first-come, paid from the shared 1,000 pool", () => {
  it("the server's combined drop-pool cap is 1,000 VB/week — the FE mirror's number", () => {
    expect(STREAM_DROP_WEEKLY_CAP_VB).toBe(1000);
  });

  it("IN-ROOM: a member standing in ANOTHER room cannot claim this room's drop — 'no-drop', the rails never move", async () => {
    let calls = 0;
    const claimer = async () => {
      calls++;
      return { ok: true } as const;
    };
    const hall = new WorldRoom(new RoomHub(), { claimWorldDrop: claimer });
    const elsewhere = new WorldRoom(new RoomHub(), { claimWorldDrop: claimer });
    expect(hall.landDrop({ eventId: "evt-x", title: "X", amountVb: 100, claimCap: 1 })).toBe(true);

    const outsider = fakeSocket();
    elsewhere.attach(outsider, member("Outsider"));
    outsider.sent = [];
    elsewhere.handleFrame(outsider, JSON.stringify({ type: "drop.claim" }));
    await flush();
    expect(denied(outsider)).toEqual(["no-drop"]);
    expect(calls).toBe(0);
    expect(hall.dropBroadcast()?.claimsLeft).toBe(1);
  });

  it("first-come order: first member lands it, the second meets 'claimed-out', the winner re-tapping meets 'already-claimed', a guest meets 'guests'", async () => {
    const room = new WorldRoom(new RoomHub(), {
      claimWorldDrop: async () => ({ ok: true }) as const,
    });
    const a = fakeSocket();
    const b = fakeSocket();
    const g = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    room.attach(g, guest());
    room.landDrop({ eventId: "evt-y", title: "Y", amountVb: 100, claimCap: 1 });
    a.sent = [];
    b.sent = [];
    g.sent = [];

    room.handleFrame(g, JSON.stringify({ type: "drop.claim" }));
    expect(denied(g)).toEqual(["guests"]);

    room.handleFrame(a, JSON.stringify({ type: "drop.claim" }));
    await flush();
    expect(a.sent.some((m) => m.type === "drop.claimed")).toBe(true);
    expect(room.dropBroadcast()?.claimsLeft).toBe(0);

    room.handleFrame(b, JSON.stringify({ type: "drop.claim" }));
    expect(denied(b)).toEqual(["claimed-out"]);

    room.handleFrame(a, JSON.stringify({ type: "drop.claim" }));
    expect(denied(a)).toEqual(["already-claimed"]);
  });
});
