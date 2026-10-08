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

export const GROUP_ROLES = ["owner", "mod", "member"] as const;
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

/* ── Group-scoped posts (see migration 0098 for the Worker 8 posts note) ── */

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
  isRead:         boolean("is_read").notNull().default(false),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
  index("messages_sender_idx").on(t.senderUserId),
]);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
