import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/* Storyboards (STACK-20 R2 #19, migration 0161): a member's own video
   plan — an ordered set of panels they author by hand at the Video
   Desk. One row per storyboard; the panels live in one ordered JSONB
   array (position IS array order) so panel CRUD and reordering are a
   single-row rewrite that can never fall out of sync with a second
   table. A panel's imageUrl is a permanent media ref (never a signed
   URL); NULL means a notes-only panel — a legitimate plan state. */
export interface StoryboardPanel {
  id: string;
  title: string;
  notes: string;
  /** Permanent image ref, or null for a notes-only panel. */
  imageUrl: string | null;
  /** The prompt that generated the frame (null when picked/typed-in). */
  imagePrompt: string | null;
}

export const storyboardsTable = pgTable("storyboards", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull(),
  title:     text("title").notNull().default("Untitled storyboard"),
  panels:    jsonb("panels").$type<StoryboardPanel[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("storyboards_user_idx").on(t.userId, t.updatedAt),
]);

export type Storyboard = typeof storyboardsTable.$inferSelect;
