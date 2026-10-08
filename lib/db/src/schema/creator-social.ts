import { pgTable, uuid, text, boolean, timestamp, primaryKey, check } from "drizzle-orm/pg-core";
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

export const profileCommentsTable = pgTable("profile_comments", {
  id:           uuid("id").primaryKey().defaultRandom(),
  profileId:    uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull(),
  body:         text("body").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertProfileCommentSchema = createInsertSchema(profileCommentsTable).omit({ id: true, createdAt: true });
export type InsertProfileComment = z.infer<typeof insertProfileCommentSchema>;
export type ProfileComment = typeof profileCommentsTable.$inferSelect;

export const mediaCommentsTable = pgTable("media_comments", {
  id:           uuid("id").primaryKey().defaultRandom(),
  kind:         text("kind").notNull(),
  mediaId:      uuid("media_id").notNull(),
  authorUserId: uuid("author_user_id").notNull(),
  body:         text("body").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("media_comments_kind_check", sql`${t.kind} IN ('track','video')`)]);

export const insertMediaCommentSchema = createInsertSchema(mediaCommentsTable).omit({ id: true, createdAt: true });
export type InsertMediaComment = z.infer<typeof insertMediaCommentSchema>;
export type MediaComment = typeof mediaCommentsTable.$inferSelect;

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
