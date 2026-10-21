import { pgTable, uuid, integer, timestamp, date, jsonb, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The King's daily moment (migration 0147) — Ring 3, THE-GAME §5
 * Q2 + §5(b). Once a day, at the palace day-turn (00:00 UTC — the
 * same boundary the site's daily claim flips on), the King holds
 * court in the Throne Hall: the palace is heralded through the
 * announce channel, the day's risers and tonight's slate are named,
 * and the members standing in the hall may claim a small audience
 * gift of Visual Bucs.
 *
 * THE MONEY RULE (owner-approved, THE-GAME §5 Q4): the gift is NOT
 * new issuance. It pays out of the existing weekly quest pool —
 * the same ≤300 VB/week envelope the four weekly quests draw from
 * (QUEST_DEFS, lib/retention) — enforced at claim time as
 * (quest rewards claimed this week) + (King gifts claimed this
 * week) + gift ≤ 300. A member who already earned the whole pool
 * from quests is told the pool is spent, honestly; the moment
 * still happens, the court still gathers.
 *
 *   king_moments — one row per palace day the moment has FIRED
 *     (moment_date is the UTC day, the primary key: the firing is
 *     idempotent across restarts and twin ticks by construction).
 *     fired_at + claim_deadline bound the claim window; payload
 *     keeps the announcement the palace heard (risers/tonight), so
 *     the record of what was said survives the day.
 *   king_moment_claims — one row per member per day (unique
 *     user+date: a second claim is a conflict, never a double pay).
 *     amount_vb is what's drawn from the week's quest pool.
 */
export const kingMomentsTable = pgTable("king_moments", {
  momentDate: date("moment_date").primaryKey(),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull(),
  claimDeadline: timestamp("claim_deadline", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull().default({}),
});

export type KingMoment = typeof kingMomentsTable.$inferSelect;
export type NewKingMoment = typeof kingMomentsTable.$inferInsert;

export const kingMomentClaimsTable = pgTable(
  "king_moment_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    momentDate: date("moment_date").notNull(),
    amountVb: integer("amount_vb").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("king_moment_claims_user_date_uq").on(t.userId, t.momentDate),
    /* Migration 0147: a gift is a positive draw on the pool. */
    check("king_moment_claims_amount_check", sql`${t.amountVb} > 0`),
  ],
);

export type KingMomentClaim = typeof kingMomentClaimsTable.$inferSelect;
export type NewKingMomentClaim = typeof kingMomentClaimsTable.$inferInsert;

/** The announcement payload a firing records (risers + tonight). */
export interface KingMomentPayload {
  kingName: string;
  risers: { name: string; score: number }[];
  tonight: { title: string; roomName: string; startsAt: string }[];
  text: string;
}
