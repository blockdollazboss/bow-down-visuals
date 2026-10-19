import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, primaryKey, check, uniqueIndex, index, type AnyPgColumn } from "drizzle-orm/pg-core";
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
 *   { kind: 'track', id, title, artwork?, artistSlug } → /track/:id
 *   { kind: 'watch', id, title, thumb?, artistSlug }  → /watch/:id
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
  /* 'public' | 'followers' | 'close_friends' — enforced at READ time
     on every surface that serves stories (migration 0137). */
  audience:  text("audience").notNull().default("public"),
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
  /* Self-FK note (Worker 10): the `as unknown` breaks a type-inference cycle
     that fails declaration emit (`tsc -b`, which the Docker build typecheck
     needs). Runtime is unchanged — each thunk still returns this table's id. */
  replyTo:     uuid("reply_to").references((): AnyPgColumn => (postsTable as unknown as { id: AnyPgColumn }).id),
  quoteOf:     uuid("quote_of").references((): AnyPgColumn => (postsTable as unknown as { id: AnyPgColumn }).id),
  repostOf:    uuid("repost_of").references((): AnyPgColumn => (postsTable as unknown as { id: AnyPgColumn }).id),
  /** Optional community group this post belongs to (Worker 9 may FK this). */
  groupId:     uuid("group_id"),
  /** NULL = published now; future = hidden until then (feed filters by time — no cron). 4+ stars. */
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  /** 'public' | 'followers' — audience targeting (4+ stars). */
  audience:    text("audience").notNull().default("public"),
  likeCount:   integer("like_count").notNull().default(0),
  repostCount: integer("repost_count").notNull().default(0),
  replyCount:  integer("reply_count").notNull().default(0),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("posts_kind_check", sql`${t.kind} IN ('post','thread_reply','quote','repost')`)]);

export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true, createdAt: true, likeCount: true, repostCount: true, replyCount: true });
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;

/** The tones a reply draft can carry — the Comment Reply Assistant's
 *  own set (routes/generate/comment-replies TONES), stored here as
 *  metadata on the draft. No generation is wired to a draft: the tone
 *  is the member's chosen voice for the reply, nothing more. */
export const POST_REPLY_DRAFT_TONES = ["hype", "grateful", "playful", "professional"] as const;
export type PostReplyDraftTone = (typeof POST_REPLY_DRAFT_TONES)[number];

/* Post reply drafts (STACK-20 R2 #8, migration 0160): ONE in-progress
   reply per member per board post, held server-side so a half-written
   answer at the Community Board survives a closed thread, leaving the
   Hall and a phone reload — and comes back on any device, with the
   tone it was drafted in. A draft is private scratch: the row is keyed
   by (post, author) and the routes only ever read or write the
   caller's own row. A landed reply deletes the sender's row; saving
   an empty body deletes it too. Deleting the post cascades the draft
   away with it. */
export const postReplyDraftsTable = pgTable("post_reply_drafts", {
  id:        uuid("id").primaryKey().defaultRandom(),
  postId:    uuid("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
  userId:    uuid("user_id").notNull(),
  body:      text("body").notNull(),
  tone:      text("tone").notNull().default("hype"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("post_reply_drafts_post_user_uidx").on(t.postId, t.userId),
  index("post_reply_drafts_user_idx").on(t.userId),
]);

export type PostReplyDraft = typeof postReplyDraftsTable.$inferSelect;

/** Attachment shapes stored in posts.media_urls — every kind has a link target. */
export type Attachment =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; thumb?: string }
  | { kind: "track"; id: string; title?: string; artwork?: string; artistSlug?: string }
  | { kind: "watch"; id: string; title?: string; thumb?: string; artistSlug?: string }
  | { kind: "product"; id: string; kindSlug: string; title?: string; image?: string; storeSlug?: string }
  | { kind: "event"; id: string; title?: string; date?: string; venue?: string };

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

/* ── Polls (migration 0097; 2-3 star composer) ─────────────────────────── */

export const pollOptionsTable = pgTable("poll_options", {
  id:         uuid("id").primaryKey().defaultRandom(),
  postId:     uuid("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
  optionText: text("option_text").notNull(),
  voteCount:  integer("vote_count").notNull().default(0),
  position:   integer("position").notNull().default(0),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertPollOptionSchema = createInsertSchema(pollOptionsTable).omit({ id: true, createdAt: true, voteCount: true });
export type InsertPollOption = z.infer<typeof insertPollOptionSchema>;
export type PollOption = typeof pollOptionsTable.$inferSelect;

export const pollVotesTable = pgTable("poll_votes", {
  userId:    uuid("user_id").notNull(),
  postId:    uuid("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
  optionId:  uuid("option_id").notNull().references(() => pollOptionsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.postId] })]);

export type PollVote = typeof pollVotesTable.$inferSelect;
