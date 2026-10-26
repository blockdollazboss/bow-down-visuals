import { pgTable, uuid, text, integer, timestamp, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Community Grants (Stack-200 N15, migration 9999-community-grants —
 * PROVISIONAL number, the integrator renumbers at join).
 *
 * A MONTHLY Visual Bucs pool funds ONE creator project, chosen by
 * COMMUNITY VOTE. Deliberately distinct from its neighbours:
 *  - NOT the jackpot (an admin-run code event),
 *  - NOT the quest pool (lib/quest-pool's ≤300 VB/week shared envelope
 *    for quests + King gifts + tutorial — this module never draws from
 *    it and never merges with it),
 *  - NOT contests (prize winners).
 *
 * The pool size is an ADMIN-ENTERED parameter recorded on the round at
 * creation — there is no hardcoded pool figure anywhere in this feature.
 * One round per month (month_key UNIQUE). Candidates are real projects
 * stated in the creator's own words (title + description, unedited by
 * the platform), one per creator per round, tied to their real account.
 *
 * Voting: signed-in members only, ONE vote row per member per round
 * (UNIQUE (round_id, voter_id)). Tallies are always fresh COUNTs of
 * vote rows — there is no cached counter column anywhere.
 *
 * Result: when the voting window closes an admin settles the round.
 * The candidate with the most real votes wins. A TIE declares NO
 * winner: the round records result_status = 'tie', nothing is paid,
 * and the pool HOLDS for admin resolution (the admin may extend the
 * voting window, which returns the round to 'pending' for a later
 * settle). No coin-flips, no invented winners.
 *
 * Payout: the pool pays to the winning creator in Visual Bucs EXACTLY
 * ONCE through the existing credits ledger rails (addCreditsAtomic +
 * a strict credit_usage row keyed `community-grant:<round_id>` — see
 * artifacts/api-server/src/lib/community-grants.ts). Visual Bucs ONLY:
 * no cash path exists or is implied anywhere in this feature.
 *
 * Report-back: the funded creator posts a report-back in their own
 * words on their candidate row; the public surface shows it, or shows
 * that a report-back is still owed. No deadline is invented here.
 */

export const GRANT_ROUND_RESULT_STATUSES = ["pending", "winner", "tie", "no_candidates"] as const;
export type GrantRoundResultStatus = (typeof GRANT_ROUND_RESULT_STATUSES)[number];

export const GRANT_PAY_STATUSES = ["none", "paid"] as const;
export type GrantPayStatus = (typeof GRANT_PAY_STATUSES)[number];

export const communityGrantRoundsTable = pgTable("community_grant_rounds", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  /** The monthly round key, 'YYYY-MM' — one round per month. */
  monthKey:            text("month_key").notNull(),
  /** Admin-entered pool size in Visual Bucs. Never a code constant. */
  poolVb:              integer("pool_vb").notNull(),
  submissionsOpenAt:   timestamp("submissions_open_at", { withTimezone: true }).notNull(),
  submissionsCloseAt:  timestamp("submissions_close_at", { withTimezone: true }).notNull(),
  votingOpenAt:        timestamp("voting_open_at", { withTimezone: true }).notNull(),
  votingCloseAt:       timestamp("voting_close_at", { withTimezone: true }).notNull(),
  resultStatus:        text("result_status").notNull().default("pending"),
  winnerCandidateId:   uuid("winner_candidate_id"),
  grantStatus:         text("grant_status").notNull().default("none"),
  grantPaidAt:         timestamp("grant_paid_at", { withTimezone: true }),
  settledAt:           timestamp("settled_at", { withTimezone: true }),
  createdByUserId:     uuid("created_by_user_id").notNull(),
  createdAt:           timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("community_grant_rounds_pool_check", sql`${t.poolVb} > 0`),
  check("community_grant_rounds_result_check", sql`${t.resultStatus} IN ('pending', 'winner', 'tie', 'no_candidates')`),
  check("community_grant_rounds_grant_check", sql`${t.grantStatus} IN ('none', 'paid')`),
  uniqueIndex("community_grant_rounds_month_uidx").on(t.monthKey),
  index("community_grant_rounds_created_idx").on(t.createdAt),
]);

export const communityGrantCandidatesTable = pgTable("community_grant_candidates", {
  id:             uuid("id").primaryKey().defaultRandom(),
  roundId:        uuid("round_id").notNull(),
  creatorUserId:  uuid("creator_user_id").notNull(),
  /** Display-name snapshot from the creator's real profile at filing. */
  creatorName:    text("creator_name").notNull().default("Creator"),
  /** The project in the creator's own words — never platform-edited. */
  title:          text("title").notNull(),
  description:    text("description").notNull().default(""),
  /** The funded creator's report-back, in their own words. Null until
   *  posted — the surface shows "still owed" honestly in that state. */
  reportBack:     text("report_back"),
  reportBackAt:   timestamp("report_back_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("community_grant_candidates_one_per_creator_uidx").on(t.roundId, t.creatorUserId),
  index("community_grant_candidates_round_idx").on(t.roundId, t.createdAt),
]);

export const communityGrantVotesTable = pgTable("community_grant_votes", {
  roundId:     uuid("round_id").notNull(),
  candidateId: uuid("candidate_id").notNull(),
  voterId:     uuid("voter_id").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  /* THE anti-fake rule: one vote row per member per round. A changed
     vote REPLACES the candidate on this same row — it can never
     become two rows, so it can never double-count. */
  uniqueIndex("community_grant_votes_one_per_voter_uidx").on(t.roundId, t.voterId),
  index("community_grant_votes_candidate_idx").on(t.candidateId),
]);
