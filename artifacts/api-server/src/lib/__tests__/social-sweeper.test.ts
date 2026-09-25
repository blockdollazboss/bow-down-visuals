import { describe, it, expect, vi } from "vitest";
import { sweepStalePublishAttempts } from "../social-sweeper";
import {
  claimPublishAttempt,
  STALE_PROCESSING_MS,
  type AttemptStore,
} from "../social-idempotency";
import type { SocialPublishAttempt } from "@workspace/db";

/* In-memory fake of the extended AttemptStore. claimStaleProcessing()
   mutates synchronously inside its async body — the same atomicity the
   production single-statement UPDATE provides — so the concurrency tests
   below are meaningful. */

function makeStore() {
  const rows = new Map<string, SocialPublishAttempt>();
  let seq = 0;
  const key = (userId: string, k: string) => `${userId}:${k}`;
  const store: AttemptStore = {
    async insertAttempt(input) {
      const k = key(input.userId, input.idempotencyKey);
      if (rows.has(k)) return { inserted: false, id: null };
      seq += 1;
      const id = `attempt-${seq}`;
      const now = new Date();
      rows.set(k, {
        id,
        user_id: input.userId,
        platform: input.platform,
        idempotency_key: input.idempotencyKey,
        account_id: input.accountId ?? null,
        status: "processing",
        credits_deducted: false,
        result: null,
        error: null,
        created_at: now,
        updated_at: now,
      });
      return { inserted: true, id };
    },
    async getAttempt(userId, k) {
      return rows.get(key(userId, k)) ?? null;
    },
    async reclaimAttempt(input) {
      const row = [...rows.values()].find((r) => r.id === input.id);
      if (!row || row.status !== input.expectedStatus) return false;
      if (input.staleBefore && row.updated_at >= input.staleBefore) return false;
      row.status = "processing";
      row.account_id = input.accountId ?? null;
      row.updated_at = new Date();
      return true;
    },
    async claimStaleProcessing(cutoff, error) {
      const claimed: Array<{ id: string; userId: string; creditsDeducted: boolean }> = [];
      for (const row of rows.values()) {
        if (row.status === "processing" && row.updated_at < cutoff) {
          row.status = "failed";
          row.error = error;
          row.updated_at = new Date();
          claimed.push({ id: row.id, userId: row.user_id, creditsDeducted: row.credits_deducted });
        }
      }
      return claimed;
    },
    async markCreditsDeducted(id) {
      const row = [...rows.values()].find((r) => r.id === id);
      if (row) row.credits_deducted = true;
    },
    async completeAttempt(id, result) {
      const row = [...rows.values()].find((r) => r.id === id);
      if (row) {
        row.status = "succeeded";
        row.result = result;
        row.error = null;
        row.updated_at = new Date();
      }
    },
    async failAttempt(id, error) {
      const row = [...rows.values()].find((r) => r.id === id);
      if (row) {
        row.status = "failed";
        row.error = error;
        row.updated_at = new Date();
      }
    },
  };
  return { store, rows };
}

const CLAIM = { userId: "user-1", platform: "instagram", idempotencyKey: "key-abc", accountId: "acct-1" };
const STALE = new Date(Date.now() - STALE_PROCESSING_MS - 60_000);

function ageRow(rows: Map<string, SocialPublishAttempt>, k: string, at: Date) {
  rows.get(k)!.updated_at = at;
}

