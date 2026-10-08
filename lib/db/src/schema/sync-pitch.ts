import { pgTable, uuid, text, boolean, timestamp, jsonb, date } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Sync Pitch Kit (DistroKid-style sync licensing pitching).
   One AI-generated one-sheet per song (shareable via share_token), user
   briefs for TV/film/ad/game projects, and a pitch tracker with
   sent -> pending -> placed statuses. See migration 0078. */

export const SYNC_PROJECT_TYPES = ["tv", "film", "ad", "game"] as const;
export type SyncProjectType = (typeof SYNC_PROJECT_TYPES)[number];

export const SYNC_PITCH_STATUSES = ["sent", "pending", "placed", "dead"] as const;
export type SyncPitchStatus = (typeof SYNC_PITCH_STATUSES)[number];

export const syncOneSheetsTable = pgTable("sync_one_sheets", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  song_title: text("song_title").notNull(),
  artist_name: text("artist_name"),
  song_library_id: uuid("song_library_id"),
  content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
  mood_tags: text("mood_tags").array().notNull().default([]),
  bpm: text("bpm"),
  musical_key: text("musical_key"),
  comparable_artists: text("comparable_artists").array().notNull().default([]),
  sounds_like: text("sounds_like"),
  instrumental_available: boolean("instrumental_available").notNull().default(false),
  stems_available: boolean("stems_available").notNull().default(false),
  contact_name: text("contact_name"),
  contact_email: text("contact_email"),
  share_token: text("share_token").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncBriefsTable = pgTable("sync_briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  project_type: text("project_type").notNull().default("tv"),
  mood: text("mood").notNull().default(""),
  budget_range: text("budget_range").notNull().default(""),
  deadline: date("deadline"),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncPitchesTable = pgTable("sync_pitches", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  one_sheet_id: uuid("one_sheet_id"),
  brief_id: uuid("brief_id"),
  song_title: text("song_title").notNull(),
  target_name: text("target_name").notNull().default(""),
  status: text("status").notNull().default("sent"),
  notes: text("notes"),
  contacted_at: timestamp("contacted_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSyncOneSheetSchema = createInsertSchema(syncOneSheetsTable).omit({
  id: true,
  user_id: true,
  created_at: true,
  updated_at: true,
});

export const insertSyncBriefSchema = createInsertSchema(syncBriefsTable).omit({
  id: true,
  user_id: true,
  created_at: true,
  updated_at: true,
});

export const insertSyncPitchSchema = createInsertSchema(syncPitchesTable).omit({
  id: true,
  user_id: true,
  created_at: true,
  updated_at: true,
});

export const selectSyncOneSheetSchema = createSelectSchema(syncOneSheetsTable);
export const selectSyncBriefSchema = createSelectSchema(syncBriefsTable);
export const selectSyncPitchSchema = createSelectSchema(syncPitchesTable);

export type SyncOneSheetRow = typeof syncOneSheetsTable.$inferSelect;
export type SyncBriefRow = typeof syncBriefsTable.$inferSelect;
export type SyncPitchRow = typeof syncPitchesTable.$inferSelect;
