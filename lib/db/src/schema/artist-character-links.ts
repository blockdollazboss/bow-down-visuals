import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { artistVaultsTable } from "./artist-vaults";

/**
 * Character links — lets one character star in another character's content.
 * E.g. "Nova" links "King Shark" as a featured artist, so when creating
 * for Nova, King Shark can appear as a co-star.
 */
export const artistCharacterLinksTable = pgTable("artist_character_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  character_id: uuid("character_id")
    .notNull()
    .references(() => artistVaultsTable.id, { onDelete: "cascade" }),
  linked_character_id: uuid("linked_character_id")
    .notNull()
    .references(() => artistVaultsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("collaborator"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertArtistCharacterLinkSchema = createInsertSchema(
  artistCharacterLinksTable,
).omit({ id: true, created_at: true });

export const selectArtistCharacterLinkSchema = createSelectSchema(
  artistCharacterLinksTable,
);

export type ArtistCharacterLinkRow = typeof artistCharacterLinksTable.$inferSelect;
export type InsertArtistCharacterLink = z.infer<typeof insertArtistCharacterLinkSchema>;

/** Roles a linked character can play in another character's content. */
export const CHARACTER_LINK_ROLES = [
  { id: "featured-artist", label: "Featured Artist" },
  { id: "collaborator", label: "Collaborator" },
  { id: "cameo", label: "Cameo" },
  { id: "rival", label: "Rival" },
  { id: "love-interest", label: "Love Interest" },
  { id: "crew", label: "Crew" },
] as const;
