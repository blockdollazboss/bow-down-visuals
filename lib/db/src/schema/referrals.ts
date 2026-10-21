import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Referral program tables (Stack 8 #6 consolidation).
   These definitions are the single source of truth for the tables the
   referrals route used to self-create at request time with inline
   CREATE TABLE IF NOT EXISTS statements. Migration coverage:
     referral_codes / referrals   → 0042_referrals.sql (+0045 columns)
     referral_payouts             → 0045_referral_revenue_share.sql
     referral_milestones          → 0136_referral_tables_consolidation.sql
     referral_contests / _prizes  → lib/db/src/schema/referral-contest.ts
                                    + 0101_referral_contest.sql
   Column shapes mirror the former inline DDL exactly (including the
   x100 Visual Bucs defaults from the 0054 era: referee welcome 10). */

export const referralCodesTable = pgTable(
  "referral_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().unique(),
    code: text("code").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("referral_codes_user_id_idx").on(t.userId),
    index("referral_codes_code_idx").on(t.code),
  ],
);

export const referralsTable = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerUserId: uuid("referrer_user_id").notNull(),
    refereeUserId: uuid("referee_user_id").notNull().unique(),
    referrerCreditsAwarded: integer("referrer_credits_awarded").notNull().default(0),
    refereeCreditsAwarded: integer("referee_credits_awarded").notNull().default(10),
    revenueSharePct: integer("revenue_share_pct").notNull().default(25),
    shareExpiresAt: timestamp("share_expires_at", { withTimezone: true }),
    totalReferrerEarned: integer("total_referrer_earned").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("referrals_referrer_idx").on(t.referrerUserId),
    index("referrals_referee_idx").on(t.refereeUserId),
  ],
);

export const referralPayoutsTable = pgTable(
  "referral_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => referralsTable.id, { onDelete: "cascade" }),
    stripeSessionId: text("stripe_session_id").notNull().unique(),
    refereeCreditsPurchased: integer("referee_credits_purchased").notNull(),
    referrerCreditsAwarded: integer("referrer_credits_awarded").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("referral_payouts_referral_idx").on(t.referralId)],
);

/* One row per (promoter, star tier) milestone bonus ever awarded —
   UNIQUE(referrer_user_id, stars) makes the bonus exactly-once. */
export const referralMilestonesTable = pgTable(
  "referral_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerUserId: uuid("referrer_user_id").notNull(),
    stars: integer("stars").notNull(),
    bonusCredits: integer("bonus_credits").notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("referral_milestones_referrer_idx").on(t.referrerUserId),
    uniqueIndex("referral_milestones_unique_idx").on(t.referrerUserId, t.stars),
  ],
);

export const insertReferralCodeSchema = createInsertSchema(referralCodesTable).omit({ id: true, createdAt: true });
export type InsertReferralCode = z.infer<typeof insertReferralCodeSchema>;
export type ReferralCode = typeof referralCodesTable.$inferSelect;

export const insertReferralSchema = createInsertSchema(referralsTable).omit({ id: true, createdAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referralsTable.$inferSelect;

export type ReferralPayout = typeof referralPayoutsTable.$inferSelect;
export type ReferralMilestone = typeof referralMilestonesTable.$inferSelect;
