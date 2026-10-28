import { pgTable, uuid, boolean, timestamp } from "drizzle-orm/pg-core";

/** Per-user device-push preferences (Stack500 push foundation,
 *  migration 0299). One row per user; no row = the defaults the
 *  owner's Settings control presents: money, messages, live and
 *  mentions ON; social OFF.
 *
 *  These switches gate the OS-level ping only. The in-app bell
 *  (notifications table) always lands its row regardless — a user
 *  who turns "social" off stops the buzz, never the record.
 *  The reader/writer lives in the API's lib/push-events.ts. */
export const pushNotificationPrefsTable = pgTable("push_notification_prefs", {
  userId:          uuid("user_id").primaryKey(),
  moneyEnabled:    boolean("money_enabled").notNull().default(true),
  messagesEnabled: boolean("messages_enabled").notNull().default(true),
  liveEnabled:     boolean("live_enabled").notNull().default(true),
  mentionsEnabled: boolean("mentions_enabled").notNull().default(true),
  socialEnabled:   boolean("social_enabled").notNull().default(false),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type PushNotificationPrefs = typeof pushNotificationPrefsTable.$inferSelect;
