import { eq, and, sql } from "drizzle-orm";
import { db, streamDropAwardsTable, sharkDropsTable } from "@workspace/db";
import { addCreditsAtomic } from "./supabase-admin";
import { currentWeekStart } from "./retention";
import { logger } from "./logger";

/* ── Stream-linked Drops (Stack 9 #5) ───────────────────────────────────
   Watching a live stream accrues REAL watch time (server-measured
   heartbeat deltas — see routes/reach.ts). Crossing a threshold
   earns a Visual Bucs drop funded from the EXISTING retention drop
   budget: the same ≤1,000 VB/week envelope the weekly contest pays
   from (challenge-engine's WEEKLY_PRIZE_CAP_VB pattern), enforced
   here server-side as the sum of stream_drop_awards for the week
   across ALL viewers. Awards also land in shark_drops (the existing
   drop ledger) as already-claimed rows, so the drop system's own
   accounting sees them. No parallel budget is invented.

   Threshold menu (fixed): 10 minutes → 100 VB, 30 minutes → 200 VB.
   Per stream per viewer each threshold pays once (unique index).
   A week whose budget is spent pays nothing further — progress
   endpoints say "budget reached" honestly instead of promising. */

export const STREAM_DROP_THRESHOLDS = [
  { seconds: 600, amountVb: 100 },
  { seconds: 1800, amountVb: 200 },
] as const;

export const STREAM_DROP_WEEKLY_CAP_VB = 1000;

export async function streamDropWeekSpendVb(weekStart: string = currentWeekStart()): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${streamDropAwardsTable.amount_vb}),0)::int` })
    .from(streamDropAwardsTable)
    .where(eq(streamDropAwardsTable.week_start, weekStart));
  return rows[0]?.total ?? 0;
}

export interface DropAwardResult {
  awarded: Array<{ thresholdSeconds: number; amountVb: number }>;
  /** True when a crossed threshold could not pay because the weekly
   *  stream-drop budget is spent. */
  budgetReached: boolean;
}

/**
 * Pay every threshold the viewer has crossed on this stream and not
 * yet been paid for, subject to the weekly cap. The award row is
 * inserted FIRST (its unique index is the exactly-once lock); the
 * credit grant follows, and a grant failure deletes the award row
 * so the threshold stays payable later.
 */
export async function awardCrossedStreamDrops(
  userId: string,
  streamId: string,
  secondsWatched: number,
): Promise<DropAwardResult> {
  const out: DropAwardResult = { awarded: [], budgetReached: false };
  const weekStart = currentWeekStart();
  for (const t of STREAM_DROP_THRESHOLDS) {
    if (secondsWatched < t.seconds) continue;
    const existing = await db
      .select({ id: streamDropAwardsTable.id })
      .from(streamDropAwardsTable)
      .where(
        and(
          eq(streamDropAwardsTable.user_id, userId),
          eq(streamDropAwardsTable.stream_id, streamId),
          eq(streamDropAwardsTable.threshold_seconds, t.seconds),
        ),
      )
      .limit(1);
    if (existing[0]) continue;
    const spent = await streamDropWeekSpendVb(weekStart);
    if (spent + t.amountVb > STREAM_DROP_WEEKLY_CAP_VB) {
      out.budgetReached = true;
      continue;
    }
    const inserted = await db
      .insert(streamDropAwardsTable)
      .values({ user_id: userId, stream_id: streamId, threshold_seconds: t.seconds, amount_vb: t.amountVb, week_start: weekStart })
      .onConflictDoNothing()
      .returning();
    const award = inserted[0];
    if (!award) continue; // a concurrent heartbeat won the lock
    try {
      await addCreditsAtomic(userId, t.amountVb);
    } catch (err) {
      await db.delete(streamDropAwardsTable).where(eq(streamDropAwardsTable.id, award.id)).catch(() => undefined);
      logger.error({ err, userId, streamId }, "stream-drops: credit grant failed — award rolled back");
      throw err;
    }
    // Record in the existing drop ledger (already-claimed: the VB is
    // granted above; this row is accounting, not a second payout).
    await db
      .insert(sharkDropsTable)
      .values({
        userId,
        amount: t.amountVb,
        droppedAt: new Date(),
        claimedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 3600_000),
      })
      .catch((err) => logger.warn({ err, userId }, "stream-drops: ledger row failed (award already paid)"));
    out.awarded.push({ thresholdSeconds: t.seconds, amountVb: t.amountVb });
  }
  return out;
}
