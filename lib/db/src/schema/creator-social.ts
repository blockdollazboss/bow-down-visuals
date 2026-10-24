import { pgTable, uuid, text, boolean, timestamp, primaryKey, check, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";

/**
 * Creator Streaming Platform — social layer (migration 0087).
 */

export const MEDIA_KINDS = ["track", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const followsTable = pgTable("follows", {
  followerUserId: uuid("follower_user_id").notNull(),
  profileId:      uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.followerUserId, t.profileId] })]);

export type Follow = typeof followsTable.$inferSelect;

/* ── Creator comment controls (Stack-100 #3, #27) ──────────────────────────
   PENDING MIGRATION: the status / pinned / pinned_at / held_reason columns
   on profile_comments + media_comments and the creator_comment_settings
   table below are described exactly in .lane/MIGRATION-NEEDED.md (number
   assigned at join — 0205 is held by another lane). Until that migration
   lands, the API degrades gracefully: reads treat a missing status as
   'public' / unpinned, and control writes answer 503
   comment_controls_not_ready instead of failing or half-applying.
   A comment's moderation state is a STATE, never a delete: 'held' is a
   delay in the creator's review queue, 'hidden' stays visible to the
   creator and to its author (badged as hidden). */

export const COMMENT_STATUSES = ["public", "held", "hidden"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const COMMENT_HOLD_MODES = ["off", "all", "first_time"] as const;
export type CommentHoldMode = (typeof COMMENT_HOLD_MODES)[number];

export const profileCommentsTable = pgTable("profile_comments", {
  id:           uuid("id").primaryKey().defaultRandom(),
  profileId:    uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull(),
  body:         text("body").notNull(),
  status:       text("status").notNull().default("public"),
  pinned:       boolean("pinned").notNull().default(false),
  pinnedAt:     timestamp("pinned_at", { withTimezone: true }),
  heldReason:   text("held_reason"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("profile_comments_status_check", sql`${t.status} IN ('public','held','hidden')`)]);

export const insertProfileCommentSchema = createInsertSchema(profileCommentsTable).omit({ id: true, createdAt: true });
export type InsertProfileComment = z.infer<typeof insertProfileCommentSchema>;
export type ProfileComment = typeof profileCommentsTable.$inferSelect;

export const mediaCommentsTable = pgTable("media_comments", {
  id:           uuid("id").primaryKey().defaultRandom(),
  kind:         text("kind").notNull(),
  mediaId:      uuid("media_id").notNull(),
  authorUserId: uuid("author_user_id").notNull(),
  body:         text("body").notNull(),
  status:       text("status").notNull().default("public"),
  pinned:       boolean("pinned").notNull().default(false),
  pinnedAt:     timestamp("pinned_at", { withTimezone: true }),
  heldReason:   text("held_reason"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("media_comments_kind_check", sql`${t.kind} IN ('track','video')`),
  check("media_comments_status_check", sql`${t.status} IN ('public','held','hidden')`),
]);

export const insertMediaCommentSchema = createInsertSchema(mediaCommentsTable).omit({ id: true, createdAt: true });
export type InsertMediaComment = z.infer<typeof insertMediaCommentSchema>;
export type MediaComment = typeof mediaCommentsTable.$inferSelect;

/**
 * Per-creator comment controls — ONE row per creator profile, created
 * lazily on first save. Defaults are OFF / creator-chosen: hold_mode
 * 'off' and an empty blocklist mean comments behave exactly as before.
 * blocked_words mirrors the live-chat automod list shape (jsonb string[])
 * but is scoped to comments on the creator's own content.
 */
export const creatorCommentSettingsTable = pgTable("creator_comment_settings", {
  profileId:   uuid("profile_id").primaryKey().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  holdMode:    text("hold_mode").notNull().default("off"),
  blockedWords: jsonb("blocked_words").$type<string[]>().notNull().default([]),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("creator_comment_settings_hold_mode_check", sql`${t.holdMode} IN ('off','all','first_time')`)]);

export const insertCreatorCommentSettingsSchema = createInsertSchema(creatorCommentSettingsTable).omit({ updatedAt: true });
export type InsertCreatorCommentSettings = z.infer<typeof insertCreatorCommentSettingsSchema>;
export type CreatorCommentSettings = typeof creatorCommentSettingsTable.$inferSelect;

export const LIKE_KINDS = ["track", "video", "playlist", "comment"] as const;
export type LikeKind = (typeof LIKE_KINDS)[number];

export const likesTable = pgTable("likes", {
  userId:    uuid("user_id").notNull(),
  kind:      text("kind").notNull(),
  targetId:  uuid("target_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.kind, t.targetId] }),
  check("likes_kind_check", sql`${t.kind} IN ('track','video','playlist','comment')`),
]);

export type Like = typeof likesTable.$inferSelect;

export const repostsTable = pgTable("reposts", {
  userId:    uuid("user_id").notNull(),
  trackId:   uuid("track_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.trackId] })]);

export type Repost = typeof repostsTable.$inferSelect;

export const playEventsTable = pgTable("play_events", {
  id:       uuid("id").primaryKey().defaultRandom(),
  kind:     text("kind").notNull(),
  mediaId:  uuid("media_id").notNull(),
  userId:   uuid("user_id"),
  playedAt: timestamp("played_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("play_events_kind_check", sql`${t.kind} IN ('track','video')`)]);

export type PlayEvent = typeof playEventsTable.$inferSelect;

export const notificationsTable = pgTable("notifications", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull(),
  kind:      text("kind").notNull(),
  title:     text("title").notNull(),
  body:      text("body").notNull().default(""),
  link:      text("link").notNull().default(""),
  isRead:    boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
