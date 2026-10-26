import { pgTable, uuid, boolean, timestamp } from "drizzle-orm/pg-core";

/** Charts Radio listener preference (Stack-200 #156, provisional
 *  migration 9999-charts-radio). One row per account; no row = the
 *  default the reader returns: NOT tuned in.
 *
 *  The station is a place the listener CHOOSES to hear — this row
 *  only remembers that choice so the Charts page and the World
 *  plaza panel can say "you tuned in last time — press play to
 *  resume". It NEVER authorizes autoplay-with-sound: playback
 *  starts only on an explicit press, on every surface, every time
 *  (the smart-law rule the FE lib pins as shouldStartOnLoad=false). */
export const chartsRadioPrefsTable = pgTable("charts_radio_prefs", {
  userId:    uuid("user_id").primaryKey(),
  tunedIn:   boolean("tuned_in").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type ChartsRadioPrefs = typeof chartsRadioPrefsTable.$inferSelect;
