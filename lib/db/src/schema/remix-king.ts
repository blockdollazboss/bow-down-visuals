import { pgTable, uuid, text, integer, timestamp, jsonb, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Remix the King (Stack-200 audit #152, TRULY NEW) — migration
 * 9999-remix-king.sql (PROVISIONAL number — the integrator renumbers
 * at join; do not treat 9999 as final).
 *
 * A MONTHLY HOUSE EVENT: the King (Thy Cheat Code, the house artist)
 * drops a track; members remix it; the winning remix becomes an
 * OFFICIAL RELEASE under splits published IN WRITING UP FRONT.
 *
 * Reuse, never rebuild: the event/entry/judging shape follows the
 * existing contest + Challenge Engine patterns, the release row links
 * to distribution_releases (the existing distribution rail), and
 * split payments run on the strict credit_usage ledger exactly like
 * Pitch & Fix rewards (claim -> grant -> strict ledger row, keyed).
 *
 * SPLITS LAW: splits are authored by the house when the event is
 * created and are FROZEN the moment the event leaves draft — entrants
 * see the exact written splits before they enter, and a winner is
 * never surprised after the fact. Shares sum to exactly 100
 * (validated in lib/remix-king.ts; per-row CHECK guards range only).
 * NO default split is invented in code: an event cannot be created
 * without explicit splits.
 *
 * MONEY: Visual Bucs ONLY, TEST MODE — no cash path exists. Split
 * payments are exactly-once: remix_king_split_payments carries a
 * UNIQUE idempotency_key and the credit_usage ledger row is keyed
 * `remix-king-split:<payment_id>`.
 */

export const REMIX_KING_EVENT_STATUSES = ["draft", "open", "judging", "decided", "released", "cancelled"] as const;
export type RemixKingEventStatus = (typeof REMIX_KING_EVENT_STATUSES)[number];

export const REMIX_KING_ENTRY_STATUSES = ["submitted", "shortlisted", "winner", "not_selected"] as const;
export type RemixKingEntryStatus = (typeof REMIX_KING_ENTRY_STATUSES)[number];

export const REMIX_KING_SPLIT_ROLES = ["winner", "king", "house"] as const;
export type RemixKingSplitRole = (typeof REMIX_KING_SPLIT_ROLES)[number];

export interface RemixKingSplit {
  role: RemixKingSplitRole;
  /** Display name written up front, e.g. "Winning remixer". Never a
   *  fabricated person — the winner role is named by role until a
   *  winner exists, then the release snapshots the winner's name. */
  payeeName: string;
  /** On-platform payee when known at creation (king/house). The
   *  winner's user id is bound at winner selection, not at creation. */
  payeeUserId: string | null;
  sharePct: number;
}

export const remixKingEventsTable = pgTable("remix_king_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** One house event per month: "2026-11". UNIQUE is the rule. */
  monthKey: text("month_key").notNull(),
  title: text("title").notNull(),
  kingTrackTitle: text("king_track_title").notNull(),
  kingTrackAudioUrl: text("king_track_audio_url"),
  kingTrackStemsUrl: text("king_track_stems_url"),
  description: text("description").notNull().default(""),
  /** The published-in-writing splits (frozen once not draft). */
  splits: jsonb("splits").$type<RemixKingSplit[]>().notNull().default([]),
  status: text("status").notNull().default("draft"),
  entriesOpenAt: timestamp("entries_open_at", { withTimezone: true }),
  entriesCloseAt: timestamp("entries_close_at", { withTimezone: true }),
  winnerEntryId: uuid("winner_entry_id"),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("remix_king_events_month_key_uidx").on(t.monthKey),
  check("remix_king_events_status_check", sql`${t.status} IN ('draft','open','judging','decided','released','cancelled')`),
  index("remix_king_events_status_idx").on(t.status, t.monthKey),
]);

export const remixKingEntriesTable = pgTable("remix_king_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => remixKingEventsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  entrantName: text("entrant_name").notNull().default("Creator"),
  remixTitle: text("remix_title").notNull(),
  audioUrl: text("audio_url").notNull(),
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("submitted"),
  voteCount: integer("vote_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("remix_king_entries_one_per_user_uidx").on(t.eventId, t.userId),
  check("remix_king_entries_status_check", sql`${t.status} IN ('submitted','shortlisted','winner','not_selected')`),
  index("remix_king_entries_event_idx").on(t.eventId, t.createdAt),
]);

export const remixKingVotesTable = pgTable("remix_king_votes", {
  entryId: uuid("entry_id").notNull().references(() => remixKingEntriesTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("remix_king_votes_unique_idx").on(t.entryId, t.userId),
  index("remix_king_votes_entry_idx").on(t.entryId),
]);

export const remixKingReleasesTable = pgTable("remix_king_releases", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** One official release per event — UNIQUE is the exactly-once rule. */
  eventId: uuid("event_id").notNull().references(() => remixKingEventsTable.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").notNull(),
  winnerUserId: uuid("winner_user_id").notNull(),
  winnerName: text("winner_name").notNull().default("Creator"),
  releaseTitle: text("release_title").notNull(),
  /** Frozen snapshot of the event's published splits, with the
   *  winner role bound to the winning member. Never rewritten. */
  splits: jsonb("splits").$type<RemixKingSplit[]>().notNull().default([]),
  /** Link into the existing distribution rail, when the package is
   *  prepared there. Null until then — never faked. */
  distributionReleaseId: uuid("distribution_release_id"),
  status: text("status").notNull().default("pending_release"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("remix_king_releases_event_uidx").on(t.eventId),
  check("remix_king_releases_status_check", sql`${t.status} IN ('pending_release','released')`),
]);

export const remixKingSplitPaymentsTable = pgTable("remix_king_split_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id").notNull().references(() => remixKingReleasesTable.id, { onDelete: "cascade" }),
  payeeUserId: uuid("payee_user_id"),
  payeeName: text("payee_name").notNull(),
  role: text("role").notNull(),
  sharePct: integer("share_pct").notNull(),
  /** Whole Visual Bucs (integer rail, like every site grant). */
  amountVb: integer("amount_vb").notNull(),
  /** The earnings period this payment distributes, e.g. "2026-12". */
  period: text("period").notNull(),
  /** pending -> paid (claim) — a replay never pays twice. */
  status: text("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("remix_king_split_payments_idem_uidx").on(t.idempotencyKey),
  check("remix_king_split_payments_status_check", sql`${t.status} IN ('pending','paid')`),
  index("remix_king_split_payments_release_idx").on(t.releaseId, t.period),
]);

export type RemixKingEvent = typeof remixKingEventsTable.$inferSelect;
export type RemixKingEntry = typeof remixKingEntriesTable.$inferSelect;
export type RemixKingRelease = typeof remixKingReleasesTable.$inferSelect;
export type RemixKingSplitPayment = typeof remixKingSplitPaymentsTable.$inferSelect;
