/**
 * grants-desk — the seam behind the Community Hall's native
 * Community Grants desk (stack1500 world parity wave #3,
 * census item 41; the census counted community grants ABSENT
 * from the World before this wave — only the 2D page and an
 * admin bench existed).
 *
 * Source of truth: artifacts/api-server/src/routes/
 * community-grants.ts + lib/community-grants.ts, and the
 * website's shared vocabulary in lib/community-grants.ts
 * (types + monthLabel + formatVb — the desk reuses them so
 * the room and the page speak the same words).
 *   GET    /api/community-grants → { current: RoundSurface |
 *     null, past: RoundSurface[] } — PUBLIC read; pre-launch
 *     the rail degrades to { current: null, past: [] }, the
 *     honest empty surface, never a fake round.
 *   POST   /api/community-grants/:id/projects { title
 *     (1–120), description (1–2000) } → 201 { candidate }.
 *   POST   /api/community-grants/:id/vote { candidateId } →
 *     { voted: true, … }; DELETE …/vote → { voted: false }.
 *   POST   /api/community-grants/:id/report-back { body
 *     (1–4000) } → { candidate }.
 *   Admin round/settle endpoints are requireAdmin — NOT the
 *   desk's (the admin benches live on the website).
 *
 * MONEY RULE (the rail's own): Visual Bucs ONLY — no cash
 * path exists here. Guests read everything and can never
 * vote (the write rails are requireAuth); the desk gates the
 * actions, never the reading. A tie pays nobody and holds —
 * the result states ride the rail's resultStatus verbatim.
 * Errors carry { error, code } — the desk shows the rail's
 * own message (incl. the 503 "not switched on yet").
 */
import type { GrantPhase, GrantRoundSurface, GrantsSurfaceData } from "@/lib/community-grants";

export const GRANTS_PATH = "/api/community-grants";

export function grantsProjectsPath(roundId: string): string {
  return `${GRANTS_PATH}/${encodeURIComponent(roundId)}/projects`;
}

export function grantsVotePath(roundId: string): string {
  return `${GRANTS_PATH}/${encodeURIComponent(roundId)}/vote`;
}

export function grantsReportBackPath(roundId: string): string {
  return `${GRANTS_PATH}/${encodeURIComponent(roundId)}/report-back`;
}

export const GRANT_PHASE_LABELS: Record<GrantPhase, string> = {
  upcoming: "Opening soon",
  submissions: "Submissions open",
  between: "Voting opens soon",
  voting: "Voting open",
  closed: "Closed",
};

export const GRANT_RESULT_LABELS: Record<string, string> = {
  winner: "Funded",
  tie: "Tied — the pool holds",
  no_candidates: "No projects this round",
  pending: "",
};

export type GrantsSurface = GrantsSurfaceData;
export type GrantRound = GrantRoundSurface;

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

const PHASES: readonly string[] = ["upcoming", "submissions", "between", "voting", "closed"];

function roundSurfaceOf(raw: unknown): GrantRoundSurface | null {
  const o = obj(raw);
  if (!o) return null;
  const round = obj(o["round"]);
  if (!round || typeof round["id"] !== "string" || typeof round["monthKey"] !== "string") return null;
  if (typeof o["phase"] !== "string" || !PHASES.includes(o["phase"])) return null;
  const candidates: GrantRoundSurface["candidates"] = [];
  for (const rawC of Array.isArray(o["candidates"]) ? o["candidates"] : []) {
    const c = obj(rawC);
    if (!c || typeof c["id"] !== "string" || typeof c["title"] !== "string") continue;
    candidates.push(c as unknown as GrantRoundSurface["candidates"][number]);
  }
  return {
    round: round as unknown as GrantRoundSurface["round"],
    phase: o["phase"] as GrantPhase,
    candidates,
    totalVotes: typeof o["totalVotes"] === "number" ? o["totalVotes"] : 0,
    myVoteCandidateId: typeof o["myVoteCandidateId"] === "string" ? o["myVoteCandidateId"] : null,
  };
}

/** The surface guard: current may be null (the honest empty
 *  surface); a malformed past round drops, never dresses up. */
export function grantsSurfaceOf(data: unknown): GrantsSurface | null {
  const o = obj(data);
  if (!o) return null;
  const current = o["current"] === null ? null : roundSurfaceOf(o["current"]);
  if (o["current"] !== null && current === null) return null;
  const past: GrantRoundSurface[] = [];
  for (const raw of Array.isArray(o["past"]) ? o["past"] : []) {
    const surface = roundSurfaceOf(raw);
    if (surface) past.push(surface);
  }
  return { current, past };
}

export function buildGrantProjectPayload(
  title: string,
  description: string,
): { title: string; description: string } | null {
  const t = title.trim();
  const d = description.trim();
  if (!t || t.length > 120 || !d || d.length > 2000) return null;
  return { title: t, description: d };
}

export function buildGrantReportBackPayload(body: string): { body: string } | null {
  const b = body.trim();
  if (!b || b.length > 4000) return null;
  return { body: b };
}

/** The funded creator who still owes the community a
 *  report-back, when that creator is the viewer. */
export function myOwedReportBack(
  surface: GrantRoundSurface,
  userId: string | null,
): GrantRoundSurface["candidates"][number] | null {
  if (!userId) return null;
  return (
    surface.candidates.find((c) => c.reportBackOwed && c.creatorUserId === userId) ?? null
  );
}
