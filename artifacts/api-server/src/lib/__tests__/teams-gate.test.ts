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
 *
 * OWNER EXEMPTION (added Nov 4, 2026, admin-unrestricted re-verification):
 * the gate is a customer POLICY gate, so an admin account passes at any
 * earned rank through the one fail-closed predicate (lib/admin.ts —
 * isAdminUserId), per the standing Oct 29 rule. The final describe pins
 * that leg; the predicate's own fail-closed proofs live in
 * admin-unrestricted.test.ts.
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

/* The admin predicate is seamed here the same way: the gate consumes
   isAdminUserId from lib/admin.ts (the ONE fail-closed definition).
   The predicate's own fail-closed behaviour (unset env → false,
   lookup error → false) is pinned in admin-unrestricted.test.ts;
   these tests pin the GATE's use of it. Default: not an admin, so
   every pre-existing case above resolves exactly as before. */
vi.mock("../admin", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, isAdminUserId: vi.fn() };
});

import { isShotCallerOrHigher } from "../teams";
import { getCreatorRank, rankFromCounts, EMPTY_RANK_COUNTS, type RankCounts } from "../creator-rank";
import { isAdminUserId } from "../admin";

const mockedRank = vi.mocked(getCreatorRank);
const mockedAdmin = vi.mocked(isAdminUserId);

function rankWith(stars: number) {
  return { ...rankFromCounts(EMPTY_RANK_COUNTS), stars };
}

beforeEach(() => {
  mockedRank.mockReset();
  mockedAdmin.mockReset();
  mockedAdmin.mockResolvedValue(false);
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

  it("carries the owner exemption through the ONE admin predicate", () => {
    expect(src).toContain('from "./admin"');
    expect(src).toContain("isAdminUserId");
  });
});

describe("owner exemption — the admin leg (Nov 4, 2026 re-verification)", () => {
  /* Standing rule (Oct 29, 2026): an admin account carries no customer
     restrictions. The ★4 gate locks a FEATURE, so it is a policy gate
     and admins pass it — through the same fail-closed predicate every
     other exemption uses. The ladder is untouched: these tests pin
     that the admin leg short-circuits the LOCK, and that non-admins
     resolve through the identical rank read as before (the describes
     above, with the predicate defaulted to false). */

  it("an admin passes at ★1 — and the ladder is never consulted", async () => {
    mockedAdmin.mockResolvedValue(true);
    mockedRank.mockResolvedValue(rankWith(1) as any);
    await expect(isShotCallerOrHigher("owner-1")).resolves.toBe(true);
    expect(mockedRank).not.toHaveBeenCalled();
  });

  it("an admin passes even when the rank read would fail", async () => {
    mockedAdmin.mockResolvedValue(true);
    mockedRank.mockRejectedValue(new Error("db gone"));
    await expect(isShotCallerOrHigher("owner-1")).resolves.toBe(true);
  });

  it("the predicate is consulted with the caller's own id", async () => {
    mockedRank.mockResolvedValue(rankWith(4) as any);
    await expect(isShotCallerOrHigher("someone")).resolves.toBe(true);
    expect(mockedAdmin).toHaveBeenCalledWith("someone");
  });
});
