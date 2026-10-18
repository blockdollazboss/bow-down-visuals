import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * World Contests + the Winners' Circle (UPGRADE-PROGRAM 2.24,
 * migration 0158) — the palace's standing competitions.
 *
 * A contest is not its own calendar: it is a world_events row of
 * kind 'contest' (the events backbone carries the booking, the
 * public slate and the scheduler's live/done flips). The event's
 * [starts_at, ends_at) window IS the entry window — entries open
 * when the contest is announced (starts_at = creation) and the
 * deadline is ends_at. The payload carries { theme }.
 *
 * These two tables carry what an event row can't:
 *  - world_contest_entries — one member's one entered work.
 *    UNIQUE(event_id, user_id) is the one-entry rule, enforced by
 *    the table, not by politeness. The work itself stays in
 *    profile_tracks / profile_videos (work_kind + work_id point at
 *    it); ownership and published state are re-verified against
 *    those tables at entry time, server-side.
 *  - world_contest_winners — the honor, frozen at decision time.
 *    The winner's name and the work's title are SNAPSHOT onto the
 *    row (court records freeze what was honored — the same rule
 *    the season settlements follow), so a later rename never
 *    rewrites history. UNIQUE(event_id, entry_id) and
 *    UNIQUE(event_id, place) keep a contest's podium exactly one
 *    row deep. No Visual Bucs move for a win in v1 — the honor IS
 *    the prize, and this table is the court record it lives on
 *    (built to dock onto the season marks wall at integration).
 *
 * FK-free like world_events.host_user_id: a contest outlives
 * nothing — it is decided or called off, never orphaned — and a
 * deleted account must not block the record.
 */
export const worldContestEntriesTable = pgTable(
  "world_contest_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    userId: uuid("user_id").notNull(),
    /** 'track' (profile_tracks) | 'video' (profile_videos). */
    workKind: text("work_kind").notNull(),
    workId: uuid("work_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("world_contest_entries_one_per_member_uq").on(table.eventId, table.userId),
    index("world_contest_entries_event_idx").on(table.eventId),
    check(
      "world_contest_entries_kind_check",
      sql`${table.workKind} IN ('track', 'video')`,
    ),
  ],
);

export type WorldContestEntry = typeof worldContestEntriesTable.$inferSelect;
export type NewWorldContestEntry = typeof worldContestEntriesTable.$inferInsert;

/** The podium's size: first, second, third — no deeper. */
export const CONTEST_MAX_PLACES = 3;

export const worldContestWinnersTable = pgTable(
  "world_contest_winners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    userId: uuid("user_id").notNull(),
    /** 1 = first place … CONTEST_MAX_PLACES. */
    place: integer("place").notNull(),
    /** Snapshot: the winner's display name when the honor landed. */
    winnerName: text("winner_name").notNull(),
    workKind: text("work_kind").notNull(),
    workId: uuid("work_id").notNull(),
    /** Snapshot: the honored work's title when the honor landed. */
    workTitle: text("work_title").notNull(),
    /** Who named the winners: the contest's host or a house admin. */
    decidedBy: uuid("decided_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("world_contest_winners_entry_uq").on(table.entryId),
    uniqueIndex("world_contest_winners_place_uq").on(table.eventId, table.place),
    index("world_contest_winners_event_idx").on(table.eventId),
    index("world_contest_winners_created_idx").on(table.createdAt),
    check(
      "world_contest_winners_place_check",
      sql`${table.place} >= 1 AND ${table.place} <= ${CONTEST_MAX_PLACES}`,
    ),
    check(
      "world_contest_winners_kind_check",
      sql`${table.workKind} IN ('track', 'video')`,
    ),
  ],
);

export type WorldContestWinner = typeof worldContestWinnersTable.$inferSelect;
export type NewWorldContestWinner = typeof worldContestWinnersTable.$inferInsert;
