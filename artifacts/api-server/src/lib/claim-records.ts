/* ── Per-claim records for the two retention awards that used to
   keep no row (migration 0165): Daily Drop bonus claims and
   creation-streak milestone claims. The Treasury ledger
   (getTreasuryHistory in lib/retention) folds these rows in as
   its "daily-drop" and "streak-milestone" entries.

   WRITE DISCIPLINE — the same guard → pay → record order both
   claim paths already live by (their guards and payouts are
   separate statements too; there is no cross-system transaction
   to join):
     • Call this ONLY after the award has actually paid. A failed
       award records nothing — both callers place the call after
       the payout await that throws on failure.
     • The unique (user_id, kind, ref_key) index is the claim's
       own identity (the UTC day for a drop, the milestone day
       count for a streak), and the insert is ON CONFLICT DO
       NOTHING — a replayed write can never double-record, exactly
       as a replayed claim can never double-pay.
     • A failed RECORD never fails the claim: the award already
       landed, and refusing the response would leave the member
       facing an error for a claim that paid (and that its guard
       now refuses to repeat). The failure is logged CRITICAL —
       the same loud-log discipline as the claim paths' own
       "marked claimed but payout failed" lines. */

import { db, retentionClaimRecordsTable } from "@workspace/db";
import { logger } from "./logger";

export type RetentionClaimKind = "daily_drop" | "streak_milestone";

export async function recordRetentionClaim(input: {
  userId: string;
  kind: RetentionClaimKind;
  /** The claim's own identity: UTC day (YYYY-MM-DD) for a daily
   *  drop; the milestone day count (as text) for a streak. */
  refKey: string;
  /** The amount the award actually paid, stamped at claim time. */
  amountVb: number;
}): Promise<void> {
  try {
    await db
      .insert(retentionClaimRecordsTable)
      .values({
        userId: input.userId,
        kind: input.kind,
        refKey: input.refKey,
        amountVb: input.amountVb,
      })
      .onConflictDoNothing();
  } catch (err) {
    logger.error(
      { err, userId: input.userId, kind: input.kind, refKey: input.refKey, amountVb: input.amountVb },
      "[claim-records] CRITICAL: retention award paid but its per-claim record failed to write",
    );
  }
}
