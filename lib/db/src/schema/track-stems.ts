import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { profileTracksTable } from "./creator-platform";

/* ── Track stems (N14 Stems Player, provisional migration 9999) ─────────────
   The fan-facing playback carrier for a profile track's stems. ONE row per
   track that "carries stems"; a track with no row simply has no stem
   controls in the player (honest absence).

   `stems` maps a stem key to its STABLE STORAGE REF — the exact refs the
   Stem Splitter produces (StemJob.stemRefs in routes/generate/stem-splitter:
   `stems/<userId>/<jobId>/<key>.wav` objects in the private generated-clips
   bucket, returned by the splitter's upload as r2:// / supabase:// refs).
   Keys are the splitter's own key set: vocals | drums | bass | other, plus
   the Pro tier's guitar | piano. A partial map is valid — the player shows
   exactly the stems that exist.

   Refs are NEVER sent to clients. The playback endpoint mints fresh
   short-lived signed URLs from these refs on each read (the same
   playback delivery pattern the master audio_url uses), and there is no
   download/export path for stems from the player. */

export type TrackStemKey = "vocals" | "drums" | "bass" | "other" | "guitar" | "piano";
export type TrackStemRefs = Partial<Record<TrackStemKey, string>>;

export const trackStemsTable = pgTable("track_stems", {
  trackId: uuid("track_id").primaryKey().references(() => profileTracksTable.id, { onDelete: "cascade" }),
  stems: jsonb("stems").$type<TrackStemRefs>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTrackStemSchema = createInsertSchema(trackStemsTable);
export const selectTrackStemSchema = createSelectSchema(trackStemsTable);
export type TrackStems = typeof trackStemsTable.$inferSelect;
