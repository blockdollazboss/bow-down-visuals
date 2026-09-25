import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/* ── Featured songs playlist (homepage) ──────────────────────────────────
   Curated tracks shown on the homepage "Featured Songs" playlist section.
   Managed by the site owner through /featured-songs (owner-only).
   The Bow Down Visuals theme song ships as the built-in default track when
   the table is empty — the playlist never renders with zero tracks. */

export const featuredSongsTable = pgTable("featured_songs", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  /** Artist / label shown under the title. */
  artist: text("artist").notNull().default("Bow Down Visuals"),
  /** Public (signed) URL of the audio file. */
  audio_url: text("audio_url").notNull(),
  /** Supabase storage reference for the audio file (nullable for the
      built-in theme track, which is served from the site's public dir). */
  audio_path: text("audio_path"),
  /** Display duration, e.g. "3:16". Filled by the browser on upload. */
  duration_label: text("duration_label"),
  /** Sort order — lower plays first. */
  position: integer("position").notNull().default(0),
  /** Owner user id that added the track. */
  created_by: uuid("created_by"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFeaturedSongSchema = createInsertSchema(featuredSongsTable).omit({
  id: true,
  created_at: true,
});

export const selectFeaturedSongSchema = createSelectSchema(featuredSongsTable);

export type FeaturedSong = typeof featuredSongsTable.$inferSelect;
