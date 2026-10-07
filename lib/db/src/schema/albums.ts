import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { songsTable } from "./songs";

/* ── Album/EP Builder ────────────────────────────────────────────────────
   Creators group their generated songs into an Album or EP: named,
   reorderable tracklist, album cover art, release notes. Drafting is
   free; publishing the shareable album page costs Visual Bucs. */

export const ALBUM_TYPES = ["album", "ep"] as const;
export const ALBUM_STATUSES = ["draft", "published"] as const;

export const albumsTable = pgTable("albums", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  slug: text("slug").unique(),
  album_type: text("album_type").notNull().default("album"),
  release_notes: text("release_notes").notNull().default(""),
  cover_art_url: text("cover_art_url"),
  status: text("status").notNull().default("draft"),
  views: integer("views").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const albumTracksTable = pgTable("album_tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  album_id: uuid("album_id")
    .notNull()
    .references(() => albumsTable.id, { onDelete: "cascade" }),
  song_id: uuid("song_id")
    .notNull()
    .references(() => songsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAlbumSchema = createInsertSchema(albumsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const selectAlbumSchema = createSelectSchema(albumsTable);

export type AlbumRow = typeof albumsTable.$inferSelect;
export type InsertAlbum = z.infer<typeof insertAlbumSchema>;
export type AlbumTrackRow = typeof albumTracksTable.$inferSelect;
