import { pgTable, uuid, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Wardrobe outfits for an artist vault. Outfits are worn BY the artist, so
   they live with the artist (vault-scoped) — not at user level, not at
   video level. Deleting a vault cascades to its outfits (see migration
   0006_artist_outfits.sql). Deleting an outfit removes ONLY this row; the
   image object in Supabase storage is never touched (non-destructive). */
export const artistOutfitsTable = pgTable("artist_outfits", {
  id: uuid("id").primaryKey().defaultRandom(),
  vault_id: uuid("vault_id").notNull(),
  label: text("label").notNull(),
  image_url: text("image_url").notNull(),
  image_path: text("image_path"),
  is_default: boolean("is_default").notNull().default(false),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertArtistOutfitSchema = createInsertSchema(artistOutfitsTable).omit({
  id: true,
  created_at: true,
});

export const selectArtistOutfitSchema = createSelectSchema(artistOutfitsTable);

export type ArtistOutfitRow = typeof artistOutfitsTable.$inferSelect;
export type InsertArtistOutfit = z.infer<typeof insertArtistOutfitSchema>;
