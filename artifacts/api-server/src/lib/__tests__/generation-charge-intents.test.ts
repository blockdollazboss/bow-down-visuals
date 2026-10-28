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
  GEN_CHARGE_RETRY_AFTER_MS,
  GEN_CHARGE_EXPIRE_AFTER_MS,
  type GenerationChargeIntentStore,
  type ChargeFn,
} from "../generation-charge-intents";
import { LedgerWriteError } from "../credits";

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
        status: "awaiting",
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
