import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const artistVaultsTable = pgTable("artist_vaults", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  artist_name: text("artist_name").notNull(),
  artist_type: text("artist_type"),
  genre: text("genre"),
  voice_style: text("voice_style"),
  visual_style: text("visual_style"),
  hair: text("hair"),
  tattoos: text("tattoos"),
  jewelry: text("jewelry"),
  clothing_style: text("clothing_style"),
  brand_colors: text("brand_colors"),
  /* Visual identity theme — preset id from src/lib/character-themes.ts.
     Drives the artist's color scheme across selection, vault, and branding. */
  theme_id: text("theme_id").notNull().default("gold-royalty"),
  personality: text("personality"),
  do_not_change_rules: text("do_not_change_rules"),
  reference_image_url: text("reference_image_url"),
  reference_image_path: text("reference_image_path"),
  consistency_prompt: text("consistency_prompt"),
  /* Locked-in ElevenLabs voice for this artist. When set, every song
     generated for the artist is vocal-swapped to this voice. */
  voice_id: text("voice_id"),
  voice_name: text("voice_name"),
  voice_preview_url: text("voice_preview_url"),
  is_active: boolean("is_active").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertArtistVaultSchema = createInsertSchema(artistVaultsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const selectArtistVaultSchema = createSelectSchema(artistVaultsTable);

export type ArtistVaultRow = typeof artistVaultsTable.$inferSelect;
export type InsertArtistVault = z.infer<typeof insertArtistVaultSchema>;
