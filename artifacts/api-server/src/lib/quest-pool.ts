/**
 * The weekly quest pool — the ONE envelope every free-credit game
 * reward draws from (Ring 3).
 *
 * The owner's law: free credits from the game rails cap at 300 VB
 * per member per week, and new features RIDE that envelope instead
 * of issuing new money. The pool's sources today:
 *   - weekly quest rewards (retention QUEST_DEFS claims),
 *   - the King's daily audience gifts (lib/world-king-moment),
 *   - the "Your First 10 Minutes" completion reward
 *     (lib/world-tutorial),
 *   - the Daily Quest Trio's claims (lib/daily-quests, Ring 4).
 * Every payer checks the SAME sum through this module before it
 * pays: spend + amount ≤ WEEKLY_QUEST_POOL_VB, or the claim
 * refuses with the pool reason. (The Daily Drop / bonus rail is a
 * separate, separately-ruled issuance and does NOT draw here.)
 *
 * The week is Monday-anchored (UTC) — the same week the retention
 * quest rails run on (lib/retention's currentWeekStart).
 */

import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import {
  db,
  questProgressTable,
  kingMomentClaimsTable,
  worldTutorialProgressTable,
  dailyQuestProgressTable,
} from "@workspace/db";
import { QUEST_DEFS } from "./retention";

/** The weekly free-credit envelope, in Visual Bucs. Also the sum
 *  of the QUEST_DEFS rewards (40 + 80 + 120 + 60) — the pool was
 *  sized by the quest slate; the game's other rewards share it. */
export const WEEKLY_QUEST_POOL_VB = 300;

/** Monday (UTC) of the week containing `now`, as YYYY-MM-DD — the
 *  retention rails' week key. */
export function questPoolWeekStart(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
  day.setUTCDate(day.getUTCDate() - dow);
  return day.toISOString().slice(0, 10);
}

/** The pool's four source sums for one member + week. Injectable
 *  so payers' pool math is unit-testable without a database. */
export interface QuestPoolStore {
  questClaimsVb(userId: string, weekStart: string): Promise<number>;
  kingClaimsVb(userId: string, weekStart: string): Promise<number>;
  tutorialClaimsVb(userId: string, weekStart: string): Promise<number>;
  dailyClaimsVb(userId: string, weekStart: string): Promise<number>;
}

/** The week window a daily row's day must fall in: [weekStart,
 *  weekStart + 7d) as YYYY-MM-DD keys — daily claims key on their
 *  palace day (migration 0150), so their weekly sum is a date
 *  range, not a week key. */
export function dailyWeekWindow(weekStart: string): { from: string; to: string } {
  const [y, m, d] = weekStart.split("-").map((p) => Number(p));
  const end = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + 7));
  return { from: weekStart, to: end.toISOString().slice(0, 10) };
}

export const dbQuestPoolStore: QuestPoolStore = {
  async questClaimsVb(userId, weekStart) {
    const rewards = new Map(QUEST_DEFS.map((q) => [q.key, q.reward]));
    const rows = await db
      .select({ questKey: questProgressTable.questKey })
      .from(questProgressTable)
      .where(
        and(
          eq(questProgressTable.userId, userId),
          eq(questProgressTable.weekStart, weekStart),
          isNotNull(questProgressTable.claimedAt),
        ),
      );
    return rows.reduce((sum, r) => sum + (rewards.get(r.questKey) ?? 0), 0);
  },
  async kingClaimsVb(userId, weekStart) {
    const rows = await db
      .select({ amountVb: kingMomentClaimsTable.amountVb })
      .from(kingMomentClaimsTable)
      .where(
        and(
          eq(kingMomentClaimsTable.userId, userId),
          gte(kingMomentClaimsTable.momentDate, weekStart),
        ),
      );
    return rows.reduce((sum, r) => sum + r.amountVb, 0);
  },
  async tutorialClaimsVb(userId, weekStart) {
    const rows = await db
      .select({ amountVb: worldTutorialProgressTable.rewardAmountVb })
      .from(worldTutorialProgressTable)
      .where(
        and(
          eq(worldTutorialProgressTable.userId, userId),
          isNotNull(worldTutorialProgressTable.rewardClaimedAt),
          gte(worldTutorialProgressTable.rewardClaimedAt, new Date(`${weekStart}T00:00:00.000Z`)),
        ),
      );
    return rows.reduce((sum, r) => sum + (r.amountVb ?? 0), 0);
  },
  async dailyClaimsVb(userId, weekStart) {
    /* The amount each claim row RECORDED (reward_vb stamped at
     * claim time, the King's-gift pattern), so a later def
     * rebalance can never rewrite what a past week actually paid. */
    const { from, to } = dailyWeekWindow(weekStart);
    const rows = await db
      .select({ rewardVb: dailyQuestProgressTable.rewardVb })
      .from(dailyQuestProgressTable)
      .where(
        and(
          eq(dailyQuestProgressTable.userId, userId),
          isNotNull(dailyQuestProgressTable.claimedAt),
          gte(dailyQuestProgressTable.dayDate, from),
          lt(dailyQuestProgressTable.dayDate, to),
        ),
      );
    return rows.reduce((sum, r) => sum + (r.rewardVb ?? 0), 0);
  },
};

/** What one member has already drawn from this week's pool,
 *  across every source. */
export async function questPoolSpendVb(
  store: QuestPoolStore,
  userId: string,
  weekStart: string,
): Promise<number> {
  const [quests, king, tutorial, daily] = await Promise.all([
    store.questClaimsVb(userId, weekStart),
    store.kingClaimsVb(userId, weekStart),
    store.tutorialClaimsVb(userId, weekStart),
    store.dailyClaimsVb(userId, weekStart),
  ]);
  return quests + king + tutorial + daily;
}
