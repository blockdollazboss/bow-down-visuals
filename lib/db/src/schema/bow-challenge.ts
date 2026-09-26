import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/* Secret Bow Challenge: a hidden monthly milestone. Users bow the shark
   for fun; reaching the admin-configured target in a calendar month
   awards credits with a surprise popup. The challenge is NEVER announced
   in the UI — only /admin controls the target, reward, and on/off switch.
   Counts are keyed by (user_id, period) so every month starts fresh.
   See migrations/0038_secret_bow_challenge.sql — the schema here must
   stay in sync with it. */

export const bowChallengeConfigTable = pgTable("bow_challenge_config", {
  id: integer("id").primaryKey().default(1),
  targetBows: integer("target_bows").notNull().default(100),
  rewardCredits: integer("reward_credits").notNull().default(5),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userBowCountsTable = pgTable(
  "user_bow_counts",
  {
    userId: uuid("user_id").notNull(),
    /* YYYY-MM, e.g. '2026-09' */
    period: text("period").notNull(),
    bowCount: integer("bow_count").notNull().default(0),
    rewarded: boolean("rewarded").notNull().default(false),
    lastBowAt: timestamp("last_bow_at", { withTimezone: true }),
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.period] }),
    index("user_bow_counts_period_idx").on(t.period, t.bowCount.desc()),
  ],
);
