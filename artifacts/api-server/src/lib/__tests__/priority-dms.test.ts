/**
 * Paid Priority DMs (Wave-4 #44) — core tests.
 *
 * The promises under test are the feature's honesty rules:
 *   - the platform gate is OPEN (owner ruling 2026-10-27); only the
 *     kill switch (PRIORITY_DM_ENABLED=false) closes it, and closed
 *     means nothing is sellable and no price is shown or charged;
 *   - the price is the platform's ruled 100 VB per message — a
 *     creator's stored price never sets or gates the charge, and
 *     opting in needs no price at all;
 *   - a charge happens exactly once — a retried purchase returns the
 *     original row and never charges again;
 *   - a block always wins: a pre-blocked fan is refused with NO
 *     charge; a block landing at delivery refunds exactly once; a
 *     block found at settle refunds exactly once;
 *   - an unanswered message auto-refunds in full at its stated
 *     deadline, exactly once (re-running settle is a no-op);
 *   - a reply inside the window pays the creator exactly once, and a
 *     reply AFTER the window earns nothing (the fan is refunded).
 */
import { describe, it, expect, vi } from "vitest";
import {
  isPriorityDmPlatformEnabled,
  evaluateSellable,
  validateSettingsUpdate,
  sendPriorityDm,
  settlePriorityDms,
  buildPriorityDmKey,
  priorityDmPriceVb,
  PRIORITY_DM_PRICE_VB,
  type PriorityDmDeps,
  type PriorityDmRow,
  type PriorityDmSettingsLike,
  type PriorityConversationLike,
} from "../priority-dms";

const FAN = "11111111-1111-4111-8111-111111111111";
const CREATOR = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-10-26T12:00:00.000Z");
const HOUR = 3600 * 1000;

function makeWorld(over: {
  settings?: PriorityDmSettingsLike | null;
  convStatus?: string | null; // null = no conversation yet
  blockAtDelivery?: boolean;
} = {}) {
  const settings: PriorityDmSettingsLike | null = over.settings === undefined
    ? { creatorUserId: CREATOR, optedIn: true, minPriceVb: 500, replyWindowHours: 48 }
    : over.settings;
  const conv: PriorityConversationLike | null = over.convStatus === null
    ? null
    : { id: "conv-1", status: over.convStatus ?? "inbox" };
  const rows: PriorityDmRow[] = [];
  const charges: Array<{ userId: string; amount: number; key: string }> = [];
  const refunds: Array<{ userId: string; amount: number }> = [];
  const payouts: Array<{ userId: string; amount: number }> = [];
  const chargedKeys = new Set<string>();
  let seq = 0;
  let deliveryChecks = 0;

  const store: PriorityDmDeps["store"] = {
    getSettings: async () => settings,
    findByIdempotencyKey: async (key) => rows.find((r) => r.idempotencyKey === key) ?? null,
    insertPriorityDm: async (input) => {
      if (rows.some((r) => r.idempotencyKey === input.idempotencyKey)) throw new Error("unique_violation");
      const row: PriorityDmRow = {
        ...input, id: `row-${++seq}`, repliedAt: null, settledAt: null, createdAt: T0,
      };
      rows.push(row);
      return row;
    },
    transitionFromHeld: async (id, to, patch) => {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== "held") return false;
      row.status = to;
      Object.assign(row, patch);
      return true;
    },
    setDelivery: async (id, conversationId, messageId) => {
      const row = rows.find((r) => r.id === id);
      if (row) { row.conversationId = conversationId; row.messageId = messageId; }
    },
    listHeld: async (filter) => rows.filter((r) =>
      r.status === "held" &&
      (!filter.creatorUserId || r.creatorUserId === filter.creatorUserId) &&
      (!filter.senderUserId || r.senderUserId === filter.senderUserId)),
    findConversationBetween: async () => conv,
    getOrCreateInboxConversation: async () => conv ?? { id: "conv-1", status: "inbox" },
    insertMessage: async () => ({ id: `msg-${++seq}` }),
    getConversationById: async () => {
      deliveryChecks++;
      if (over.blockAtDelivery && deliveryChecks >= 1 && conv) return { ...conv, status: "blocked" };
      return conv;
    },
    creatorReplyAt: async () => null,
  };
  const credits: PriorityDmDeps["credits"] = {
    charge: async (userId, amountVb, key) => {
      if (chargedKeys.has(key)) return; // rail-level idempotency
      chargedKeys.add(key);
      charges.push({ userId, amount: amountVb, key });
    },
    refund: async (userId, amountVb) => { refunds.push({ userId, amount: amountVb }); },
    payout: async (userId, amountVb) => { payouts.push({ userId, amount: amountVb }); },
  };
  return { store, credits, rows, charges, refunds, payouts, settings };
}

