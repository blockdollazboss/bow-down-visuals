import { pgTable, uuid, text, integer, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";

export const generationHistoryTable = pgTable("generation_history", {
  id:             uuid("id").primaryKey().defaultRandom(),
  userId:         uuid("user_id").notNull(),
  projectId:      uuid("project_id"),
  generationType: text("generation_type"),
  prompt:         text("prompt"),
  result:         jsonb("result").$type<{
    content?:      string;
    artistName?:   string;
    songTitle?:    string;
    videoUrl?:     string;
    thumbnailUrl?: string;
    sceneId?:      string;
    actionLabel?:  string;
  }>(),
  creditsUsed:    integer("credits_used"),
  saveStatus:     text("save_status").notNull().default("pending"),
  refunded:       boolean("refunded").notNull().default(false),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GenerationHistory = typeof generationHistoryTable.$inferSelect;
