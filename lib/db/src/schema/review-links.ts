import { pgTable, uuid, text, timestamp, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reviewLinksTable = pgTable("review_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  token_hash: text("token_hash").notNull().unique(),
  title: text("title").notNull().default("Untitled video"),
  video_url: text("video_url").notNull(),
  source_type: text("source_type").notNull().default("other"),
  source_id: text("source_id"),
  password_hash: text("password_hash"),
  status: text("status").notNull().default("open"),
  expires_at: timestamp("expires_at", { withTimezone: true }),
  feedback_seen_at: timestamp("feedback_seen_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewCommentsTable = pgTable("review_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  link_id: uuid("link_id")
    .notNull()
    .references(() => reviewLinksTable.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Reviewer"),
  timestamp_sec: doublePrecision("timestamp_sec").notNull().default(0),
  text: text("text").notNull(),
  hidden: boolean("hidden").notNull().default(false),
  ip_hash: text("ip_hash"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReviewLinkSchema = createInsertSchema(reviewLinksTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const insertReviewCommentSchema = createInsertSchema(reviewCommentsTable).omit({
  id: true,
  created_at: true,
});

export const selectReviewLinkSchema = createSelectSchema(reviewLinksTable);
export const selectReviewCommentSchema = createSelectSchema(reviewCommentsTable);

export type ReviewLinkRow = typeof reviewLinksTable.$inferSelect;
export type ReviewCommentRow = typeof reviewCommentsTable.$inferSelect;
export type InsertReviewLink = z.infer<typeof insertReviewLinkSchema>;
export type InsertReviewComment = z.infer<typeof insertReviewCommentSchema>;
