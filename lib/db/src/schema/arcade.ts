import { pgTable, uuid, text, integer, timestamp, index, jsonb } from "drizzle-orm/pg-core";

/** Arcade scores — one row per finished run (Shark King Endless
 *  Runner / Royal Skeet / Crownfall Run; the Skeet replaced the
 *  Shooter Gallery in the games upgrade and Crownfall Run joined as
 *  the third house game, same text column, no migration). Status and
 *  leaderboards only: rewards are paid exclusively through the Shark
 *  Drop rail (shark_drops), never from this table. Indexes live in
 *  migration 0140. */
export const arcadeScoresTable = pgTable("arcade_scores", {
  id:         uuid("id").primaryKey().defaultRandom(),
  userId:     uuid("user_id").notNull(),
  game:       text("game").notNull(), // "runner" | "skeet" | "crownfall"
  score:      integer("score").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("arcade_scores_game_score_idx").on(t.game, t.score),
  index("arcade_scores_user_game_idx").on(t.userId, t.game),
]);

/** Crownfall Run — per-member prestige meta (migration 0336). One row
 *  per member: their prestige tier, lifetime kills / boss kills, best
 *  depth, earned achievement ids, and the last day the Royal Bounty
 *  was claimed. This is the server home the client's storage adapter
 *  (FE lib/crownfall-meta.ts) syncs against; the route merges
 *  monotonically, so a stale device can never roll progress back.
 *  Prestige is power + status only — it never touches a score row
 *  and never touches Visual Bucs. */
export const crownfallMetaTable = pgTable("crownfall_meta", {
  userId:            uuid("user_id").primaryKey(),
  tier:              integer("tier").notNull().default(0),
  lifetimeKills:     integer("lifetime_kills").notNull().default(0),
  lifetimeBossKills: integer("lifetime_boss_kills").notNull().default(0),
  bestDepth:         integer("best_depth").notNull().default(0),
  achievements:      jsonb("achievements").$type<string[]>().notNull().default([]),
  lastBountyDay:     text("last_bounty_day").notNull().default(""),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
