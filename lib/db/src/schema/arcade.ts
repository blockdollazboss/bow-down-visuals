import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/** Arcade v1 scores — one row per finished run (Shark King Endless
 *  Runner / Shooter Gallery). Status and leaderboards only: rewards are
 *  paid exclusively through the Shark Drop rail (shark_drops), never
 *  from this table. Indexes live in migration 0140. */
export const arcadeScoresTable = pgTable("arcade_scores", {
  id:         uuid("id").primaryKey().defaultRandom(),
  userId:     uuid("user_id").notNull(),
  game:       text("game").notNull(), // "runner" | "gallery"
  score:      integer("score").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("arcade_scores_game_score_idx").on(t.game, t.score),
  index("arcade_scores_user_game_idx").on(t.userId, t.game),
]);
export type ArcadeScore = typeof arcadeScoresTable.$inferSelect;
