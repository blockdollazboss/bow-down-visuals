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
  /* Challenge engine 2.0 (migration 0102): lifecycle + prize pool. */
  /** upcoming | live | judging | winners — enforced by a DB check constraint. */
  status:           text("status").notNull().default("live"),
  startsAt:         timestamp("starts_at", { withTimezone: true }),
  endsAt:           timestamp("ends_at", { withTimezone: true }),
  judgingEndsAt:    timestamp("judging_ends_at", { withTimezone: true }),
  /** Sum of the configured prize pool, Visual Bucs (x100 convention). */
  prizePoolCredits: integer("prize_pool_credits").notNull().default(0),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertChallengeSchema = createInsertSchema(challengesTable).omit({ id: true, createdAt: true });
export type InsertChallenge = z.infer<typeof insertChallengeSchema>;
export type Challenge = typeof challengesTable.$inferSelect;

export const challengeEntriesTable = pgTable("challenge_entries", {
  challengeId: uuid("challenge_id").notNull().references(() => challengesTable.id, { onDelete: "cascade" }),
  videoId:     uuid("video_id").notNull().references(() => profileVideosTable.id, { onDelete: "cascade" }),
  /** Denormalized community vote count (migration 0102), kept in sync by the vote API. */
  voteCount:   integer("vote_count").notNull().default(0),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.challengeId, t.videoId] })]);

export type ChallengeEntry = typeof challengeEntriesTable.$inferSelect;

/* ── Challenge engine 2.0 (migration 0102) ────────────────────────────────
   Prize pools, community voting, winners' circle. Visual Bucs convention:
   prize credits are ALWAYS multiples of 100 (the x100 system). */

/** Prize pool rows: place → prize in Visual Bucs. UNIQUE(challenge_id, place)
    makes a place unpayable twice; the judge payout additionally claims the
    winner row with UPDATE ... WHERE paid_at IS NULL. */
export const challengePrizesTable = pgTable("challenge_prizes", {
  id:           uuid("id").primaryKey().defaultRandom(),
  challengeId:  uuid("challenge_id").notNull().references(() => challengesTable.id, { onDelete: "cascade" }),
  place:        integer("place").notNull(),
  prizeCredits: integer("prize_credits").notNull(),
  description:  text("description").notNull().default(""),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ChallengePrize = typeof challengePrizesTable.$inferSelect;

/** One vote per user per entry — enforced by UNIQUE(user_id, video_id). */
export const challengeVotesTable = pgTable("challenge_votes", {
  id:          uuid("id").primaryKey().defaultRandom(),
  challengeId: uuid("challenge_id").notNull().references(() => challengesTable.id, { onDelete: "cascade" }),
  videoId:     uuid("video_id").notNull().references(() => profileVideosTable.id, { onDelete: "cascade" }),
  userId:      uuid("user_id").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ChallengeVote = typeof challengeVotesTable.$inferSelect;

/** Announced winners. paid_at IS NULL until the prize is paid; the payout
    claims the row with UPDATE ... WHERE paid_at IS NULL so concurrent
    judge calls can never double-pay. */
export const challengeWinnersTable = pgTable("challenge_winners", {
  id:           uuid("id").primaryKey().defaultRandom(),
  challengeId:  uuid("challenge_id").notNull().references(() => challengesTable.id, { onDelete: "cascade" }),
  place:        integer("place").notNull(),
  videoId:      uuid("video_id").notNull().references(() => profileVideosTable.id, { onDelete: "cascade" }),
  profileId:    uuid("profile_id").references(() => creatorProfilesTable.id, { onDelete: "set null" }),
  userId:       uuid("user_id"),
  prizeCredits: integer("prize_credits").notNull().default(0),
  paidAt:       timestamp("paid_at", { withTimezone: true }),
  announcedAt:  timestamp("announced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ChallengeWinner = typeof challengeWinnersTable.$inferSelect;
