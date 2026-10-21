import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Referral monthly contest (virality wave).
   One referral_contests row per contest month (period = "YYYY-MM"). When the
   month ends, the server computes winners from the referrals ledger
   (signups in-month, tiebreak = revenue earned) and pays Visual Bucs prizes
   into referral_contest_prizes. UNIQUE(contest_id, referrer_user_id) keeps
   every payout exactly-once. */

export const referralContestsTable = pgTable(
  "referral_contests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    period: text("period").notNull().unique(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /* [{ rank, prizeCredits }] */
    prizes: jsonb("prizes").notNull().default([]),
    minSignupsToQualify: integer("min_signups_to_qualify").notNull().default(5),
    /* open | settled | skipped */
    status: text("status").notNull().default("open"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("referral_contests_period_idx").on(t.period)],
);

export const referralContestPrizesTable = pgTable(
  "referral_contest_prizes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contestId: uuid("contest_id").notNull(),
    rank: integer("rank").notNull(),
    referrerUserId: uuid("referrer_user_id").notNull(),
    signups: integer("signups").notNull().default(0),
    revenueEarned: integer("revenue_earned").notNull().default(0),
    prizeCredits: integer("prize_credits").notNull().default(0),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("referral_contest_prizes_contest_idx").on(t.contestId),
    index("referral_contest_prizes_referrer_idx").on(t.referrerUserId),
    uniqueIndex("referral_contest_prizes_unique_idx").on(t.contestId, t.referrerUserId),
  ],
);

export const insertReferralContestSchema = createInsertSchema(referralContestsTable).omit({ id: true, createdAt: true });
export type InsertReferralContest = z.infer<typeof insertReferralContestSchema>;
export type ReferralContest = typeof referralContestsTable.$inferSelect;

export const insertReferralContestPrizeSchema = createInsertSchema(referralContestPrizesTable).omit({ id: true, awardedAt: true });
export type InsertReferralContestPrize = z.infer<typeof insertReferralContestPrizeSchema>;
export type ReferralContestPrize = typeof referralContestPrizesTable.$inferSelect;
