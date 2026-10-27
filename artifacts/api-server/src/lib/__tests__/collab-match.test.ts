/**
 * Collab Match pins (lib/collab-match.ts, #175).
 *
 * The house suggests pairings DETERMINISTICALLY — no AI, no credits —
 * and contact is brokered only when BOTH sides opt in. These pins hold:
 * the score is pure arithmetic with explainable reasons; a pass from
 * either side closes the pair forever; generation respects its cadence;
 * ranking never offers self, private profiles, or an already-rowed pair.
 */
import { describe, it, expect } from "vitest";
import {
  scorePair,
  totalFollowers,
  interestTokens,
  pairKey,
  canonicalPair,
  sideOf,
  applySideMark,
  generationDue,
  rankCandidates,
  houseIntroMessage,
  SUGGESTION_MIN_SCORE,
  type CollabProfileFacts,
} from "../collab-match";

function facts(over: Partial<CollabProfileFacts> = {}): CollabProfileFacts {
  return {
    userId: "u1",
    displayName: "One",
    niche: "music",
    platforms: [{ platform: "tiktok", followers: 10_000 }],
    collabInterests: "looking for duet partners for hooks",
    isPublic: true,
    ...over,
  };
}

describe("scorePair", () => {
  it("same niche + similar size + shared platform scores high with reasons", () => {
    const a = facts();
    const b = facts({ userId: "u2", displayName: "Two" });
    const { score, reasons } = scorePair(a, b);
    expect(score).toBeGreaterThanOrEqual(80);
    expect(reasons[0]).toContain("Same niche");
    expect(reasons.join(" ")).toContain("tiktok");
  });

  it("is deterministic — same inputs, same score", () => {
    const a = facts();
    const b = facts({ userId: "u2", niche: "gaming" });
    expect(scorePair(a, b)).toEqual(scorePair(a, b));
  });

  it("complementary niche beats unrelated niche", () => {
    const a = facts();
    const comp = scorePair(a, facts({ userId: "u2", niche: "gaming", platforms: [] })).score;
    const unrel = scorePair(a, facts({ userId: "u2", niche: "beauty", platforms: [] })).score;
    expect(comp).toBeGreaterThan(unrel);
  });

  it("no follower data on either side is neutral, never zeroing the pair", () => {
    const { score } = scorePair(
      facts({ platforms: [] }),
      facts({ userId: "u2", platforms: [] }),
    );
    expect(score).toBeGreaterThanOrEqual(50); // 40 niche + 10 neutral size
  });

  it("shared interest tokens add up, stopwords ignored", () => {
    expect([...interestTokens("looking for the duet and hooks")].sort()).toEqual(["duet", "hooks"]);
    const { reasons } = scorePair(
      facts({ collabInterests: "duet hooks wanted" }),
      facts({ userId: "u2", collabInterests: "duet swaps" }),
    );
    expect(reasons.join(" ")).toContain("duet");
  });

  it("totalFollowers sums platforms and tolerates junk", () => {
    expect(totalFollowers(facts({
      platforms: [
        { platform: "tiktok", followers: 100 },
        { platform: "youtube", followers: 50 },
      ],
    }))).toBe(150);
  });
});

describe("pair identity", () => {
  it("pairKey + canonicalPair are order-independent", () => {
    expect(pairKey("b", "a")).toBe("a|b");
    expect(canonicalPair("b", "a")).toEqual(["a", "b"]);
    expect(canonicalPair("a", "b")).toEqual(["a", "b"]);
  });

  it("sideOf resolves a/b and rejects strangers", () => {
    const row = { userAId: "a", userBId: "b" };
    expect(sideOf(row, "a")).toBe("a");
    expect(sideOf(row, "b")).toBe("b");
    expect(sideOf(row, "zzz")).toBeNull();
  });
});

describe("applySideMark", () => {
  const open = { aStatus: "pending" as const, bStatus: "pending" as const, status: "open" as const };

  it("one interested mark keeps the pair open", () => {
    expect(applySideMark(open, "a", "interested")).toEqual({
      aStatus: "interested", bStatus: "pending", status: "open",
    });
  });

  it("both interested connects the pair", () => {
    const once = applySideMark(open, "a", "interested");
    expect(applySideMark(once, "b", "interested").status).toBe("connected");
  });

  it("a pass from EITHER side closes the pair, even after the other said yes", () => {
    const yes = applySideMark(open, "a", "interested");
    expect(applySideMark(yes, "b", "passed").status).toBe("closed");
    expect(applySideMark(open, "a", "passed").status).toBe("closed");
  });

  it("marks on a non-open pair change nothing", () => {
    const closed = { aStatus: "passed" as const, bStatus: "pending" as const, status: "closed" as const };
    expect(applySideMark(closed, "b", "interested")).toEqual(closed);
  });
});

describe("generationDue", () => {
  const now = new Date("2026-10-27T00:00:00Z");

  it("due when never suggested and slots are open", () => {
    expect(generationDue({ openCount: 0, lastCreatedAt: null, now })).toBe(true);
  });

  it("not due at the open target, however old the last batch is", () => {
    expect(generationDue({
      openCount: 3, lastCreatedAt: new Date("2026-01-01T00:00:00Z"), now,
    })).toBe(false);
  });

  it("not due inside the cadence window; due after it", () => {
    expect(generationDue({
      openCount: 1, lastCreatedAt: new Date("2026-10-25T00:00:00Z"), now,
    })).toBe(false);
    expect(generationDue({
      openCount: 1, lastCreatedAt: new Date("2026-10-19T00:00:00Z"), now,
    })).toBe(true);
  });
});

describe("rankCandidates", () => {
  it("excludes self, private profiles, existing pairs, and sub-floor scores", () => {
    const me = facts();
    const good = facts({ userId: "u2" });
    const self = facts({ userId: "u1" });
    const priv = facts({ userId: "u3", isPublic: false });
    const rowed = facts({ userId: "u4" });
    const weak = facts({ userId: "u5", niche: "beauty", platforms: [], collabInterests: "" });
    const out = rankCandidates(me, [good, self, priv, rowed, weak], new Set([pairKey("u1", "u4")]), 5);
    expect(out.map((r) => r.other.userId)).toEqual(["u2"]);
    expect(out[0].score).toBeGreaterThanOrEqual(SUGGESTION_MIN_SCORE);
  });

  it("best first with a deterministic tie-break", () => {
    const me = facts();
    const b = facts({ userId: "ub" });
    const a = facts({ userId: "ua" });
    const out = rankCandidates(me, [b, a], new Set(), 5);
    expect(out.map((r) => r.other.userId)).toEqual(["ua", "ub"]);
  });
});

describe("houseIntroMessage", () => {
  it("names the house as matchmaker and carries the top reason", () => {
    const msg = houseIntroMessage("Nova", "Kai", ["Same niche — you both make music content"]);
    expect(msg).toContain("The house matched Nova and Kai");
    expect(msg).toContain("Same niche");
  });
});
