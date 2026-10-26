import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/* ── Sample Clearance Lane (Stack-200 N2, migration 9999 PROVISIONAL) ──
   A creator declares the samples used on THEIR OWN song (ownership is
   verified against the songs table at write time — this table never
   trusts a caller-supplied owner). The declaration is the creator's
   honesty; the lane's job is plain-words risk flags + cleared-loop
   alternatives, never silent passage and never a platform "verified"
   stamp: clearance_status is CREATOR-STATED, always labelled as such.

   The declaration rides the track's credits (N1, sibling lane
   stack200/rem-song-credits — NOT in this base): declarations live in
   this own table keyed to the song and are exposed via
   GET /api/sample-clearance/songs/:songId so the credits layer can
   render them at join.

   NO MONEY: this lane charges nothing and moves nothing. */

export const SAMPLE_USE_KINDS = ["loop", "interpolation", "one_shot", "replay", "other"] as const;
export type SampleUseKind = (typeof SAMPLE_USE_KINDS)[number];

export const SAMPLE_USE_LABEL: Record<SampleUseKind, string> = {
  loop: "Loop — a piece of the source repeats through the track",
  interpolation: "Interpolation — the melody/lyric was re-performed, not the recording itself",
  one_shot: "One-shot — a short hit or sound used once or a few times",
  replay: "Replay — a section of the source plays as-is",
  other: "Something else",
};

/** Creator-stated clearance. NEVER platform-verified. */
export const SAMPLE_CLEARANCE_STATUSES = ["licensed", "public_domain_or_original", "not_cleared", "unsure"] as const;
export type SampleClearanceStatus = (typeof SAMPLE_CLEARANCE_STATUSES)[number];

export const SAMPLE_CLEARANCE_LABEL: Record<SampleClearanceStatus, string> = {
  licensed: "I have a license or clearance for this sample",
  public_domain_or_original: "The source is public domain, or it is my own original recording",
  not_cleared: "I do not have a license or clearance for this sample",
  unsure: "I'm not sure whether this sample is cleared",
};

export const sampleDeclarationsTable = pgTable(
  "sample_declarations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The song (track) this declaration belongs to — songs.id. */
    song_id: uuid("song_id").notNull(),
    /** Declaring creator; must equal songs.user_id (checked at write). */
    user_id: uuid("user_id").notNull(),
    /** What was sampled, in the creator's own words. */
    source_description: text("source_description").notNull(),
    /** How it is used: loop | interpolation | one_shot | replay | other. */
    use_kind: text("use_kind").notNull().default("loop"),
    /** Creator-stated: licensed | public_domain_or_original | not_cleared | unsure. */
    clearance_status: text("clearance_status").notNull().default("unsure"),
    /** Creator says the source is a recognizable recording/melody. */
    recognizable: boolean("recognizable").notNull().default(true),
    /** Pre-ship acknowledgement: the creator saw the risk flags and
     *  chose to ship anyway. Recorded, never implied. */
    risk_acknowledged: boolean("risk_acknowledged").notNull().default(false),
    risk_acknowledged_at: timestamp("risk_acknowledged_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sample_declarations_song_idx").on(t.song_id), index("sample_declarations_user_idx").on(t.user_id)],
);

export const insertSampleDeclarationSchema = createInsertSchema(sampleDeclarationsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export const selectSampleDeclarationSchema = createSelectSchema(sampleDeclarationsTable);

export type SampleDeclaration = typeof sampleDeclarationsTable.$inferSelect;
