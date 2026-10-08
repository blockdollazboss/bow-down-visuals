import { pgTable, uuid, text, jsonb, timestamp, boolean, numeric, integer } from "drizzle-orm/pg-core";

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
   per-row range.
   VERSIONING (migration 0078): editing splits never deletes history — the
   old agreement version is marked superseded and the new one becomes
   effective immediately, so changes apply to FUTURE earnings only
   (DistroKid behavior). The version effective on a money entry's date is
   the one applied to that income.
   invite_status is 'not_invited' | 'invited' | 'accepted'. Invite emails are
   a stub until an email provider is configured; the invite is always
   recorded in the ledger. */
export const SPLIT_INVITE_STATUSES = ["not_invited", "invited", "accepted"] as const;
export type SplitInviteStatus = (typeof SPLIT_INVITE_STATUSES)[number];

export const distributionRoyaltySplitsTable = pgTable("distribution_royalty_splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id").notNull(),
  userId: uuid("user_id").notNull(),
  payeeName: text("payee_name").notNull(),
  role: text("role"),
  sharePct: numeric("share_pct", { precision: 5, scale: 2 }).notNull(),
  payeeEmail: text("payee_email"),
  inviteStatus: text("invite_status").notNull().$type<SplitInviteStatus>().default("not_invited"),
  inviteToken: text("invite_token"),
  agreementVersion: integer("agreement_version").notNull().default(1),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DistributionRoyaltySplitRow = typeof distributionRoyaltySplitsTable.$inferSelect;

/* Release Metadata Manager (migration 0079) — DistroKid-parity columns:
   - upc_kind ('internal' | 'official'): generated barcodes are marked
     INTERNAL until a real UPC is assigned via a distribution partner.
   - label_imprint: custom label name / imprint.
   - copyright_c_line / copyright_p_line: © and ℗ lines.
   - subgenre alongside the primary genre column.
   - original_release_date + preorder_date.
   - territories_mode ('worldwide' | 'include' | 'exclude') + territories
     jsonb of ISO 3166-1 alpha-2 codes. */

export const distributionReleaseMetadataColumns = {
  upcKind: text("upc_kind").notNull().default("internal"),
  labelImprint: text("label_imprint"),
  copyrightCLine: text("copyright_c_line"),
  copyrightPLine: text("copyright_p_line"),
  subgenre: text("subgenre"),
  originalReleaseDate: text("original_release_date"),
  preorderDate: text("preorder_date"),
  territoriesMode: text("territories_mode").notNull().default("worldwide"),
  territories: jsonb("territories").notNull().$type<string[]>().default([]),
};
