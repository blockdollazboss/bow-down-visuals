/**
 * generation-charge-intents.test.ts — Stack400 Lane 4 (charge integrity).
 *
 * Pins the Pass 3 fix: a poll-charged generation's obligation lives in a
 * durable submit-time intent row, not only in a process Map. A restart
 * between submit and the success poll must still settle the charge —
 * exactly once — and a delivered-but-uncharged intent must be retried
 * by the sweeper, while a deduction that landed without its ledger row
 * (LedgerWriteError, rollback disabled) must NEVER be retried (the
 * retry would double-charge).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GenerationChargeIntentRow } from "@workspace/db";
import {
  resolvePendingCharge,
  settleGenerationCharge,
  sweepGenerationChargeIntents,
  chargeGenerationReserve,
  recordGenerationReserve,
  confirmGenerationReserve,
  refundGenerationReserve,
  generationChargeKey,
  GEN_CHARGE_RETRY_AFTER_MS,
  GEN_CHARGE_EXPIRE_AFTER_MS,
  GEN_CHARGE_RESERVE_STALE_MS,
  type GenerationChargeIntentStore,
  type ChargeFn,
  type RefundFn,
} from "../generation-charge-intents";
import { LedgerWriteError, OutOfCreditsError, CreditsDisabledError } from "../credits";

/* ── In-memory intent store (same contract as the drizzle store) ── */
function makeStore() {
  const rows = new Map<string, GenerationChargeIntentRow>();
  let seq = 0;
  const store: GenerationChargeIntentStore = {
    async recordIntent(input) {
      if (rows.has(input.taskId)) return;
      rows.set(input.taskId, {
        id: `intent-${++seq}`,
        task_id: input.taskId,
        rail: input.rail,
        user_id: input.userId,
        credits: input.credits,
        project_id: input.projectId ?? null,
        action: input.action,
        extra: input.extra ?? null,
        status: input.status ?? "awaiting",
        delivered_at: null,
        created_at: new Date(),
        resolved_at: null,
      } as GenerationChargeIntentRow);
    },
    async getIntent(taskId) {
      return rows.get(taskId) ?? null;
    },
    async markCharged(taskId) {
      const r = rows.get(taskId);
      if (!r || (r.status !== "awaiting" && r.status !== "expired")) return false;
      r.status = "charged";
      r.resolved_at = new Date();
      return true;
    },
    async markFailed(taskId) {
      const r = rows.get(taskId);
      if (!r || r.status !== "awaiting") return false;
      r.status = "failed";
      r.resolved_at = new Date();
      return true;
    },
    async markDelivered(taskId) {
      const r = rows.get(taskId);
      if (r && !r.delivered_at) r.delivered_at = new Date();
    },
    async listDeliveredUncharged(cutoff) {
      return [...rows.values()].filter(
        (r) =>
          (r.status === "awaiting" || r.status === "expired") &&
          r.delivered_at !== null &&
          r.delivered_at < cutoff,
      );
    },
    async expireUndelivered(cutoff) {
      const out: GenerationChargeIntentRow[] = [];
      for (const r of rows.values()) {
        if (r.status === "awaiting" && !r.delivered_at && r.created_at < cutoff) {
          r.status = "expired";
          r.resolved_at = new Date();
          out.push(r);
        }
      }
      return out;
    },
    async confirmReserve(taskId) {
      const r = rows.get(taskId);
      if (!r || r.status !== "reserved") return false;
      r.status = "charged";
      r.resolved_at = new Date();
      return true;
    },
    async claimReserveRefund(taskId) {
      const r = rows.get(taskId);
      if (!r || r.status !== "reserved") return null;
      r.status = "refunded";
      r.resolved_at = new Date();
      return r;
    },
    async releaseReserveRefundClaim(taskId) {
      const r = rows.get(taskId);
      if (!r || r.status !== "refunded") return false;
      r.status = "reserved";
      r.resolved_at = null;
      return true;
    },
    async listDeliveredReserves(cutoff) {
      return [...rows.values()].filter(
        (r) => r.status === "reserved" && r.delivered_at !== null && r.delivered_at < cutoff,
      );
    },
    async listStaleReserves(cutoff) {
      return [...rows.values()].filter(
        (r) => r.status === "reserved" && r.delivered_at === null && r.created_at < cutoff,
      );
    },
  };
  return { store, rows };
}

