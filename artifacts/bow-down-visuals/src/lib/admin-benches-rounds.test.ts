/**
 * admin-benches-rounds.test.ts — stack1200 admin-benches lane pins.
 *
 * The second trio of /admin benches (challenges, community grants,
 * remix king) dock onto rails that had NO frontend consumer at all.
 * These pins hold the seams honest, in the X1 idiom:
 *  - parsers are strict: a malformed answer is a FAILED read (null),
 *    never a painted-empty queue;
 *  - the FE mirrors are the rails' own rules, cross-checked against
 *    the API sources themselves (the 1,000 VB weekly cap, the remix
 *    transition table, the published-splits contract);
 *  - action availability never offers a move the rail would refuse
 *    (no 'winners' lifecycle target, settle only when closed+pending,
 *    winner only while judging, no shortlist toggle on the winner).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHALLENGE_PRIZE_POOL_CAP_VB,
  challengeLifecycleTargets,
  grantSettleAvailable,
  grantWindowsEditable,
  parseAdminChallenges,
  parseChallengeDetail,
  parseGrantsAdmin,
  parseGrantSettleOutcome,
  parseJudgeResult,
  parseRemixAdminEvents,
  prizeDraftError,
  prizeDraftTotal,
  remixShortlistAvailable,
  remixStatusTargets,
  remixWinnerAvailable,
  splitDraftError,
  splitDraftSum,
  type AdminChallengeRow,
  type PrizeDraft,
  type RemixEntryRow,
  type SplitDraft,
} from "./admin-benches";

const API_ROUTES = join(__dirname, "..", "..", "..", "api-server", "src", "routes");
const API_LIB = join(__dirname, "..", "..", "..", "api-server", "src", "lib");
const readApi = (p: string) => readFileSync(join(API_ROUTES, p), "utf8");
const readApiLib = (p: string) => readFileSync(join(API_LIB, p), "utf8");

/* ─── fixtures in the rails' own wire shapes ─────────────────────── */

const CHALLENGE_ROW = {
  slug: "nov-flex",
  title: "November Flex",
  hashtag: "novflex",
  status: "live",
  effective_status: "judging",
  starts_at: "2026-11-01T00:00:00.000Z",
  ends_at: "2026-11-07T00:00:00.000Z",
  judging_ends_at: "2026-11-09T00:00:00.000Z",
  entry_count: 12,
  prize_pool_credits: 1000,
  winners_announced: false,
  created_at: "2026-10-30T00:00:00.000Z",
};

const CHALLENGE_DETAIL = {
  challenge: {
    id: "ch-1",
    slug: "nov-flex",
    title: "November Flex",
    status: "judging",
    starts_at: CHALLENGE_ROW.starts_at,
    ends_at: CHALLENGE_ROW.ends_at,
    judging_ends_at: CHALLENGE_ROW.judging_ends_at,
    entry_count: 12,
    prize_pool_credits: 1000,
    prizes: [
      { place: 1, prize_credits: 500, description: "Champion" },
      { place: 2, prize_credits: 300, description: "Runner-up" },
      { place: 3, prize_credits: 200, description: "3rd place" },
    ],
    winners_announced: false,
  },
  entries: [
    {
      id: "vid-1",
      title: "My flex",
      vote_count: 9,
      view_count: 400,
      like_count: 30,
      creator: { id: "prof-1", slug: "maker", display_name: "Maker", avatar_url: null },
    },
  ],
};

