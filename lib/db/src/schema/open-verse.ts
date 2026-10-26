import { pgTable, uuid, text, timestamp, numeric, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Open Verse (Stack-200 Wave 2, idea #176 — TRULY NEW) ────────────────
   A song posted with ONE open verse slot. Other creators submit a verse
   IN-APP; the song's creator — and only the creator — picks the winner,
   and the winner's verse becomes the verse on the track.

   Split terms are shown UP FRONT, before anyone submits, and they are
   NOT a second splits machine: the terms are a two-line split validated
   by the EXISTING publishing-splits rail (api-server
   lib/publishing-splits.ts `validateWriterSplits`, sum = 100) — the
   song creator's share and the winning verse creator's share, both
   creator-entered at post time. `split_terms` snapshots that validated
   list so the terms a submitter saw can never drift after the fact.

   Money law: TEST MODE, Visual Bucs only, never cash. No amount is
   invented and nothing is charged for posting or submitting. When a
   winner is picked, ONE row lands in open_verse_split_ledger recording
   the split agreement (unique on post_id + a unique idempotency key
   `open-verse-split:<post_id>`) — exactly once, however many times the
   pick is retried. Future earnings on the track divide by these terms
   in Visual Bucs through the existing rails; this feature pays nobody
   cash and moves no balance by itself.

   Smart law: creator approval gates EVERY step. A post exists only
   because its creator posted it; a winner exists only because the
   creator picked one. Nothing auto-posts, auto-picks, or auto-applies.

   A song is anchored like the publishing registry: song_kind 'release'
   → distribution_releases.id, or 'song' → songs.id. song_id carries no
   FK on purpose (two possible targets); the route validates ownership
   at post time and song_title is snapshotted.

   *** MIGRATION PROVISIONAL *** These tables are created by
   lib/db/migrations/9999-open-verse.sql (coordinator renumbers at
   join). Until it lands, write routes probe-first and answer 503, and
   reads degrade to "no open verses yet" — nothing is faked. */

export const OPEN_VERSE_SONG_KINDS = ["release", "song"] as const;
export type OpenVerseSongKind = (typeof OPEN_VERSE_SONG_KINDS)[number];

export const OPEN_VERSE_POST_STATUSES = ["open", "closed", "winner_picked", "cancelled"] as const;
export type OpenVersePostStatus = (typeof OPEN_VERSE_POST_STATUSES)[number];

export const OPEN_VERSE_SUBMISSION_STATUSES = ["submitted", "winner", "not_selected", "withdrawn"] as const;
export type OpenVerseSubmissionStatus = (typeof OPEN_VERSE_SUBMISSION_STATUSES)[number];

export interface OpenVerseSplitTerm {
  name: string;
  role: "creator" | "winner";
  sharePct: number;
}

export const openVersePostsTable = pgTable(
  "open_verse_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner_user_id: uuid("owner_user_id").notNull(),
    song_kind: text("song_kind").notNull().default("song"),
    song_id: uuid("song_id").notNull(),
    song_title: text("song_title").notNull().default(""),
    /* What the verse should be — the creator's brief for the slot. */
    brief: text("brief").notNull().default(""),
    slot_label: text("slot_label").notNull().default("Open verse"),
    /* The up-front split, validated by the publishing-splits rail
       (sum = 100): [{ name, role: 'creator'|'winner', sharePct }]. */
    split_terms: jsonb("split_terms").$type<OpenVerseSplitTerm[]>().notNull().default([]),
    winner_share_pct: numeric("winner_share_pct", { precision: 5, scale: 2 }).notNull(),
    status: text("status").notNull().default("open"),
    closes_at: timestamp("closes_at", { withTimezone: true }),
    winner_submission_id: uuid("winner_submission_id"),
    winner_user_id: uuid("winner_user_id"),
    winner_picked_at: timestamp("winner_picked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("open_verse_posts_song_kind_check", sql`${t.song_kind} IN ('release','song')`),
    check("open_verse_posts_status_check", sql`${t.status} IN ('open','closed','winner_picked','cancelled')`),
    check("open_verse_posts_winner_share_range_check", sql`${t.winner_share_pct} > 0 AND ${t.winner_share_pct} < 100`),
    index("open_verse_posts_owner_idx").on(t.owner_user_id),
    index("open_verse_posts_status_idx").on(t.status, t.created_at),
    index("open_verse_posts_song_idx").on(t.song_kind, t.song_id),
  ],
);

export const openVerseSubmissionsTable = pgTable(
  "open_verse_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    post_id: uuid("post_id")
      .notNull()
      .references(() => openVersePostsTable.id, { onDelete: "cascade" }),
    submitter_user_id: uuid("submitter_user_id").notNull(),
    /* Display-name snapshot at submit time (creator_profiles). */
    submitter_name: text("submitter_name").notNull().default("Creator"),
    /* The verse itself, in-app: an audio URL (the submitter's own song /
       upload) plus optional lyrics and a note to the song's creator. */
    audio_url: text("audio_url").notNull(),
    lyrics: text("lyrics"),
    note: text("note"),
    status: text("status").notNull().default("submitted"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("open_verse_submissions_status_check", sql`${t.status} IN ('submitted','winner','not_selected','withdrawn')`),
    uniqueIndex("open_verse_submissions_post_submitter_uidx").on(t.post_id, t.submitter_user_id),
    index("open_verse_submissions_post_idx").on(t.post_id, t.created_at),
    index("open_verse_submissions_submitter_idx").on(t.submitter_user_id),
  ],
);

/* Exactly-once split ledger: ONE row per post, written only when the
   creator picks a winner. The unique post_id + unique idempotency key
   make a retried pick resolve to the same row — never a second split
   agreement, never a second payment record. Amounts are PERCENTAGES
   of the track's future Visual Bucs earnings (test mode); no cash. */
export const openVerseSplitLedgerTable = pgTable(
  "open_verse_split_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    post_id: uuid("post_id")
      .notNull()
      .unique()
      .references(() => openVersePostsTable.id, { onDelete: "cascade" }),
    winner_submission_id: uuid("winner_submission_id").notNull(),
    owner_user_id: uuid("owner_user_id").notNull(),
    winner_user_id: uuid("winner_user_id").notNull(),
    winner_share_pct: numeric("winner_share_pct", { precision: 5, scale: 2 }).notNull(),
    split_terms: jsonb("split_terms").$type<OpenVerseSplitTerm[]>().notNull().default([]),
    /* Always 'VB' — Visual Bucs only, test mode, never cash. */
    currency: text("currency").notNull().default("VB"),
    idempotency_key: text("idempotency_key").notNull().unique(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("open_verse_split_ledger_currency_check", sql`${t.currency} = 'VB'`),
    index("open_verse_split_ledger_winner_idx").on(t.winner_user_id),
  ],
);

export const insertOpenVersePostSchema = createInsertSchema(openVersePostsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertOpenVersePost = z.infer<typeof insertOpenVersePostSchema>;
export type OpenVersePost = typeof openVersePostsTable.$inferSelect;

export const insertOpenVerseSubmissionSchema = createInsertSchema(openVerseSubmissionsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertOpenVerseSubmission = z.infer<typeof insertOpenVerseSubmissionSchema>;
export type OpenVerseSubmission = typeof openVerseSubmissionsTable.$inferSelect;

export type OpenVerseSplitLedgerRow = typeof openVerseSplitLedgerTable.$inferSelect;
