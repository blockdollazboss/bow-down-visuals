/**
 * Stage shoutouts in the World (Ring 3, item 3.3 remainder) — the
 * purchase rail's pins, at balance level with a fake store.
 *
 * The stage shoutout buys the performer's shoutout THROUGH the
 * site rail: the price comes from the performer's OWN
 * shoutout_settings row (the 2D rail's price source), charged in
 * Visual Bucs at that number, and the performer is credited the
 * net after the rail's flat 5% fee. The math is pinned HERE
 * against the rail's own exported constants and rounding
 * (routes/generate/shoutouts.ts) — if the rail's fee or rounding
 * ever moves, this suite fails instead of the World silently
 * charging a different split.
 *
 * Exactly-once, stage-tip discipline: one fan debit, one ledger
 * row, one performer credit per attempt; a replayed attempt key
 * moves nothing again; an insert failure refunds the fan in full
 * and voids the key; a credit failure reverses any landed credit
 * (and only a landed one), refunds, drops the row, voids the key.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createStageShoutouter,
  stageShoutoutSplit,
  STAGE_SHOUTOUT_PLATFORM_FEE_PCT,
  buildStageShoutoutEvent,
  __setStageShoutoutEventNotifier,
  type StageShoutoutStore,
  type StageShoutoutRow,
} from "../world-stage-shoutouts";
import { OutOfCreditsError, CreditsDisabledError } from "../credits";
import { SHOUTOUT_PLATFORM_FEE_PCT, netAfterFee } from "../../routes/generate/shoutouts";

const FAN = "fan-1";
const STAR = "star-1";
const ROOM = "world:theatre";

interface FakeState {
  balances: Map<string, number>;
  offers: Map<string, { price_cents: number; accepting: string } | null>;
  rows: StageShoutoutRow[];
  recordedCreditKeys: Set<string>;
  chargeCalls: Array<{ userId: string; amount: number; idempotencyKey: string }>;
  creditCalls: Array<{ userId: string; amount: number }>;
  recordCalls: Array<{ userId: string; amount: number; creditKey: string }>;
  reversals: Array<{ userId: string; amount: number }>;
  refundCalls: Array<{ userId: string; amount: number; action: string }>;
  voidedKeys: string[];
  insertFails: boolean;
  creditFails: boolean;
  recordFails: boolean;
  railDisabled: boolean;
}

function freshState(): FakeState {
  return {
    balances: new Map([
      [FAN, 500],
      [STAR, 0],
    ]),
    offers: new Map([[STAR, { price_cents: 100, accepting: "true" }]]),
    rows: [],
    recordedCreditKeys: new Set(),
    chargeCalls: [],
    creditCalls: [],
    recordCalls: [],
    reversals: [],
    refundCalls: [],
    voidedKeys: [],
    insertFails: false,
    creditFails: false,
    recordFails: false,
    railDisabled: false,
  };
}

function fakeStore(state: FakeState): StageShoutoutStore {
  return {
    async findOffer(toUserId) {
      return state.offers.get(toUserId) ?? null;
    },
    async findByIdempotencyKey(key) {
      return state.rows.find((r) => r.idempotencyKey === key) ?? null;
    },
    async insert(row) {
      if (state.insertFails) throw new Error("insert blew up");
      const full: StageShoutoutRow = {
        ...row,
        id: `row-${state.rows.length + 1}`,
        creatorCreditedAt: null,
      };
      state.rows.push(full);
      return full;
    },
    async creditAlreadyRecorded(creditKey) {
      return state.recordedCreditKeys.has(creditKey);
    },
    async markCredited(id) {
      const row = state.rows.find((r) => r.id === id);
      if (row) row.creatorCreditedAt = new Date();
    },
    async deleteById(id) {
      state.rows = state.rows.filter((r) => r.id !== id);
    },
  };
}

function buildShoutouter(state: FakeState) {
  return createStageShoutouter({
    store: fakeStore(state),
    charge: async ({ userId, amount, idempotencyKey }) => {
      if (state.railDisabled) throw new CreditsDisabledError();
      const bal = state.balances.get(userId) ?? 0;
      if (bal < amount) throw new OutOfCreditsError();
      state.balances.set(userId, bal - amount);
      state.chargeCalls.push({ userId, amount, idempotencyKey });
    },
    creditPerformer: async (userId, amount) => {
      if (state.creditFails) throw new Error("credit blew up");
      state.balances.set(userId, (state.balances.get(userId) ?? 0) + amount);
      state.creditCalls.push({ userId, amount });
    },
    recordCredit: async (userId, amount, creditKey) => {
      if (state.recordFails) throw new Error("record blew up");
      state.recordedCreditKeys.add(creditKey);
      state.recordCalls.push({ userId, amount, creditKey });
    },
    reverseCredit: async (userId, amount) => {
      state.balances.set(userId, (state.balances.get(userId) ?? 0) - amount);
      state.reversals.push({ userId, amount });
    },
    refund: async (userId, amount, action) => {
      state.balances.set(userId, (state.balances.get(userId) ?? 0) + amount);
      state.refundCalls.push({ userId, amount, action });
    },
    voidKey: (key) => {
      state.voidedKeys.push(key);
    },
    resolveDisplayName: async () => "Riley",
  });
}

type ShoutInput = Parameters<ReturnType<typeof buildShoutouter>>[0];
const shout = (over: Partial<ShoutInput> = {}): ShoutInput => ({
  fromUserId: FAN,
  toUserId: STAR,
  message: "Play the anthem!",
  roomId: ROOM,
  attemptKey: "attempt-1",
  ...over,
});

let notified: Array<Parameters<Parameters<typeof __setStageShoutoutEventNotifier>[0]>[0]>;

beforeEach(() => {
  notified = [];
  __setStageShoutoutEventNotifier((event) => {
    notified.push(event);
  });
});

afterEach(() => {
  __setStageShoutoutEventNotifier(null);
});

describe("the split — pinned to the site rail", () => {
  it("uses the rail's own fee constant", () => {
    expect(STAGE_SHOUTOUT_PLATFORM_FEE_PCT).toBe(SHOUTOUT_PLATFORM_FEE_PCT);
    expect(STAGE_SHOUTOUT_PLATFORM_FEE_PCT).toBe(5);
  });

  it("matches the rail's netAfterFee rounding on every amount", () => {
    for (const gross of [0, 1, 5, 99, 100, 101, 250, 999, 2500, 12345]) {
      const { feeVb, netVb } = stageShoutoutSplit(gross);
      expect(netVb).toBe(netAfterFee(gross, SHOUTOUT_PLATFORM_FEE_PCT));
      expect(feeVb).toBe(gross - netVb);
      expect(feeVb + netVb).toBe(gross);
    }
  });

  it("the known figures: 100 → 95/5, 2500 → 2375/125, 99 → 94/5, 1 → 1/0", () => {
    expect(stageShoutoutSplit(100)).toEqual({ feeVb: 5, netVb: 95 });
    expect(stageShoutoutSplit(2500)).toEqual({ feeVb: 125, netVb: 2375 });
    expect(stageShoutoutSplit(99)).toEqual({ feeVb: 5, netVb: 94 });
    expect(stageShoutoutSplit(1)).toEqual({ feeVb: 0, netVb: 1 });
    expect(stageShoutoutSplit(0)).toEqual({ feeVb: 0, netVb: 0 });
  });
});

describe("a landed shoutout", () => {
  it("debits the fan the gross, credits the performer the NET, rows the split", async () => {
    const state = freshState();
    const result = await buildShoutouter(state)(shout());
    expect(result).toEqual({ ok: true, amountVb: 100 });
    expect(state.balances.get(FAN)).toBe(400);
    expect(state.balances.get(STAR)).toBe(95);
    expect(state.rows).toHaveLength(1);
    const row = state.rows[0]!;
    expect(row.amountVb).toBe(100);
    expect(row.feeVb).toBe(5);
    expect(row.netVb).toBe(95);
    expect(row.message).toBe("Play the anthem!");
    expect(row.creatorCreditedAt).not.toBeNull();
    /* The performer's credit record rides the charge's key
     * extended — one purchase, one key family. */
    expect(state.chargeCalls).toHaveLength(1);
    expect(state.creditCalls).toEqual([{ userId: STAR, amount: 95 }]);
    expect(state.recordCalls).toEqual([
      { userId: STAR, amount: 95, creditKey: `${row.idempotencyKey}:credit` },
    ]);
  });

  it("charges the performer's OWN price — a 2500 setting charges 2500", async () => {
    const state = freshState();
    state.offers.set(STAR, { price_cents: 2500, accepting: "true" });
    state.balances.set(FAN, 3000);
    const result = await buildShoutouter(state)(shout());
    expect(result).toEqual({ ok: true, amountVb: 2500 });
    expect(state.balances.get(FAN)).toBe(500);
    expect(state.balances.get(STAR)).toBe(2375);
  });

  it("tells the performer once, with the net and the message", async () => {
    const state = freshState();
    await buildShoutouter(state)(shout());
    expect(notified).toHaveLength(1);
    const ev = notified[0]!;
    expect(ev.userId).toBe(STAR);
    expect(ev.kind).toBe("stage_shoutout");
    expect(ev.category).toBe("money");
    expect(ev.link).toBe("/world");
    expect(ev.title).toBe("New stage shoutout");
    expect(ev.body).toContain("Riley");
    expect(ev.body).toContain("95 Visual Bucs");
    expect(ev.body).toContain("Play the anthem!");
  });

  it("a FREE shoutout (price 0) moves no money and still lands + tells", async () => {
    const state = freshState();
    state.offers.set(STAR, { price_cents: 0, accepting: "true" });
    const result = await buildShoutouter(state)(shout());
    expect(result).toEqual({ ok: true, amountVb: 0 });
    expect(state.chargeCalls).toHaveLength(0);
    expect(state.creditCalls).toHaveLength(0);
    expect(state.balances.get(FAN)).toBe(500);
    expect(state.balances.get(STAR)).toBe(0);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ amountVb: 0, feeVb: 0, netVb: 0 });
    expect(state.rows[0]!.creatorCreditedAt).not.toBeNull();
    expect(notified).toHaveLength(1);
    expect(notified[0]!.body).toContain("free shoutout");
  });
});

