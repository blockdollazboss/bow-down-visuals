import { eq, and, gte, lt, sql } from "drizzle-orm";
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
   here server-side on the COMBINED weekly total — stream awards
   plus regular shark drops claimed that week, across ALL viewers
   (Lane V3 F8; see combinedDropWeekSpendVb). Awards also land in
   shark_drops (the existing
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

/* The reader seam lets the award path run its spend check INSIDE
   the budget transaction (on the tx handle) while read-only callers
   use the plain db. */
type SpendReader = Pick<typeof db, "select">;

export async function streamDropWeekSpendVb(
  weekStart: string = currentWeekStart(),
  reader: SpendReader = db,
): Promise<number> {
  const rows = await reader
    .select({ total: sql<number>`COALESCE(SUM(${streamDropAwardsTable.amount_vb}),0)::int` })
    .from(streamDropAwardsTable)
    .where(eq(streamDropAwardsTable.week_start, weekStart));
  return rows[0]?.total ?? 0;
}

/**
 * COMBINED weekly drop spend (Lane V3 F8): the 1,000 VB/week
 * envelope covers BOTH drop systems — stream awards AND regular
 * shark drops claimed in the same week. Stream awards also land a
 * mirror row in shark_drops (accounting only); a claim matching an
 * award on user + amount within seconds of the award's creation is
 * that mirror and is NOT counted twice. (A genuine regular claim
 * would need the same user, the same amount, and a claim within 10s
 * of a stream award to be misread as a mirror — bounded at one drop
 * and documented here rather than hidden.)
 */
export async function combinedDropWeekSpendVb(
  weekStart: string = currentWeekStart(),
  reader: SpendReader = db,
): Promise<number> {
  const streamSpent = await streamDropWeekSpendVb(weekStart, reader);
  const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
  const weekEndDate = new Date(weekStartDate.getTime() + 7 * 24 * 3600_000);
  const claims = await reader
    .select({
      userId: sharkDropsTable.userId,
      amount: sharkDropsTable.amount,
      claimedAt: sharkDropsTable.claimedAt,
    })
    .from(sharkDropsTable)
    .where(and(gte(sharkDropsTable.claimedAt, weekStartDate), lt(sharkDropsTable.claimedAt, weekEndDate)));
  if (claims.length === 0) return streamSpent;
  const awards = await reader
    .select({
      user_id: streamDropAwardsTable.user_id,
      amount_vb: streamDropAwardsTable.amount_vb,
      created_at: streamDropAwardsTable.created_at,
    })
    .from(streamDropAwardsTable)
    .where(eq(streamDropAwardsTable.week_start, weekStart));
  let regular = 0;
  for (const c of claims) {
    if (!c.claimedAt) continue;
    const claimedMs = new Date(c.claimedAt).getTime();
    const isMirror = awards.some(
      (a) =>
        a.user_id === c.userId &&
        a.amount_vb === c.amount &&
        Math.abs(new Date(a.created_at).getTime() - claimedMs) <= 10_000,
    );
    if (!isMirror) regular += c.amount;
  }
  return streamSpent + regular;
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
    /* Cap check + award insert run in ONE transaction under a
       week-scoped advisory lock (Lane V3 F8 — the house pattern from
       contests.ts): the old read-then-insert let concurrent
       heartbeats from different viewers each pass the check and
       overshoot the combined cap. The spend read is the COMBINED
       total (stream awards + regular shark-drop claims). */
    const award = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"stream-drops:" + weekStart}))`);
      const spent = await combinedDropWeekSpendVb(weekStart, tx as unknown as SpendReader);
      if (spent + t.amountVb > STREAM_DROP_WEEKLY_CAP_VB) return null;
      const inserted = await tx
        .insert(streamDropAwardsTable)
        .values({ user_id: userId, stream_id: streamId, threshold_seconds: t.seconds, amount_vb: t.amountVb, week_start: weekStart })
        .onConflictDoNothing()
        .returning();
      return inserted[0] ?? null;
    });
    if (!award) {
      /* Either the combined budget is spent or a concurrent heartbeat
         won the unique lock — distinguish for the honest response. */
      const spentNow = await combinedDropWeekSpendVb(weekStart);
      if (spentNow + t.amountVb > STREAM_DROP_WEEKLY_CAP_VB) out.budgetReached = true;
      continue;
    }
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
