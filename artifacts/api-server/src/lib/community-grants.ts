/* ─── Community Grants (Stack-200 N15) ────────────────────────────────
   A MONTHLY Visual Bucs pool funds ONE creator project, chosen by
   COMMUNITY VOTE. Migration 9999-community-grants (PROVISIONAL number).

   NOT the jackpot (admin-run code event), NOT the quest pool
   (lib/quest-pool's ≤300 VB/week envelope — never drawn from here),
   NOT contests (prize winners). A separate, monthly, voted grant.

   Rules as built:
   - ROUNDS: one per month (month_key UNIQUE). An ADMIN opens a round
     and enters the pool size in Visual Bucs — pool_vb is recorded on
     the round; no pool figure exists anywhere in code or copy. Until
     an admin opens a round, the public surface honestly shows none.
     Submission + voting windows are round fields set at creation.
   - CANDIDATES: a creator submits THEIR OWN project in their own
     words (title + description, never platform-edited), tied to their
     real account. One project per creator per round (unique index).
   - VOTING: signed-in members only (routes enforce auth), ONE vote
     row per member per round — UNIQUE (round_id, voter_id). A member
     MAY change their vote while the window is open: the change
     REPLACES the candidate on the same single row (upsert), so a
     change can never double-count; they may also withdraw the row.
     Tallies are fresh COUNTs of vote rows on every read — no cached
     counter exists. Anti-fake = a real account + one row; no other
     signal is invented.
   - RESULT + PAYOUT: after the voting window closes, an admin settles
     the round. Most real votes wins. TIE ⇒ NO winner: the round
     records result_status='tie', nothing is paid, and the pool HOLDS
     for admin resolution — the admin may extend the voting window
     (PATCH), which returns a tied round to 'pending' for a later
     settle. A round with zero votes likewise declares no winner
     (recorded as a tie — no project earned the community's choice).
     The grant pays the pool to the winning creator in Visual Bucs
     EXACTLY ONCE on the referral/pitch-fix rail pattern:
       1. CLAIM — the round row flips (result pending + grant 'none')
          → winner recorded + grant 'paid' in ONE conditional update;
          a settle that loses the claim pays nothing.
       2. GRANT — addCreditsAtomic credits the winner's profile.
       3. LEDGER — a STRICT credit_usage row, creditsUsed NEGATIVE
          (the grant convention), keyed `community-grant:<round_id>`;
          the unique key makes any replay "already-recorded".
       4. FAILURE — claw back any credits that moved, release the
          claim, report failed_released; a later settle retries.
     Visual Bucs ONLY — no cash path exists anywhere in this feature.
   - REPORT-BACK: the funded creator posts a report-back in their own
     words on their candidate; the public surface shows it, or shows
     that one is still owed. No deadline is invented. */

import {
  db,
  communityGrantRoundsTable,
  communityGrantCandidatesTable,
  communityGrantVotesTable,
  creditUsageTable,
} from "@workspace/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { recordCreditUsageStrict } from "./payment-record";
import { isUniqueViolation, isUndefinedTable } from "./pg-errors";
import { logger } from "./logger";

