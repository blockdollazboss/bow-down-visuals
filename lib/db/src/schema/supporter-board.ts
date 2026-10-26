import { pgTable, uuid, text, boolean, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

/**
 * Top-Supporter Recognition (Wave-4 #49 + N6 Front Row Boards delta,
 * provisional migration 9999-top-supporter).
 *
 * The board itself is DERIVED at read time from real ledgers only
 * (completed store/digital sales, paid live-shop sales, credited stage
 * tips, paid fan-club joins, active live tickets) — see
 * api-server lib/supporter-board.ts. Nothing about a supporter's rank
 * is ever stored, so the board can never drift from the money facts.
 *
 * These two tables hold only the two things that are NOT derivable:
 *  - supporter_board_settings: the creator's own controls — board
 *    on/off (off = the board is hidden everywhere, including the
 *    supporter's own standing) and the N6 perks text, in the creator's
 *    own plain words. No row = house defaults (board ON, no perks).
 *  - supporter_board_opt_outs: a fan's opt-out of ONE creator's public
 *    board. Opting out removes the fan's name + badge from that
 *    creator's board only; their support still counts in the creator's
 *    private Fan Graph. No row = not opted out.
 *
 * Recognition only: no Visual Bucs move through these tables, nothing
 * is charged, and the site pays nobody real money here.
 */
export const supporterBoardSettingsTable = pgTable("supporter_board_settings", {
  creatorUserId: uuid("creator_user_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  perksText: text("perks_text").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supporterBoardOptOutsTable = pgTable(
  "supporter_board_opt_outs",
  {
    creatorUserId: uuid("creator_user_id").notNull(),
    fanUserId: uuid("fan_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.creatorUserId, t.fanUserId] }),
    index("supporter_board_opt_outs_creator_idx").on(t.creatorUserId),
  ],
);

export type SupporterBoardSettingsRow = typeof supporterBoardSettingsTable.$inferSelect;
export type SupporterBoardOptOutRow = typeof supporterBoardOptOutsTable.$inferSelect;