/** A charge fn that behaves like chargeCredits under the idempotency
    key: the first call for a key deducts; a replay is suppressed. */
function makeChargeFn() {
  const deducted = new Map<string, number>();
  const calls: Array<{ userId: string; credits: number; key: string }> = [];
  const fn: ChargeFn = async (userId, credits, _record, opts) => {
    calls.push({ userId, credits, key: opts.idempotencyKey });
    if (deducted.has(opts.idempotencyKey)) return 0; // replay suppressed
    deducted.set(opts.idempotencyKey, credits);
    return 0;
  };
  return { fn, deducted, calls };
}

const SUBMIT = {
  taskId: "task-1",
  rail: "runway-clip",
  userId: "user-1",
  credits: 5,
  projectId: null,
  action: "Runway Video Clip",
};

describe("resolvePendingCharge — the restart path", () => {
  it("falls back to the durable intent when the in-memory entry is gone", async () => {
    const { store } = makeStore();
    await store.recordIntent(SUBMIT);
    const resolved = await resolvePendingCharge(store, "task-1", null);
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("intent");
    expect(resolved!.userId).toBe("user-1");
    expect(resolved!.credits).toBe(5);
    expect(resolved!.action).toBe("Runway Video Clip");
  });

  it("prefers the in-memory entry when both exist", async () => {
    const { store } = makeStore();
    await store.recordIntent(SUBMIT);
    const resolved = await resolvePendingCharge(store, "task-1", {
      userId: "user-1",
      credits: 5,
      action: "Runway Video Clip",
    });
    expect(resolved!.source).toBe("memory");
    expect(resolved!.intentStatus).toBe("awaiting");
  });

  it("returns null when neither exists — the caller must say so, never assume paid", async () => {
    const { store } = makeStore();
    expect(await resolvePendingCharge(store, "ghost", null)).toBeNull();
  });

  it("returns null for a failed intent — no charge is owed", async () => {
    const { store } = makeStore();
    await store.recordIntent(SUBMIT);
    await store.markFailed("task-1");
    expect(await resolvePendingCharge(store, "task-1", null)).toBeNull();
  });
});

describe("settleGenerationCharge — exactly once", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Pass 3 shape: submit → restart (memory lost) → success poll still charges, once", async () => {
    const { store, rows } = makeStore();
    const charge = makeChargeFn();
    await store.recordIntent(SUBMIT);

    const resolved = await resolvePendingCharge(store, "task-1", null);
    const outcome = await settleGenerationCharge(store, "task-1", resolved!, charge.fn);

    expect(outcome).toBe("charged");
    expect(charge.calls).toHaveLength(1);
    expect(charge.calls[0]!.key).toBe("gen-charge:task-1");
    expect(charge.deducted.get("gen-charge:task-1")).toBe(5);
    expect(rows.get("task-1")!.status).toBe("charged");
  });

  it("a second settle after the first landed is 'already' and never re-charges", async () => {
    const { store } = makeStore();
    const charge = makeChargeFn();
    await store.recordIntent(SUBMIT);
    const resolved = await resolvePendingCharge(store, "task-1", null);
    await settleGenerationCharge(store, "task-1", resolved!, charge.fn);

    const again = await resolvePendingCharge(store, "task-1", null);
    const outcome = await settleGenerationCharge(store, "task-1", again!, charge.fn);
    expect(outcome).toBe("already");
    expect(charge.calls).toHaveLength(1);
  });

  it("a charge that did not land leaves the intent awaiting for the sweeper", async () => {
    const { store, rows } = makeStore();
    await store.recordIntent(SUBMIT);
    const failing: ChargeFn = async () => {
      throw new Error("profile store down");
    };
    const resolved = await resolvePendingCharge(store, "task-1", null);
    const outcome = await settleGenerationCharge(store, "task-1", resolved!, failing);
    expect(outcome).toBe("charge_failed");
    expect(rows.get("task-1")!.status).toBe("awaiting");
  });

  it("LedgerWriteError = deduction stands: marked charged so NO retry can double-charge", async () => {
    const { store, rows } = makeStore();
    await store.recordIntent(SUBMIT);
    const unledgered: ChargeFn = async () => {
      throw new LedgerWriteError();
    };
    const resolved = await resolvePendingCharge(store, "task-1", null);
    const outcome = await settleGenerationCharge(store, "task-1", resolved!, unledgered);
    expect(outcome).toBe("charged_unledgered");
    expect(rows.get("task-1")!.status).toBe("charged");
  });
});

