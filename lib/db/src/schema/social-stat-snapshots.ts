import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Periodic follower/media-count snapshots per connected social account, so
   the /analytics page can draw follower-growth sparklines after a few
   refreshes. Written by GET /api/analytics/overview (best-effort — a failed
   snapshot insert never fails the overview request). Mirrors
   migrations/0008_social_stat_snapshots.sql. */
export const socialStatSnapshotsTable = pgTable(
  "social_stat_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    platform: text("platform").notNull(),
    account_id: uuid("account_id"),
    followers: integer("followers"),
    media_count: integer("media_count"),
    recorded_at: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("social_stat_snapshots_user_platform_idx").on(t.user_id, t.platform, t.recorded_at)],
);

export const insertSocialStatSnapshotSchema = createInsertSchema(socialStatSnapshotsTable).omit({
  id: true,
  recorded_at: true,
});
export type InsertSocialStatSnapshot = z.infer<typeof insertSocialStatSnapshotSchema>;
export type SocialStatSnapshot = typeof socialStatSnapshotsTable.$inferSelect;
