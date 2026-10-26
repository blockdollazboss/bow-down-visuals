/* In-memory CommunityGrantStore for tests — mirrors the drizzle
   store's semantics: one candidate per creator per round (throws a
   23505-shaped error), one vote ROW per (round, voter) that an upsert
   replaces in place, tallies counted from the rows every call. */
import type {
  CandidateWire,
  CommunityGrantStore,
  NewRoundRow,
  RoundWire,
} from "../community-grants";

function uniqueViolation(): Error {
  const err = new Error("duplicate key value violates unique constraint") as Error & { code?: string };
  err.code = "23505";
  return err;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export class MemoryGrantStore implements CommunityGrantStore {
  rounds = new Map<string, RoundWire>();
  candidates = new Map<string, CandidateWire>();
  /** The vote rows: key `${roundId}:${voterId}` → candidateId. One key
   *  per voter per round — a change overwrites, never adds a row. */
  votes = new Map<string, string>();

  async insertRound(input: NewRoundRow): Promise<RoundWire> {
    for (const r of this.rounds.values()) {
      if (r.monthKey === input.monthKey) throw uniqueViolation();
    }
    const round: RoundWire = {
      id: nextId("round"),
      monthKey: input.monthKey,
      poolVb: input.poolVb,
      submissionsOpenAt: input.submissionsOpenAt,
      submissionsCloseAt: input.submissionsCloseAt,
      votingOpenAt: input.votingOpenAt,
      votingCloseAt: input.votingCloseAt,
      resultStatus: "pending",
      winnerCandidateId: null,
      grantStatus: "none",
      grantPaidAt: null,
      settledAt: null,
      createdByUserId: input.createdByUserId,
      createdAt: new Date().toISOString(),
    };
    this.rounds.set(round.id, round);
    return { ...round };
  }
  async getRound(id: string) {
    const r = this.rounds.get(id);
    return r ? { ...r } : null;
  }
  async getRoundByMonth(monthKey: string) {
    for (const r of this.rounds.values()) if (r.monthKey === monthKey) return { ...r };
    return null;
  }
  async listRounds() {
    return [...this.rounds.values()].reverse().map((r) => ({ ...r }));
  }
  async updateRoundWindows(id: string, patch: Partial<Pick<RoundWire, "submissionsOpenAt" | "submissionsCloseAt" | "votingOpenAt" | "votingCloseAt">>) {
    const r = this.rounds.get(id);
    if (!r) return null;
    Object.assign(r, patch);
    return { ...r };
  }
  async reopenTiedRound(id: string) {
    const r = this.rounds.get(id);
    if (!r || r.resultStatus !== "tie") return false;
    r.resultStatus = "pending";
    r.settledAt = null;
    return true;
  }
  async claimGrant(id: string, winnerCandidateId: string, paidAt: string) {
    const r = this.rounds.get(id);
    if (!r || r.resultStatus !== "pending" || r.grantStatus !== "none") return false;
    r.resultStatus = "winner";
    r.winnerCandidateId = winnerCandidateId;
    r.grantStatus = "paid";
    r.grantPaidAt = paidAt;
    r.settledAt = paidAt;
    return true;
  }
  async releaseGrantClaim(id: string) {
    const r = this.rounds.get(id);
    if (!r) return;
    r.resultStatus = "pending";
    r.winnerCandidateId = null;
    r.grantStatus = "none";
    r.grantPaidAt = null;
    r.settledAt = null;
  }
  async markNoWinner(id: string, result: "tie" | "no_candidates", settledAt: string) {
    const r = this.rounds.get(id);
    if (!r || r.resultStatus !== "pending") return false;
    r.resultStatus = result;
    r.settledAt = settledAt;
    return true;
  }
  async insertCandidate(input: { roundId: string; creatorUserId: string; creatorName: string; title: string; description: string }) {
    for (const c of this.candidates.values()) {
      if (c.roundId === input.roundId && c.creatorUserId === input.creatorUserId) throw uniqueViolation();
    }
    const candidate: CandidateWire = {
      id: nextId("cand"),
      ...input,
      reportBack: null,
      reportBackAt: null,
      createdAt: new Date().toISOString(),
    };
    this.candidates.set(candidate.id, candidate);
    return { ...candidate };
  }
  async listCandidates(roundId: string) {
    return [...this.candidates.values()].filter((c) => c.roundId === roundId).map((c) => ({ ...c }));
  }
  async getCandidate(id: string) {
    const c = this.candidates.get(id);
    return c ? { ...c } : null;
  }
  async setReportBack(candidateId: string, body: string, at: string) {
    const c = this.candidates.get(candidateId);
    if (!c) return null;
    c.reportBack = body;
    c.reportBackAt = at;
    return { ...c };
  }
  async upsertVote(roundId: string, voterId: string, candidateId: string) {
    this.votes.set(`${roundId}:${voterId}`, candidateId);
  }
  async deleteVote(roundId: string, voterId: string) {
    this.votes.delete(`${roundId}:${voterId}`);
  }
  async getVote(roundId: string, voterId: string) {
    return this.votes.get(`${roundId}:${voterId}`) ?? null;
  }
  async tally(roundId: string) {
    const map = new Map<string, number>();
    for (const [key, candidateId] of this.votes) {
      if (key.startsWith(`${roundId}:`)) map.set(candidateId, (map.get(candidateId) ?? 0) + 1);
    }
    return map;
  }
}

/** A round whose windows straddle a fixed "now" per phase. */
export function roundInput(overrides: Partial<NewRoundRow> = {}): NewRoundRow {
  return {
    monthKey: "2026-11",
    poolVb: 5000,
    submissionsOpenAt: "2026-11-01T00:00:00.000Z",
    submissionsCloseAt: "2026-11-10T00:00:00.000Z",
    votingOpenAt: "2026-11-11T00:00:00.000Z",
    votingCloseAt: "2026-11-20T00:00:00.000Z",
    createdByUserId: "admin-1",
    ...overrides,
  };
}

export const IN_SUBMISSIONS = new Date("2026-11-05T12:00:00.000Z");
export const IN_VOTING = new Date("2026-11-15T12:00:00.000Z");
export const AFTER_CLOSE = new Date("2026-11-21T12:00:00.000Z");
