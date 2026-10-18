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

/** Daily Quest Trio progress per user (World Ring 4, migration
 *  0150). One row per member × daily quest × palace day (the UTC
 *  date): the trio's defs rotate by day (lib/daily-quests in the
 *  API), so the day is the scope. Claims stamp reward_vb + marks
 *  at claim time — the row records what was actually paid; the VB
 *  draws from the shared weekly quest pool (lib/quest-pool counts
 *  these rows as its fourth source). */
export const dailyQuestProgressTable = pgTable("daily_quest_progress", {
  userId:    uuid("user_id").notNull(),
  questKey:  text("quest_key").notNull(),
  dayDate:   date("day_date").notNull(),
  progress:  integer("progress").notNull().default(0),
  target:    integer("target").notNull().default(1),
  completed: boolean("completed").notNull().default(false),
  rewardVb:  integer("reward_vb"),
  marks:     integer("marks").notNull().default(0),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.questKey, t.dayDate] })]);
export type DailyQuestProgress = typeof dailyQuestProgressTable.$inferSelect;

/** Which creator levels were already celebrated (fires once per level-up). */
export const levelCelebrationsTable = pgTable("level_celebrations", {
  userId:       uuid("user_id").notNull(),
  level:        integer("level").notNull(),
  celebratedAt: timestamp("celebrated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.level] })]);
export type LevelCelebration = typeof levelCelebrationsTable.$inferSelect;

/** Share-to-earn viral loop: one row per share action (native / X / WhatsApp /
 * copy link) posted via POST /api/shares. Feeds the "Viral Sharer" weekly
 * quest (quest_progress rows with quest_key = 'viral-sharer'). */
export const shareEventsTable = pgTable("share_events", {
  id:          uuid("id").primaryKey().defaultRandom(),
  userId:      uuid("user_id").notNull(),
  contentType: text("content_type").notNull(),
  contentId:   text("content_id"),
  channel:     text("channel").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
// Indexes (user_id, created_at) live in migration 0117.
export type ShareEvent = typeof shareEventsTable.$inferSelect;

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
  /* Login-streaks-with-teeth pack (2026-10-11): owned by prefs plumbing,
     consumed by sibling systems. */
  loginStreaksEnabled:      boolean("login_streaks_enabled").notNull().default(true),
  shareToEarnEnabled:       boolean("share_to_earn_enabled").notNull().default(true),
  contestsEnabled:          boolean("contests_enabled").notNull().default(true),
  fomoFeedEnabled:          boolean("fomo_feed_enabled").notNull().default(true),
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
