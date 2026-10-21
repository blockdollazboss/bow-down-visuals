import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ─── Inspo Mode "My Vibes" presets ──────────────────────────────────────
   A reusable style DNA card extracted from a playlist link / vibe
   description in Song Maker's Inspo tab. Applied to future songs. */

export const inspoVibePresetsTable = pgTable("inspo_vibe_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: text("user_id").notNull(),
  name: text("name").notNull(),
  style_dna: jsonb("style_dna").notNull().default({}),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInspoVibePresetSchema = createInsertSchema(inspoVibePresetsTable).omit({
  id: true,
  created_at: true,
});

export const selectInspoVibePresetSchema = createSelectSchema(inspoVibePresetsTable);

export type InspoVibePresetRow = typeof inspoVibePresetsTable.$inferSelect;
export type InsertInspoVibePreset = z.infer<typeof insertInspoVibePresetSchema>;
