import { describe, it, expect } from "vitest";
import {
  LIVE_BATTLE_COPY,
  battleRoundAt,
  battleStatusLabel,
  battleViewerActions,
  battleWinnerLabel,
  cardForSide,
  liveBattleActionPath,
  liveBattleByStreamPath,
  liveBattleTallyPath,
  tallyShare,
  voteEligibility,
  type LiveBattle,
} from "./live-battles";

/* Live Battles (#154): client mirror of the battle rules. The copy
   is pinned verbatim — the UI must SAY that tips never count as
   votes and that no money moves, not just implement it. */

const card = (over: Partial<LiveBattle["challenger"]> = {}) => ({
  user_id: "u-ch",
  profile_id: "p-ch",
  display_name: "Thy Cheat Code",
  slug: "thy-cheat-code",
  avatar_url: null,
  ...over,
});

const START = "2026-10-26T12:00:00.000Z";
const END = "2026-10-26T12:04:30.000Z"; // 3 rounds x 90s

const battle = (over: Partial<LiveBattle> = {}): LiveBattle => ({
  id: "11111111-1111-4111-8111-111111111111",
  theme: "Golden Hour",
  status: "live",
  round_count: 3,
  round_seconds: 90,
  stream_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  starts_at: START,
  ends_at: END,
  result: null,
  winner_user_id: null,
  void_reason: null,
  spectacle_announced_at: null,
  challenger: card(),
  opponent: card({ user_id: "u-op", profile_id: "p-op", display_name: "Opponent", slug: "opponent" }),
  tally: { challenger: 0, opponent: 0, total: 0, perRound: [] },
  current_round: 1,
  viewer_side: null,
  my_vote: null,
  created_at: START,
  updated_at: START,
  ...over,
});

describe("LIVE_BATTLE_COPY", () => {
  it("states votes are recorded-only and tips never count", () => {
    expect(LIVE_BATTLE_COPY.votesAreRecorded).toContain("recorded votes only");
    expect(LIVE_BATTLE_COPY.votesAreRecorded).toContain("Tips never count as votes");
  });
  it("states no money moves and the prize is honours", () => {
    expect(LIVE_BATTLE_COPY.noMoney).toContain("charge nothing and pay out nothing");
    expect(LIVE_BATTLE_COPY.noMoney).toContain("honours, never money");
  });
  it("states a tie crowns nobody", () => {
    expect(LIVE_BATTLE_COPY.tieKeepsCrown).toContain("crowns nobody");
  });
});

describe("paths", () => {
  it("builds encoded paths for every door", () => {
    expect(liveBattleByStreamPath("s 1")).toBe("/api/live-battles/by-stream/s%201");
    expect(liveBattleTallyPath("id/1")).toBe("/api/live-battles/id%2F1/tally");
    expect(liveBattleActionPath("abc", "vote")).toBe("/api/live-battles/abc/vote");
    expect(liveBattleActionPath("abc", "finalize")).toBe("/api/live-battles/abc/finalize");
  });
});

describe("tallyShare", () => {
  it("zero votes reads 0/0 — never a fabricated even split", () => {
    expect(tallyShare({ challenger: 0, opponent: 0, total: 0 })).toEqual({ challenger: 0, opponent: 0 });
  });
  it("shares are whole percents that total 100", () => {
    expect(tallyShare({ challenger: 2, opponent: 1, total: 3 })).toEqual({ challenger: 67, opponent: 33 });
    expect(tallyShare({ challenger: 1, opponent: 1, total: 2 })).toEqual({ challenger: 50, opponent: 50 });
  });
});

describe("battleRoundAt — mirrors the service window", () => {
  it("slices the window into exact rounds and closes at the end", () => {
    const b = battle();
    expect(battleRoundAt(b, new Date(START))).toBe(1);
    expect(battleRoundAt(b, new Date("2026-10-26T12:01:30.000Z"))).toBe(2);
    expect(battleRoundAt(b, new Date("2026-10-26T12:04:29.000Z"))).toBe(3);
    expect(battleRoundAt(b, new Date(END))).toBeNull();
    expect(battleRoundAt(b, new Date("2026-10-26T11:59:00.000Z"))).toBeNull();
    expect(battleRoundAt(battle({ starts_at: null, ends_at: null }), new Date(START))).toBeNull();
  });
});

describe("battleViewerActions — mirrors the service lifecycle", () => {
  it("the opponent answers a pending challenge; the challenger cancels", () => {
    expect(battleViewerActions(battle({ status: "pending", viewer_side: "opponent" }))).toEqual(["accept", "decline"]);
    expect(battleViewerActions(battle({ status: "pending", viewer_side: "challenger" }))).toEqual(["cancel"]);
  });
  it("either battler starts an accepted battle; nobody else acts", () => {
    expect(battleViewerActions(battle({ status: "accepted", viewer_side: "challenger" }))).toEqual(["cancel", "start"]);
    expect(battleViewerActions(battle({ status: "accepted", viewer_side: "opponent" }))).toEqual(["start"]);
    expect(battleViewerActions(battle({ status: "accepted", viewer_side: null }))).toEqual([]);
    expect(battleViewerActions(battle({ status: "live", viewer_side: null }))).toEqual([]);
  });
  it("a live battle offers finalize only once its window has ended", () => {
    const during = new Date("2026-10-26T12:02:00.000Z");
    const after = new Date("2026-10-26T12:05:00.000Z");
    expect(battleViewerActions(battle({ viewer_side: "challenger" }), during)).toEqual([]);
    expect(battleViewerActions(battle({ viewer_side: "challenger" }), after)).toEqual(["finalize"]);
  });
});

describe("voteEligibility — mirrors castVote's guards", () => {
  const during = new Date("2026-10-26T12:02:00.000Z");
  it("a signed-in fan inside the window can vote", () => {
    expect(voteEligibility(battle(), { signedIn: true, now: during })).toEqual({ canVote: true, reason: null });
  });
  it("guests watch only; battlers never vote; closed windows refuse", () => {
    expect(voteEligibility(battle(), { signedIn: false, now: during }).canVote).toBe(false);
    expect(voteEligibility(battle(), { signedIn: false, now: during }).reason).toContain("sign-in");
    expect(voteEligibility(battle({ viewer_side: "challenger" }), { signedIn: true, now: during }).reason).toContain("battlers can't vote");
    expect(voteEligibility(battle(), { signedIn: true, now: new Date(END) }).canVote).toBe(false);
    expect(voteEligibility(battle({ status: "pending" }), { signedIn: true, now: during }).reason).toContain("opens when the battle is live");
  });
});

describe("labels", () => {
  it("status labels are honest", () => {
    expect(battleStatusLabel("live")).toContain("voting open");
    expect(battleStatusLabel("voided")).toBe("Cut off");
    expect(battleStatusLabel("pending")).toContain("waiting");
  });
  it("the winner label comes from the stamped result; ties crown nobody", () => {
    expect(battleWinnerLabel(battle({ status: "completed", result: "challenger" }))).toBe("Thy Cheat Code takes the crown");
    expect(battleWinnerLabel(battle({ status: "completed", result: "tie" }))).toContain("no winner");
    expect(battleWinnerLabel(battle({ status: "live", result: null }))).toBeNull();
  });
  it("cardForSide picks the right card", () => {
    expect(cardForSide(battle(), "opponent")?.slug).toBe("opponent");
    expect(cardForSide(battle(), "challenger")?.slug).toBe("thy-cheat-code");
  });
});
