/* ─── Pitch & Fix rewards — the payment rail (owner ruling, Oct 25,
   18:12 EDT; Stack-200 UPGRADES 196 + 180) ───────────────────────────
   Amounts + pool live in lib/pitch-fix.ts (rewardAmountFor,
   getRewardPoolState): shipped pitch 500 VB, fixed fix/feedback
   100 VB (250 for blocks_me), ONE shared 1,000 VB/week pool, queued
   over-cap rewards roll into next week. This module MOVES the money,
   on the referral rail's pattern (routes/referrals.ts +
   lib/grant-ledger.ts):

   1. CLAIM — the submission row itself is the claim: reward_status
      flips queued → paid (conditional, one winner) BEFORE any money
      moves. A processor that loses the claim pays nothing.
   2. GRANT — addCreditsAtomic credits the submitter's profile.
   3. LEDGER — a STRICT credit_usage row, creditsUsed NEGATIVE (the
      grant convention), keyed `pitch-fix-reward:<submission_id>` —
      the unique key makes any replay resolve "already-recorded",
      never a second row, and the grant shows on /credit-history.
   4. FAILURE — if the grant or the ledger genuinely fails after the
      claim: claw back any credits that moved, RELEASE the claim
      (paid → queued), and report failed_released. The item stays in
      the queue — never a double-pay, never a silent loss; the next
      processing run retries it.

   Processing is strict FIFO (first-shipped first-paid): the first
   queued item that doesn't fit the week's remaining pool stops the
   run — nothing behind it jumps the line. Runs fire from the team
   surface: after a status transition, when the review queue is
   opened, and from POST /api/admin/pitch-fix/rewards/process (the
   3x/day intake checks call that one).

   Visual Bucs ONLY — no cash path exists anywhere in this rail. */

import { db, creditUsageTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordCreditUsageStrict } from "./payment-record";
import { isUniqueViolation } from "./pg-errors";
import { logger } from "./logger";
import {
  getRewardPoolState,
  setSubmissionStatus,
  type PitchFixStore,
  type SubmissionWire,
} from "./pitch-fix";

export const pitchFixRewardLedgerKey = (submissionId: string) => `pitch-fix-reward:${submissionId}`;

export const pitchFixRewardAction = (sub: Pick<SubmissionWire, "kind">) =>
  sub.kind === "pitch" ? "Pitch & Fix Reward — Shipped Pitch" : "Pitch & Fix Reward — Fixed Report";

export interface RewardPayDeps {
  addCredits(userId: string, amount: number): Promise<void>;
  recordLedger(record: {
    userId: string;
    action: string;
    creditsUsed: number;
    idempotencyKey: string;
  }): Promise<"recorded" | "already-recorded">;
}

function isDuplicateKeyError(err: unknown): boolean {
  /* Same rule as lib/grant-ledger.ts: drizzle wraps pg errors, so the
     23505 code may ride on .cause; a message match covers fakes. */
  if (isUniqueViolation(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key|unique constraint|credit_usage_idempotency_key_uidx/i.test(msg);
}

export const defaultRewardPayDeps: RewardPayDeps = {
  async addCredits(userId, amount) {
    /* Dynamic import, the payment-record pattern (supabase-admin is a
       leaf; this avoids a hard dependency cycle). */
    const { addCreditsAtomic } = await import("./supabase-admin");
    await addCreditsAtomic(userId, amount);
  },
  async recordLedger(record) {
    const [existing] = await db
      .select({ id: creditUsageTable.id })
      .from(creditUsageTable)
      .where(eq(creditUsageTable.idempotencyKey, record.idempotencyKey))
      .limit(1);
    if (existing) return "already-recorded";
    try {
      await recordCreditUsageStrict(record);
      return "recorded";
    } catch (err) {
      if (isDuplicateKeyError(err)) return "already-recorded";
      throw err;
    }
  },
};

export type PayOutcome = "paid" | "already_claimed" | "failed_released";

export async function payQueuedReward(
  store: PitchFixStore,
  deps: RewardPayDeps,
  sub: SubmissionWire,
  now: Date = new Date(),
): Promise<PayOutcome> {
  const amount = sub.rewardAmount ?? 0;
  if (sub.rewardStatus !== "queued" || amount <= 0) return "already_claimed";
  const claimed = await store.claimReward(sub.id, now.toISOString());
  if (!claimed) return "already_claimed";
  let granted = false;
  try {
    await deps.addCredits(sub.submitterUserId, amount);
    granted = true;
    await deps.recordLedger({
      userId: sub.submitterUserId,
      action: pitchFixRewardAction(sub),
      creditsUsed: -amount,
      idempotencyKey: pitchFixRewardLedgerKey(sub.id),
    });
    return "paid";
  } catch (err) {
    if (granted) {
      await deps.addCredits(sub.submitterUserId, -amount).catch(() => {});
    }
    await store.releaseRewardClaim(sub.id);
    logger.error(
      { err, submissionId: sub.id, submitterUserId: sub.submitterUserId, amount },
      "[pitch-fix-rewards] payout failed after claim — credits clawed back, claim released to the queue for retry",
    );
    return "failed_released";
  }
}

export interface ProcessRewardsResult {
  weekStart: string;
  capVb: number;
  spentVbBefore: number;
  paidNowVb: number;
  paidIds: string[];
  failedId: string | null;
  stillQueuedIds: string[];
}

/** Pay the queue, oldest first, until the week's pool can't fit the
 *  head item (strict FIFO — it rolls to next week, still queued) or
 *  a payout fails (released back to queued; the run stops so the
 *  failure is worked before later items jump it). */
export async function processRewardQueue(
  store: PitchFixStore,
  deps: RewardPayDeps,
  now: Date = new Date(),
): Promise<ProcessRewardsResult> {
  const state = await getRewardPoolState(store, now);
  let remaining = state.remainingVb;
  let paidNowVb = 0;
  const paidIds: string[] = [];
  let failedId: string | null = null;
  const stillQueuedIds: string[] = [];

  let blocked = false;
  for (const sub of state.queued) {
    const amount = sub.rewardAmount ?? 0;
    if (blocked || failedId || amount > remaining) {
      /* Strict FIFO: once the head doesn't fit the week's remaining
         pool, the whole line waits — nothing behind it jumps. */
      blocked = true;
      stillQueuedIds.push(sub.id);
      continue;
    }
    const outcome = await payQueuedReward(store, deps, sub, now);
    if (outcome === "paid") {
      paidIds.push(sub.id);
      paidNowVb += amount;
      remaining -= amount;
    } else if (outcome === "failed_released") {
      failedId = sub.id;
      stillQueuedIds.push(sub.id);
    }
    /* already_claimed: another processor owns it — not ours to queue. */
  }

  return {
    weekStart: state.weekStart,
    capVb: state.capVb,
    spentVbBefore: state.spentVb,
    paidNowVb,
    paidIds,
    failedId,
    stillQueuedIds,
  };
}

/** The team-surface path: set the status (which queues/unqueues the
 *  reward on the transition), then immediately process the queue so
 *  a shipped item with pool room pays in the same action. */
export async function setStatusAndProcessRewards(
  store: PitchFixStore,
  deps: RewardPayDeps,
  id: string,
  status: string,
  now: Date = new Date(),
): Promise<{ submission: SubmissionWire; rewards: ProcessRewardsResult }> {
  const submission = await setSubmissionStatus(store, id, status, now);
  const rewards = await processRewardQueue(store, deps, now);
  const fresh = (await store.getSubmission(id)) ?? submission;
  return { submission: fresh, rewards };
}
