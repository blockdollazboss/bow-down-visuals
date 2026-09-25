import { pgTable, uuid, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Press kits (EPKs) ───────────────────────────────────────────────────
   Electronic press kits artists generate and share: bio, photos, top
   tracks, achievements, press quotes, and booking contact — published at
   a public shareable URL (/press/:handle). The AI bio is the only
   compute-burning step (3 credits); all editing is free. */

export interface PressKitTrack {
  title: string;
  url: string;
}

export interface PressKitQuote {
  quote: string;
  source: string;
}

export const pressKitTrackSchema = z.object({
  title: z.string().min(1).max(120),
  url: z.string().url().max(500),
});

export const pressKitQuoteSchema = z.object({
  quote: z.string().min(1).max(500),
  source: z.string().min(1).max(120),
});

export const pressKitsTable = pgTable("press_kits", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  /** URL-safe public handle, unique across the site. */
  handle: text("handle").notNull().unique(),
  artist_name: text("artist_name").notNull(),
  tagline: text("tagline"),
  /** AI-written bio (3-credit generation) — editable for free after. */
  bio: text("bio"),
  genre: text("genre"),
  location: text("location"),
  booking_email: text("booking_email"),
  website: text("website"),
  instagram_url: text("instagram_url"),
  tiktok_url: text("tiktok_url"),
  youtube_url: text("youtube_url"),
  spotify_url: text("spotify_url"),
  /** Free-text achievements, one per line in the UI, stored as JSON array. */
  achievements: jsonb("achievements").$type<string[]>().default([]),
  press_quotes: jsonb("press_quotes").$type<PressKitQuote[]>().default([]),
  /** Photo URLs pulled from the artist vault gallery. */
  photo_urls: jsonb("photo_urls").$type<string[]>().default([]),
  top_tracks: jsonb("top_tracks").$type<PressKitTrack[]>().default([]),
  /** Artist vault this kit was built from (bio source + photos). */
  artist_vault_id: uuid("artist_vault_id"),
  is_public: boolean("is_public").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPressKitSchema = createInsertSchema(pressKitsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const selectPressKitSchema = createSelectSchema(pressKitsTable);

export type PressKit = typeof pressKitsTable.$inferSelect;
export type InsertPressKit = z.infer<typeof insertPressKitSchema>;

/** Public shape served at /press/:handle — never leaks user_id. */
export const publicPressKitSchema = selectPressKitSchema.omit({ user_id: true });
export type PublicPressKit = z.infer<typeof publicPressKitSchema>;

/** Handle rules: 3-30 chars, lowercase letters/numbers/hyphens, no leading/trailing hyphen. */
export const pressKitHandleSchema = z
  .string()
  .min(3, "Handle must be at least 3 characters")
  .max(30, "Handle must be at most 30 characters")
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Handle must be lowercase letters, numbers, and hyphens only");
