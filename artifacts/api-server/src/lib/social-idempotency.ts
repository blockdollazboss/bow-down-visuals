import { eq, and, lt } from "drizzle-orm";
import {
  db as defaultDb,
  socialPublishAttemptsTable,
  type PublishAttemptResult,
  type PublishAttemptStatus,
  type SocialPublishAttempt,
} from "@workspace/db";
import { logger } from "./logger";

/* Idempotency for social publishing (Instagram MVP).

   The client generates one idempotency key per publish intent and sends it
   with the request. The server claims a row for (user_id, idempotency_key)
   BEFORE charging credits or calling Meta:

   - new key → this request owns the attempt (`claimed`)
   - key seen, row `succeeded` → `replay` with the stored result: no re-post,
     no re-charge. This is what makes retry-after-timeout safe.
   - key seen, row `processing` and fresh → `in_progress`: the first attempt
     is still running, so the client waits instead of starting a duplicate.
   - key seen, row `failed` → atomically reclaim and retry (`claimed` again).
     Credits were refunded when it failed, so charging again is correct.
   - key seen, row `processing` but stale (older than STALE_PROCESSING_MS —
     the process died mid-publish) → atomically reclaim and retry. The
     `creditsAlreadyDeducted` flag tells the caller whether the dead attempt
     already charged, so the retry skips the deduction instead of charging
     twice.

   All claim/reclaim decisions are single atomic statements (INSERT … ON
   CONFLICT DO NOTHING, UPDATE … WHERE status=…), so two concurrent requests
   with the same key can't both win.

   Residual risk, documented honestly: if the process dies in the tiny window
   between Meta's media_publish succeeding and the `succeeded` row update, a
   reclaimed retry would post a second time. That window is one UPDATE wide;
   everything else is exactly-once.

   The stale-attempt sweeper (social-sweeper.ts) closes the remaining gap:
   `processing` rows older than STALE_PROCESSING_MS are atomically moved to
   `failed` via claimStaleProcessing() and their deducted credits refunded.
   A later retry with the same key then flows through the normal
   `failed`→reclaim path above and charges fresh — no double charge, no
   double refund. */

export const STALE_PROCESSING_MS = 30 * 60 * 1000;

/* Re-exported for route handlers that record/replay attempt results. */
export type { PublishAttemptResult };

export interface ClaimInput {
  userId: string;
  platform?: string;
  idempotencyKey: string;
  accountId?: string;
}

export type ClaimOutcome =
  | { outcome: "claimed"; attemptId: string; creditsAlreadyDeducted: boolean }
  | { outcome: "replay"; result: PublishAttemptResult }
  | { outcome: "in_progress" };

/* Minimal store interface so the claim state machine is unit-testable
   without a database; createDrizzleAttemptStore() is the production impl. */
export interface AttemptStore {
  insertAttempt(input: {
    userId: string;
    platform: string;
    idempotencyKey: string;
    accountId?: string;
  }): Promise<{ inserted: boolean; id: string | null }>;
  getAttempt(userId: string, idempotencyKey: string): Promise<SocialPublishAttempt | null>;
  /** Atomically move a row back to `processing` iff it is still in the
      expected state (and, for stale processing rows, still stale). */
  reclaimAttempt(input: {
    id: string;
    expectedStatus: PublishAttemptStatus;
    staleBefore?: Date;
    accountId?: string;
  }): Promise<boolean>;
  /** Atomically claim every `processing` row older than `cutoff`, moving it
      to `failed` with the given error. Returns the claimed rows (id, owner,
      whether credits were deducted) for refund processing. A single UPDATE
      statement, so concurrent sweepers can never claim the same row twice. */
  claimStaleProcessing(
    cutoff: Date,
    error: string,
  ): Promise<Array<{ id: string; userId: string; creditsDeducted: boolean }>>;
  markCreditsDeducted(id: string): Promise<void>;
  completeAttempt(id: string, result: PublishAttemptResult): Promise<void>;
  failAttempt(id: string, error: string): Promise<void>;
}

type Db = typeof defaultDb;

