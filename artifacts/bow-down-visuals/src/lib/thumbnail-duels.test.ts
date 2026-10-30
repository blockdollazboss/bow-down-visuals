/**
 * Thumbnail Duels (#174) — creator-desk helpers.
 * The anti-fake rule is pinned here: every formatted line carries the
 * raw counts; a percentage never appears without its numbers, and no
 * winner line exists for a duel the server has not resolved.
 */
import { describe, expect, it } from "vitest";
import {
  buildDuelStartPayload,
  clampDuelTargetViews,
  duelProgress,
  duelScoreLine,
  duelWinnerLine,
  mergeCandidateCovers,
  DUEL_TARGET_VIEWS_DEFAULT,
  DUEL_TARGET_VIEWS_MAX,
  DUEL_TARGET_VIEWS_MIN,
  type DuelRecord,
  type DuelResults,
} from "./thumbnail-duels";

const results: DuelResults = {
  viewsA: 198,
  viewsB: 212,
  clicksA: 33,
  clicksB: 41,
  totalViews: 410,
  totalClicks: 74,
  targetViews: 100,
  clickRateA: 16.7,
  clickRateB: 19.3,
};

describe("clampDuelTargetViews (mirrors the server band)", () => {
  it("clamps into [20, 10000] and defaults junk", () => {
    expect(clampDuelTargetViews(5)).toBe(DUEL_TARGET_VIEWS_MIN);
    expect(clampDuelTargetViews(999999)).toBe(DUEL_TARGET_VIEWS_MAX);
    expect(clampDuelTargetViews(250.6)).toBe(251);
    expect(clampDuelTargetViews(undefined)).toBe(DUEL_TARGET_VIEWS_DEFAULT);
    expect(clampDuelTargetViews("lots")).toBe(DUEL_TARGET_VIEWS_DEFAULT);
  });
});

describe("mergeCandidateCovers", () => {
  it("dedupes by URL, keeps the first label, drops blanks", () => {
    const merged = mergeCandidateCovers(
      [{ url: " https://x/a.png ", label: "Winner" }],
      [
        { url: "https://x/a.png", label: "Variant 1" },
        { url: "", label: "blank" },
        { url: "https://x/b.png", label: "" },
      ],
    );
    expect(merged).toEqual([
      { url: "https://x/a.png", label: "Winner" },
      { url: "https://x/b.png", label: "Cover" },
    ]);
  });
});

describe("buildDuelStartPayload", () => {
  it("requires a challenger; omits a blank cover A so the server uses the current thumbnail", () => {
    expect(buildDuelStartPayload({ coverBUrl: "  " })).toBeNull();
    expect(buildDuelStartPayload({ coverBUrl: "https://x/b.png" })).toEqual({
      coverBUrl: "https://x/b.png",
      targetViews: DUEL_TARGET_VIEWS_DEFAULT,
    });
    expect(
      buildDuelStartPayload({ coverAUrl: "https://x/a.png", coverBUrl: "https://x/b.png", targetViews: 3 }),
    ).toEqual({ coverBUrl: "https://x/b.png", coverAUrl: "https://x/a.png", targetViews: DUEL_TARGET_VIEWS_MIN });
  });
});

describe("duelProgress", () => {
  it("reports counted vs target with the derived pct capped at 100", () => {
    expect(duelProgress(results)).toEqual({ counted: 410, target: 100, pct: 100, reached: true });
    expect(duelProgress({ ...results, totalViews: 40 })).toEqual({
      counted: 40,
      target: 100,
      pct: 40,
      reached: false,
    });
  });
});

describe("duelScoreLine — counts always ride along", () => {
  it("names views and clicks beside the rate, for both covers", () => {
    expect(duelScoreLine("a", results)).toBe("Cover A — 198 views · 33 clicks (16.7% click rate)");
    expect(duelScoreLine("b", results)).toBe("Cover B — 212 views · 41 clicks (19.3% click rate)");
  });
});

describe("duelWinnerLine", () => {
  const duel: DuelRecord = {
    id: "d1",
    status: "resolved",
    winner: "b",
    cover_a_url: "https://x/a.png",
    cover_b_url: "https://x/b.png",
    target_views: 100,
  };

  it("states the verdict in raw counts and the takeover", () => {
    expect(duelWinnerLine(duel, results)).toBe(
      "Cover B won — 41 clicks from 212 views against 33 clicks from 198 views. It is now this video's thumbnail.",
    );
  });

  it("is null while running, tied, or winner-less — never declared on vibes", () => {
    expect(duelWinnerLine({ ...duel, status: "running", winner: null }, results)).toBeNull();
    expect(duelWinnerLine({ ...duel, winner: null }, results)).toBeNull();
    expect(duelWinnerLine({ ...duel, status: "cancelled", winner: "a" }, results)).toBeNull();
  });
});
