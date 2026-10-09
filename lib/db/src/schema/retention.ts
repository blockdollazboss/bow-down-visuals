import { pgTable, uuid, text, integer, boolean, timestamp, date, primaryKey } from "drizzle-orm/pg-core";

/** Consecutive days the user created something (not just logged in). */
export const creationStreaksTable = pgTable("creation_streaks", {
  userId:            uuid("user_id").primaryKey(),
  currentStreak:     integer("current_streak").notNull().default(0),
  longestStreak:     integer("longest_streak").notNull().default(0),
  lastCreationDate:  date("last_creation_date"),
  milestonesClaimed: integer("milestones_claimed").array().notNull().default([]),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type CreationStreak = typeof creationStreaksTable.$inferSelect;

/** Surprise Visual Bucs drops. Unclaimed drops expire after 48h. */
export const sharkDropsTable = pgTable("shark_drops", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull(),
  amount:    integer("amount").notNull(),
  droppedAt: timestamp("dropped_at", { withTimezone: true }).defaultNow().notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export type SharkDrop = typeof sharkDropsTable.$inferSelect;

/** Weekly quest progress per user. */
export const questProgressTable = pgTable("quest_progress", {
  userId:    uuid("user_id").notNull(),
  questKey:  text("quest_key").notNull(),
  weekStart: date("week_start").notNull(),
  progress:  integer("progress").notNull().default(0),
  target:    integer("target").notNull().default(1),
  completed: boolean("completed").notNull().default(false),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.questKey, t.weekStart] })]);
export type QuestProgress = typeof questProgressTable.$inferSelect;

/** Which creator levels were already celebrated (fires once per level-up). */
export const levelCelebrationsTable = pgTable("level_celebrations", {
  userId:       uuid("user_id").notNull(),
  level:        integer("level").notNull(),
  celebratedAt: timestamp("celebrated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.level] })]);
export type LevelCelebration = typeof levelCelebrationsTable.$inferSelect;

/** User-facing on/off for every retention system. */
export const retentionPrefsTable = pgTable("retention_prefs", {
  userId:                   uuid("user_id").primaryKey(),
  dailyDropEnabled:         boolean("daily_drop_enabled").notNull().default(true),
  creationStreaksEnabled:   boolean("creation_streaks_enabled").notNull().default(true),
  sharkDropsEnabled:        boolean("shark_drops_enabled").notNull().default(true),
  levelCelebrationsEnabled: boolean("level_celebrations_enabled").notNull().default(true),
  leaderboardVisible:       boolean("leaderboard_visible").notNull().default(true),
  awayDigestEnabled:        boolean("away_digest_enabled").notNull().default(true),
  questsEnabled:            boolean("quests_enabled").notNull().default(true),
  updatedAt:                timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type RetentionPrefs = typeof retentionPrefsTable.$inferSelect;

/** Last-seen tracking for "while you were away" digests. */
export const userActivityTable = pgTable("user_activity", {
  userId:     uuid("user_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type UserActivity = typeof userActivityTable.$inferSelect;
