import { pgTable, uuid, boolean, timestamp } from "drizzle-orm/pg-core";

/** Per-account signature-sound switches (Stack-200 UPGRADES 183,
 *  migration 0242). One row per account; no row = the all-on default
 *  the lib reader returns. The site's single sound engine gates every
 *  play on these: master off = total silence, a kind off = that kind
 *  silent, and a device/browser mute outranks every switch.
 *
 *  successStingsEnabled governs two engine kinds — "success" and
 *  "sting" — because the owner's Settings control presents them as one
 *  "Success & stings" switch. errorsEnabled is its own switch so each
 *  of the six kinds has a gate. */
export const soundPrefsTable = pgTable("sound_prefs", {
  userId:                uuid("user_id").primaryKey(),
  masterEnabled:         boolean("master_enabled").notNull().default(true),
  notificationsEnabled:  boolean("notifications_enabled").notNull().default(true),
  messagesEnabled:       boolean("messages_enabled").notNull().default(true),
  successStingsEnabled:  boolean("success_stings_enabled").notNull().default(true),
  errorsEnabled:         boolean("errors_enabled").notNull().default(true),
  ringtoneEnabled:       boolean("ringtone_enabled").notNull().default(true),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type SoundPrefs = typeof soundPrefsTable.$inferSelect;
