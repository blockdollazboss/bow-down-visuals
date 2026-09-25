import { describe, it, expect } from "vitest";
import {
  claimPublishAttempt,
  STALE_PROCESSING_MS,
  type AttemptStore,
  type PublishAttemptResult,
} from "../social-idempotency";
import type { SocialPublishAttempt } from "@workspace/db";

/* In-memory fake of the AttemptStore — exercises the claim/replay/reclaim
   state machine without a database. The production Drizzle store is a thin
   wrapper over single atomic statements (INSERT … ON CONFLICT DO NOTHING /
   UPDATE … WHERE status=…), so the concurrency semantics tested here hold. */

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

const RESULT: PublishAttemptResult = {
  mediaId: "media-1",
  permalink: "https://instagram.com/p/abc",
  creditsUsed: 2,
  creditsRemaining: 480,
};

const CLAIM = { userId: "user-1", platform: "instagram", idempotencyKey: "key-abc", accountId: "acct-1" };

describe("claimPublishAttempt", () => {
  it("claims a fresh key", async () => {
    const { store } = makeStore();
    const out = await claimPublishAttempt(store, CLAIM);
    expect(out.outcome).toBe("claimed");
    if (out.outcome === "claimed") {
      expect(out.creditsAlreadyDeducted).toBe(false);
    }
  });

  it("returns in_progress while the first attempt is still running", async () => {
    const { store } = makeStore();
    await claimPublishAttempt(store, CLAIM);
    /* Double-click / second tab with the same key: no duplicate. */
    const out = await claimPublishAttempt(store, CLAIM);
    expect(out).toEqual({ outcome: "in_progress" });
  });

  it("replays the stored result after success — no re-post, no re-charge", async () => {
    const { store } = makeStore();
    const first = await claimPublishAttempt(store, CLAIM);
    expect(first.outcome).toBe("claimed");
    if (first.outcome !== "claimed") throw new Error("expected claim");
    await store.markCreditsDeducted(first.attemptId);
    await store.completeAttempt(first.attemptId, RESULT);

    /* Retry after a timeout with the same key: identical result, and the
       caller returns before touching credits or Meta. */
    const out = await claimPublishAttempt(store, CLAIM);
    expect(out).toEqual({ outcome: "replay", result: RESULT });
  });

  it("allows retry after a failed attempt", async () => {
    const { store } = makeStore();
    const first = await claimPublishAttempt(store, CLAIM);
    if (first.outcome !== "claimed") throw new Error("expected claim");
    await store.failAttempt(first.attemptId, "instagram_error");

    const out = await claimPublishAttempt(store, CLAIM);
    expect(out.outcome).toBe("claimed");
    if (out.outcome === "claimed") {
      /* Credits were refunded on failure, so the retry charges fresh. */
      expect(out.creditsAlreadyDeducted).toBe(false);
    }
  });

  it("reclaims a stale processing attempt without double-charging", async () => {
    const { store, rows } = makeStore();
    const first = await claimPublishAttempt(store, CLAIM);
    if (first.outcome !== "claimed") throw new Error("expected claim");
    await store.markCreditsDeducted(first.attemptId);
    /* Simulate a process death: row stuck `processing` for over the TTL. */
    const row = rows.get("user-1:key-abc")!;
    row.updated_at = new Date(Date.now() - STALE_PROCESSING_MS - 60_000);

    const out = await claimPublishAttempt(store, CLAIM);
    expect(out.outcome).toBe("claimed");
    if (out.outcome === "claimed") {
      expect(out.attemptId).toBe(first.attemptId);
      expect(out.creditsAlreadyDeducted).toBe(true);
    }
  });

  it("does not reclaim a fresh processing attempt", async () => {
    const { store } = makeStore();
    await claimPublishAttempt(store, CLAIM);
    const out = await claimPublishAttempt(store, CLAIM, new Date(Date.now() + 60_000));
    expect(out).toEqual({ outcome: "in_progress" });
  });

  it("losing the reclaim race reports in_progress instead of duplicating", async () => {
    const { store, rows } = makeStore();
    const first = await claimPublishAttempt(store, CLAIM);
    if (first.outcome !== "claimed") throw new Error("expected claim");
    await store.failAttempt(first.attemptId, "boom");
    /* Another request reclaims first… */
    const winner = await claimPublishAttempt(store, CLAIM);
    expect(winner.outcome).toBe("claimed");
    /* …then the row is processing again, so a late duplicate waits. */
    rows.get("user-1:key-abc")!.status = "processing";
    const loser = await claimPublishAttempt(store, CLAIM);
    expect(loser).toEqual({ outcome: "in_progress" });
  });

  it("scopes keys per user", async () => {
    const { store } = makeStore();
    await claimPublishAttempt(store, CLAIM);
    const other = await claimPublishAttempt(store, { ...CLAIM, userId: "user-2" });
    expect(other.outcome).toBe("claimed");
  });
});