describe("exactly-once", () => {
  it("a replayed attempt key charges once, rows once, credits once, tells once", async () => {
    const state = freshState();
    const shoutouter = buildShoutouter(state);
    const first = await shoutouter(shout());
    const replay = await shoutouter(shout());
    expect(first).toEqual({ ok: true, amountVb: 100 });
    expect(replay).toEqual({ ok: true, amountVb: 100 });
    expect(state.chargeCalls).toHaveLength(1);
    expect(state.rows).toHaveLength(1);
    expect(state.creditCalls).toHaveLength(1);
    expect(state.balances.get(FAN)).toBe(400);
    expect(state.balances.get(STAR)).toBe(95);
    expect(notified).toHaveLength(1);
  });

  it("a different attempt key is a different purchase", async () => {
    const state = freshState();
    const shoutouter = buildShoutouter(state);
    await shoutouter(shout());
    await shoutouter(shout({ attemptKey: "attempt-2" }));
    expect(state.rows).toHaveLength(2);
    expect(state.balances.get(FAN)).toBe(300);
    expect(state.balances.get(STAR)).toBe(190);
  });
});

describe("refusals move nothing", () => {
  it("not offered — no settings row: refused before any charge attempt", async () => {
    const state = freshState();
    state.offers.set(STAR, null);
    const result = await buildShoutouter(state)(shout());
    expect(result).toEqual({ ok: false, reason: "not-offered" });
    expect(state.chargeCalls).toHaveLength(0);
    expect(state.rows).toHaveLength(0);
    expect(state.balances.get(FAN)).toBe(500);
  });

  it("not offered — settings exist but accepting is off", async () => {
    const state = freshState();
    state.offers.set(STAR, { price_cents: 100, accepting: "false" });
    const result = await buildShoutouter(state)(shout());
    expect(result).toEqual({ ok: false, reason: "not-offered" });
    expect(state.chargeCalls).toHaveLength(0);
    expect(state.rows).toHaveLength(0);
  });

  it("insufficient — the fan's balance never moves, no row, no credit", async () => {
    const state = freshState();
    state.balances.set(FAN, 50);
    const result = await buildShoutouter(state)(shout());
    expect(result).toEqual({ ok: false, reason: "insufficient" });
    expect(state.balances.get(FAN)).toBe(50);
    expect(state.balances.get(STAR)).toBe(0);
    expect(state.rows).toHaveLength(0);
    expect(state.creditCalls).toHaveLength(0);
  });

  it("the credits rail being off reads disabled, not a generic error", async () => {
    const state = freshState();
    state.railDisabled = true;
    const result = await buildShoutouter(state)(shout());
    expect(result).toEqual({ ok: false, reason: "disabled" });
    expect(state.rows).toHaveLength(0);
    expect(state.balances.get(FAN)).toBe(500);
  });
});

