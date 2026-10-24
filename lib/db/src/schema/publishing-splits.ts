import { pgTable, uuid, text, timestamp, boolean, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Publishing (songwriter) splits registry (Stack-100 #3 Wave 3, #22) ──
   The SONGWRITING side of a song, as distinct from the master/recording
   side held in distribution_royalty_splits: who wrote what share of the
   underlying composition. Creators register per-song writer splits here;
   writers who are on the platform can confirm or dispute their share.

   This is a RECORDS layer only. Royalty collection needs a publishing
   administration partner, which is not connected — a registration here
   collects nothing and pays nobody. The UI/API copy says so plainly:
   "Registered — collection activates when publishing administration
   is connected."

   *** MIGRATION HELD *** These tables are created by the held migration
   in the lane's .lane/MIGRATION-NEEDED.md (number unclaimed — sibling
   lanes hold 0205/0206; the integrator renumbers at join). Until it
   lands, write routes probe-first and answer 503, and reads degrade
   to "no registrations yet" — nothing is faked.

   A song is anchored to ONE of the creator's existing items:
   song_kind 'release' → distribution_releases.id, or 'song' →
   songs.id. song_id carries no FK on purpose (it points at one of two
   tables); the route validates ownership against the correct table at
   registration time and song_title is snapshotted so the registry
   survives the item being renamed or deleted.
   Shares are creator-entered percentages; the per-row CHECK guards
   range only — the sum-to-100 rule spans rows, so it is enforced in
   the API machine (lib/publishing-splits.ts), exactly like
   distribution_royalty_splits. NO rate, fee, or default share is
   invented anywhere in this feature. */

export const PUBLISHING_SONG_KINDS = ["release", "song"] as const;
export type PublishingSongKind = (typeof PUBLISHING_SONG_KINDS)[number];

export const PUBLISHING_WRITER_STATUSES = ["pending", "confirmed", "disputed", "unlinked"] as const;
export type PublishingWriterStatus = (typeof PUBLISHING_WRITER_STATUSES)[number];

export const publishingSplitRegistrationsTable = pgTable(
  "publishing_split_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner_user_id: uuid("owner_user_id").notNull(),
    song_kind: text("song_kind").notNull().default("release"),
    song_id: uuid("song_id").notNull(),
    song_title: text("song_title").notNull().default(""),
    /* Set whenever any linked writer disputes; cleared only when no
       writer remains in 'disputed' (confirming resolves a dispute).
       A dispute NEVER rewrites a share — it flags the record. */
    has_dispute: boolean("has_dispute").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("publishing_split_registrations_owner_idx").on(t.owner_user_id),
    index("publishing_split_registrations_song_idx").on(t.song_kind, t.song_id),
  ],
);

export const publishingSplitWritersTable = pgTable(
  "publishing_split_writers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registration_id: uuid("registration_id")
      .notNull()
      .references(() => publishingSplitRegistrationsTable.id, { onDelete: "cascade" }),
    writer_name: text("writer_name").notNull(),
    /* On-platform link, when the writer has a Bow Down account. Both
       null = an off-platform writer: recorded by name, can never
       confirm/dispute (status 'unlinked'). */
    writer_user_id: uuid("writer_user_id"),
    writer_profile_id: uuid("writer_profile_id"),
    share_pct: numeric("share_pct", { precision: 5, scale: 2 }).notNull(),
    confirmation_status: text("confirmation_status").notNull().default("pending"),
    dispute_note: text("dispute_note"),
    confirmed_at: timestamp("confirmed_at", { withTimezone: true }),
    disputed_at: timestamp("disputed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("publishing_split_writers_registration_idx").on(t.registration_id),
    index("publishing_split_writers_user_idx").on(t.writer_user_id),
  ],
);

export const insertPublishingSplitRegistrationSchema = createInsertSchema(
  publishingSplitRegistrationsTable,
).omit({ id: true, created_at: true, updated_at: true });
export type InsertPublishingSplitRegistration = z.infer<typeof insertPublishingSplitRegistrationSchema>;
export type PublishingSplitRegistration = typeof publishingSplitRegistrationsTable.$inferSelect;

export const insertPublishingSplitWriterSchema = createInsertSchema(publishingSplitWritersTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertPublishingSplitWriter = z.infer<typeof insertPublishingSplitWriterSchema>;
export type PublishingSplitWriter = typeof publishingSplitWritersTable.$inferSelect;