const GRANT_SURFACE = {
  current: {
    round: {
      id: "round-1",
      monthKey: "2026-11",
      poolVb: 5000,
      submissionsOpenAt: "2026-11-01T00:00:00.000Z",
      submissionsCloseAt: "2026-11-10T00:00:00.000Z",
      votingOpenAt: "2026-11-11T00:00:00.000Z",
      votingCloseAt: "2026-11-20T00:00:00.000Z",
      resultStatus: "pending",
      winnerCandidateId: null,
      grantStatus: "none",
      grantPaidAt: null,
      settledAt: null,
      createdByUserId: "admin-1",
      createdAt: "2026-10-28T00:00:00.000Z",
    },
    phase: "closed",
    candidates: [
      {
        id: "cand-1",
        roundId: "round-1",
        creatorUserId: "user-1",
        creatorName: "Maker",
        title: "Studio fund",
        description: "In my own words.",
        reportBack: null,
        reportBackAt: null,
        createdAt: "2026-11-02T00:00:00.000Z",
        votes: 7,
        isWinner: false,
        reportBackOwed: false,
      },
    ],
    totalVotes: 7,
    myVoteCandidateId: null,
  },
  past: [],
};

const REMIX_BUNDLE = {
  event: {
    id: "ev-1",
    monthKey: "2026-11",
    title: "Remix the King — November",
    kingTrackTitle: "Throne Room",
    kingTrackAudioUrl: "https://example.test/track.mp3",
    kingTrackStemsUrl: null,
    description: "",
    splits: [
      { role: "winner", payeeName: "Winning Remixer", payeeUserId: null, sharePct: 50 },
      { role: "king", payeeName: "Thy Cheat Code", payeeUserId: null, sharePct: 30 },
      { role: "house", payeeName: "Bow Down Visuals", payeeUserId: null, sharePct: 20 },
    ],
    status: "judging",
    entriesOpenAt: null,
    entriesCloseAt: null,
    winnerEntryId: null,
    createdByUserId: "admin-1",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  },
  entries: [
    {
      id: "entry-1",
      eventId: "ev-1",
      userId: "user-1",
      entrantName: "Maker",
      remixTitle: "Throne Flip",
      audioUrl: "https://example.test/remix.mp3",
      note: "",
      status: "shortlisted",
      voteCount: 11,
      createdAt: "2026-11-03T00:00:00.000Z",
      updatedAt: "2026-11-03T00:00:00.000Z",
    },
  ],
  release: null,
  payments: [],
};

/* ─── challenges ─────────────────────────────────────────────────── */

describe("challenges bench — parsers are strict", () => {
  it("parses the bench list in the rail's wire shape", () => {
    const rows = parseAdminChallenges({ challenges: [CHALLENGE_ROW] });
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ slug: "nov-flex", status: "live", effectiveStatus: "judging", prizePoolCredits: 1000 });
  });

  it("a malformed list is a failed read, never an empty queue", () => {
    expect(parseAdminChallenges({ challenges: [{ title: "no slug" }] })).toBeNull();
    expect(parseAdminChallenges({})).toBeNull();
    expect(parseAdminChallenges(null)).toBeNull();
  });

  it("parses the public detail (prizes + entries) the bench decides from", () => {
    const detail = parseChallengeDetail(CHALLENGE_DETAIL);
    expect(detail?.prizes).toHaveLength(3);
    expect(detail?.entries[0]).toMatchObject({ id: "vid-1", voteCount: 9, creatorName: "Maker" });
    expect(parseChallengeDetail({ challenge: { slug: "x" } })).toBeNull();
  });

  it("parses the judge answer; anything else is a failed read", () => {
    const result = parseJudgeResult({
      ok: true, paid: 2, already_paid: 1, payout_errors: [], budget_capped: ["2nd — 300 VB"],
      weekly_cap_vb: 1000, weekly_paid_vb: 800,
      winners: [{ place: 1, video_id: "vid-1", prize_credits: 500, paid_at: "2026-11-09T00:00:00.000Z" }],
    });
    expect(result?.paid).toBe(2);
    expect(result?.budgetCapped).toHaveLength(1);
    expect(parseJudgeResult({ ok: false })).toBeNull();
  });
});