describe("sweepGenerationChargeIntents — delivered but uncharged gets settled", () => {
  it("retries a delivered intent whose poll-time charge failed", async () => {
    const { store, rows } = makeStore();
    const charge = makeChargeFn();
    await store.recordIntent(SUBMIT);
    await store.markDelivered("task-1");
    /* Age the delivery past the retry cutoff. */
    rows.get("task-1")!.delivered_at = new Date(Date.now() - GEN_CHARGE_RETRY_AFTER_MS - 1000);

    const result = await sweepGenerationChargeIntents({ store, chargeFn: charge.fn });
    expect(result).toMatchObject({ retried: 1, charged: 1, stillFailing: 0 });
    expect(charge.deducted.get("gen-charge:task-1")).toBe(5);
    expect(rows.get("task-1")!.status).toBe("charged");
  });

  it("does not touch an undelivered awaiting intent (no delivery, no charge)", async () => {
    const { store } = makeStore();
    const charge = makeChargeFn();
    await store.recordIntent(SUBMIT);
    const result = await sweepGenerationChargeIntents({ store, chargeFn: charge.fn });
    expect(result.retried).toBe(0);
    expect(charge.calls).toHaveLength(0);
  });

  it("expires stale undelivered intents without charging them", async () => {
    const { store, rows } = makeStore();
    const charge = makeChargeFn();
    await store.recordIntent(SUBMIT);
    rows.get("task-1")!.created_at = new Date(Date.now() - GEN_CHARGE_EXPIRE_AFTER_MS - 1000);
    const result = await sweepGenerationChargeIntents({ store, chargeFn: charge.fn });
    expect(result.expired).toBe(1);
    expect(charge.calls).toHaveLength(0);
    expect(rows.get("task-1")!.status).toBe("expired");
  });

  it("a late poll can still settle an expired intent, exactly once", async () => {
    const { store, rows } = makeStore();
    const charge = makeChargeFn();
    await store.recordIntent(SUBMIT);
    rows.get("task-1")!.status = "expired";
    const resolved = await resolvePendingCharge(store, "task-1", null);
    const outcome = await settleGenerationCharge(store, "task-1", resolved!, charge.fn);
    expect(outcome).toBe("charged");
    expect(charge.calls).toHaveLength(1);
    expect(rows.get("task-1")!.status).toBe("charged");
  });
});

/* ── Reserve-at-submit (stack1400 ruling #43 Part A) ───────────────── */

function makeRefundFn() {
  const calls: Array<{ userId: string; credits: number; action: string }> = [];
  const fn: RefundFn = async (userId, credits, record) => {
    calls.push({ userId, credits, action: record.action });
  };
  return { fn, calls };
}

async function seedReserve(store: GenerationChargeIntentStore, rows: Map<string, GenerationChargeIntentRow>, taskId = "task-1") {
  await recordGenerationReserve(store, {
    ...SUBMIT,
    taskId,
    chargeKey: generationChargeKey(taskId),
  });
  return rows.get(taskId)!;
}

