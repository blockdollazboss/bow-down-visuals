/* ─── Community Grants — shared frontend vocabulary (Stack-200 N15) ──
   Mirrors the API wire shapes in artifacts/api-server/src/lib/
   community-grants.ts. The API is the authority; these types + the
   phase/month helpers exist so the page and the tests speak the same
   words. NO pool amount lives here — the pool is whatever an admin
   recorded on the round, read from the API every time. */

export type GrantPhase = "upcoming" | "submissions" | "between" | "voting" | "closed";
export type GrantResultStatus = "pending" | "winner" | "tie" | "no_candidates";

export interface GrantRound {
  id: string;
  monthKey: string;
  /** Admin-entered pool size in Visual Bucs — from the API, never local. */
  poolVb: number;
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  votingOpenAt: string;
  votingCloseAt: string;
  resultStatus: GrantResultStatus;
  winnerCandidateId: string | null;
  grantStatus: "none" | "paid";
  grantPaidAt: string | null;
  settledAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface GrantCandidate {
  id: string;
  roundId: string;
  creatorUserId: string;
  creatorName: string;
  /** The creator's own words, shown unedited. */
  title: string;
  description: string;
  reportBack: string | null;
  reportBackAt: string | null;
  createdAt: string;
  /** Fresh COUNT of real vote rows, from the API. */
  votes: number;
  isWinner: boolean;
  /** True while the funded creator still owes the community a report-back. */
  reportBackOwed: boolean;
}

export interface GrantRoundSurface {
  round: GrantRound;
  phase: GrantPhase;
  candidates: GrantCandidate[];
  totalVotes: number;
  myVoteCandidateId: string | null;
}

export interface GrantsSurfaceData {
  current: GrantRoundSurface | null;
  past: GrantRoundSurface[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** '2026-11' → 'November 2026'. A label for the round's month key —
 *  never a schedule claim; the windows on the round are the schedule. */
export function monthLabel(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  const name = MONTH_NAMES[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : monthKey;
}

export function formatVb(n: number): string {
  return `${n.toLocaleString("en-US")} VB`;
}
