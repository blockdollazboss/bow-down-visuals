import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import {
  recordClipCharge,
  markClipChargeDelivered,
  refundClipChargeOnSaveFailure,
  sweepStaleClipCharges,
  type ClipChargeStore,
} from "../clip-charge-obligations";
import type { ClipChargeObligationRow } from "@workspace/db";

/* Durable clip-charge obligations (payments D3, migration 0184).
 *
 * The fake store below is an in-memory implementation of the SAME
 * ClipChargeStore contract the Drizzle store implements. Its claim
 * methods mutate synchronously inside their async bodies — the same
 * atomicity the production single-statement UPDATE … WHERE
 * status='pending' provides — so the exactly-once tests are
 * meaningful. A "restart" is simulated the honest way: a brand-new
 * store instance + fresh function calls over the SAME backing rows —
 * nothing survives except what was written to the durable store. */

interface FakeBacking {
  rows: Map<string, ClipChargeObligationRow>;
  landedClips: Set<string>;
}

function makeBacking(): FakeBacking {
  return { rows: new Map(), landedClips: new Set() };
}

function makeStore(backing: FakeBacking): ClipChargeStore {
  const byTask = (taskId: string) =>
    [...backing.rows.values()].find((r) => r.task_id === taskId) ?? null;
  return {
    async recordPending(input) {
      if (byTask(input.taskId)) return; /* UNIQUE task_id: no-op */
      const row: ClipChargeObligationRow = {
        id: randomUUID(),
        task_id: input.taskId,
        user_id: input.userId,
        credits: input.credits,
        project_id: input.projectId ?? null,
        status: "pending",
        resolution: null,
        created_at: new Date(),
        resolved_at: null,
      };
      backing.rows.set(row.id, row);
    },
    async markDelivered(taskId, resolution) {
      const row = byTask(taskId);
      if (!row || row.status !== "pending") return false;
      row.status = "delivered";
      row.resolution = resolution;
      row.resolved_at = new Date();
      return true;
    },
    async claimForRefund(taskId, userId, resolution) {
      const row = byTask(taskId);
      if (!row || row.status !== "pending" || row.user_id !== userId) return null;
      row.status = "refunded";
      row.resolution = resolution;
      row.resolved_at = new Date();
      return row;
    },
    async listStalePending(cutoff) {
      return [...backing.rows.values()]
        .filter((r) => r.status === "pending" && r.created_at < cutoff)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    },
    async claimStaleById(id, resolution) {
      const row = backing.rows.get(id);
      if (!row || row.status !== "pending") return null;
      row.status = "refunded";
      row.resolution = resolution;
      row.resolved_at = new Date();
      return row;
    },
    async hasLandedClip(taskId) {
      return backing.landedClips.has(taskId);
    },
  };
}

const USER = randomUUID();
const TASK = "runway-task-123";
const STALE = 60 * 60 * 1000;

let backing: FakeBacking;
let refund: ReturnType<typeof vi.fn>;

beforeEach(() => {
  backing = makeBacking();
  refund = vi.fn(async () => {});
});

function deps(store: ClipChargeStore, extra: object = {}) {
  return { store, refund: refund as never, ...extra };
}

describe("recordClipCharge — the charge is durable from the moment it lands", () => {
  it("writes one pending obligation carrying the member and the charged amount", async () => {
    const store = makeStore(backing);
    await recordClipCharge(
      { taskId: TASK, userId: USER, credits: 400, projectId: null },
      deps(store),
    );
    const rows = [...backing.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task_id: TASK,
      user_id: USER,
      credits: 400,
      status: "pending",
    });
  });

  it("recording the same task twice keeps ONE obligation (re-poll safety)", async () => {
    const store = makeStore(backing);
    await recordClipCharge({ taskId: TASK, userId: USER, credits: 400 }, deps(store));
    await recordClipCharge({ taskId: TASK, userId: USER, credits: 400 }, deps(store));
    expect(backing.rows.size).toBe(1);
  });
});