function deps(world: ReturnType<typeof makeWorld>, enabled = true, now = () => T0): PriorityDmDeps {
  return { store: world.store, credits: world.credits, platformEnabled: enabled, now };
}

describe("platform gate (owner ruling 2026-10-27 — ships OPEN)", () => {
  it("is on by default; only exactly 'false' (the kill switch) turns it off", () => {
    expect(isPriorityDmPlatformEnabled({})).toBe(true);
    expect(isPriorityDmPlatformEnabled({ PRIORITY_DM_ENABLED: "true" })).toBe(true);
    expect(isPriorityDmPlatformEnabled({ PRIORITY_DM_ENABLED: "1" })).toBe(true);
    expect(isPriorityDmPlatformEnabled({ PRIORITY_DM_ENABLED: "false" })).toBe(false);
  });

  it("the price is the ruled 100 VB; an invalid override falls back to it", () => {
    expect(PRIORITY_DM_PRICE_VB).toBe(100);
    expect(priorityDmPriceVb({})).toBe(100);
    expect(priorityDmPriceVb({ PRIORITY_DM_PRICE_VB: "250" })).toBe(250);
    expect(priorityDmPriceVb({ PRIORITY_DM_PRICE_VB: "abc" })).toBe(100);
    expect(priorityDmPriceVb({ PRIORITY_DM_PRICE_VB: "0" })).toBe(100);
  });

  it("gate-off: send refuses before any charge and sellable hides the price", async () => {
    const world = makeWorld();
    const out = await sendPriorityDm(deps(world, false), { senderUserId: FAN, creatorUserId: CREATOR, body: "hi", clientKey: "intent-0001" });
    expect(out.kind).toBe("gate_off");
    expect(world.charges).toHaveLength(0);
    expect(evaluateSellable(world.settings, false)).toEqual({ sellable: false, reason: "gate_off" });
  });
});

describe("creator controls — opt in/out; the price is the platform's", () => {
  it("opted-out creator is not sellable; opted-in sells at the ruled 100 VB with or without a stored price", () => {
    expect(evaluateSellable({ creatorUserId: CREATOR, optedIn: false, minPriceVb: 500, replyWindowHours: 48 }, true))
      .toEqual({ sellable: false, reason: "not_opted_in" });
    expect(evaluateSellable({ creatorUserId: CREATOR, optedIn: true, minPriceVb: null, replyWindowHours: 48 }, true))
      .toEqual({ sellable: true, priceVb: 100, replyWindowHours: 48 });
    /* A stored creator price (500 here) never overrides the ruled price. */
    expect(evaluateSellable({ creatorUserId: CREATOR, optedIn: true, minPriceVb: 500, replyWindowHours: 48 }, true))
      .toEqual({ sellable: true, priceVb: 100, replyWindowHours: 48 });
    expect(evaluateSellable(null, true)).toEqual({ sellable: false, reason: "not_opted_in" });
  });

  it("opting in needs no creator price — the platform price is the ruled 100 VB", () => {
    const out = validateSettingsUpdate(null, { opted_in: true });
    expect(out).toEqual({ ok: true, settings: { optedIn: true, minPriceVb: null, replyWindowHours: 48 } });
    const ok = validateSettingsUpdate(null, { opted_in: true, min_price_vb: 750, reply_window_hours: 24 });
    expect(ok).toEqual({ ok: true, settings: { optedIn: true, minPriceVb: 750, replyWindowHours: 24 } });
  });

  it("opting out is always allowed and keeps the creator's stated values", () => {
    const cur: PriorityDmSettingsLike = { creatorUserId: CREATOR, optedIn: true, minPriceVb: 500, replyWindowHours: 48 };
    expect(validateSettingsUpdate(cur, { opted_in: false }))
      .toEqual({ ok: true, settings: { optedIn: false, minPriceVb: 500, replyWindowHours: 48 } });
  });

  it("rejects fractional / zero / out-of-range prices and windows", () => {
    for (const bad of [0, -5, 1.5, "500", 1_000_001]) {
      expect(validateSettingsUpdate(null, { min_price_vb: bad as never }).ok).toBe(false);
    }
    for (const bad of [0, 11, 169, 24.5]) {
      expect(validateSettingsUpdate(null, { reply_window_hours: bad as never }).ok).toBe(false);
    }
  });
});

