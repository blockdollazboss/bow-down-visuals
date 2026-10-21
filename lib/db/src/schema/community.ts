import { pgTable, uuid, text, integer, boolean, timestamp, primaryKey, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";

/**
 * Creator Streaming Platform — groups, events, DMs (migration 0098).
 *
 * Link-graph contract (cross-surface wiring):
 *   groups  -> members link to /creator/:slug (Worker 2 profiles)
 *   events  -> host profile (/creator/:slug), ticket products (ticket_url),
 *              stream/drop destination (destination_url)
 *   DMs     -> participant profiles (/creator/:slug)
 *   Explore -> every card deep-links to its destination
 *   event reminder notifications carry link=/events/:id
 */

/* Stack 10: the ladder is owner > admin > moderator > member.
   "mod" is the legacy stored value for moderator and is normalized
   by group-roles.ts (normalizeGroupRole) wherever it is read. */
export const GROUP_ROLES = ["owner", "admin", "moderator", "member"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const EVENT_KINDS = ["stream", "drop", "premiere", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const CONVERSATION_STATUSES = ["inbox", "request", "blocked"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/* ── Groups ─────────────────────────────────────────────────────────────── */

export const groupsTable = pgTable("groups", {
  id:             uuid("id").primaryKey().defaultRandom(),
  slug:           text("slug").notNull().unique(),
  name:           text("name").notNull(),
  description:    text("description").notNull().default(""),
  coverUrl:       text("cover_url"),
  ownerProfileId: uuid("owner_profile_id").references(() => creatorProfilesTable.id, { onDelete: "set null" }),
  memberCount:    integer("member_count").notNull().default(0),
  isPublic:       boolean("is_public").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertGroupSchema = createInsertSchema(groupsTable).omit({ id: true, createdAt: true });
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type Group = typeof groupsTable.$inferSelect;

export const groupMembersTable = pgTable("group_members", {
  groupId:  uuid("group_id").notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
  userId:   uuid("user_id").notNull(),
  role:     text("role").notNull().default("member"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.groupId, t.userId] }),
  index("group_members_user_idx").on(t.userId),
]);

export type GroupMember = typeof groupMembersTable.$inferSelect;

/* ── Group-scoped posts ─────────────────────────────────────────────────
   Worker 8's `posts` table landed (0096) with nullable group_id — but
   posts.profile_id is NOT NULL, so non-creator group members could never
   post there. group_posts (authored by user_id) stays the group-feed write
   target; a future worker can union posts WHERE group_id IS NOT NULL into
   the same feed query. See migration 0098. ─────────────────────────────── */

export const groupPostsTable = pgTable("group_posts", {
  id:           uuid("id").primaryKey().defaultRandom(),
  groupId:      uuid("group_id").notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull(),
  body:         text("body").notNull(),
  likeCount:    integer("like_count").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("group_posts_group_idx").on(t.groupId, t.createdAt),
  index("group_posts_author_idx").on(t.authorUserId),
]);

export const insertGroupPostSchema = createInsertSchema(groupPostsTable).omit({ id: true, createdAt: true });
export type InsertGroupPost = z.infer<typeof insertGroupPostSchema>;
export type GroupPost = typeof groupPostsTable.$inferSelect;

/* ── Group forum channels / threads / replies (migration 0185, Wave 3 #13) ──
   The group feed is one flat stream; forums give a group topic-contained
   boards INSIDE the group: channels (topics) hold threads, threads hold
   replies. Visibility and write rules are the group's own — the routes
   resolve the parent group first and apply the same public/private +
   membership gates as the feed; nothing here is reachable except
   through a group the viewer may see.

   group_id is denormalized onto threads and replies (always written
   from the resolved parent chain, never from client input) so every
   read can scope by group without a join — the private-group gate can
   never be bypassed by guessing a channel or thread id from another
   group. Tags are a plain text array on the thread: the data model
   honestly supports per-thread labels, and nothing more (no tag
   registry, no tag following) is claimed. ─────────────────────────── */

export const groupForumChannelsTable = pgTable("group_forum_channels", {
  id:              uuid("id").primaryKey().defaultRandom(),
  groupId:         uuid("group_id").notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
  name:            text("name").notNull(),
  description:     text("description").notNull().default(""),
  position:        integer("position").notNull().default(0),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("group_forum_channels_group_idx").on(t.groupId, t.position, t.createdAt),
]);

export const insertGroupForumChannelSchema = createInsertSchema(groupForumChannelsTable).omit({ id: true, createdAt: true });
export type InsertGroupForumChannel = z.infer<typeof insertGroupForumChannelSchema>;
export type GroupForumChannel = typeof groupForumChannelsTable.$inferSelect;

export const groupForumThreadsTable = pgTable("group_forum_threads", {
  id:            uuid("id").primaryKey().defaultRandom(),
  channelId:     uuid("channel_id").notNull().references(() => groupForumChannelsTable.id, { onDelete: "cascade" }),
  groupId:       uuid("group_id").notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
  authorUserId:  uuid("author_user_id").notNull(),
  title:         text("title").notNull(),
  body:          text("body").notNull(),
  tags:          text("tags").array().notNull().default([]),
  replyCount:    integer("reply_count").notNull().default(0),
  lastReplyAt:   timestamp("last_reply_at", { withTimezone: true }),
  isPinned:      boolean("is_pinned").notNull().default(false),
  isLocked:      boolean("is_locked").notNull().default(false),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("group_forum_threads_channel_idx").on(t.channelId, t.createdAt),
  index("group_forum_threads_group_idx").on(t.groupId),
  index("group_forum_threads_author_idx").on(t.authorUserId),
]);

export const insertGroupForumThreadSchema = createInsertSchema(groupForumThreadsTable).omit({ id: true, createdAt: true });
export type InsertGroupForumThread = z.infer<typeof insertGroupForumThreadSchema>;
export type GroupForumThread = typeof groupForumThreadsTable.$inferSelect;

export const groupForumRepliesTable = pgTable("group_forum_replies", {
  id:           uuid("id").primaryKey().defaultRandom(),
  threadId:     uuid("thread_id").notNull().references(() => groupForumThreadsTable.id, { onDelete: "cascade" }),
  groupId:      uuid("group_id").notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull(),
  body:         text("body").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("group_forum_replies_thread_idx").on(t.threadId, t.createdAt),
  index("group_forum_replies_group_idx").on(t.groupId),
]);

export const insertGroupForumReplySchema = createInsertSchema(groupForumRepliesTable).omit({ id: true, createdAt: true });
export type InsertGroupForumReply = z.infer<typeof insertGroupForumReplySchema>;
export type GroupForumReply = typeof groupForumRepliesTable.$inferSelect;

/* ── Events ─────────────────────────────────────────────────────────────── */

export const eventsTable = pgTable("events", {
  id:             uuid("id").primaryKey().defaultRandom(),
  profileId:      uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  title:          text("title").notNull(),
  description:    text("description").notNull().default(""),
  startsAt:       timestamp("starts_at", { withTimezone: true }).notNull(),
  kind:           text("kind").notNull().default("other"),
  coverUrl:       text("cover_url"),
  /** Where the event happens: stream URL, drop page, premiere destination. */
  destinationUrl: text("destination_url"),
  /** Where to buy tickets / paid access. */
  ticketUrl:      text("ticket_url"),
  rsvpCount:      integer("rsvp_count").notNull().default(0),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("events_starts_at_idx").on(t.startsAt),
  index("events_profile_idx").on(t.profileId),
]);

export const insertEventSchema = createInsertSchema(eventsTable).omit({ id: true, createdAt: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type PlatformEvent = typeof eventsTable.$inferSelect;

export const eventRsvpsTable = pgTable("event_rsvps", {
  eventId:   uuid("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
  userId:    uuid("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.eventId, t.userId] }),
  index("event_rsvps_user_idx").on(t.userId),
]);

export type EventRsvp = typeof eventRsvpsTable.$inferSelect;

/* ── DMs ────────────────────────────────────────────────────────────────── */

export const conversationsTable = pgTable("conversations", {
  id:            uuid("id").primaryKey().defaultRandom(),
  participantA:  uuid("participant_a").notNull(),
  participantB:  uuid("participant_b").notNull(),
  status:        text("status").notNull().default("inbox"),
  requestedBy:   uuid("requested_by"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("conversations_participants_uidx").on(t.participantA, t.participantB),
  index("conversations_participants_idx").on(t.participantA, t.participantB),
  index("conversations_last_message_idx").on(t.lastMessageAt),
]);

export type Conversation = typeof conversationsTable.$inferSelect;

export const messagesTable = pgTable("messages", {
  id:             uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderUserId:   uuid("sender_user_id").notNull(),
  body:           text("body").notNull(),
  /* DM attachments (Ring 2, 2.17): one piece of the sender's own work
     riding with the message — a beat, a cover, a clip. attachmentUrl
     stores the PERMANENT storage ref (supabase:// / r2://, mirrored at
     send time per mirror-on-save), never a signed URL; reads mint a
     fresh URL per fetch. All three columns are nullable: text-only
     messages (every row before 0144) keep them NULL. */
  attachmentUrl:  text("attachment_url"),
  attachmentType: text("attachment_type"),
  attachmentName: text("attachment_name"),
  isRead:         boolean("is_read").notNull().default(false),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
  index("messages_sender_idx").on(t.senderUserId),
]);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;

/* DM reply drafts (STACK-20 #15, migration 0157): ONE in-progress reply
   per member per conversation, held server-side so a half-written
   answer survives a closed panel, a rejoin and a phone reload — and
   comes back on any device. A draft is private scratch: the row is
   keyed by (conversation, author) and the routes only ever read or
   write the caller's own row. A landed send deletes the sender's row;
   saving an empty body deletes it too. Deleting the conversation
   cascades the draft away with it. */
export const dmDraftsTable = pgTable("dm_drafts", {
  id:             uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  userId:         uuid("user_id").notNull(),
  body:           text("body").notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("dm_drafts_conversation_user_uidx").on(t.conversationId, t.userId),
  index("dm_drafts_user_idx").on(t.userId),
]);

export type DmDraft = typeof dmDraftsTable.$inferSelect;