describe("refundClipChargeOnSaveFailure — failure refunds, exactly once", () => {
  it("refunds the row's amount to the row's owner with the save-failed ledger label", async () => {
    const store = makeStore(backing);
    await recordClipCharge({ taskId: TASK, userId: USER, credits: 800 }, deps(store));

    const out = await refundClipChargeOnSaveFailure(
      TASK,
      { userId: USER, projectId: null, memoryCharge: null },
      deps(store),
    );
    expect(out).toEqual({ refunded: true, credits: 800, source: "durable" });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith(USER, 800, {
      action: "Runway Video Clip — Refund (save failed)",
      projectId: null,
    });
    expect([...backing.rows.values()][0]?.status).toBe("refunded");
  });

  it("a second save-failure attempt refunds NOTHING (the claim is spent)", async () => {
    const store = makeStore(backing);
    await recordClipCharge({ taskId: TASK, userId: USER, credits: 400 }, deps(store));
    await refundClipChargeOnSaveFailure(TASK, { userId: USER, memoryCharge: null }, deps(store));
    const out = await refundClipChargeOnSaveFailure(
      TASK,
      { userId: USER, memoryCharge: null },
      deps(store),
    );
    expect(out.refunded).toBe(false);
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("never refunds another member's obligation", async () => {
    const store = makeStore(backing);
    const other = randomUUID();
    await recordClipCharge({ taskId: TASK, userId: USER, credits: 400 }, deps(store));
    const out = await refundClipChargeOnSaveFailure(
      TASK,
      { userId: other, memoryCharge: null },
      deps(store),
    );
    expect(out.refunded).toBe(false);
    expect(refund).not.toHaveBeenCalled();
    expect([...backing.rows.values()][0]?.status).toBe("pending");
  });

  it("falls back to the in-memory entry for a charge with no durable row", async () => {
    const store = makeStore(backing);
    const mem = { userId: USER, credits: 400, refunded: false };
    const out = await refundClipChargeOnSaveFailure(
      "legacy-task",
      { userId: USER, memoryCharge: mem },
      deps(store),
    );
    expect(out).toEqual({ refunded: true, credits: 400, source: "memory" });
    expect(mem.refunded).toBe(true);
    expect(refund).toHaveBeenCalledTimes(1);
    /* And the spent memory flag blocks a repeat. */
    const again = await refundClipChargeOnSaveFailure(
      "legacy-task",
      { userId: USER, memoryCharge: mem },
      deps(store),
    );
    expect(again.refunded).toBe(false);
    expect(refund).toHaveBeenCalledTimes(1);
  });
});

describe("simulated restart — a fresh process refunds from the durable store alone", () => {
  it("charge in process #1, restart, stale sweep refunds exactly once", async () => {
    /* Process #1: the charge lands and is recorded; the process dies
       before any save attempt (no in-memory state crosses over). */
    const processOne = makeStore(backing);
    await recordClipCharge({ taskId: TASK, userId: USER, credits: 400 }, deps(processOne));

    /* Process #2: a NEW store over the same durable rows. The sweep
       runs 2h later; the clip never landed → refund, once. */
    const processTwo = makeStore(backing);
    const later = new Date(Date.now() + 2 * STALE);
    const first = await sweepStaleClipCharges(deps(processTwo, { staleMs: STALE, now: later }));
    expect(first).toEqual({ scanned: 1, delivered: 0, refunded: 1, refundFailures: 0 });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith(USER, 400, {
      action: "Runway Video Clip — Refund (clip never saved)",
      projectId: null,
    });

    /* A second sweep (next interval, or a second instance) refunds
       nothing — the obligation is resolved. */
    const second = await sweepStaleClipCharges(deps(processTwo, { staleMs: STALE, now: later }));
    expect(second).toEqual({ scanned: 0, delivered: 0, refunded: 0, refundFailures: 0 });
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("a fresh obligation is NOT swept before the stale cutoff", async () => {
    const store = makeStore(backing);
    await recordClipCharge({ taskId: TASK, userId: USER, credits: 400 }, deps(store));
    const soon = new Date(Date.now() + 5 * 60 * 1000);
    const out = await sweepStaleClipCharges(deps(store, { staleMs: STALE, now: soon }));
    expect(out).toEqual({ scanned: 0, delivered: 0, refunded: 0, refundFailures: 0 });
    expect(refund).not.toHaveBeenCalled();
  });
});

describe("success path — delivery clears the obligation", () => {
  it("markClipChargeDelivered resolves the row; the sweeper then refunds nothing", async () => {
    const store = makeStore(backing);
    await recordClipCharge({ taskId: TASK, userId: USER, credits: 400 }, deps(store));
    expect(await markClipChargeDelivered(TASK, deps(store))).toBe(true);
    expect([...backing.rows.values()][0]).toMatchObject({
      status: "delivered",
      resolution: "saved",
    });
    /* Marking again is a no-op false — already resolved. */
    expect(await markClipChargeDelivered(TASK, deps(store))).toBe(false);

    const later = new Date(Date.now() + 2 * STALE);
    const out = await sweepStaleClipCharges(deps(store, { staleMs: STALE, now: later }));
    expect(out.refunded).toBe(0);
    expect(refund).not.toHaveBeenCalled();
  });

  it("sweeper completes bookkeeping (no refund) when the clip DID land but the mark was lost", async () => {
    const store = makeStore(backing);
    await recordClipCharge({ taskId: TASK, userId: USER, credits: 400 }, deps(store));
    backing.landedClips.add(TASK); /* the save landed; the mark didn't */

    const later = new Date(Date.now() + 2 * STALE);
    const out = await sweepStaleClipCharges(deps(store, { staleMs: STALE, now: later }));
    expect(out).toEqual({ scanned: 1, delivered: 1, refunded: 0, refundFailures: 0 });
    expect(refund).not.toHaveBeenCalled();
    expect([...backing.rows.values()][0]).toMatchObject({
      status: "delivered",
      resolution: "swept_delivered",
    });
  });
});