describe("challenges bench — lifecycle targets mirror the rail", () => {
  const row = (status: string): AdminChallengeRow => ({
    slug: "s", title: "", hashtag: "", status, effectiveStatus: status,
    startsAt: null, endsAt: null, judgingEndsAt: null, entryCount: 0,
    prizePoolCredits: 0, winnersAnnounced: false, createdAt: "2026-11-01T00:00:00.000Z",
  });

  it("never offers 'winners' — only /judge crowns", () => {
    for (const status of ["upcoming", "live", "judging"]) {
      expect(challengeLifecycleTargets(row(status))).not.toContain("winners");
    }
  });

  it("excludes the current state and offers nothing once crowned", () => {
    expect(challengeLifecycleTargets(row("live"))).toEqual(["upcoming", "judging"]);
    expect(challengeLifecycleTargets(row("winners"))).toEqual([]);
  });
});

describe("challenges bench — the prize mirror is the rail's rules", () => {
  const draft = (rows: Array<[number, string]>): PrizeDraft[] =>
    rows.map(([place, amount]) => ({ place, amount, description: "" }));

  it("the cap constant is the API's own WEEKLY_PRIZE_CAP_VB", () => {
    expect(readApi("challenge-engine.ts")).toContain(`const WEEKLY_PRIZE_CAP_VB = ${CHALLENGE_PRIZE_POOL_CAP_VB};`);
  });

  it("the standard split (500/300/200) is sendable and totals 1,000", () => {
    const d = draft([[1, "500"], [2, "300"], [3, "200"]]);
    expect(prizeDraftError(d)).toBeNull();
    expect(prizeDraftTotal(d)).toBe(1000);
  });

  it("each broken rule names itself", () => {
    expect(prizeDraftError([])).toBe("empty");
    expect(prizeDraftError(draft([[1, "500"], [1, "300"]]))).toBe("placeDuplicate");
    expect(prizeDraftError(draft([[11, "500"]]))).toBe("placeRange");
    expect(prizeDraftError(draft([[1, "abc"]]))).toBe("amountWhole");
    expect(prizeDraftError(draft([[1, "150"]]))).toBe("amountMultiple");
    expect(prizeDraftError(draft([[1, "0"]]))).toBe("amountRange");
    expect(prizeDraftError(draft([[1, "600"], [2, "500"]]))).toBe("overCap");
  });
});

/* ─── community grants ───────────────────────────────────────────── */

describe("grants bench — parsers are strict", () => {
  it("parses the public surface (current + past) the bench rides", () => {
    const read = parseGrantsAdmin(GRANT_SURFACE);
    expect(read?.current?.round.monthKey).toBe("2026-11");
    expect(read?.current?.candidates[0]?.votes).toBe(7);
    expect(read?.past).toEqual([]);
  });

  it("a malformed surface is a failed read, never an empty bench", () => {
    expect(parseGrantsAdmin({ current: { round: {} }, past: [] })).toBeNull();
    expect(parseGrantsAdmin({ past: "nope" })).toBeNull();
    expect(parseGrantsAdmin(null)).toBeNull();
  });

  it("parses settle outcomes in the lib's own literals", () => {
    expect(parseGrantSettleOutcome({ outcome: "paid", winnerCandidateId: "cand-1", amountVb: 5000 }))
      .toMatchObject({ outcome: "paid", amountVb: 5000 });
    expect(parseGrantSettleOutcome({ outcome: "tie" })?.outcome).toBe("tie");
    expect(parseGrantSettleOutcome({})).toBeNull();
  });
});

describe("grants bench — availability mirrors the rail", () => {
  it("settle is offered only when voting closed and the round is undecided", () => {
    const surface = parseGrantsAdmin(GRANT_SURFACE)!.current!;
    expect(grantSettleAvailable(surface)).toBe(true);
    expect(grantSettleAvailable({ ...surface, phase: "voting" })).toBe(false);
    expect(grantSettleAvailable({ ...surface, round: { ...surface.round, resultStatus: "tie" } })).toBe(false);
  });

  it("a paid grant's windows are final", () => {
    const round = parseGrantsAdmin(GRANT_SURFACE)!.current!.round;
    expect(grantWindowsEditable(round)).toBe(true);
    expect(grantWindowsEditable({ ...round, grantStatus: "paid" })).toBe(false);
  });

  it("the API lib settles only from the closed phase — the mirror's premise", () => {
    expect(readApiLib("community-grants.ts")).toContain('phaseOf(round, now) !== "closed"');
  });
});

