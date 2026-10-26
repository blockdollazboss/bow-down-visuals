import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";
import { liveStreamsTable } from "./live-streams";

/* Live Battles (Stack-200 TRULY NEW #154) — migration 9999 (provisional
   number, assigned at join).

   Two creators go head-to-head LIVE inside the existing live surfaces:
   a challenge/accept flow, one drawn theme, timed rounds on a host
   live_streams broadcast, and audience voting. A battle row is the
   durable record BOTH creators keep — the result (winner or tie, the
   final tally, the theme, the window) is stamped onto it at finish
   and never rewritten.

   VOTES ARE RECORDED INTERACTIONS ONLY: one live_battle_votes row =
   one signed-in fan's one voice (UNIQUE battle+voter). The tally is
   always a COUNT of those rows — nothing else feeds it. Tips never
   count as votes (no bought votes): stream tips keep moving on the
   existing live-tips rail, untouched by this feature.

   NO PRICES: nothing here charges, prices or pays out. The winner
   takes the Charts-page crown slot (a display honour read from the
   most recent completed battle) and a World palace announcement —
   both honours, never money. */

export const LIVE_BATTLE_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "live",
  "completed",
  "voided",
] as const;
export type LiveBattleStatus = (typeof LIVE_BATTLE_STATUSES)[number];

export const LIVE_BATTLE_SIDES = ["challenger", "opponent"] as const;
export type LiveBattleSide = (typeof LIVE_BATTLE_SIDES)[number];

export const liveBattlesTable = pgTable(
  "live_battles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challenger_user_id: uuid("challenger_user_id").notNull(),
    challenger_profile_id: uuid("challenger_profile_id")
      .notNull()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    opponent_user_id: uuid("opponent_user_id").notNull(),
    opponent_profile_id: uuid("opponent_profile_id")
      .notNull()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    /* The host broadcast the battle docks into, set at start. The
       battle never creates a stream of its own — it rides the
       existing live_streams rail (either participant's live stream). */
    stream_id: uuid("stream_id").references(() => liveStreamsTable.id, {
      onDelete: "set null",
    }),
    /* The one theme, drawn server-side at challenge creation from
       the house list (lib/live-battles BATTLE_THEMES) so both
       creators prepare for the same theme. */
    theme: text("theme").notNull(),
    /* 'pending' | 'accepted' | 'declined' | 'cancelled' | 'live' |
       'completed' | 'voided' (severed — e.g. a block landed) */
    status: text("status").notNull().default("pending"),
    round_count: integer("round_count").notNull().default(3),
    round_seconds: integer("round_seconds").notNull().default(90),
    starts_at: timestamp("starts_at", { withTimezone: true }),
    ends_at: timestamp("ends_at", { withTimezone: true }),
    /* Stamped once at finish, from the recorded vote rows. */
    winner_user_id: uuid("winner_user_id"),
    /* 'challenger' | 'opponent' | 'tie' — null until completed. */
    result: text("result"),
    challenger_votes: integer("challenger_votes"),
    opponent_votes: integer("opponent_votes"),
    void_reason: text("void_reason"),
    /* When the World palace announcement for the win was spoken. */
    spectacle_announced_at: timestamp("spectacle_announced_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("live_battles_challenger_idx").on(t.challenger_user_id, t.created_at.desc()),
    index("live_battles_opponent_idx").on(t.opponent_user_id, t.created_at.desc()),
    index("live_battles_status_created_idx").on(t.status, t.created_at.desc()),
    index("live_battles_stream_idx").on(t.stream_id),
  ],
);

export const liveBattleVotesTable = pgTable(
  "live_battle_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    battle_id: uuid("battle_id")
      .notNull()
      .references(() => liveBattlesTable.id, { onDelete: "cascade" }),
    voter_user_id: uuid("voter_user_id").notNull(),
    /* 'challenger' | 'opponent' */
    side: text("side").notNull(),
    /* The timed round the vote landed in (1..round_count), stamped
       from the battle window at cast time. */
    round_number: integer("round_number").notNull().default(1),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* One voice per real fan per battle — structural, not a check
       that can be raced past. A fan may MOVE their voice to the
       other side while the battle is live (the row updates); they
       can never hold two. */
    uniqueIndex("live_battle_votes_battle_voter_uniq").on(t.battle_id, t.voter_user_id),
    index("live_battle_votes_battle_idx").on(t.battle_id, t.side),
  ],
);

export const insertLiveBattleSchema = createInsertSchema(liveBattlesTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertLiveBattle = z.infer<typeof insertLiveBattleSchema>;
export type LiveBattle = typeof liveBattlesTable.$inferSelect;
export type LiveBattleVote = typeof liveBattleVotesTable.$inferSelect;
