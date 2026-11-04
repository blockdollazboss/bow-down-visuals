import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Beat Samples — a creator's own uploaded Beat Studio sounds, made
 * durable (stack1500 beat-persistence lane).
 *
 * Until this table existed, a sound loaded onto a sequencer track lived
 * only in the browser session: the beat project persisted the sound id
 * + display name, but the bytes were memory-only, so after a reload the
 * track fell back to its built-in synth voice with a "not loaded"
 * notice (lib/beat-sounds.ts, FE). This table is the library of record:
 * one row per saved sample, owned by exactly one account (user_id —
 * every read/write in routes/beat-samples.ts is scoped to the caller,
 * fail-closed). The audio bytes themselves live in R2 under the row's
 * storage_key; this row is the metadata + lifecycle:
 *
 *   pending → the row + presigned PUT exist, bytes not yet confirmed.
 *             Pending rows are invisible to every read path.
 *   ready   → the bytes landed in R2 at the declared size (the
 *             /complete step verified via HEAD) and the sample can be
 *             listed, fetched, and rehydrated into the registry.
 *
 * The registry sound id is derived, never stored: `upload:<row id>` —
 * the same id shape session uploads use, so a beat project saved with
 * the durable id resolves identically after any reload once the FE
 * registers the library manifest (lib/beat-sample-library.ts).
 */

/** The nine sequencer track kinds — mirrors BeatSoundKind in the FE
 *  registry (lib/beat-sounds.ts BEAT_TRACK_KINDS). A sample is saved
 *  for exactly one kind, the track family it was loaded onto. */
export const BEAT_SAMPLE_KINDS = [
  "kick", "snare", "clap", "chat", "ohat", "b808", "perc", "shk", "crash",
] as const;
export type BeatSampleKind = (typeof BEAT_SAMPLE_KINDS)[number];

export const BEAT_SAMPLE_STATUSES = ["pending", "ready"] as const;
export type BeatSampleStatus = (typeof BEAT_SAMPLE_STATUSES)[number];

/** Hard size ceiling for one saved sample (20 MB). A drum one-shot or
 *  a short loop is far under this; the cap exists so the library can't
 *  become a general file locker. The FE loader enforces the same
 *  number before any bytes move (lib/beat-sample-library.ts). */
export const BEAT_SAMPLE_MAX_BYTES = 20 * 1024 * 1024;

/** Accepted audio content types → the storage-key file extension.
 *  Mirrors what the Beat Studio loader accepts (the page's file input
 *  takes audio/*,.wav,.mp3,.ogg,.m4a,.flac and decodeAudioData does the
 *  rest); anything outside this map is refused at the door, before a
 *  presigned URL is minted. */
export const BEAT_SAMPLE_CONTENT_TYPES: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
};

export function beatSampleExtensionForContentType(contentType: string): string | null {
  return BEAT_SAMPLE_CONTENT_TYPES[contentType.trim().toLowerCase()] ?? null;
}

/** The sound-registry id a saved sample carries in beat projects. */
export function beatSampleSoundId(sampleId: string): string {
  return `upload:${sampleId}`;
}

export const beatSamplesTable = pgTable(
  "beat_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Supabase user id of the sample's owner — the ONLY account that
     *  can list, fetch, complete, or delete this row. */
    userId: uuid("user_id").notNull(),
    /** Display name shown in the track sound picker ("Your sounds"). */
    name: text("name").notNull(),
    /** One of BEAT_SAMPLE_KINDS — the track family this sample plays on. */
    kind: text("kind").notNull(),
    /** R2 object key: "<userId>/beat-samples/<id>.<ext>" — user-prefixed
     *  like every other user object on the shared storage rail. */
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    /** Declared byte size, verified against the landed object at
     *  /complete before the row can turn ready. */
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("beat_samples_storage_key_ux").on(t.storageKey),
    index("beat_samples_user_idx").on(t.userId, t.status),
  ],
);

const insertBeatSampleSchema = createInsertSchema(beatSamplesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBeatSample = z.infer<typeof insertBeatSampleSchema>;
export type BeatSample = typeof beatSamplesTable.$inferSelect;