export class CommunityGrantError extends Error {
  code:
    | "not_found"
    | "validation"
    | "round_exists"
    | "window_closed"
    | "window_not_open"
    | "already_submitted"
    | "not_votable"
    | "not_winner"
    | "not_ready";
  constructor(code: CommunityGrantError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/* ─── Wire shapes ──────────────────────────────────────────────────── */

export type GrantPhase = "upcoming" | "submissions" | "between" | "voting" | "closed";

export interface RoundWire {
  id: string;
  monthKey: string;
  /** Admin-entered pool size in Visual Bucs. */
  poolVb: number;
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  votingOpenAt: string;
  votingCloseAt: string;
  resultStatus: "pending" | "winner" | "tie" | "no_candidates";
  winnerCandidateId: string | null;
  grantStatus: "none" | "paid";
  grantPaidAt: string | null;
  settledAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface CandidateWire {
  id: string;
  roundId: string;
  creatorUserId: string;
  creatorName: string;
  /** The creator's own words — stored and shown unedited. */
  title: string;
  description: string;
  reportBack: string | null;
  reportBackAt: string | null;
  createdAt: string;
}

export interface CandidateWithVotes extends CandidateWire {
  /** Fresh COUNT of vote rows — computed on every read, never stored. */
  votes: number;
  isWinner: boolean;
  /** Whether the funded creator's report-back has landed. */
  reportBackOwed: boolean;
}

export interface RoundSurface {
  round: RoundWire;
  phase: GrantPhase;
  candidates: CandidateWithVotes[];
  totalVotes: number;
  /** The viewing member's current vote (null for guests / non-voters). */
  myVoteCandidateId: string | null;
}

export interface GrantsSurface {
  /** The current (most recently created) round, or null — the honest
   *  "no round is open right now" state. */
  current: RoundSurface | null;
  /** Earlier rounds with their results and report-backs. */
  past: RoundSurface[];
}

export function phaseOf(round: Pick<RoundWire, "submissionsOpenAt" | "submissionsCloseAt" | "votingOpenAt" | "votingCloseAt">, now: Date): GrantPhase {
  const t = now.getTime();
  if (t < Date.parse(round.submissionsOpenAt)) return "upcoming";
  if (t <= Date.parse(round.submissionsCloseAt)) return "submissions";
  if (t < Date.parse(round.votingOpenAt)) return "between";
  if (t <= Date.parse(round.votingCloseAt)) return "voting";
  return "closed";
}

/* ─── Storage seam (drizzle in production, in-memory in tests) ─────── */

export interface NewRoundRow {
  monthKey: string;
  poolVb: number;
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  votingOpenAt: string;
  votingCloseAt: string;
  createdByUserId: string;
}

export interface CommunityGrantStore {
  insertRound(input: NewRoundRow): Promise<RoundWire>;
  getRound(id: string): Promise<RoundWire | null>;
  getRoundByMonth(monthKey: string): Promise<RoundWire | null>;
  listRounds(): Promise<RoundWire[]>;
  updateRoundWindows(id: string, patch: Partial<Pick<RoundWire, "submissionsOpenAt" | "submissionsCloseAt" | "votingOpenAt" | "votingCloseAt">>): Promise<RoundWire | null>;
  /** Reopen a TIED round for admin resolution: back to 'pending'. */
  reopenTiedRound(id: string): Promise<boolean>;
  /** The settle claim for a decisive result: atomically record the
   *  winner + flip grant 'none' → 'paid' ONLY while the round is
   *  still result 'pending' and unpaid. False = already claimed. */
  claimGrant(id: string, winnerCandidateId: string, paidAt: string): Promise<boolean>;
  /** Release a claimed-but-unpaid grant (after a clawback). */
  releaseGrantClaim(id: string): Promise<void>;
  /** Record a no-payout result ('tie' | 'no_candidates') while the
   *  round is still 'pending'. False = already resolved. */
  markNoWinner(id: string, result: "tie" | "no_candidates", settledAt: string): Promise<boolean>;
  insertCandidate(input: { roundId: string; creatorUserId: string; creatorName: string; title: string; description: string }): Promise<CandidateWire>;
  listCandidates(roundId: string): Promise<CandidateWire[]>;
  getCandidate(id: string): Promise<CandidateWire | null>;
  setReportBack(candidateId: string, body: string, at: string): Promise<CandidateWire | null>;
  /** Insert or REPLACE the voter's single row for the round. */
  upsertVote(roundId: string, voterId: string, candidateId: string): Promise<void>;
  deleteVote(roundId: string, voterId: string): Promise<void>;
  getVote(roundId: string, voterId: string): Promise<string | null>;
  /** Fresh COUNT of vote rows per candidate — the only tally source. */
  tally(roundId: string): Promise<Map<string, number>>;
}

type RoundRow = typeof communityGrantRoundsTable.$inferSelect;
type CandidateRow = typeof communityGrantCandidatesTable.$inferSelect;

function roundToWire(r: RoundRow): RoundWire {
  return {
    id: r.id,
    monthKey: r.monthKey,
    poolVb: r.poolVb,
    submissionsOpenAt: r.submissionsOpenAt.toISOString(),
    submissionsCloseAt: r.submissionsCloseAt.toISOString(),
    votingOpenAt: r.votingOpenAt.toISOString(),
    votingCloseAt: r.votingCloseAt.toISOString(),
    resultStatus: r.resultStatus as RoundWire["resultStatus"],
    winnerCandidateId: r.winnerCandidateId,
    grantStatus: r.grantStatus as RoundWire["grantStatus"],
    grantPaidAt: r.grantPaidAt ? r.grantPaidAt.toISOString() : null,
    settledAt: r.settledAt ? r.settledAt.toISOString() : null,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt.toISOString(),
  };
}

function candidateToWire(r: CandidateRow): CandidateWire {
  return {
    id: r.id,
    roundId: r.roundId,
    creatorUserId: r.creatorUserId,
    creatorName: r.creatorName,
    title: r.title,
    description: r.description,
    reportBack: r.reportBack,
    reportBackAt: r.reportBackAt ? r.reportBackAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

export const drizzleCommunityGrantStore: CommunityGrantStore = {
  async insertRound(input) {
    const rows = await db.insert(communityGrantRoundsTable).values({
      monthKey: input.monthKey,
      poolVb: input.poolVb,
      submissionsOpenAt: new Date(input.submissionsOpenAt),
      submissionsCloseAt: new Date(input.submissionsCloseAt),
      votingOpenAt: new Date(input.votingOpenAt),
      votingCloseAt: new Date(input.votingCloseAt),
      createdByUserId: input.createdByUserId,
    }).returning();
    return roundToWire(rows[0]!);
  },
  async getRound(id) {
    const rows = await db.select().from(communityGrantRoundsTable).where(eq(communityGrantRoundsTable.id, id)).limit(1);
    return rows[0] ? roundToWire(rows[0]) : null;
  },
  async getRoundByMonth(monthKey) {
    const rows = await db.select().from(communityGrantRoundsTable).where(eq(communityGrantRoundsTable.monthKey, monthKey)).limit(1);
    return rows[0] ? roundToWire(rows[0]) : null;
  },
  async listRounds() {
    const rows = await db.select().from(communityGrantRoundsTable).orderBy(desc(communityGrantRoundsTable.createdAt));
    return rows.map(roundToWire);
  },
  async updateRoundWindows(id, patch) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.submissionsOpenAt !== undefined) set["submissionsOpenAt"] = new Date(patch.submissionsOpenAt);
    if (patch.submissionsCloseAt !== undefined) set["submissionsCloseAt"] = new Date(patch.submissionsCloseAt);
    if (patch.votingOpenAt !== undefined) set["votingOpenAt"] = new Date(patch.votingOpenAt);
    if (patch.votingCloseAt !== undefined) set["votingCloseAt"] = new Date(patch.votingCloseAt);
    const rows = await db.update(communityGrantRoundsTable).set(set).where(eq(communityGrantRoundsTable.id, id)).returning();
    return rows[0] ? roundToWire(rows[0]) : null;
  },
  async reopenTiedRound(id) {
    const rows = await db.update(communityGrantRoundsTable)
      .set({ resultStatus: "pending", settledAt: null, updatedAt: new Date() })
      .where(and(eq(communityGrantRoundsTable.id, id), eq(communityGrantRoundsTable.resultStatus, "tie")))
      .returning({ id: communityGrantRoundsTable.id });
    return rows.length > 0;
  },
  async claimGrant(id, winnerCandidateId, paidAt) {
    const rows = await db.update(communityGrantRoundsTable)
      .set({
        resultStatus: "winner",
        winnerCandidateId,
        grantStatus: "paid",
        grantPaidAt: new Date(paidAt),
        settledAt: new Date(paidAt),
        updatedAt: new Date(),
      })
      .where(and(
        eq(communityGrantRoundsTable.id, id),
        eq(communityGrantRoundsTable.resultStatus, "pending"),
        eq(communityGrantRoundsTable.grantStatus, "none"),
      ))
      .returning({ id: communityGrantRoundsTable.id });
    return rows.length > 0;
  },
  async releaseGrantClaim(id) {
    await db.update(communityGrantRoundsTable)
      .set({ resultStatus: "pending", winnerCandidateId: null, grantStatus: "none", grantPaidAt: null, settledAt: null, updatedAt: new Date() })
      .where(eq(communityGrantRoundsTable.id, id));
  },
  async markNoWinner(id, result, settledAt) {
    const rows = await db.update(communityGrantRoundsTable)
      .set({ resultStatus: result, settledAt: new Date(settledAt), updatedAt: new Date() })
      .where(and(eq(communityGrantRoundsTable.id, id), eq(communityGrantRoundsTable.resultStatus, "pending")))
      .returning({ id: communityGrantRoundsTable.id });
    return rows.length > 0;
  },
  async insertCandidate(input) {
    const rows = await db.insert(communityGrantCandidatesTable).values(input).returning();
    return candidateToWire(rows[0]!);
  },
  async listCandidates(roundId) {
    const rows = await db.select().from(communityGrantCandidatesTable)
      .where(eq(communityGrantCandidatesTable.roundId, roundId))
      .orderBy(asc(communityGrantCandidatesTable.createdAt));
    return rows.map(candidateToWire);
  },
  async getCandidate(id) {
    const rows = await db.select().from(communityGrantCandidatesTable).where(eq(communityGrantCandidatesTable.id, id)).limit(1);
    return rows[0] ? candidateToWire(rows[0]) : null;
  },
  async setReportBack(candidateId, body, at) {
    const rows = await db.update(communityGrantCandidatesTable)
      .set({ reportBack: body, reportBackAt: new Date(at), updatedAt: new Date() })
      .where(eq(communityGrantCandidatesTable.id, candidateId))
      .returning();
    return rows[0] ? candidateToWire(rows[0]) : null;
  },
  async upsertVote(roundId, voterId, candidateId) {
    await db.insert(communityGrantVotesTable)
      .values({ roundId, voterId, candidateId })
      .onConflictDoUpdate({
        target: [communityGrantVotesTable.roundId, communityGrantVotesTable.voterId],
        set: { candidateId, updatedAt: new Date() },
      });
  },
  async deleteVote(roundId, voterId) {
    await db.delete(communityGrantVotesTable)
      .where(and(eq(communityGrantVotesTable.roundId, roundId), eq(communityGrantVotesTable.voterId, voterId)));
  },
  async getVote(roundId, voterId) {
    const rows = await db.select({ candidateId: communityGrantVotesTable.candidateId })
      .from(communityGrantVotesTable)
      .where(and(eq(communityGrantVotesTable.roundId, roundId), eq(communityGrantVotesTable.voterId, voterId)))
      .limit(1);
    return rows[0]?.candidateId ?? null;
  },
  async tally(roundId) {
    const rows = await db.select({
      candidateId: communityGrantVotesTable.candidateId,
      n: sql<number>`count(*)::int`,
    })
      .from(communityGrantVotesTable)
      .where(eq(communityGrantVotesTable.roundId, roundId))
      .groupBy(communityGrantVotesTable.candidateId);
    return new Map(rows.map((r) => [r.candidateId, Number(r.n)]));
  },
};

/* ─── Core logic (store-driven; the routes stay thin) ──────────────── */

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function openRound(
  store: CommunityGrantStore,
  adminUserId: string,
  input: Omit<NewRoundRow, "createdByUserId">,
): Promise<RoundWire> {
  if (!MONTH_KEY_RE.test(input.monthKey)) {
    throw new CommunityGrantError("validation", "monthKey must be YYYY-MM.");
  }
  if (!Number.isInteger(input.poolVb) || input.poolVb <= 0) {
    throw new CommunityGrantError("validation", "The pool must be a positive whole number of Visual Bucs.");
  }
  const stamps = [input.submissionsOpenAt, input.submissionsCloseAt, input.votingOpenAt, input.votingCloseAt].map((s) => Date.parse(s));
  if (stamps.some((n) => Number.isNaN(n))) {
    throw new CommunityGrantError("validation", "All four window timestamps are required.");
  }
  if (!(stamps[0]! < stamps[1]! && stamps[1]! <= stamps[2]! && stamps[2]! < stamps[3]!)) {
    throw new CommunityGrantError("validation", "Windows must run in order: submissions open → submissions close → voting open → voting close.");
  }
  const existing = await store.getRoundByMonth(input.monthKey);
  if (existing) {
    throw new CommunityGrantError("round_exists", `A grant round already exists for ${input.monthKey}.`);
  }
  try {
    return await store.insertRound({ ...input, createdByUserId: adminUserId });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CommunityGrantError("round_exists", `A grant round already exists for ${input.monthKey}.`);
    }
    throw err;
  }
}

export async function submitProject(
  store: CommunityGrantStore,
  roundId: string,
  creatorUserId: string,
  creatorName: string,
  input: { title: string; description: string },
  now: Date = new Date(),
): Promise<CandidateWire> {
  const round = await store.getRound(roundId);
  if (!round) throw new CommunityGrantError("not_found", "That grant round does not exist.");
  if (phaseOf(round, now) !== "submissions") {
    throw new CommunityGrantError("window_closed", "Submissions are not open for this round right now.");
  }
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || !description) {
    throw new CommunityGrantError("validation", "Your project needs a title and a description in your own words.");
  }
  const mine = (await store.listCandidates(roundId)).find((c) => c.creatorUserId === creatorUserId);
  if (mine) {
    throw new CommunityGrantError("already_submitted", "You already have a project in this round — one project per creator per round.");
  }
  try {
    return await store.insertCandidate({ roundId, creatorUserId, creatorName, title, description });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CommunityGrantError("already_submitted", "You already have a project in this round — one project per creator per round.");
    }
    throw err;
  }
}

