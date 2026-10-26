import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";

/* ─── Public Results Wall (Stack-200, dedupe audit #177 — TRULY NEW) ─────
   A public wall of creator OUTCOMES docked in the Promote flow. This is
   NOT Showcase (a gallery of work), NOT Social Proof (a creator's own
   connected-account figures on their own profile) and NOT Winners'
   Circle (contest wins).

   HONESTY LAW — the whole feature stands on it:
   - Every event on the wall is DERIVED from the platform's own records
     (digital_sales, follows, the credit_usage ledger, play_events chart
     computation). There is NO user-input path that creates an event:
     creators cannot submit, type, estimate or project a number.
   - An event is a REAL moment: `occurredAt` is the timestamp of the
     underlying record that crossed the line (the Nth sale's created_at,
     the Nth follow's created_at, the ledger row that pushed cumulative
     VB earned past the threshold, the chart computation time).
   - Earnings are stated in Visual Bucs ONLY, summed from the strict
     credit_usage ledger (grants are negative creditsUsed rows — the
     platform's own grant convention). Never cash, never a conversion.
   - OPT-IN: `results_wall_prefs.opted_in` defaults FALSE. Nothing about
     a creator appears on the public wall until they turn it on, and
     turning it off (or hiding a kind) removes them at read time — the
     public query filters on prefs, so revocation is instant.
   - The unique (profile_id, kind, threshold) index makes re-scans
     idempotent: a milestone can be recorded exactly once, never duped.

   Provisional migration: lib/db/migrations/9999-results-wall.sql
   (number assigned at join). */

export const RESULTS_WALL_KINDS = [
  "first_sale",
  "sales",
  "followers",
  "vb_earned",
  "chart_placement",
] as const;
export type ResultsWallKind = (typeof RESULTS_WALL_KINDS)[number];

/** Completed-sale count milestones (digital_sales, status='completed'). */
export const RESULTS_WALL_SALES_THRESHOLDS = [10, 25, 50, 100, 250, 500, 1000] as const;
/** On-platform follower milestones (follows table count). */
export const RESULTS_WALL_FOLLOWER_THRESHOLDS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
/** Cumulative Visual Bucs earned milestones (credit_usage ledger grants). */
export const RESULTS_WALL_VB_THRESHOLDS = [100, 500, 1000, 5000, 10000, 50000, 100000] as const;
/** A weekly-chart placement counts when a creator's best track lands in
 *  the Top 50 of the platform's own play_events chart (7-day window). */
export const RESULTS_WALL_CHART_CUTOFF = 50;

export interface ResultsWallEventDetail {
  /** The platform table / computation the number was verified against. */
  source: "digital_sales" | "follows" | "credit_usage" | "play_events_chart";
  /** Chart placements only: the chart window the rank was computed over. */
  window?: string;
  /** Chart placements only: the track the placement belongs to. */
  trackTitle?: string;
}

export const resultsWallPrefsTable = pgTable("results_wall_prefs", {
  userId:        uuid("user_id").primaryKey(),
  profileId:     uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  /** The master opt-in. Default FALSE — the wall is opt-in, period. */
  optedIn:       boolean("opted_in").notNull().default(false),
  /** Per-kind off switch: a hidden kind shows nowhere, for anyone. */
  hiddenKinds:   jsonb("hidden_kinds").$type<string[]>().notNull().default([]),
  /** Last derivation scan — drives the stale-scan cadence. */
  lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("results_wall_prefs_profile_idx").on(t.profileId),
]);

export const insertResultsWallPrefsSchema = createInsertSchema(resultsWallPrefsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertResultsWallPrefs = z.infer<typeof insertResultsWallPrefsSchema>;
export type ResultsWallPrefs = typeof resultsWallPrefsTable.$inferSelect;

export const resultsWallEventsTable = pgTable("results_wall_events", {
  id:         uuid("id").primaryKey().defaultRandom(),
  userId:     uuid("user_id").notNull(),
  profileId:  uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  kind:       text("kind").notNull().$type<ResultsWallKind>(),
  /** The line that was crossed (sale count, follower count, VB total).
   *  For chart_placement this is the rank achieved (lower = better). */
  threshold:  integer("threshold").notNull(),
  /** The verified value at the moment of crossing (== threshold for
   *  count/VB kinds; for chart_placement, the rank). */
  value:      integer("value").notNull(),
  detail:     jsonb("detail").$type<ResultsWallEventDetail>().notNull().default({ source: "follows" }),
  /** The REAL moment the underlying record crossed the line. */
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  /** When the derivation scan verified + recorded this event. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("results_wall_events_kind_check", sql`${t.kind} IN ('first_sale', 'sales', 'followers', 'vb_earned', 'chart_placement')`),
  uniqueIndex("results_wall_events_unique_idx").on(t.profileId, t.kind, t.threshold),
  index("results_wall_events_wall_idx").on(t.occurredAt),
  index("results_wall_events_profile_idx").on(t.profileId, t.occurredAt),
]);

export const insertResultsWallEventSchema = createInsertSchema(resultsWallEventsTable).omit({
  id: true,
  createdAt: true,
  verifiedAt: true,
});
export type InsertResultsWallEvent = z.infer<typeof insertResultsWallEventSchema>;
export type ResultsWallEvent = typeof resultsWallEventsTable.$inferSelect;
