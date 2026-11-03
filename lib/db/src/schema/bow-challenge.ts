import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/* Global Bow Race: one site-wide monthly counter. Every signed-in user's
   bows feed the current month's row; each month draws a random target of
   1000-5000 bows. Whoever's bow lands exactly on the target wins the
   credit reward (default 50) — exactly one winner per month, then the
   counter freezes. The race is NEVER announced in the UI — only the
   winner's client learns it won, and only /admin sees the counter,
   target, and winner. A new month starts a new race automatically.
   See migrations/0039_global_bow_race.sql — the schema here must stay
   in sync with it. */


export const bowRaceMonthsTable = pgTable(
  "bow_race_months",
  {
    /* YYYY-MM, e.g. '2026-10' */
    period: text("period").primaryKey(),
    target: integer("target").notNull(),
    totalBows: integer("total_bows").notNull().default(0),
    winnerUserId: uuid("winner_user_id"),
    winnerEmail: text("winner_email"),
    wonAt: timestamp("won_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bow_race_months_winner_idx")
      .on(t.winnerUserId)
      .where(sql`winner_user_id IS NOT NULL`),
  ],
);

/* SUPERSEDED by the global race (0039): the per-user monthly milestone no
   longer exists. Table kept for history; nothing writes to it anymore. */
