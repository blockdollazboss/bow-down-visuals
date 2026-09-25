import { pgTable, uuid, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Fan Contests (v1).
   Creators run giveaways/contests: prize, rules, entry methods (follow,
   comment, share, purchase), entry tracking, a provably-fair winner draw
   (seeded random + audit log), and an AI winner-announcement graphic.

   Money model: contests are free to run (pure interface — building the
   contest, tracking entries, and drawing the winner burn no compute).
   Only the AI announcement graphic charges (1 credit, on success).

   Provably-fair draw: entries are sorted deterministically by id, the seed
   is sha256(contestId | sorted entry ids | drawnAt ISO), and a mulberry32
   PRNG picks the winner index. The full audit payload is stored on the
   contest row so anyone can re-run the draw and verify the winner. */

export const contestsTable = pgTable(
  "contests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    title: text("title").notNull(),
    prize: text("prize").notNull(),
    description: text("description").notNull().default(""),
    rules: text("rules").notNull().default(""),
    /* Array of entry-method keys, e.g. ["follow","comment","share","purchase"]. */
    entry_methods: jsonb("entry_methods").notNull().default([]),
    starts_at: timestamp("starts_at", { withTimezone: true }),
    ends_at: timestamp("ends_at", { withTimezone: true }),
    /* draft | active | ended */
    status: text("status").notNull().default("draft"),
    winner_entry_id: uuid("winner_entry_id"),
    /* Provably-fair draw audit: { algorithm, seed, entryCount, entryIds,
       winnerEntryId, winnerIndex, drawnAt, drawnBy }. NULL until drawn. */
    draw_audit: jsonb("draw_audit"),
    announcement_image_url: text("announcement_image_url"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contests_user_id_idx").on(t.user_id)],
);

export const contestEntriesTable = pgTable(
  "contest_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contest_id: uuid("contest_id").notNull(),
    /* Entrant display handle (e.g. "@sharkfan" or an email). */
    handle: text("handle").notNull(),
    email: text("email"),
    /* One of: follow | comment | share | purchase */
    entry_method: text("entry_method").notNull(),
    /* Fraud prevention: the creator verifies each entry (proof reviewed). */
    is_verified: boolean("is_verified").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contest_entries_contest_id_idx").on(t.contest_id),
    index("contest_entries_handle_idx").on(t.handle),
  ],
);

export const insertContestSchema = createInsertSchema(contestsTable).omit({
  id: true,
  winner_entry_id: true,
  draw_audit: true,
  announcement_image_url: true,
  created_at: true,
  updated_at: true,
});
export type InsertContest = z.infer<typeof insertContestSchema>;
export type Contest = typeof contestsTable.$inferSelect;

export const insertContestEntrySchema = createInsertSchema(contestEntriesTable).omit({
  id: true,
  is_verified: true,
  created_at: true,
});
export type InsertContestEntry = z.infer<typeof insertContestEntrySchema>;
export type ContestEntry = typeof contestEntriesTable.$inferSelect;
