/**
 * Money-integrity + logic tests for the Milestone Tracker / Catalog Vault.
 *
 * Covers: the 200 VB one-time vault price, the award ladder (bronze → diamond),
 * next-step computation, and the CSV importer (header aliases, malformed
 * rows skipped, honest source attribution). The vault flow is 402 → charge →
 * auto-refund, matching the invoice generator's contract.
 */
import { describe, expect, it } from "vitest";
import {
  CATALOG_VAULT_CREDIT_COST,
  AWARD_STEPS,
  awardFor,
  nextStepAfter,
  parseMilestoneCsv,
  VERTICAL_LADDERS,
  FOLLOWERS_LADDER,
  EARNINGS_LADDER,
  RELEASES_LADDER,
  crossedSteps,
  tierRank,
} from "../milestones";

describe("Catalog Vault pricing", () => {
  it("costs 200 Visual Bucs one-time per release", () => {
    expect(CATALOG_VAULT_CREDIT_COST).toBe(200);
  });
});

describe("award ladder", () => {
  it("has 5 rungs in ascending order", () => {
    const ats = AWARD_STEPS.map((s) => s.at);
    expect(ats).toEqual([1_000, 10_000, 100_000, 1_000_000, 10_000_000]);
  });

  it("awards the highest earned tier", () => {
    expect(awardFor(0)).toBe("none");
    expect(awardFor(999)).toBe("none");
    expect(awardFor(1_000)).toBe("bronze");
    expect(awardFor(50_000)).toBe("silver");
    expect(awardFor(100_000)).toBe("gold");
    expect(awardFor(2_500_000)).toBe("platinum");
    expect(awardFor(10_000_000)).toBe("diamond");
  });

  it("computes the next milestone after the current count", () => {
    expect(nextStepAfter(0)?.at).toBe(1_000);
    expect(nextStepAfter(1_000)?.at).toBe(10_000);
    expect(nextStepAfter(99_999)?.at).toBe(100_000);
    expect(nextStepAfter(10_000_000)).toBeNull();
  });
});

describe("CSV importer", () => {
  it("parses header + rows with alias headers", () => {
    const { rows, skipped } = parseMilestoneCsv(
      "title,service,plays\nMidnight Run,spotify,102400\nBlue Hour,apple music,\"38,200\"\n"
    );
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      { trackTitle: "Midnight Run", platform: "spotify", streamCount: 102400 },
      { trackTitle: "Blue Hour", platform: "apple music", streamCount: 38200 },
    ]);
  });

  it("skips malformed rows without failing the import", () => {
    const { rows, skipped } = parseMilestoneCsv(
      "track_title,platform,streams\nGood Song,spotify,5000\n,spotify,10\nBad Song,spotify,nope\n"
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("rejects a CSV missing the required headers", () => {
    const { rows, skipped } = parseMilestoneCsv("foo,bar\n1,2\n");
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("caps at 500 rows", () => {
    const header = "track_title,platform,streams";
    const body = Array.from({ length: 600 }, (_, i) => `Song ${i},spotify,${i + 1}`).join("\n");
    const { rows } = parseMilestoneCsv(`${header}\n${body}`);
    expect(rows).toHaveLength(500);
  });
});

describe("brag ladder", () => {
  it("has 4 verticals with 5 ascending rungs each", () => {
    expect(Object.keys(VERTICAL_LADDERS).sort()).toEqual([
      "earnings",
      "followers",
      "releases",
      "streams",
    ]);
    for (const ladder of Object.values(VERTICAL_LADDERS)) {
      expect(ladder).toHaveLength(5);
      const ats = ladder.map((s) => s.at);
      expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    }
  });

  it("streams ladder mirrors the award ladder", () => {
    expect(VERTICAL_LADDERS.streams.map((s) => s.at)).toEqual(AWARD_STEPS.map((s) => s.at));
    expect(VERTICAL_LADDERS.streams.map((s) => s.tier)).toEqual(AWARD_STEPS.map((s) => s.tier));
  });

  it("detects newly crossed steps (exclusive lower, inclusive upper)", () => {
    const streams = VERTICAL_LADDERS.streams;
    expect(crossedSteps(streams, 0, 999)).toEqual([]);
    expect(crossedSteps(streams, 0, 1_000).map((s) => s.tier)).toEqual(["bronze"]);
    /* Re-logging the same count crosses nothing — no double brag. */
    expect(crossedSteps(streams, 10_000, 10_000)).toEqual([]);
    expect(crossedSteps(streams, 9_999, 10_000).map((s) => s.tier)).toEqual(["silver"]);
    /* One log can cross several rungs at once. */
    expect(crossedSteps(streams, 0, 5_000_000).map((s) => s.tier)).toEqual([
      "bronze",
      "silver",
      "gold",
      "platinum",
    ]);
  });

  it("ranks tiers for upgrade detection", () => {
    expect(tierRank("none")).toBe(0);
    expect(tierRank("bronze")).toBeLessThan(tierRank("silver"));
    expect(tierRank("silver")).toBeLessThan(tierRank("gold"));
    expect(tierRank("gold")).toBeLessThan(tierRank("platinum"));
    expect(tierRank("platinum")).toBeLessThan(tierRank("diamond"));
    expect(tierRank("bogus")).toBe(0);
  });

  it("sets honest, distinct thresholds per vertical", () => {
    expect(FOLLOWERS_LADDER[0]!.at).toBe(100);
    expect(EARNINGS_LADDER[0]!.at).toBe(100);
    expect(RELEASES_LADDER[0]!.at).toBe(1);
    expect(EARNINGS_LADDER.map((s) => s.tierLabel)).toContain("First $100");
  });
});