describe("sweepStalePublishAttempts", () => {
  it("fails and refunds a stale processing attempt that was charged", async () => {
    const { store, rows } = makeStore();
    const first = await claimPublishAttempt(store, CLAIM);
    if (first.outcome !== "claimed") throw new Error("expected claim");
    await store.markCreditsDeducted(first.attemptId);
    ageRow(rows, "user-1:key-abc", STALE);

    const refundCredits = vi.fn(async () => {});
    const result = await sweepStalePublishAttempts({ store, refundCredits, creditCost: 2 });

    expect(result).toEqual({ claimed: 1, refunded: 1, refundFailures: 0 });
    expect(refundCredits).toHaveBeenCalledTimes(1);
    expect(refundCredits).toHaveBeenCalledWith("user-1", 2);
    expect(rows.get("user-1:key-abc")!.status).toBe("failed");
  });

  it("marks an uncharged stale attempt failed without refunding", async () => {
    const { store, rows } = makeStore();
    await claimPublishAttempt(store, CLAIM);
    /* Died between claim and deduction — credits_deducted stays false. */
    ageRow(rows, "user-1:key-abc", STALE);

    const refundCredits = vi.fn(async () => {});
    const result = await sweepStalePublishAttempts({ store, refundCredits });

    expect(result).toEqual({ claimed: 1, refunded: 0, refundFailures: 0 });
    expect(refundCredits).not.toHaveBeenCalled();
    expect(rows.get("user-1:key-abc")!.status).toBe("failed");
  });

  it("leaves fresh processing attempts alone", async () => {
    const { store, rows } = makeStore();
    const first = await claimPublishAttempt(store, CLAIM);
    if (first.outcome !== "claimed") throw new Error("expected claim");
    await store.markCreditsDeducted(first.attemptId);
    /* updated_at is now — well under the cutoff. */

    const refundCredits = vi.fn(async () => {});
    const result = await sweepStalePublishAttempts({ store, refundCredits });

    expect(result).toEqual({ claimed: 0, refunded: 0, refundFailures: 0 });
    expect(refundCredits).not.toHaveBeenCalled();
    expect(rows.get("user-1:key-abc")!.status).toBe("processing");
  });

  it("leaves succeeded and failed attempts alone", async () => {
    const { store, rows } = makeStore();
    const first = await claimPublishAttempt(store, CLAIM);
    if (first.outcome !== "claimed") throw new Error("expected claim");
    await store.markCreditsDeducted(first.attemptId);
    await store.completeAttempt(first.attemptId, {
      mediaId: "m", permalink: null, creditsUsed: 2, creditsRemaining: 98,
    });
    ageRow(rows, "user-1:key-abc", STALE);

    const second = await claimPublishAttempt(store, { ...CLAIM, idempotencyKey: "key-def" });
    if (second.outcome !== "claimed") throw new Error("expected claim");
    await store.failAttempt(second.attemptId, "instagram_error");
    ageRow(rows, "user-1:key-def", STALE);

    const refundCredits = vi.fn(async () => {});
    const result = await sweepStalePublishAttempts({ store, refundCredits });

    expect(result).toEqual({ claimed: 0, refunded: 0, refundFailures: 0 });
    expect(refundCredits).not.toHaveBeenCalled();
  });

  it("retry after a sweep: no double charge, no double refund", async () => {
    const { store, rows } = makeStore();
    /* Simulate the money side: a fake balance the route would mutate. */
    let balance = 100;
    const deduct = () => { balance -= 2; };
    const refundCredits = vi.fn(async () => { balance += 2; });

    /* Original attempt: claimed, charged, then the process died. */
    const first = await claimPublishAttempt(store, CLAIM);
    if (first.outcome !== "claimed") throw new Error("expected claim");
    deduct();
    await store.markCreditsDeducted(first.attemptId);
    ageRow(rows, "user-1:key-abc", STALE);
    expect(balance).toBe(98);

    /* Sweeper runs: fails the row, refunds once. */
    await sweepStalePublishAttempts({ store, refundCredits, creditCost: 2 });
    expect(balance).toBe(100);
    expect(refundCredits).toHaveBeenCalledTimes(1);

    /* User retries with the same key: reclaims the failed row and must
       charge fresh (the sweep already refunded). */
    const retry = await claimPublishAttempt(store, CLAIM);
    expect(retry.outcome).toBe("claimed");
    if (retry.outcome !== "claimed") throw new Error("expected claim");
    expect(retry.creditsAlreadyDeducted).toBe(false);
    deduct(); // the route's fresh deduction for the retry
    expect(balance).toBe(98);

    /* Net: two charges (original + retry), one refund — exactly right for
       one failed attempt plus one live retry. No double refund. */
    expect(refundCredits).toHaveBeenCalledTimes(1);
  });

  it("concurrent sweeps process each attempt exactly once", async () => {
    const { store, rows } = makeStore();
    for (const k of ["key-a", "key-b", "key-c"]) {
      const c = await claimPublishAttempt(store, { ...CLAIM, idempotencyKey: k });
      if (c.outcome !== "claimed") throw new Error("expected claim");
      await store.markCreditsDeducted(c.attemptId);
      ageRow(rows, `user-1:${k}`, STALE);
    }

    const refundCredits = vi.fn(async () => {});
    const deps = { store, refundCredits, creditCost: 2 };
    const [r1, r2] = await Promise.all([
      sweepStalePublishAttempts(deps),
      sweepStalePublishAttempts(deps),
    ]);

    expect(r1.claimed + r2.claimed).toBe(3);
    expect(refundCredits).toHaveBeenCalledTimes(3);
    for (const k of ["key-a", "key-b", "key-c"]) {
      expect(rows.get(`user-1:${k}`)!.status).toBe("failed");
    }
  });

  it("a refund failure is logged and doesn't stop the sweep", async () => {
    const { store, rows } = makeStore();
    for (const [userId, k] of [["user-1", "key-a"], ["user-2", "key-b"]] as const) {
      const c = await claimPublishAttempt(store, { userId, platform: "instagram", idempotencyKey: k });
      if (c.outcome !== "claimed") throw new Error("expected claim");
      await store.markCreditsDeducted(c.attemptId);
      ageRow(rows, `${userId}:${k}`, STALE);
    }

    const refundCredits = vi.fn(async (userId: string) => {
      if (userId === "user-1") throw new Error("supabase down");
    });
    const result = await sweepStalePublishAttempts({ store, refundCredits, creditCost: 2 });

    expect(result).toEqual({ claimed: 2, refunded: 1, refundFailures: 1 });
    expect(rows.get("user-1:key-a")!.status).toBe("failed");
    expect(rows.get("user-2:key-b")!.status).toBe("failed");
  });
});
