import { pgTable, uuid, text, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable, profileVideosTable } from "./creator-platform";

/**
 * Creator Streaming Platform — Shorts / TikTok mechanics (migration 0091).
 *
 * - profile_videos shorts columns live on profileVideosTable in creator-platform.ts
 *   (isShort, duetWith, stitchWith, soundId, soundTitle, soundUrl, soundUseCount).
 * - challenges: hashtag-driven challenges (TikTok-style).
 * - challenge_entries: many-to-many (challenge_id, video_id) join.
 */
export const challengesTable = pgTable("challenges", {
  id:               uuid("id").primaryKey().defaultRandom(),
  slug:             text("slug").notNull().unique(),
  title:            text("title").notNull(),
  description:      text("description").notNull().default(""),
  hashtag:          text("hashtag").notNull(),
  coverUrl:         text("cover_url"),
  creatorProfileId: uuid("creator_profile_id").references(() => creatorProfilesTable.id, { onDelete: "set null" }),
  /** Prize / earning hook — shown on the challenge page ("guide them to the money"). */
  prizeText:        text("prize_text").notNull().default(""),
  entryCount:       integer("entry_count").notNull().default(0),
  totalViews:       integer("total_views").notNull().default(0),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertChallengeSchema = createInsertSchema(challengesTable).omit({ id: true, createdAt: true });
export type InsertChallenge = z.infer<typeof insertChallengeSchema>;
export type Challenge = typeof challengesTable.$inferSelect;

export const challengeEntriesTable = pgTable("challenge_entries", {
  challengeId: uuid("challenge_id").notNull().references(() => challengesTable.id, { onDelete: "cascade" }),
  videoId:     uuid("video_id").notNull().references(() => profileVideosTable.id, { onDelete: "cascade" }),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.challengeId, t.videoId] })]);

export type ChallengeEntry = typeof challengeEntriesTable.$inferSelect;
