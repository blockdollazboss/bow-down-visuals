import { pgTable, uuid, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Discovery feed preferences (migration 0191, Wave 3 #19).
 *
 * One row per member: the explicit user-facing on/off for For-You
 * personalization on GET /discovery/feed (owner law: every automated
 * behavior ships with an explicit user-facing on/off). No row = the
 * default, which is ON — but a member with no recorded engagement
 * signals still gets the untouched legacy feed (cold start), so the
 * default only matters once the member actually plays / likes /
 * saves / reacts / reposts.
 *
 * Owner-scoped by construction: the routes only ever read and write
 * the caller's own row (user_id is the primary key).
 */
export const feedPreferencesTable = pgTable("feed_preferences", {
  userId:        uuid("user_id").primaryKey(),
  forYouEnabled: boolean("for_you_enabled").notNull().default(true),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FeedPreferences = typeof feedPreferencesTable.$inferSelect;
