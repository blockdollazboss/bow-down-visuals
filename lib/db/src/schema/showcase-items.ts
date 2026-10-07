import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const showcaseItemsTable = pgTable("showcase_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  media_type: text("media_type").notNull().default("image"),
  media_url: text("media_url").notNull(),
  thumbnail_url: text("thumbnail_url"),
  creator_name: text("creator_name").notNull().default("Anonymous Creator"),
  likes: integer("likes").notNull().default(0),
  views: integer("views").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const showcaseLikesTable = pgTable("showcase_likes", {
  item_id: uuid("item_id")
    .notNull()
    .references(() => showcaseItemsTable.id, { onDelete: "cascade" }),
  voter_key: text("voter_key").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertShowcaseItemSchema = createInsertSchema(showcaseItemsTable).omit({
  id: true,
  likes: true,
  views: true,
  created_at: true,
});

export const selectShowcaseItemSchema = createSelectSchema(showcaseItemsTable);

export type ShowcaseItemRow = typeof showcaseItemsTable.$inferSelect;
export type InsertShowcaseItem = z.infer<typeof insertShowcaseItemSchema>;
