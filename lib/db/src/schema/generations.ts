import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const generationsTable = pgTable("generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title"),
  file_url: text("file_url"),
  thumbnail_url: text("thumbnail_url"),
  prompt: text("prompt"),
  credits_spent: integer("credits_spent").notNull().default(0),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /* Soft delete: never permanently lose user data. */
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

export const insertGenerationSchema = createInsertSchema(generationsTable).omit({
  id: true,
  created_at: true,
  deleted_at: true,
});

export const selectGenerationSchema = createSelectSchema(generationsTable);

export type GenerationRow = typeof generationsTable.$inferSelect;
export type InsertGeneration = z.infer<typeof insertGenerationSchema>;
