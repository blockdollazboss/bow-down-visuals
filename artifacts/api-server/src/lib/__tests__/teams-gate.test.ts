/**
 * teams-gate.test.ts — the Team Workspace entitlement gate.
 *
 * THE BUG THIS PINS AGAINST: isShotCallerOrHigher used to read
 * profiles.plan_tier — a legacy column whose only writer is the manual
 * admin endpoint (/api/admin/plan/set; migration 0039: "assigned
 * manually … until real checkout exists"). It defaults to 1 and nothing
 * a user does ever raises it, so the gate was closed to every self-serve
 * creator, including creators who had EARNED ★4 Shot Caller on the real
 * ladder. The staging walk reproduced it: Test Creator (earned ★2) met
 * the gate — and so would a creator at earned ★4/★5/★6.
 *
 * THE RULE: the gate reads the earned rank from lib/creator-rank.ts —
 * the single source of truth whose header names this gate as a reader
 * ("Rank is NEVER purchasable. No source counts … plan tier"). ★4+
 * passes, ★3 and below do not, and a failed rank read fails closed.
 *
 * Reachability is proven with the REAL rankFromCounts: point profiles a
 * real creator can actually produce are fed through the genuine ladder
 * math, so "can anyone ever pass?" is answered by computation, not by a
 * stubbed star count alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

vi.mock("@workspace/db", () => ({
  db: {},
  teamsTable: {},
  teamMembersTable: {},
}));

vi.mock("../creator-rank", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getCreatorRank: vi.fn() };
});

import { isShotCallerOrHigher } from "../teams";
import { getCreatorRank, rankFromCounts, EMPTY_RANK_COUNTS, type RankCounts } from "../creator-rank";

const mockedRank = vi.mocked(getCreatorRank);

function rankWith(stars: number) {
  return { ...rankFromCounts(EMPTY_RANK_COUNTS), stars };
}

beforeEach(() => {
  mockedRank.mockReset();
});

describe("isShotCallerOrHigher — the earned-rank gate", () => {
  it("opens at ★4 Shot Caller and above", async () => {
    for (const stars of [4, 5, 6]) {
      mockedRank.mockResolvedValue(rankWith(stars) as any);
      await expect(isShotCallerOrHigher("u1")).resolves.toBe(true);
    }
  });

  it("stays closed at ★3 and below", async () => {
    for (const stars of [1, 2, 3]) {
      mockedRank.mockResolvedValue(rankWith(stars) as any);
      await expect(isShotCallerOrHigher("u1")).resolves.toBe(false);
    }
  });

  it("fails closed when the rank read fails", async () => {
    mockedRank.mockRejectedValue(new Error("db gone"));
    await expect(isShotCallerOrHigher("u1")).resolves.toBe(false);
  });

  it("fails closed on a malformed rank", async () => {
    mockedRank.mockResolvedValue({} as any);
    await expect(isShotCallerOrHigher("u1")).resolves.toBe(false);
  });
});

describe("reachability — real point profiles through the real ladder", () => {
  function gateForCounts(counts: Partial<RankCounts>) {
    const rank = rankFromCounts({ ...EMPTY_RANK_COUNTS, ...counts });
    mockedRank.mockResolvedValue(rank as any);
    return { rank, gate: isShotCallerOrHigher("u1") };
  }

  it("a working creator CAN reach the gate: 300 points of published work = ★4", async () => {
    // 10 tracks (100) + 10 videos (150) + 50 followers (50) = 300 pts.
    const { rank, gate } = gateForCounts({ publishedTracks: 10, publishedVideos: 10, followers: 50 });
    expect(rank.points).toBe(300);
    expect(rank.stars).toBe(4);
    await expect(gate).resolves.toBe(true);
  });

  it("the staging-walk account shape (46 pts, ★2 Hustler) is under the gate — correctly", async () => {
    // 2 tracks (20) + 1 video (15) + 11 followers (11) = 46 pts.
    const { rank, gate } = gateForCounts({ publishedTracks: 2, publishedVideos: 1, followers: 11 });
    expect(rank.points).toBe(46);
    expect(rank.stars).toBe(2);
    await expect(gate).resolves.toBe(false);
  });

  it("★3 Gangster (100 pts) is still under the gate — the threshold is exactly ★4", async () => {
    const { rank, gate } = gateForCounts({ publishedTracks: 10 });
    expect(rank.stars).toBe(3);
    await expect(gate).resolves.toBe(false);
  });
});

describe("the gate's source — wiring pins", () => {
  const src = readFileSync(fileURLToPath(new URL("../teams.ts", import.meta.url)), "utf8");

  it("derives from lib/creator-rank, the ladder's single source of truth", () => {
    expect(src).toContain('from "./creator-rank"');
    expect(src).toContain("getCreatorRank");
  });

  it("never consults the legacy plan_tier column again", () => {
    expect(src).not.toContain("getUserPlanTier");
    expect(src).not.toContain('select("plan_tier")');
    expect(src).not.toContain("getSupabaseAdmin");
  });
});
