import { pgTable, uuid, text, timestamp, check, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { distributionReleasesTable } from "./distribution-releases";

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

/* Pitch submission deadlines (migration 0199, competitor gap G7).
   One row per submission deadline a creator is tracking for a playlist
   pitch: the target curator/playlist, the date it is due, and where the
   outreach stands. This is the pitch-WINDOW workflow (draft → send →
   follow up → answered) — deliberately a different vocabulary from the
   tracker above, which records pitch OUTCOMES (sent/pending/accepted/
   rejected). A deadline may optionally point at the tracker pitch it
   belongs to and/or the release being pitched; both links are set-null
   on delete so the deadline record survives either parent going away.
   In-app state only: nothing here sends email or notifications. */

export const PITCH_DEADLINE_STATUSES = ["drafted", "sent", "followed_up", "answered"] as const;
export type PitchDeadlineStatus = (typeof PITCH_DEADLINE_STATUSES)[number];

export const pitchDeadlinesTable = pgTable("pitch_deadlines", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  pitch_id: uuid("pitch_id").references(() => playlistPitchesTable.id, { onDelete: "set null" }),
  release_id: uuid("release_id").references(() => distributionReleasesTable.id, { onDelete: "set null" }),
  curator_name: text("curator_name"),
  playlist_name: text("playlist_name").notNull(),
  deadline_at: timestamp("deadline_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("drafted"),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check(
    "pitch_deadlines_status_check",
    sql`${t.status} IN ('drafted', 'sent', 'followed_up', 'answered')`,
  ),
  index("pitch_deadlines_user_deadline_idx").on(t.user_id, t.deadline_at),
]);

export const insertPitchDeadlineSchema = createInsertSchema(pitchDeadlinesTable).omit({
  id: true,
  user_id: true,
  created_at: true,
  updated_at: true,
});
export const selectPitchDeadlineSchema = createSelectSchema(pitchDeadlinesTable);

export type PitchDeadlineRow = typeof pitchDeadlinesTable.$inferSelect;
export type InsertPitchDeadline = z.infer<typeof insertPitchDeadlineSchema>;