describe("failure unwinds", () => {
  it("a ledger insert failure refunds the fan in full and voids the key", async () => {
    const state = freshState();
    state.insertFails = true;
    const result = await buildShoutouter(state)(shout());
    expect(result).toEqual({ ok: false, reason: "error" });
    expect(state.balances.get(FAN)).toBe(500);
    expect(state.balances.get(STAR)).toBe(0);
    expect(state.refundCalls).toEqual([
      { userId: FAN, amount: 100, action: "World Stage Shoutout — Refund (record failed)" },
    ]);
    expect(state.voidedKeys).toHaveLength(1);
    expect(state.creditCalls).toHaveLength(0);
  });

  it("a credit-record failure after the credit landed reverses it, refunds, drops the row, voids the key", async () => {
    const state = freshState();
    state.recordFails = true;
    const result = await buildShoutouter(state)(shout());
    expect(result).toEqual({ ok: false, reason: "error" });
    expect(state.reversals).toEqual([{ userId: STAR, amount: 95 }]);
    expect(state.refundCalls).toEqual([
      { userId: FAN, amount: 100, action: "World Stage Shoutout — Refund (credit failed)" },
    ]);
    expect(state.rows).toHaveLength(0);
    expect(state.voidedKeys).toHaveLength(1);
    expect(state.balances.get(FAN)).toBe(500);
    expect(state.balances.get(STAR)).toBe(0);
    expect(notified).toHaveLength(0);
  });

  it("a performer-credit failure before anything landed refunds WITHOUT a reversal", async () => {
    const state = freshState();
    state.creditFails = true;
    const result = await buildShoutouter(state)(shout());
    expect(result).toEqual({ ok: false, reason: "error" });
    expect(state.reversals).toEqual([]);
    expect(state.refundCalls).toHaveLength(1);
    expect(state.rows).toHaveLength(0);
    expect(state.balances.get(FAN)).toBe(500);
    expect(state.balances.get(STAR)).toBe(0);
    expect(notified).toHaveLength(0);
  });
});

describe("the performer tell", () => {
  it("buildStageShoutoutEvent names the fan, the net and the message", () => {
    const ev = buildStageShoutoutEvent({
      toUserId: STAR,
      fromName: "Riley",
      netVb: 95,
      message: "One more song!",
    });
    expect(ev.kind).toBe("stage_shoutout");
    expect(ev.body).toContain("Riley");
    expect(ev.body).toContain("95 Visual Bucs");
    expect(ev.body).toContain("One more song!");
  });
});
