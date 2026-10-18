import { pgTable, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Court seasons (migration 0153) — World / THE-GAME Ring 4.
 *
 * A court season is one UTC calendar month on the palace calendar,
 * derived deterministically in the api-server's
 * lib/world-court-season (Season I = October 2026, the month the
 * palace game layer opened; seasons are named in sequence with a
 * courtly subtitle). During a season, court standing accumulates
 * from the earned-rank ladder's own business sources
 * (lib/creator-rank's countRankSources), windowed to the season's
 * span — the ladder's weights, caps and thresholds are never
 * forked, only its counts are windowed.
 *
 * At the season's turn, the SETTLING freezes the final standings
 * into this table and heralds the court through the palace
 * announce channel. The Season Marks Wall in the Royal Court
 * Chamber reads these rows: past seasons' standings as collectible
 * marks, public to everyone including guests (standings are
 * public spectacle per THE-GAME defaults — wins public, balances
 * private). Marks are honor, not money: no VB moves in a season.
 *
 *   court_season_settlements — one row per settled season.
 *     season_key ("2026-10") is the primary key: the settling is
 *     idempotent across restarts and twin ticks by construction —
 *     a re-run inserts nothing and heralds nothing. standings
 *     keeps the frozen top of the court; herald_text keeps the
 *     announcement the palace heard, so the record of what was
 *     said survives the season.
 */
export const courtSeasonSettlementsTable = pgTable(
  "court_season_settlements",
  {
    seasonKey: text("season_key").primaryKey(),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    subtitle: text("subtitle").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
    standings: jsonb("standings").notNull().default([]),
    heraldText: text("herald_text").notNull().default(""),
  },
  (t) => [index("court_season_settlements_ordinal_idx").on(t.ordinal)],
);

export type CourtSeasonSettlement = typeof courtSeasonSettlementsTable.$inferSelect;
export type NewCourtSeasonSettlement = typeof courtSeasonSettlementsTable.$inferInsert;

/** One frozen placement on a settled season's marks wall. */
export interface CourtSeasonStanding {
  place: number;
  userId: string;
  displayName: string;
  slug: string;
  /** Season points: the ladder's points over the season window. */
  points: number;
  /** The creator's earned rank (lifetime ladder) at the turn. */
  stars: number;
  title: string;
}
