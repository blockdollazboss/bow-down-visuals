import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/* ── Songs library ─────────────────────────────────────────────────────────
   Songs the user uploaded, generated on the site, or remixed from either.
   Uploaded songs can be stripped to vocals (to clone a character voice) or
   remixed — vocals regenerated in an artist vault's locked voice. */

export const songsTable = pgTable("songs", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  /** Public (signed) URL of the audio file. */
  audio_url: text("audio_url").notNull(),
  /** Supabase storage reference for the audio file. */
  audio_path: text("audio_path"),
  /** upload | generated | remix */
  source: text("source").notNull().default("upload"),
  /** For remixes: the song this was remixed from. */
  parent_song_id: uuid("parent_song_id"),
  /** Artist vault whose locked voice was used (remixes). */
  artist_vault_id: uuid("artist_vault_id"),
  duration_sec: text("duration_sec"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSongSchema = createInsertSchema(songsTable).omit({
  id: true,
  created_at: true,
});

export const selectSongSchema = createSelectSchema(songsTable);

export type Song = typeof songsTable.$inferSelect;
