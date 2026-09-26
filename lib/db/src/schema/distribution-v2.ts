import { pgTable, uuid, text, jsonb, timestamp, boolean, numeric } from "drizzle-orm/pg-core";

/* Music Distribution v2 — release tiers, full metadata, delivery tracking.
   Extends distribution-releases.ts (v1: prepare + track). v2 adds:
   - release_type (single | ep | album) → tiered pricing
   - full release metadata: ISRC, genre, explicit (+ explicit_declared —
     the creator must actively declare clean/explicit), UPC, label, copyright
   - song_id: optional link into the user's song library
   - tracks: [{ title, isrc? }] — release-level track listing metadata
   - aggregator ('none' | 'mock' | 'toolost') + aggregator_release_id:
     which delivery backend handled the release
   - platform_statuses: [{ platform, status, detail?, updatedAt }] —
     the ONLY source of truth for per-platform delivery state.
     Never fabricate these: they come from the aggregator adapter.
   - presave_slug: public pre-save landing link slug (unique, nullable) */

export const distributionReleaseV2Columns = {
  releaseType: text("release_type").notNull().default("single"),
  isrc: text("isrc"),
  genre: text("genre"),
  explicit: boolean("explicit").notNull().default(false),
  explicitDeclared: boolean("explicit_declared").notNull().default(false),
  upc: text("upc"),
  label: text("label"),
  copyrightLine: text("copyright_line"),
  songId: uuid("song_id"),
  tracks: jsonb("tracks").notNull().$type<Array<{ title: string; isrc?: string }>>().default([]),
  aggregator: text("aggregator").notNull().default("none"),
  aggregatorReleaseId: text("aggregator_release_id"),
  platformStatuses: jsonb("platform_statuses")
    .notNull()
    .$type<Array<{ platform: string; status: string; detail?: string; updatedAt: string }>>()
    .default([]),
  presaveSlug: text("presave_slug"),
};

/* Royalty splits: who gets paid what on a release. Shares are validated to
   sum to exactly 100 at the API layer; the CHECK constraint guards the
   per-row range. Splits are informational (payouts are a future integration). */
export const distributionRoyaltySplitsTable = pgTable("distribution_royalty_splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id").notNull(),
  userId: uuid("user_id").notNull(),
  payeeName: text("payee_name").notNull(),
  role: text("role"),
  sharePct: numeric("share_pct", { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DistributionRoyaltySplitRow = typeof distributionRoyaltySplitsTable.$inferSelect;