describe("chargeGenerationReserve — the submit charge", () => {
  it("charges through chargeFn under the gen-charge key with rollback on ledger failure", async () => {
    const charge = makeChargeFn();
    const seen: Array<{ rollback?: boolean }> = [];
    const fn: ChargeFn = async (u, c, r, o) => { seen.push({ rollback: o.rollbackOnLedgerFailure }); return charge.fn(u, c, r, o); };
    const out = await chargeGenerationReserve(
      { userId: "user-1", credits: 5, action: "Runway Video Clip", chargeKey: generationChargeKey("job-1") },
      fn,
    );
    expect(out.ok).toBe(true);
    expect(charge.deducted.get("gen-charge:job-1")).toBe(5);
    expect(seen[0]!.rollback).toBe(true);
  });

  it("maps a refused charge to insufficient — the rail refuses the submit, provider never called by construction", async () => {
    const failing: ChargeFn = async () => { throw new OutOfCreditsError(); };
    const out = await chargeGenerationReserve(
      { userId: "user-1", credits: 5, action: "X", chargeKey: "gen-charge:job-2" },
      failing,
    );
    expect(out).toMatchObject({ ok: false, reason: "insufficient" });
  });

  it("maps disabled / ledger failures distinctly", async () => {
    const disabled: ChargeFn = async () => { throw new CreditsDisabledError(); };
    expect(await chargeGenerationReserve({ userId: "u", credits: 1, action: "X", chargeKey: "k" }, disabled))
      .toMatchObject({ ok: false, reason: "disabled" });
    const ledger: ChargeFn = async () => { throw new LedgerWriteError(); };
    expect(await chargeGenerationReserve({ userId: "u", credits: 1, action: "X", chargeKey: "k" }, ledger))
      .toMatchObject({ ok: false, reason: "ledger" });
  });

  it("a replayed submit charge under the same key deducts once (chargeCredits idempotency)", async () => {
    const charge = makeChargeFn();
    const input = { userId: "user-1", credits: 5, action: "X", chargeKey: generationChargeKey("job-3") };
    await chargeGenerationReserve(input, charge.fn);
    await chargeGenerationReserve(input, charge.fn);
    expect(charge.calls).toHaveLength(2);
    expect(charge.deducted.size).toBe(1);
  });
});

describe("reserve lifecycle — confirm on success, refund on failure, exactly once", () => {
  it("recordGenerationReserve writes a 'reserved' row carrying the charge key", async () => {
    const { store, rows } = makeStore();
    const row = await seedReserve(store, rows);
    expect(row.status).toBe("reserved");
    expect((row.extra as any).chargeKey).toBe("gen-charge:task-1");
    const resolved = await resolvePendingCharge(store, "task-1", null);
    expect(resolved!.reserved).toBe(true);
    expect(resolved!.chargeKey).toBe("gen-charge:task-1");
  });

  it("success confirm moves NO money and flips reserved → charged; a second confirm is 'already'", async () => {
    const { store, rows } = makeStore();
    const charge = makeChargeFn();
    await seedReserve(store, rows);
    const resolved = await resolvePendingCharge(store, "task-1", null);
    expect(await confirmGenerationReserve(store, "task-1", resolved!)).toBe("confirmed");
    expect(rows.get("task-1")!.status).toBe("charged");
    expect(charge.calls).toHaveLength(0);
    const again = await resolvePendingCharge(store, "task-1", null);
    expect(await confirmGenerationReserve(store, "task-1", again!)).toBe("already");
  });

  it("provider failure refunds the exact reserve exactly once — double-poll refunds nothing twice", async () => {
    const { store, rows } = makeStore();
    const refund = makeRefundFn();
    await seedReserve(store, rows);
    const resolved = await resolvePendingCharge(store, "task-1", null);
    expect(await refundGenerationReserve(store, "task-1", resolved!, "provider failed", refund.fn)).toBe("refunded");
    expect(refund.calls).toEqual([{ userId: "user-1", credits: 5, action: "Runway Video Clip — Refund (provider failed)" }]);
    expect(rows.get("task-1")!.status).toBe("refunded");
    const again = await resolvePendingCharge(store, "task-1", null);
    expect(await refundGenerationReserve(store, "task-1", again!, "provider failed", refund.fn)).toBe("already");
    expect(refund.calls).toHaveLength(1);
  });

  it("two racing refund claims: only the claim winner refunds", async () => {
    const { store, rows } = makeStore();
    const refund = makeRefundFn();
    await seedReserve(store, rows);
    const resolved = await resolvePendingCharge(store, "task-1", null);
    const [a, b] = await Promise.all([
      refundGenerationReserve(store, "task-1", resolved!, "provider failed", refund.fn),
      refundGenerationReserve(store, "task-1", resolved!, "provider failed", refund.fn),
    ]);
    expect([a, b].sort()).toEqual(["already", "refunded"]);
    expect(refund.calls).toHaveLength(1);
  });

  it("a refund that throws releases the claim — a later retry refunds", async () => {
    const { store, rows } = makeStore();
    await seedReserve(store, rows);
    const resolved = await resolvePendingCharge(store, "task-1", null);
    const boom: RefundFn = async () => { throw new Error("restore down"); };
    expect(await refundGenerationReserve(store, "task-1", resolved!, "provider failed", boom)).toBe("refund_failed");
    expect(rows.get("task-1")!.status).toBe("reserved");
    const refund = makeRefundFn();
    expect(await refundGenerationReserve(store, "task-1", resolved!, "provider failed", refund.fn)).toBe("refunded");
    expect(refund.calls).toHaveLength(1);
  });

  it("a legacy 'awaiting' resolution is not a reserve — confirm/refund decline so the caller settles/marks failed", async () => {
    const { store } = makeStore();
    const refund = makeRefundFn();
    await store.recordIntent(SUBMIT);
    const resolved = await resolvePendingCharge(store, "task-1", null);
    expect(resolved!.reserved).toBe(false);
    expect(await confirmGenerationReserve(store, "task-1", resolved!)).toBe("not_reserved");
    expect(await refundGenerationReserve(store, "task-1", resolved!, "provider failed", refund.fn)).toBe("not_reserved");
    expect(refund.calls).toHaveLength(0);
  });

  it("a confirmed reserve refuses a late refund", async () => {
    const { store, rows } = makeStore();
    const refund = makeRefundFn();
    await seedReserve(store, rows);
    const resolved = await resolvePendingCharge(store, "task-1", null);
    await confirmGenerationReserve(store, "task-1", resolved!);
    const charged = await resolvePendingCharge(store, "task-1", null);
    expect(await refundGenerationReserve(store, "task-1", charged!, "provider failed", refund.fn)).toBe("already");
    expect(refund.calls).toHaveLength(0);
  });
});

