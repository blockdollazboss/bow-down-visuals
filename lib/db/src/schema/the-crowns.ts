import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * The Crowns (provisional migration 0283_the_crowns) — N8, the
 * yearly house awards, an UPGRADE of the World court seasons
 * (lib/world-court-season), the Winners' Circle
 * (lib/world-contests) and the Challenges Hall of Fame.
 *
 * Where a court season settles ONE month of World-scoped standing,
 * The Crowns roll up a whole UTC calendar YEAR of platform records
 * — the site's and the World's together, because the underlying
 * counts are lib/creator-rank's own sources (published works,
 * exports, followers, streams, tips, sales, memberships), windowed
 * to the year. Real numbers decide: no votes, no estimates, no
 * admin picks — every category's winner is the top of a
 * deterministic ranking over the platform's records, frozen at the
 * year's turn.
 *
 *   house_crown_years — one row per decided year.
 *     year (2026) is the primary key: the deciding is idempotent
 *     across restarts and twin ticks by construction — a re-run
 *     inserts nothing and heralds nothing. awards keeps the frozen
 *     per-category record (the published category, its winner, the
 *     deciding number, the frozen top of the category, and the
 *     instant the crown comes off); herald_text keeps the
 *     announcement the palace heard, so the record of what was
 *     said survives the year.
 *
 * Winners wear their crown on their profiles for the year after
 * the win (awards[].expiresAt) — the profile read is
 * GET /api/crowns (routes/the-crowns). Crowns are honor, not
 * money: no VB moves anywhere in this feature.
 */
export const houseCrownYearsTable = pgTable("house_crown_years", {
  year: integer("year").primaryKey(),
  crownKey: text("crown_key").notNull(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  awards: jsonb("awards").notNull().default([]),
  heraldText: text("herald_text").notNull().default(""),
});

export type HouseCrownYear = typeof houseCrownYearsTable.$inferSelect;
export type NewHouseCrownYear = typeof houseCrownYearsTable.$inferInsert;

/** One frozen placement inside a decided category. */
export interface CrownCategoryStanding {
  place: number;
  userId: string;
  displayName: string;
  slug: string;
  /** The category's deciding number (its published metric). */
  metric: number;
  /** The ladder's points over the same year — the tie-break truth. */
  points: number;
}

/** One decided category of a Crowns year. A category whose court
 *  scored zero all year carries winnerUserId null — an honest
 *  absence, never an invented winner. */
export interface CrownAward {
  category: string;
  categoryTitle: string;
  metricLabel: string;
  metricValue: number;
  winnerUserId: string | null;
  displayName: string;
  slug: string;
  /** The winner's lifetime earned rank at the deciding. */
  stars: number;
  title: string;
  /** When the winner's profile crown comes off (Jan 1 of year+2). */
  expiresAt: string;
  standings: CrownCategoryStanding[];
}
