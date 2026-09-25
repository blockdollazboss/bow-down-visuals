import { pgTable, uuid, text, timestamp, numeric, date, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Royalty Tracker (v1).
   Creators track streaming earnings across platforms in one dashboard.
   v1 data sources:
   - Manual CSV import (the honest universal path — every distributor exports CSVs).
   - Connected platform accounts where a real API exists (marked clearly in UI).
   Integrations that don't exist yet are labeled "coming soon" — never faked.

   royalty_entries: one row per song × platform × reporting period.
   Amounts use NUMERIC (exact cents, never float).
   royalty_platform_connections: which platforms the user linked (OAuth or manual).
   royalty_payouts: expected vs received payouts from distributors. */

/* Platforms we know about. "manual" = CSV import bucket. Others get real
   connection flows only where an API exists; the UI marks the rest honestly. */
export const ROYALTY_PLATFORMS = [
  "spotify",
  "apple-music",
  "youtube",
  "tiktok",
  "amazon-music",
  "tidal",
  "deezer",
  "distrokid",
  "tunecore",
  "manual",
] as const;
export type RoyaltyPlatform = (typeof ROYALTY_PLATFORMS)[number];

export function isRoyaltyPlatform(v: unknown): v is RoyaltyPlatform {
  return typeof v === "string" && (ROYALTY_PLATFORMS as readonly string[]).includes(v);
}

export const ROYALTY_PLATFORM_LABELS: Record<RoyaltyPlatform, string> = {
  spotify: "Spotify",
  "apple-music": "Apple Music",
  youtube: "YouTube",
  tiktok: "TikTok",
  "amazon-music": "Amazon Music",
  tidal: "Tidal",
  deezer: "Deezer",
  distrokid: "DistroKid",
  tunecore: "TuneCore",
  manual: "Manual / CSV import",
};

export const royaltyEntriesTable = pgTable(
  "royalty_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    song_title: text("song_title").notNull(),
    artist_name: text("artist_name"),
    platform: text("platform").notNull(),
    /* Reporting period this entry covers (distributors report monthly). */
    period_start: date("period_start").notNull(),
    period_end: date("period_end").notNull(),
    streams: text("streams"),
    /* Exact money — NUMERIC, never float. Stored as decimal string. */
    gross_amount: numeric("gross_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    source: text("source").notNull().default("csv"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("royalty_entries_user_id_idx").on(t.user_id),
    index("royalty_entries_user_song_idx").on(t.user_id, t.song_title),
    index("royalty_entries_user_platform_idx").on(t.user_id, t.platform),
  ],
);

export const royaltyPlatformConnectionsTable = pgTable(
  "royalty_platform_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    platform: text("platform").notNull(),
    /* "oauth" | "manual" — how this connection feeds data. */
    connection_type: text("connection_type").notNull().default("manual"),
    account_label: text("account_label"),
    connected_at: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("royalty_platform_connections_user_id_idx").on(t.user_id),
  ],
);

export const royaltyPayoutsTable = pgTable(
  "royalty_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    distributor: text("distributor").notNull(),
    period_start: date("period_start").notNull(),
    period_end: date("period_end").notNull(),
    expected_amount: numeric("expected_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    received_amount: numeric("received_amount", { precision: 12, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("expected"),
    notes: text("notes"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("royalty_payouts_user_id_idx").on(t.user_id),
  ],
);

export const PAYOUT_STATUSES = ["expected", "received", "partial", "overdue"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export function isPayoutStatus(v: unknown): v is PayoutStatus {
  return typeof v === "string" && (PAYOUT_STATUSES as readonly string[]).includes(v);
}

export const insertRoyaltyEntrySchema = createInsertSchema(royaltyEntriesTable).omit({
  id: true,
  created_at: true,
});
export type InsertRoyaltyEntry = z.infer<typeof insertRoyaltyEntrySchema>;
export type RoyaltyEntry = typeof royaltyEntriesTable.$inferSelect;

export const insertRoyaltyPlatformConnectionSchema = createInsertSchema(
  royaltyPlatformConnectionsTable,
).omit({ id: true, connected_at: true });
export type InsertRoyaltyPlatformConnection = z.infer<typeof insertRoyaltyPlatformConnectionSchema>;
export type RoyaltyPlatformConnection = typeof royaltyPlatformConnectionsTable.$inferSelect;

export const insertRoyaltyPayoutSchema = createInsertSchema(royaltyPayoutsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertRoyaltyPayout = z.infer<typeof insertRoyaltyPayoutSchema>;
export type RoyaltyPayout = typeof royaltyPayoutsTable.$inferSelect;
