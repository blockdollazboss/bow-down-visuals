import { pgTable, uuid, boolean, timestamp } from "drizzle-orm/pg-core";

/** "Your Month, Wrapped" opt-out (Stack-200, idea #170 — TRULY NEW).
 *  Provisional migration 9999-month-wrapped.sql.
 *
 *  The monthly recap itself is NOT stored: it is computed on read from
 *  the real source tables (play_events, follows, digital_sales,
 *  store_orders, profile_tracks, profile_videos), exactly one recap
 *  per creator per month by construction (the month is the key).
 *  The only state this feature needs is the creator's opt-out, so —
 *  following the sound_prefs / retention_prefs house pattern — one row
 *  per account, and NO row = enabled (the recap is on by default and
 *  the first PATCH creates the row). Sharing is never stored either:
 *  it happens only when the creator taps Share, client-side. */
export const monthWrappedPrefsTable = pgTable("month_wrapped_prefs", {
  userId:    uuid("user_id").primaryKey(),
  enabled:   boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type MonthWrappedPrefs = typeof monthWrappedPrefsTable.$inferSelect;
