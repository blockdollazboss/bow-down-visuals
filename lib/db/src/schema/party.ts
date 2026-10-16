import { pgTable, uuid, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";

/** Party Games v1 (#7 owner's games pick) — one row per player per
 *  finished party match (Trivia rooms / Court Battle duels). Party rooms
 *  themselves are ephemeral socket state (lib/party-rooms.ts) and are
 *  never stored; only the RESULT of a finished match lands here, so the
 *  party leaderboard and a player's record survive the room.
 *
 *  Scores and wins ONLY: this table carries NO Visual Bucs and nothing
 *  in the party flow calls a credits function — wagering is a separate
 *  owner ruling that has not been made. Indexes live in migration 0141. */
export const partyMatchResultsTable = pgTable("party_match_results", {
  id:         uuid("id").primaryKey().defaultRandom(),
  roomCode:   text("room_code").notNull(),
  game:       text("game").notNull(), // "trivia" | "duel"
  userId:     uuid("user_id").notNull(),
  placement:  integer("placement").notNull(), // 1 = winner / top of the podium
  score:      integer("score").notNull(),
  roundsWon:  integer("rounds_won").notNull().default(0), // duel rounds won (0 for trivia)
  won:        boolean("won").notNull().default(false),
  playerCount: integer("player_count").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("party_match_results_user_idx").on(t.userId),
  index("party_match_results_user_game_idx").on(t.userId, t.game),
  index("party_match_results_room_idx").on(t.roomCode),
]);
export type PartyMatchResult = typeof partyMatchResultsTable.$inferSelect;