/** Cast or CHANGE a vote. One row per voter per round either way: the
 *  store upserts on (round_id, voter_id), so a change moves the single
 *  vote — the tally can never count this member twice. */
export async function castVote(
  store: CommunityGrantStore,
  roundId: string,
  voterId: string,
  candidateId: string,
  now: Date = new Date(),
): Promise<{ candidateId: string; votes: number }> {
  const round = await store.getRound(roundId);
  if (!round) throw new CommunityGrantError("not_found", "That grant round does not exist.");
  if (phaseOf(round, now) !== "voting") {
    throw new CommunityGrantError("window_closed", "Voting is not open for this round right now.");
  }
  const candidate = await store.getCandidate(candidateId);
  if (!candidate || candidate.roundId !== roundId) {
    throw new CommunityGrantError("not_votable", "That project is not a candidate in this round.");
  }
  await store.upsertVote(roundId, voterId, candidateId);
  const tally = await store.tally(roundId);
  return { candidateId, votes: tally.get(candidateId) ?? 0 };
}

export async function withdrawVote(
  store: CommunityGrantStore,
  roundId: string,
  voterId: string,
  now: Date = new Date(),
): Promise<void> {
  const round = await store.getRound(roundId);
  if (!round) throw new CommunityGrantError("not_found", "That grant round does not exist.");
  if (phaseOf(round, now) !== "voting") {
    throw new CommunityGrantError("window_closed", "Voting is not open for this round right now.");
  }
  await store.deleteVote(roundId, voterId);
}