describe("send — charge exactly once", () => {
  it("charges the ruled 100 VB once (never the creator's stored 500) and delivers with the stated deadline", async () => {
    const world = makeWorld();
    const out = await sendPriorityDm(deps(world), { senderUserId: FAN, creatorUserId: CREATOR, body: "collab?", clientKey: "intent-0002" });
    expect(out.kind).toBe("sent");
    expect(world.charges).toEqual([{ userId: FAN, amount: 100, key: expect.stringContaining("intent-0002") }]);
    if (out.kind === "sent") {
      expect(out.row.amountVb).toBe(100);
      expect(out.row.replyDeadline.getTime()).toBe(T0.getTime() + 48 * HOUR);
      expect(out.row.status).toBe("held");
      expect(out.row.messageId).toBeTruthy();
    }
  });

  it("an opted-in creator with NO stored price still sells at the ruled 100 VB", async () => {
    const world = makeWorld({ settings: { creatorUserId: CREATOR, optedIn: true, minPriceVb: null, replyWindowHours: 24 } });
    const out = await sendPriorityDm(deps(world), { senderUserId: FAN, creatorUserId: CREATOR, body: "hi", clientKey: "intent-0002b" });
    expect(out.kind).toBe("sent");
    expect(world.charges).toEqual([{ userId: FAN, amount: 100, key: expect.stringContaining("intent-0002b") }]);
  });

  it("a retried purchase (same intent key) returns the original row and never charges twice", async () => {
    const world = makeWorld();
    const first = await sendPriorityDm(deps(world), { senderUserId: FAN, creatorUserId: CREATOR, body: "collab?", clientKey: "intent-0003" });
    const retry = await sendPriorityDm(deps(world), { senderUserId: FAN, creatorUserId: CREATOR, body: "collab?", clientKey: "intent-0003" });
    expect(first.kind).toBe("sent");
    expect(retry.kind).toBe("duplicate");
    expect(world.charges).toHaveLength(1);
    expect(world.rows).toHaveLength(1);
  });

  it("derived keys: identical retries hash to the same key, different bodies do not", () => {
    const a = buildPriorityDmKey(FAN, undefined, { creatorUserId: CREATOR, body: "x" });
    const b = buildPriorityDmKey(FAN, undefined, { creatorUserId: CREATOR, body: "x" });
    const c = buildPriorityDmKey(FAN, undefined, { creatorUserId: CREATOR, body: "y" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("insufficient balance propagates and leaves no row behind", async () => {
    const world = makeWorld();
    world.credits.charge = async () => { throw new Error("out_of_credits"); };
    await expect(sendPriorityDm(deps(world), { senderUserId: FAN, creatorUserId: CREATOR, body: "hi", clientKey: "intent-0004" }))
      .rejects.toThrow("out_of_credits");
    expect(world.rows).toHaveLength(0);
  });
});

describe("block always wins — refund path is exact", () => {
  it("a pre-blocked fan is refused with NO charge at all", async () => {
    const world = makeWorld({ convStatus: "blocked" });
    const out = await sendPriorityDm(deps(world), { senderUserId: FAN, creatorUserId: CREATOR, body: "hi", clientKey: "intent-0005" });
    expect(out.kind).toBe("blocked");
    expect(world.charges).toHaveLength(0);
    expect(world.refunds).toHaveLength(0);
    expect(world.rows).toHaveLength(0);
  });

  it("a block landing at delivery refunds exactly once and delivers nothing", async () => {
    const world = makeWorld({ convStatus: "inbox", blockAtDelivery: true });
    const insertSpy = vi.spyOn(world.store, "insertMessage");
    const out = await sendPriorityDm(deps(world), { senderUserId: FAN, creatorUserId: CREATOR, body: "hi", clientKey: "intent-0006" });
    expect(out.kind).toBe("refunded_blocked");
    expect(world.charges).toHaveLength(1);
    expect(world.refunds).toEqual([{ userId: FAN, amount: 100 }]);
    expect(insertSpy).not.toHaveBeenCalled();
    // Settling afterwards must not refund a second time.
    const summary = await settlePriorityDms(deps(world), { creatorUserId: CREATOR });
    expect(summary.refundedBlocked).toBe(0);
    expect(world.refunds).toHaveLength(1);
  });

  it("a block found at settle refunds exactly once, even across repeated settles", async () => {
    const world = makeWorld();
    const sent = await sendPriorityDm(deps(world), { senderUserId: FAN, creatorUserId: CREATOR, body: "hi", clientKey: "intent-0007" });
    expect(sent.kind).toBe("sent");
    world.store.getConversationById = async () => ({ id: "conv-1", status: "blocked" });
    const s1 = await settlePriorityDms(deps(world), { creatorUserId: CREATOR });
    const s2 = await settlePriorityDms(deps(world), { creatorUserId: CREATOR });
    expect(s1.refundedBlocked).toBe(1);
    expect(s2.refundedBlocked).toBe(0);
    expect(world.refunds).toEqual([{ userId: FAN, amount: 100 }]);
    expect(world.payouts).toHaveLength(0);
  });
});

describe("settle — the stated window is the contract", () => {
  async function sentWorld() {
    const world = makeWorld();
    const out = await sendPriorityDm(deps(world), { senderUserId: FAN, creatorUserId: CREATOR, body: "hi", clientKey: "intent-0008" });
    if (out.kind !== "sent") throw new Error("setup failed");
    return { world, row: out.row };
  }

  it("unanswered at the deadline: full auto-refund, exactly once", async () => {
    const { world } = await sentWorld();
    const after = () => new Date(T0.getTime() + 49 * HOUR);
    const s1 = await settlePriorityDms(deps(world, true, after), { creatorUserId: CREATOR });
    const s2 = await settlePriorityDms(deps(world, true, after), { creatorUserId: CREATOR });
    expect(s1.refundedExpired).toBe(1);
    expect(s2.refundedExpired).toBe(0);
    expect(world.refunds).toEqual([{ userId: FAN, amount: 100 }]);
    expect(world.payouts).toHaveLength(0);
  });

  it("still inside the window: nothing moves", async () => {
    const { world } = await sentWorld();
    const s = await settlePriorityDms(deps(world, true, () => new Date(T0.getTime() + HOUR)), { creatorUserId: CREATOR });
    expect(s).toEqual({ replied: 0, refundedExpired: 0, refundedBlocked: 0, stillHeld: 1 });
    expect(world.refunds).toHaveLength(0);
    expect(world.payouts).toHaveLength(0);
  });

  it("a reply inside the window pays the creator exactly once", async () => {
    const { world, row } = await sentWorld();
    world.store.creatorReplyAt = async () => new Date(row.createdAt.getTime() + 2 * HOUR);
    const s1 = await settlePriorityDms(deps(world), { creatorUserId: CREATOR });
    const s2 = await settlePriorityDms(deps(world), { creatorUserId: CREATOR });
    expect(s1.replied).toBe(1);
    expect(s2.replied).toBe(0);
    expect(world.payouts).toEqual([{ userId: CREATOR, amount: 100 }]);
    expect(world.refunds).toHaveLength(0);
  });

  it("a reply AFTER the deadline earns nothing — the fan is refunded instead", async () => {
    const { world, row } = await sentWorld();
    world.store.creatorReplyAt = async () => new Date(row.replyDeadline.getTime() + HOUR);
    const s = await settlePriorityDms(deps(world, true, () => new Date(T0.getTime() + 72 * HOUR)), { creatorUserId: CREATOR });
    expect(s.replied).toBe(0);
    expect(s.refundedExpired).toBe(1);
    expect(world.payouts).toHaveLength(0);
    expect(world.refunds).toEqual([{ userId: FAN, amount: 100 }]);
  });
});
