/**
 * grants-desk — stack1500 world parity wave #3 item 41 pins.
 * The Community Grants desk is the grants board's native
 * form. These pins hold: the paths match the route family
 * (admin endpoints excluded by construction — no admin path
 * exists in the seam); the surface guard reads the rail's
 * RoundSurface whole (round, phase, candidates with votes,
 * myVoteCandidateId), keeps the honest null current, and
 * drops malformed rounds rather than dressing them up; the
 * submit/report-back builders enforce the schemas' limits;
 * the owed report-back is found only for the viewer's own
 * funded candidate; phase + result labels cover the rail's
 * whole vocabulary.
 */
import { describe, expect, it } from "vitest";
import {
  GRANTS_PATH,
  GRANT_PHASE_LABELS,
  GRANT_RESULT_LABELS,
  buildGrantProjectPayload,
  buildGrantReportBackPayload,
  grantsProjectsPath,
  grantsReportBackPath,
  grantsSurfaceOf,
  grantsVotePath,
  myOwedReportBack,
  type GrantRound,
} from "./grants-desk";

const ROUND = {
  round: {
    id: "r1",
    monthKey: "2026-11",
    poolVb: 5000,
    submissionsOpenAt: "2026-11-01T00:00:00Z",
    submissionsCloseAt: "2026-11-10T00:00:00Z",
    votingOpenAt: "2026-11-11T00:00:00Z",
    votingCloseAt: "2026-11-20T00:00:00Z",
    resultStatus: "winner",
    winnerCandidateId: "c1",
    grantStatus: "paid",
    grantPaidAt: "2026-11-21T00:00:00Z",
    settledAt: "2026-11-21T00:00:00Z",
    createdByUserId: "admin",
    createdAt: "2026-10-30T00:00:00Z",
  },
  phase: "closed",
  candidates: [
    {
      id: "c1",
      roundId: "r1",
      creatorUserId: "u1",
      creatorName: "Thy Cheat Code",
      title: "A free studio day for new creators",
      description: "One full day…",
      reportBack: null,
      reportBackAt: null,
      createdAt: "2026-11-02T00:00:00Z",
      votes: 42,
      isWinner: true,
      reportBackOwed: true,
    },
    { id: "c2", roundId: "r1", creatorUserId: "u2", creatorName: "Other", title: "", description: "x", votes: 3, isWinner: false, reportBackOwed: false },
    { id: "bad" },
  ],
  totalVotes: 45,
  myVoteCandidateId: "c1",
};

describe("paths — the member family only", () => {
  it("projects, vote, report-back; no admin path exists", () => {
    expect(GRANTS_PATH).toBe("/api/community-grants");
    expect(grantsProjectsPath("r 1")).toBe("/api/community-grants/r%201/projects");
    expect(grantsVotePath("r1")).toBe("/api/community-grants/r1/vote");
    expect(grantsReportBackPath("r1")).toBe("/api/community-grants/r1/report-back");
  });
});

describe("the surface guard", () => {
  it("reads a round whole; a title-less candidate and a malformed one drop", () => {
    const s = grantsSurfaceOf({ current: ROUND, past: [] })!;
    expect(s.current!.round.poolVb).toBe(5000);
    expect(s.current!.phase).toBe("closed");
    expect(s.current!.myVoteCandidateId).toBe("c1");
    // c2 has an empty-string title — typeof string passes the
    // guard (the rail stores creators' own words); only the
    // shapeless "bad" row drops.
    expect(s.current!.candidates.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("the honest empty surface stays valid; garbage does not", () => {
    expect(grantsSurfaceOf({ current: null, past: [] })).toEqual({ current: null, past: [] });
    expect(grantsSurfaceOf({ current: { nope: true }, past: [] })).toBeNull();
    expect(grantsSurfaceOf(null)).toBeNull();
  });
});

describe("payloads + the owed report-back", () => {
  it("the schemas' limits are enforced in-desk", () => {
    expect(buildGrantProjectPayload("  My project ", " Words. ")).toEqual({ title: "My project", description: "Words." });
    expect(buildGrantProjectPayload("", "Words.")).toBeNull();
    expect(buildGrantProjectPayload("x".repeat(121), "Words.")).toBeNull();
    expect(buildGrantReportBackPayload(" We built it. ")).toEqual({ body: "We built it." });
    expect(buildGrantReportBackPayload(" ")).toBeNull();
  });

  it("the owed report-back belongs to the funded viewer only", () => {
    const s = grantsSurfaceOf({ current: ROUND, past: [] })!.current as GrantRound;
    expect(myOwedReportBack(s, "u1")?.id).toBe("c1");
    expect(myOwedReportBack(s, "u2")).toBeNull();
    expect(myOwedReportBack(s, null)).toBeNull();
  });

  it("phase + result labels cover the rail's vocabulary", () => {
    expect(Object.keys(GRANT_PHASE_LABELS).sort()).toEqual(["between", "closed", "submissions", "upcoming", "voting"]);
    expect(GRANT_RESULT_LABELS["tie"]).toContain("pool holds");
    expect(GRANT_RESULT_LABELS["winner"]).toBe("Funded");
  });
});