export async function postReportBack(
  store: CommunityGrantStore,
  roundId: string,
  userId: string,
  body: string,
  now: Date = new Date(),
): Promise<CandidateWire> {
  const round = await store.getRound(roundId);
  if (!round) throw new CommunityGrantError("not_found", "That grant round does not exist.");
  if (round.resultStatus !== "winner" || round.grantStatus !== "paid" || !round.winnerCandidateId) {
    throw new CommunityGrantError("not_winner", "Only the funded project reports back, once its grant has been paid.");
  }
  const winner = await store.getCandidate(round.winnerCandidateId);
  if (!winner || winner.creatorUserId !== userId) {
    throw new CommunityGrantError("not_winner", "Only the funded creator can post this project's report-back.");
  }
  const text = body.trim();
  if (!text) throw new CommunityGrantError("validation", "Write your report-back in your own words.");
  const updated = await store.setReportBack(winner.id, text, now.toISOString());
  if (!updated) throw new CommunityGrantError("not_found", "That project does not exist.");
  return updated;
}

async function buildSurface(store: CommunityGrantStore, round: RoundWire, viewerId: string | undefined, now: Date): Promise<RoundSurface> {
  const [candidates, tally, myVote] = await Promise.all([
    store.listCandidates(round.id),
    store.tally(round.id),
    viewerId ? store.getVote(round.id, viewerId) : Promise.resolve(null),
  ]);
  const withVotes: CandidateWithVotes[] = candidates.map((c) => ({
    ...c,
    votes: tally.get(c.id) ?? 0,
    isWinner: round.winnerCandidateId === c.id,
    reportBackOwed: round.winnerCandidateId === c.id && round.grantStatus === "paid" && !c.reportBack,
  }));
  /* Public ordering: most real votes first, then earliest submitted. */
  withVotes.sort((a, b) => b.votes - a.votes || a.createdAt.localeCompare(b.createdAt));
  return {
    round,
    phase: phaseOf(round, now),
    candidates: withVotes,
    totalVotes: withVotes.reduce((sum, c) => sum + c.votes, 0),
    myVoteCandidateId: myVote,
  };
}

