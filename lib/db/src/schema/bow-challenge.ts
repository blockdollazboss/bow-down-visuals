import {
  pgTable,
  uuid,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/* Secret Bow Challenge: a hidden milestone. Users bow the shark for fun;
   reaching the admin-configured target awards credits with a surprise
   popup. The challenge is NEVER announced in the UI — only /admin
   controls the target, reward, and on/off switch.
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
    userId: uuid("user_id").primaryKey(),
    bowCount: integer("bow_count").notNull().default(0),
    rewarded: boolean("rewarded").notNull().default(false),
    lastBowAt: timestamp("last_bow_at", { withTimezone: true }),
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("user_bow_counts_count_idx").on(t.bowCount.desc())],
);