export function createDrizzleAttemptStore(db: Db = defaultDb): AttemptStore {
  const T = socialPublishAttemptsTable;
  return {
    async insertAttempt(input) {
      const rows = await db
        .insert(T)
        .values({
          user_id: input.userId,
          platform: input.platform,
          idempotency_key: input.idempotencyKey,
          account_id: input.accountId ?? null,
          status: "processing",
        })
        .onConflictDoNothing({
          target: [T.user_id, T.idempotency_key],
        })
        .returning({ id: T.id });
      return { inserted: rows.length > 0, id: rows[0]?.id ?? null };
    },

    async getAttempt(userId, idempotencyKey) {
      const rows = await db
        .select()
        .from(T)
        .where(and(eq(T.user_id, userId), eq(T.idempotency_key, idempotencyKey)))
        .limit(1);
      return rows[0] ?? null;
    },

    async reclaimAttempt(input) {
      const conditions = [eq(T.id, input.id), eq(T.status, input.expectedStatus)];
      if (input.staleBefore) conditions.push(lt(T.updated_at, input.staleBefore));
      const rows = await db
        .update(T)
        .set({
          status: "processing",
          account_id: input.accountId ?? null,
          updated_at: new Date(),
        })
        .where(and(...conditions))
        .returning({ id: T.id });
      return rows.length > 0;
    },

    async markCreditsDeducted(id) {
      await db.update(T).set({ credits_deducted: true, updated_at: new Date() }).where(eq(T.id, id));
    },

    async claimStaleProcessing(cutoff, error) {
      const rows = await db
        .update(T)
        .set({ status: "failed", error, updated_at: new Date() })
        .where(and(eq(T.status, "processing"), lt(T.updated_at, cutoff)))
        .returning({ id: T.id, userId: T.user_id, creditsDeducted: T.credits_deducted });
      return rows;
    },

    async completeAttempt(id, result) {
      await db
        .update(T)
        .set({ status: "succeeded", result, error: null, updated_at: new Date() })
        .where(eq(T.id, id));
    },

    async failAttempt(id, error) {
      await db
        .update(T)
        .set({ status: "failed", error, updated_at: new Date() })
        .where(eq(T.id, id));
    },
  };
}

export async function claimPublishAttempt(
  store: AttemptStore,
  input: ClaimInput,
  now: Date = new Date(),
): Promise<ClaimOutcome> {
  const platform = input.platform ?? "instagram";

  const { inserted, id } = await store.insertAttempt({
    userId: input.userId,
    platform,
    idempotencyKey: input.idempotencyKey,
    accountId: input.accountId,
  });
  if (inserted && id) {
    return { outcome: "claimed", attemptId: id, creditsAlreadyDeducted: false };
  }

  const row = await store.getAttempt(input.userId, input.idempotencyKey);
  if (!row) {
    /* Lost a race we can't explain (insert conflicted but the row vanished).
       Fail closed: tell the client to wait rather than risk a duplicate. */
    logger.warn(
      { userId: input.userId, key: input.idempotencyKey },
      "[social] idempotency insert conflicted but no row found",
    );
    return { outcome: "in_progress" };
  }

  if (row.status === "succeeded" && row.result) {
    return { outcome: "replay", result: row.result };
  }

  const staleCutoff = new Date(now.getTime() - STALE_PROCESSING_MS);
  const reclaimable =
    row.status === "failed" ||
    (row.status === "processing" && row.updated_at < staleCutoff);

  if (reclaimable) {
    /* Capture the pre-reclaim status: some store implementations mutate the
       row object on reclaim, so the decision must not read row.status after. */
    const statusBeforeReclaim = row.status;
    const reclaimed = await store.reclaimAttempt({
      id: row.id,
      expectedStatus: row.status,
      staleBefore: row.status === "processing" ? staleCutoff : undefined,
      accountId: input.accountId,
    });
    if (reclaimed) {
      return {
        outcome: "claimed",
        attemptId: row.id,
        /* Only a reclaimed stale `processing` attempt skips the deduction:
           it was charged and never refunded (the process died mid-publish).
           A `failed` attempt was always refunded when it failed — every
           failAttempt in the publish route and the stale sweeper is paired
           with a refund — so its retry must charge fresh. (The
           credits_deducted flag is intentionally NOT cleared on failure;
           this branch is what makes the retry re-charge.) */
        creditsAlreadyDeducted:
          statusBeforeReclaim === "processing" ? row.credits_deducted : false,
      };
    }
    /* Lost the reclaim race to a concurrent request — it owns the attempt now. */
    return { outcome: "in_progress" };
  }

  return { outcome: "in_progress" };
}