/* ─── remix king ─────────────────────────────────────────────────── */

describe("remix bench — parsers are strict", () => {
  it("parses an event bundle (entries + no release yet)", () => {
    const bundles = parseRemixAdminEvents({ events: [REMIX_BUNDLE] });
    expect(bundles).toHaveLength(1);
    expect(bundles![0]!.event.status).toBe("judging");
    expect(bundles![0]!.entries[0]?.status).toBe("shortlisted");
    expect(bundles![0]!.release).toBeNull();
  });

  it("a malformed bundle is a failed read, never an empty bench", () => {
    expect(parseRemixAdminEvents({ events: [{ event: { id: "x" } }] })).toBeNull();
    expect(parseRemixAdminEvents({})).toBeNull();
  });
});

describe("remix bench — the transition mirror is the rail's own table", () => {
  it("matches TRANSITIONS in the API lib, state for state", () => {
    const lib = readApiLib("remix-king.ts");
    expect(lib).toContain('draft: ["open", "cancelled"]');
    expect(lib).toContain('open: ["judging", "cancelled"]');
    expect(lib).toContain('judging: ["cancelled"]');
    expect(lib).toContain('decided: ["released", "cancelled"]');
    expect(remixStatusTargets("draft")).toEqual(["open", "cancelled"]);
    expect(remixStatusTargets("judging")).toEqual(["cancelled"]);
    expect(remixStatusTargets("released")).toEqual([]);
    expect(remixStatusTargets("cancelled")).toEqual([]);
  });

  it("the winner verb exists only while judging; shortlist never touches the winner", () => {
    const event = parseRemixAdminEvents({ events: [REMIX_BUNDLE] })![0]!.event;
    expect(remixWinnerAvailable(event)).toBe(true);
    expect(remixWinnerAvailable({ ...event, status: "open" })).toBe(false);
    const entry = parseRemixAdminEvents({ events: [REMIX_BUNDLE] })![0]!.entries[0]! as RemixEntryRow;
    expect(remixShortlistAvailable(entry)).toBe(true);
    expect(remixShortlistAvailable({ ...entry, status: "winner" })).toBe(false);
  });
});

describe("remix bench — the splits mirror is the published contract", () => {
  const draft = (rows: Array<[string, string, string]>): SplitDraft[] =>
    rows.map(([role, payeeName, sharePct]) => ({ role, payeeName, payeeUserId: "", sharePct }));

  it("the published 50/30/20 is sendable and sums to 100", () => {
    const d = draft([["winner", "Maker", "50"], ["king", "Thy Cheat Code", "30"], ["house", "Bow Down Visuals", "20"]]);
    expect(splitDraftError(d)).toBeNull();
    expect(splitDraftSum(d)).toBe(100);
  });

  it("each broken rule names itself", () => {
    expect(splitDraftError([])).toBe("empty");
    expect(splitDraftError(draft([["winner", "A", "40"], ["king", "B", "30"], ["house", "C", "20"], ["house", "D", "10"]]))).toBe("tooMany");
    expect(splitDraftError(draft([["dj", "A", "100"]]))).toBe("roleUnknown");
    expect(splitDraftError(draft([["winner", "A", "50"], ["winner", "B", "50"]]))).toBe("roleDuplicate");
    expect(splitDraftError(draft([["winner", " ", "100"]]))).toBe("nameMissing");
    expect(splitDraftError(draft([["winner", "A", "0"]]))).toBe("shareRange");
    expect(splitDraftError(draft([["king", "A", "100"]]))).toBe("winnerMissing");
    expect(splitDraftError(draft([["winner", "A", "60"], ["king", "B", "30"]]))).toBe("sumNot100");
  });

  it("the API lib holds the same contract (winner required, sum exactly 100)", () => {
    const lib = readApiLib("remix-king.ts");
    expect(lib).toContain("Published splits must add up to exactly 100%");
    expect(lib).toContain('!seen.has("winner")');
  });
});
