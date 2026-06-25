import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const generatedClipsTable = pgTable("generated_clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  project_id: uuid("project_id"),
  scene_id: text("scene_id"),
  title: text("title"),
  prompt: text("prompt"),
  final_prompt: text("final_prompt"),
  runway_job_id: text("runway_job_id"),
  video_url: text("video_url"),
  thumbnail_url: text("thumbnail_url"),
  status: text("status").notNull().default("completed"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGeneratedClipSchema = createInsertSchema(generatedClipsTable).omit({
  id: true,
  created_at: true,
});

export const selectGeneratedClipSchema = createSelectSchema(generatedClipsTable);

export type GeneratedClipRow = typeof generatedClipsTable.$inferSelect;
export type InsertGeneratedClip = z.infer<typeof insertGeneratedClipSchema>;
