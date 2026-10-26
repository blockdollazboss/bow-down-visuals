import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Song credits that TRAVEL with the song (Stack-200 N1) ───────────────
   The canonical credits layer. A song's credits used to live only as
   payment-side records (publishing writer splits, distribution royalty
   splits, co-release agreed splits) — none of them a credits LIST a play,
   share, or export surface could render, and producers / featured
   artists / declared samples lived NOWHERE.

   This schema is deliberately NOT a second splits machine and NOT a
   second credits copy of the splits:
   - Writer shares stay in publishing_split_registrations/writers and
     are validated by validateWriterSplits (lib/publishing-splits.ts).
   - Master shares stay in distribution_royalty_splits (versioned).
   - Co-release shares stay frozen in co_release_sides (consented).
   The canonical read layer (api-server lib/song-credits.ts) MERGES those
   rails with the entries stored here, keyed by the same anchor the
   publishing registry already uses: song_kind 'song' → songs.id,
   'release' → distribution_releases.id. A release also inherits the
   credits of its library song (distribution_releases.song_id), and a
   library song inherits from its parent_song_id chain (remixes, covers,
   open-verse winners, loop builds) — that inheritance is what makes the
   credits FOLLOW the song instead of being re-entered per surface.

   song_credit_entries holds ONLY the credits no other rail records:
   producers, featured artists, declared samples, engineers and other
   named roles. Entries carry NO share — a share entered here would be
   a second splits machine. Samples ride here because N2's clearance
   lane reads the same declarations.

   song_credit_revisions is the audit trail: every owner save appends
   one row whose snapshot is the FULL canonical credits picture at that
   version (entries + the splits rails as read at save time), so an
   edit is never silent and any past version can be shown. The
   snapshot is a record, never a source surfaces render from.

   *** MIGRATION PROVISIONAL *** Created by
   lib/db/migrations/9999-song-credits.sql — the number is provisional
   (flagged for the integrator to renumber at join). Until it lands,
   write routes probe-first and answer 503, and reads degrade to the
   splits rails alone — nothing is faked. */

export const SONG_CREDIT_KINDS = ["song", "release"] as const;
export type SongCreditKind = (typeof SONG_CREDIT_KINDS)[number];

export const SONG_CREDIT_ROLES = [
  "featured_artist",
  "producer",
  "sample",
  "engineer",
  "mixer",
  "mastering",
  "arranger",
  "other",
] as const;
export type SongCreditRole = (typeof SONG_CREDIT_ROLES)[number];

export const songCreditEntriesTable = pgTable(
  "song_credit_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner_user_id: uuid("owner_user_id").notNull(),
    song_kind: text("song_kind").notNull().default("song"),
    song_id: uuid("song_id").notNull(),
    role: text("role").notNull(),
    display_name: text("display_name").notNull(),
    /* On-platform link when the credited person has a Bow Down account:
       the credit becomes tappable to their creator profile. Both null =
       off-platform, recorded by name only. */
    credit_user_id: uuid("credit_user_id"),
    credit_profile_id: uuid("credit_profile_id"),
    /* Role detail: for a sample, the sampled work ("Title — Artist");
       for other roles an optional note (e.g. "co-producer"). */
    detail: text("detail"),
    sort_order: integer("sort_order").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("song_credit_entries_song_idx").on(t.song_kind, t.song_id),
    index("song_credit_entries_profile_idx").on(t.credit_profile_id),
  ],
);

export const songCreditRevisionsTable = pgTable(
  "song_credit_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner_user_id: uuid("owner_user_id").notNull(),
    song_kind: text("song_kind").notNull().default("song"),
    song_id: uuid("song_id").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("song_credit_revisions_song_idx").on(t.song_kind, t.song_id, t.version)],
);

export const insertSongCreditEntrySchema = createInsertSchema(songCreditEntriesTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertSongCreditEntry = z.infer<typeof insertSongCreditEntrySchema>;
export type SongCreditEntryRow = typeof songCreditEntriesTable.$inferSelect;
export type SongCreditRevisionRow = typeof songCreditRevisionsTable.$inferSelect;
