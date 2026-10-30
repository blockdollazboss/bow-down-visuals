/**
 * King's daily gift landed → member bell + device-push wiring
 * (push families #10, stack900 lane A4).
 *
 * The authoritative moment is the gift grant landing inside
 * createKingMomentClaimer's claim path. The tell fires only from
 * the one path that lands THIS claim's grant — inside the
 * protection of the claim row, the structural exactly-once anchor
 * (unique (user, date) insert): a replayed claim reads "already"
 * and never reaches the tell, a refused claim (window closed,
 * pool spent) never reaches it, and a failed grant rolls the row
 * back and returns before it — so the retry that finally lands
 * tells exactly once. Category money (every landed-credit
 * precedent: stage tips, Pitch & Fix rewards, referral payouts),
 * deep link /world.
 *
 * The other half of family #10's remainder — Creator Room invites
 * — is NOT wired here: no invite creation flow exists in code to
 * wire against (see stack900-world-notify-report.md for the
 * proof). Nothing was invented for it.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __setKingGiftEventNotifier,
  buildKingGiftEvent,
  createKingMomentClaimer,
  KING_MOMENT_REWARD_VB,
  type KingMomentStore,
} from "../world-king-moment";
import type { QuestPoolStore } from "../quest-pool";
import type { UserEventInput } from "../push-events";
import type { KingMoment as KingMomentRow } from "@workspace/db";

/* ── Fakes (the world-king-moment.test.ts shape) ────────────────── */

class FakeKingStore implements KingMomentStore {
  moments = new Map<string, KingMomentRow>();
  claims = new Map<string, number>(); // `${userId}|${date}` → amountVb
  questVb = 0;
  grantCalls: { userId: string; amountVb: number }[] = [];
  grantFails = false;

  async getMoment(date: string) {
    return this.moments.get(date) ?? null;
  }
  async markFired() {
    return false;
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
    if (this.grantFails) throw new Error("grant boom");
    this.grantCalls.push({ userId, amountVb });
  }
  async momentMaterial() {
    return { kingName: "Thy Cheat Code", risers: [], tonight: [] };
  }
}

function poolOf(store: FakeKingStore): QuestPoolStore {
  return {
    questClaimsVb: async () => store.questVb,
    kingClaimsVb: async (userId, weekStart) => {
      let sum = 0;
      for (const [key, amount] of store.claims) {
        const [u, d] = key.split("|");
        if (u === userId && d! >= weekStart) sum += amount;
      }
      return sum;
    },
    tutorialClaimsVb: async () => 0,
    dailyClaimsVb: async () => 0,
  };
}

/** Saturday Oct 17, 2026, 00:00:30 UTC — just past the day-turn. */
const FIRE_MS = Date.parse("2026-10-17T00:00:30.000Z");
const DATE = "2026-10-17";
const CLAIM_AT = FIRE_MS + 5 * 60_000;

function firedStore(): FakeKingStore {
  const store = new FakeKingStore();
  store.moments.set(DATE, {
    momentDate: DATE,
    firedAt: new Date(FIRE_MS),
    claimDeadline: new Date(FIRE_MS + 60 * 60_000),
    payload: {},
  } as KingMomentRow);
  return store;
}

function capture() {
  const events: UserEventInput[] = [];
  __setKingGiftEventNotifier(async (input) => {
    events.push(input);
  });
  return events;
}

afterEach(() => {
  __setKingGiftEventNotifier(null);
});

describe("buildKingGiftEvent", () => {
  it("addresses the member, money category, /world link, honest amount", () => {
    const ev = buildKingGiftEvent({ userId: "user-a", amountVb: KING_MOMENT_REWARD_VB });
    expect(ev).toMatchObject({
      userId: "user-a",
      category: "money",
      kind: "king_gift",
      link: "/world",
    });
    expect(ev.body).toContain(`${KING_MOMENT_REWARD_VB} VB`);
  });
});

describe("king.claim gift push wiring", () => {
  it("a landed gift tells the member exactly once", async () => {
    const store = firedStore();
    const events = capture();
    const claim = createKingMomentClaimer(store, poolOf(store));
    await expect(claim("user-a", DATE, CLAIM_AT)).resolves.toEqual({
      ok: true,
      amountVb: KING_MOMENT_REWARD_VB,
    });
    expect(store.grantCalls).toEqual([{ userId: "user-a", amountVb: KING_MOMENT_REWARD_VB }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: "user-a", kind: "king_gift", category: "money" });
  });

  it("a replayed claim (already) never re-tells — and never re-pays", async () => {
    const store = firedStore();
    const events = capture();
    const claim = createKingMomentClaimer(store, poolOf(store));
    await claim("user-a", DATE, CLAIM_AT);
    await expect(claim("user-a", DATE, CLAIM_AT + 1000)).resolves.toEqual({
      ok: false,
      reason: "already",
    });
    expect(store.grantCalls).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("two claims racing the same moment land — and tell — exactly once", async () => {
    const store = firedStore();
    const events = capture();
    const claim = createKingMomentClaimer(store, poolOf(store));
    const [a, b] = await Promise.all([
      claim("user-a", DATE, CLAIM_AT),
      claim("user-a", DATE, CLAIM_AT),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect(store.grantCalls).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("refused claims tell nobody: window closed, and pool spent", async () => {
    const store = firedStore();
    const events = capture();
    const claim = createKingMomentClaimer(store, poolOf(store));
    await expect(claim("user-a", "2026-10-16", CLAIM_AT)).resolves.toEqual({
      ok: false,
      reason: "closed",
    });
    store.questVb = 280; // 280 + 25 gift > the 300 pool
    await expect(claim("user-a", DATE, CLAIM_AT)).resolves.toEqual({
      ok: false,
      reason: "pool",
    });
    expect(store.grantCalls).toEqual([]);
    expect(events).toEqual([]);
  });

  it("a failed grant tells nobody; the retry that lands tells exactly once", async () => {
    const store = firedStore();
    const events = capture();
    const claim = createKingMomentClaimer(store, poolOf(store));
    store.grantFails = true;
    await expect(claim("user-a", DATE, CLAIM_AT)).resolves.toEqual({
      ok: false,
      reason: "error",
    });
    expect(events).toEqual([]);
    store.grantFails = false;
    await expect(claim("user-a", DATE, CLAIM_AT)).resolves.toEqual({
      ok: true,
      amountVb: KING_MOMENT_REWARD_VB,
    });
    expect(store.grantCalls).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("a throwing notifier cannot unwind a landed gift", async () => {
    const store = firedStore();
    __setKingGiftEventNotifier(async () => {
      throw new Error("push down");
    });
    const claim = createKingMomentClaimer(store, poolOf(store));
    await expect(claim("user-a", DATE, CLAIM_AT)).resolves.toEqual({
      ok: true,
      amountVb: KING_MOMENT_REWARD_VB,
    });
    expect(store.grantCalls).toHaveLength(1);
    expect(store.claims.get(`user-a|${DATE}`)).toBe(KING_MOMENT_REWARD_VB);
  });

  it("each member's gift tells only that member", async () => {
    const store = firedStore();
    const events = capture();
    const claim = createKingMomentClaimer(store, poolOf(store));
    await claim("user-a", DATE, CLAIM_AT);
    await claim("user-b", DATE, CLAIM_AT);
    expect(events.map((e) => e.userId)).toEqual(["user-a", "user-b"]);
  });
});
