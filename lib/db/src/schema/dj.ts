import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { songsTable } from "./songs";

/* ── DJ Set-Prep (migration 0195) ──────────────────────────────────────────
   Per-song DJ analysis (BPM + musical key + Camelot) and performance
   crates (ordered set lists) for the DJ Set-Prep Pack docked in the song
   library. Analysis is an ESTIMATE produced by lib/track-analysis.ts —
   key_confidence / bpm_confidence are stored with the numbers so no UI
   ever has to present a rough guess as a fact. */

/** One analysis row per song (upserted on re-analyze). */
export const songDjAnalysisTable = pgTable("song_dj_analysis", {
  song_id: uuid("song_id")
    .primaryKey()
    .references(() => songsTable.id),
  /** Denormalized owner — every read is owner-scoped without a join. */
  user_id: uuid("user_id").notNull(),
  /** Estimated tempo, or null when the onset signal was too weak. */
  bpm: integer("bpm"),
  /** high | medium | low — honesty label for the tempo estimate. */
  bpm_confidence: text("bpm_confidence"),
  /** Pitch class 0–11 (0 = C) of the estimated key root. */
  key_root: integer("key_root"),
  /** major | minor */
  key_mode: text("key_mode"),
  /** Display label, e.g. "A minor". */
  key_label: text("key_label"),
  /** Camelot wheel code, e.g. "8A" (minor) / "8B" (major). */
  camelot: text("camelot"),
  /** Krumhansl-Schmuckler correlation of the winning key (0–1). */
  key_score: doublePrecision("key_score"),
  /** high | medium | low — honesty label for the key estimate. */
  key_confidence: text("key_confidence"),
  duration_sec: integer("duration_sec"),
  analyzed_at: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
  /** Bumped when the analyzer changes so stale rows can be refreshed. */
  analyzer_version: integer("analyzer_version").notNull().default(1),
});

/** A creator's DJ crate (a set being prepped). */
export const djCratesTable = pgTable("dj_crates", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  name: text("name").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One track in a crate. `position` is the play order (0-based). */
export const djCrateItemsTable = pgTable("dj_crate_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  crate_id: uuid("crate_id")
    .notNull()
    .references(() => djCratesTable.id),
  song_id: uuid("song_id")
    .notNull()
    .references(() => songsTable.id),
  position: integer("position").notNull(),
  added_at: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSongDjAnalysisSchema = createInsertSchema(songDjAnalysisTable);
export const selectSongDjAnalysisSchema = createSelectSchema(songDjAnalysisTable);
export const insertDjCrateSchema = createInsertSchema(djCratesTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export const selectDjCrateSchema = createSelectSchema(djCratesTable);

export type SongDjAnalysis = typeof songDjAnalysisTable.$inferSelect;
export type DjCrate = typeof djCratesTable.$inferSelect;
export type DjCrateItem = typeof djCrateItemsTable.$inferSelect;