export async function getGrantsSurface(
  store: CommunityGrantStore,
  viewerId?: string,
  now: Date = new Date(),
): Promise<GrantsSurface> {
  const rounds = await store.listRounds(); // newest first
  if (rounds.length === 0) return { current: null, past: [] };
  const [current, ...rest] = rounds;
  return {
    current: await buildSurface(store, current!, viewerId, now),
    past: await Promise.all(rest.map((r) => buildSurface(store, r, viewerId, now))),
  };
}

/* ─── Settle: result + exactly-once VB payout ──────────────────────── */

export const communityGrantLedgerKey = (roundId: string) => `community-grant:${roundId}`;
export const COMMUNITY_GRANT_LEDGER_ACTION = "Community Grant";

export interface GrantPayDeps {
  addCredits(userId: string, amount: number): Promise<void>;
  recordLedger(record: {
    userId: string;
    action: string;
    creditsUsed: number;
    idempotencyKey: string;
  }): Promise<"recorded" | "already-recorded">;
}

function isDuplicateKeyError(err: unknown): boolean {
  if (isUniqueViolation(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key|unique constraint|credit_usage_idempotency_key_uidx/i.test(msg);
}

export const defaultGrantPayDeps: GrantPayDeps = {
  async addCredits(userId, amount) {
    const { addCreditsAtomic } = await import("./supabase-admin");
    await addCreditsAtomic(userId, amount);
  },
  async recordLedger(record) {
    const [existing] = await db
      .select({ id: creditUsageTable.id })
      .from(creditUsageTable)
      .where(eq(creditUsageTable.idempotencyKey, record.idempotencyKey))
      .limit(1);
    if (existing) return "already-recorded";
    try {
      await recordCreditUsageStrict(record);
      return "recorded";
    } catch (err) {
      if (isDuplicateKeyError(err)) return "already-recorded";
      throw err;
    }
  },
};

export type SettleOutcome =
  | { outcome: "paid"; winnerCandidateId: string; amountVb: number }
  | { outcome: "tie" }
  | { outcome: "no_candidates" }
  | { outcome: "already_settled"; resultStatus: RoundWire["resultStatus"] }
  | { outcome: "failed_released" };

export async function settleRound(
  store: CommunityGrantStore,
  deps: GrantPayDeps,
  roundId: string,
  now: Date = new Date(),
): Promise<SettleOutcome> {
  const round = await store.getRound(roundId);
  if (!round) throw new CommunityGrantError("not_found", "That grant round does not exist.");
  if (round.resultStatus !== "pending") {
    /* A replayed settle is a no-op — the grant can only ever pay once. */
    return { outcome: "already_settled", resultStatus: round.resultStatus };
  }
  if (phaseOf(round, now) !== "closed") {
    throw new CommunityGrantError("window_not_open", "The round can only be settled after its voting window closes.");
  }
  const candidates = await store.listCandidates(roundId);
  if (candidates.length === 0) {
    await store.markNoWinner(roundId, "no_candidates", now.toISOString());
    return { outcome: "no_candidates" };
  }
  const tally = await store.tally(roundId);
  const totalVotes = [...tally.values()].reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...candidates.map((c) => tally.get(c.id) ?? 0));
  const leaders = candidates.filter((c) => (tally.get(c.id) ?? 0) === max);
  if (totalVotes === 0 || leaders.length !== 1) {
    /* TIE (or no votes at all): NO winner is declared, NOTHING is
       paid, the pool holds for admin resolution. */
    await store.markNoWinner(roundId, "tie", now.toISOString());
    return { outcome: "tie" };
  }
  const winner = leaders[0]!;
  const claimed = await store.claimGrant(roundId, winner.id, now.toISOString());
  if (!claimed) {
    const fresh = await store.getRound(roundId);
    return { outcome: "already_settled", resultStatus: fresh?.resultStatus ?? "winner" };
  }
  let granted = false;
  try {
    await deps.addCredits(winner.creatorUserId, round.poolVb);
    granted = true;
    await deps.recordLedger({
      userId: winner.creatorUserId,
      action: COMMUNITY_GRANT_LEDGER_ACTION,
      creditsUsed: -round.poolVb,
      idempotencyKey: communityGrantLedgerKey(roundId),
    });
    return { outcome: "paid", winnerCandidateId: winner.id, amountVb: round.poolVb };
  } catch (err) {
    if (granted) {
      await deps.addCredits(winner.creatorUserId, -round.poolVb).catch(() => {});
    }
    await store.releaseGrantClaim(roundId);
    logger.error({ err, roundId }, "[community-grants] settle failed after claim — claim released, pool unpaid");
    return { outcome: "failed_released" };
  }
}

/** Admin resolution path for a tied round: extend the voting window;
 *  a tied round returns to 'pending' so a later settle can decide it.
 *  The pool is never paid out by this action. */
export async function updateRoundWindows(
  store: CommunityGrantStore,
  roundId: string,
  patch: Partial<Pick<RoundWire, "submissionsOpenAt" | "submissionsCloseAt" | "votingOpenAt" | "votingCloseAt">>,
): Promise<RoundWire> {
  const round = await store.getRound(roundId);
  if (!round) throw new CommunityGrantError("not_found", "That grant round does not exist.");
  if (round.grantStatus === "paid") {
    throw new CommunityGrantError("validation", "This round's grant is already paid — its windows are final.");
  }
  const merged = { ...round, ...patch };
  const stamps = [merged.submissionsOpenAt, merged.submissionsCloseAt, merged.votingOpenAt, merged.votingCloseAt].map((s) => Date.parse(s));
  if (stamps.some((n) => Number.isNaN(n)) || !(stamps[0]! < stamps[1]! && stamps[1]! <= stamps[2]! && stamps[2]! < stamps[3]!)) {
    throw new CommunityGrantError("validation", "Windows must run in order: submissions open → submissions close → voting open → voting close.");
  }
  const updated = await store.updateRoundWindows(roundId, patch);
  if (!updated) throw new CommunityGrantError("not_found", "That grant round does not exist.");
  if (updated.resultStatus === "tie") {
    await store.reopenTiedRound(roundId);
    return (await store.getRound(roundId)) ?? updated;
  }
  return updated;
}

/** Pre-migration honesty: the 9999 tables may not exist yet. Reads
 *  degrade to the empty surface; writes answer an honest 503. */
export function isGrantsNotReady(err: unknown): boolean {
  return isUndefinedTable(err);
}
