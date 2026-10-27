import { pgTable, uuid, text, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { groupsTable } from "./community";

/**
 * Per-group activity digest (Stack-200 orphan wave, provisional
 * migration 9999-group-digest — renumbered at join).
 *
 * group_digest_prefs — one row per account: the user-facing on/off +
 * frequency for the periodic per-group activity digest (owner law:
 * every automated behavior ships with an explicit user-facing on/off).
 * No row = the default: digests ON, weekly, in-app bell only (email is
 * opt-in, default OFF — a digest nobody asked to receive by email is
 * spam). Owner-scoped by construction: routes only ever read/write the
 * caller's own row (user_id is the primary key), mirroring sound_prefs
 * (0242) / feed_preferences (0191).
 *
 * group_digest_deliveries — the exactly-once ledger. One row per
 * (user, group, period_end): the sweep claims a digest by inserting
 * its row FIRST (UNIQUE … ON CONFLICT DO NOTHING); only a won claim
 * creates the notification. period_end is the member's high-water
 * mark — the next digest aggregates everything since it, so a quiet
 * period sends nothing and loses nothing.
 */
export const GROUP_DIGEST_FREQUENCIES = ["daily", "weekly"] as const;
export type GroupDigestFrequency = (typeof GROUP_DIGEST_FREQUENCIES)[number];

export const groupDigestPrefsTable = pgTable("group_digest_prefs", {
  userId:        uuid("user_id").primaryKey(),
  enabled:       boolean("enabled").notNull().default(true),
  frequency:     text("frequency").notNull().default("weekly"),
  emailEnabled:  boolean("email_enabled").notNull().default(false),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GroupDigestPrefs = typeof groupDigestPrefsTable.$inferSelect;

export const groupDigestDeliveriesTable = pgTable("group_digest_deliveries", {
  id:          uuid("id").primaryKey().defaultRandom(),
  userId:      uuid("user_id").notNull(),
  groupId:     uuid("group_id").notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd:   timestamp("period_end", { withTimezone: true }).notNull(),
  /** Channels that ACTUALLY delivered: 'notification' or
   *  'notification+email'. Email is only recorded when the email rail
   *  confirmed the send — never on a skipped/failed send. */
  channels:    text("channels").notNull().default("notification"),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("group_digest_deliveries_user_group_period_uidx").on(t.userId, t.groupId, t.periodEnd),
  index("group_digest_deliveries_user_idx").on(t.userId, t.periodEnd),
]);

export type GroupDigestDelivery = typeof groupDigestDeliveriesTable.$inferSelect;
