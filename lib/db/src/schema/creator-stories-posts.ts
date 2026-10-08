import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";

/**
 * Creator Streaming Platform — stories / posts / reactions (migration 0091).
 *
 * Worker 8. Stories expire after 24h (filtered by expires_at on every read;
 * a weekly purge runs in the migration; no cron needed). Posts support
 * threads (reply_to chains), quotes (quote_of), and reposts (repost_of).
 * Reactions are the expanded emoji set (like stays the default); saves are
 * cross-kind bookmarks.
 *
 * ── Link graph (standing rule: everything links together) ────────────────
 * media_urls JSONB items use a shared attachment shape:
 *   { kind: 'image'|'video', url, thumb? }
 *   { kind: 'track'|'video', id, title, url, artwork?, artistSlug }
 *     → links to the creator's profile (/artist/:slug) where the sound lives
 *   { kind: 'product', id, kindSlug, title, image?, storeSlug? }
 *     → links to /store/buy/:kind/:id (the drop page) or /shop/:slug
 *   { kind: 'event', id, title, date?, venue? }
 *     → links to /shows (the events page)
 * A product attachment MUST always resolve to a store link — never render
 * a product mention without a destination.
 */

export const storiesTable = pgTable("stories", {
  id:        uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  mediaUrl:  text("media_url").notNull(),
  mediaKind: text("media_kind").notNull().default("image"),
  caption:   text("caption").notNull().default(""),
  viewCount: integer("view_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertStorySchema = createInsertSchema(storiesTable).omit({ id: true, createdAt: true, viewCount: true });
export type InsertStory = z.infer<typeof insertStorySchema>;
export type Story = typeof storiesTable.$inferSelect;

export const storyHighlightsTable = pgTable("story_highlights", {
  id:        uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  title:     text("title").notNull(),
  coverUrl:  text("cover_url"),
  storyIds:  jsonb("story_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertStoryHighlightSchema = createInsertSchema(storyHighlightsTable).omit({ id: true, createdAt: true });
export type InsertStoryHighlight = z.infer<typeof insertStoryHighlightSchema>;
export type StoryHighlight = typeof storyHighlightsTable.$inferSelect;

export const POST_KINDS = ["post", "thread_reply", "quote", "repost"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const postsTable = pgTable("posts", {
  id:          uuid("id").primaryKey().defaultRandom(),
  profileId:   uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  body:        text("body").notNull(),
  mediaUrls:   jsonb("media_urls").$type<Attachment[]>().notNull().default([]),
  kind:        text("kind").notNull().default("post"),
  replyTo:     uuid("reply_to").references(() => postsTable.id),
  quoteOf:     uuid("quote_of").references(() => postsTable.id),
  repostOf:    uuid("repost_of").references(() => postsTable.id),
  /** Optional community group this post belongs to (Worker 9 may FK this). */
  groupId:     uuid("group_id"),
  likeCount:   integer("like_count").notNull().default(0),
  repostCount: integer("repost_count").notNull().default(0),
  replyCount:  integer("reply_count").notNull().default(0),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("posts_kind_check", sql`${t.kind} IN ('post','thread_reply','quote','repost')`)]);

export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true, createdAt: true, likeCount: true, repostCount: true, replyCount: true });
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;

/** Attachment shapes stored in posts.media_urls — every kind has a link target. */
export type Attachment =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; thumb?: string }
  | { kind: "track"; id: string; title: string; url: string; artwork?: string; artistSlug: string }
  | { kind: "product"; id: string; kindSlug: string; title: string; image?: string; storeSlug?: string }
  | { kind: "event"; id: string; title: string; date?: string; venue?: string };

export const REACTION_EMOJIS = ["like", "love", "fire", "clap", "mindblown"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const REACTION_TARGETS = ["post", "track", "video", "profile"] as const;
export type ReactionTarget = (typeof REACTION_TARGETS)[number];

export const reactionsTable = pgTable("reactions", {
  userId:     uuid("user_id").notNull(),
  targetKind: text("target_kind").notNull(),
  targetId:   uuid("target_id").notNull(),
  emoji:      text("emoji").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.targetKind, t.targetId] }),
  check("reactions_target_check", sql`${t.targetKind} IN ('post','track','video','profile')`),
  check("reactions_emoji_check", sql`${t.emoji} IN ('like','love','fire','clap','mindblown')`),
]);

export type Reaction = typeof reactionsTable.$inferSelect;

export const SAVE_KINDS = ["post", "track", "video", "profile"] as const;
export type SaveKind = (typeof SAVE_KINDS)[number];

export const savesTable = pgTable("saves", {
  userId:    uuid("user_id").notNull(),
  kind:      text("kind").notNull(),
  targetId:  uuid("target_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.kind, t.targetId] }),
  check("saves_kind_check", sql`${t.kind} IN ('post','track','video','profile')`),
]);

export type Save = typeof savesTable.$inferSelect;
