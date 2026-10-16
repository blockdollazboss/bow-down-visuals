import { eq, and, sql } from "drizzle-orm";
import { db, loyaltySettingsTable, loyaltyBalancesTable, type LoyaltySettings } from "@workspace/db";
import { logger } from "./logger";

/* ── Per-channel loyalty (Stack 9 #6) ───────────────────────────────────
   Fans earn a channel's own points for watching / chatting / tipping.
   Earn rules are a FIXED MENU — creators pick a value per action from
   the allowed lists below; there are no arbitrary formulas. Points
   are NOT Visual Bucs: they live in their own balance table, no code
   path converts them to credits or money, and the copy says so.

   Awards are fire-and-forget from the hot paths (chat post, tip,
   watch heartbeat): a loyalty failure must never break the action
   that earned the points, but it is logged. */

export const LOYALTY_WATCH_MENU = [0, 5, 10, 20] as const; // points per 10 minutes watched
export const LOYALTY_CHAT_MENU = [0, 1, 2, 5] as const; // points per chat message
export const LOYALTY_TIP_MENU = [0, 5, 10] as const; // points per 100 VB tipped
export const LOYALTY_CUSTOM_COST_MENU = [500, 1000, 2500, 5000] as const;

export interface LoyaltyPerk {
  kind: "shoutout" | "priority_chat" | "custom";
  label: string;
  cost: number;
}

/** The fixed perk menu. 'custom' only exists when the creator named
 *  a reward (their own text, fulfilled by them manually). */
export function perkMenu(settings: LoyaltySettings | null): LoyaltyPerk[] {
  const perks: LoyaltyPerk[] = [
    { kind: "shoutout", label: "Shoutout request", cost: 500 },
    { kind: "priority_chat", label: "Priority chat mark", cost: 1000 },
  ];
  if (settings?.custom_reward_label && settings.custom_reward_cost) {
    perks.push({ kind: "custom", label: settings.custom_reward_label, cost: settings.custom_reward_cost });
  }
  return perks;
}

export async function getLoyaltySettings(profileId: string): Promise<LoyaltySettings | null> {
  const rows = await db.select().from(loyaltySettingsTable).where(eq(loyaltySettingsTable.profile_id, profileId)).limit(1);
  return rows[0] ?? null;
}

export function defaultLoyaltySettings(profileId: string): LoyaltySettings {
  return {
    profile_id: profileId,
    enabled: true,
    watch_points_per_10min: 10,
    chat_points: 2,
    tip_points_per_100vb: 5,
    custom_reward_label: null,
    custom_reward_cost: null,
    updated_at: new Date(),
  };
}

/** Credit points to a (fan, channel) balance. Never throws. */
export async function awardLoyaltyPoints(userId: string, profileId: string, points: number): Promise<void> {
  if (points <= 0 || userId === undefined) return;
  try {
    await db
      .insert(loyaltyBalancesTable)
      .values({ user_id: userId, profile_id: profileId, points, updated_at: new Date() })
      .onConflictDoUpdate({
        target: [loyaltyBalancesTable.user_id, loyaltyBalancesTable.profile_id],
        set: { points: sql`${loyaltyBalancesTable.points} + ${points}`, updated_at: new Date() },
      });
  } catch (err) {
    logger.warn({ err, userId, profileId, points }, "loyalty: award failed");
  }
}

/** Award for a chat message on the channel's stream. */
export async function awardChatPoints(userId: string, profileId: string, ownerUserId: string): Promise<void> {
  if (userId === ownerUserId) return; // creators don't farm their own channel
  try {
    const settings = await getLoyaltySettings(profileId);
    const rate = settings ? (settings.enabled ? settings.chat_points : 0) : defaultLoyaltySettings(profileId).chat_points;
    await awardLoyaltyPoints(userId, profileId, rate);
  } catch (err) {
    logger.warn({ err, userId, profileId }, "loyalty: chat award failed");
  }
}

/** Award for a tip: floor(amount/100) × the menu rate. */
export async function awardTipPoints(userId: string, profileId: string, ownerUserId: string, amountVb: number): Promise<void> {
  if (userId === ownerUserId) return;
  try {
    const settings = await getLoyaltySettings(profileId);
    const rate = settings ? (settings.enabled ? settings.tip_points_per_100vb : 0) : defaultLoyaltySettings(profileId).tip_points_per_100vb;
    await awardLoyaltyPoints(userId, profileId, Math.floor(amountVb / 100) * rate);
  } catch (err) {
    logger.warn({ err, userId, profileId }, "loyalty: tip award failed");
  }
}

/**
 * Convert accrued watch minutes into points, exactly once per minute
 * block: the balance row remembers how many minutes were already
 * credited, so heartbeats can call this freely. Returns the points
 * newly awarded. Never throws (returns 0 on failure).
 */
export async function awardWatchPoints(
  userId: string,
  profileId: string,
  ownerUserId: string,
  totalSecondsWatched: number,
): Promise<number> {
  if (userId === ownerUserId) return 0;
  try {
    const settings = await getLoyaltySettings(profileId);
    const s = settings ?? defaultLoyaltySettings(profileId);
    if (settings && !settings.enabled) return 0;
    const per10 = s.watch_points_per_10min;
    if (per10 <= 0) return 0;
    const minutes = Math.floor(totalSecondsWatched / 60);
    const rows = await db
      .select()
      .from(loyaltyBalancesTable)
      .where(and(eq(loyaltyBalancesTable.user_id, userId), eq(loyaltyBalancesTable.profile_id, profileId)))
      .limit(1);
    const already = rows[0]?.watch_minutes_credited ?? 0;
    // Points land per completed 10-minute block.
    const newBlocks = Math.floor(minutes / 10) - Math.floor(already / 10);
    if (newBlocks <= 0) {
      // Still advance the credited-minutes marker so blocks line up.
      if (rows[0] && minutes > already) {
        await db
          .update(loyaltyBalancesTable)
          .set({ watch_minutes_credited: minutes, updated_at: new Date() })
          .where(and(eq(loyaltyBalancesTable.user_id, userId), eq(loyaltyBalancesTable.profile_id, profileId)));
      }
      return 0;
    }
    const points = newBlocks * per10;
    await db
      .insert(loyaltyBalancesTable)
      .values({ user_id: userId, profile_id: profileId, points, watch_minutes_credited: minutes, updated_at: new Date() })
      .onConflictDoUpdate({
        target: [loyaltyBalancesTable.user_id, loyaltyBalancesTable.profile_id],
        set: {
          points: sql`${loyaltyBalancesTable.points} + ${points}`,
          watch_minutes_credited: minutes,
          updated_at: new Date(),
        },
      });
    return points;
  } catch (err) {
    logger.warn({ err, userId, profileId }, "loyalty: watch award failed");
    return 0;
  }
}
