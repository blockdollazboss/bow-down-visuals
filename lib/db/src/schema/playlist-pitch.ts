import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Pitch tracker for the Playlist Pitcher (/playlist-pitch).
   One row per pitch a creator sends to a playlist curator — tracks the
   outreach pipeline: sent → pending → accepted (or rejected).
   Deleting a row removes ONLY this row; nothing else references it. */

export const PITCH_STATUSES = ["sent", "pending", "accepted", "rejected"] as const;
export type PitchStatus = (typeof PITCH_STATUSES)[number];

export const playlistPitchesTable = pgTable("playlist_pitches", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  song_title: text("song_title").notNull(),
  artist_name: text("artist_name"),
  curator_name: text("curator_name"),
  playlist_name: text("playlist_name").notNull(),
  status: text("status").notNull().default("sent"),
  notes: text("notes"),
  contacted_at: timestamp("contacted_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlaylistPitchSchema = createInsertSchema(playlistPitchesTable).omit({
  id: true,
  user_id: true,
  created_at: true,
  updated_at: true,
});

export const selectPlaylistPitchSchema = createSelectSchema(playlistPitchesTable);

export type PlaylistPitchRow = typeof playlistPitchesTable.$inferSelect;
export type InsertPlaylistPitch = z.infer<typeof insertPlaylistPitchSchema>;
