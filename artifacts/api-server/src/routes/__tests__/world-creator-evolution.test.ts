/**
 * Creator Room evolution (Ring 3, Phase 5) — the rank → DTO seam.
 *
 * Pinned contract:
 * - The ladder has ONE source: lib/creator-rank. STAR_TITLES names
 *   its rungs there, and the room DTO carries those names — built
 *   by creatorRoomEvolutionFromRank from a RankResult, never from
 *   a second ladder anywhere.
 * - The DTO names the current rung, the next rung (null at the
 *   top) and the points still needed (null at the top).
 * - starTitle clamps out-of-range counts to the nearest real rung.
 */
import { describe, it, expect } from "vitest";
import { STAR_TITLES, starTitle, type RankResult } from "../../lib/creator-rank";
import { creatorRoomEvolutionFromRank } from "../world";

function rank(partial: Partial<RankResult>): RankResult {
  return {
    stars: 1,
    points: 0,
    counts: {
      publishedTracks: 0,
      publishedVideos: 0,
      exports: 0,
      followers: 0,
      streamsHosted: 0,
      tipsReceived: 0,
      sales: 0,
      membershipsSold: 0,
    },
    breakdown: {
      publishedTracks: 0,
      publishedVideos: 0,
      exports: 0,
      followers: 0,
      streamsHosted: 0,
      tipsReceived: 0,
      sales: 0,
      membershipsSold: 0,
    },
    businessResults: 0,
    publishedWorks: 0,
    next: { stars: 2, pointsAt: 25, pointsNeeded: 25, gates: [] },
    hints: [],
    ...partial,
  };
}

describe("the ladder's names (lib/creator-rank, the single source)", () => {
  it("names all six rungs in order", () => {
    expect(STAR_TITLES).toEqual([
      "Street Punk",
      "Hustler",
      "Gangster",
      "Shot Caller",
      "Crime Boss",
      "Kingpin",
    ]);
    expect(starTitle(1)).toBe("Street Punk");
    expect(starTitle(4)).toBe("Shot Caller");
    expect(starTitle(6)).toBe("Kingpin");
  });

  it("clamps out-of-range counts to the nearest real rung", () => {
    expect(starTitle(0)).toBe("Street Punk");
    expect(starTitle(99)).toBe("Kingpin");
  });
});

describe("creatorRoomEvolutionFromRank", () => {
  it("carries stars, the rung name, the next rung and the points needed", () => {
    const evo = creatorRoomEvolutionFromRank(
      rank({ stars: 3, next: { stars: 4, pointsAt: 300, pointsNeeded: 120, gates: [] } }),
    );
    expect(evo).toEqual({
      stars: 3,
      tierName: "Gangster",
      nextTierName: "Shot Caller",
      pointsNeeded: 120,
    });
  });

  it("at the top of the ladder the next rung and points read null, never invented", () => {
    const evo = creatorRoomEvolutionFromRank(rank({ stars: 6, next: null }));
    expect(evo).toEqual({
      stars: 6,
      tierName: "Kingpin",
      nextTierName: null,
      pointsNeeded: null,
    });
  });
});