describe("sweepGenerationChargeIntents — reserve reconciliation", () => {
  it("confirms a delivered reserve without charging or refunding", async () => {
    const { store, rows } = makeStore();
    const charge = makeChargeFn();
    const refund = makeRefundFn();
    await seedReserve(store, rows);
    await store.markDelivered("task-1");
    rows.get("task-1")!.delivered_at = new Date(Date.now() - GEN_CHARGE_RETRY_AFTER_MS - 1000);
    const result = await sweepGenerationChargeIntents({ store, chargeFn: charge.fn, refundFn: refund.fn });
    expect(result.reservesConfirmed).toBe(1);
    expect(rows.get("task-1")!.status).toBe("charged");
    expect(charge.calls).toHaveLength(0);
    expect(refund.calls).toHaveLength(0);
  });

  it("refunds an abandoned reserve in full, exactly once across sweeps", async () => {
    const { store, rows } = makeStore();
    const refund = makeRefundFn();
    await seedReserve(store, rows);
    rows.get("task-1")!.created_at = new Date(Date.now() - GEN_CHARGE_RESERVE_STALE_MS - 1000);
    const r1 = await sweepGenerationChargeIntents({ store, refundFn: refund.fn });
    expect(r1.reservesRefunded).toBe(1);
    expect(refund.calls).toEqual([{ userId: "user-1", credits: 5, action: "Runway Video Clip — Refund (abandoned — never delivered)" }]);
    expect(rows.get("task-1")!.status).toBe("refunded");
    const r2 = await sweepGenerationChargeIntents({ store, refundFn: refund.fn });
    expect(r2.reservesRefunded).toBe(0);
    expect(refund.calls).toHaveLength(1);
  });

  it("leaves a fresh undelivered reserve alone (still in flight)", async () => {
    const { store, rows } = makeStore();
    const refund = makeRefundFn();
    await seedReserve(store, rows);
    const result = await sweepGenerationChargeIntents({ store, refundFn: refund.fn });
    expect(result.reservesRefunded).toBe(0);
    expect(rows.get("task-1")!.status).toBe("reserved");
  });
});
