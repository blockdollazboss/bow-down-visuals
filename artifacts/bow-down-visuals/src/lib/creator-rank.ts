/**
 * creator-rank.ts — pure earned-rank helpers for the frontend.
 *
 * Kept free of React/JSX imports so the node test harness can pin the
 * math directly (the repo's established pure-contract split). The
 * server ladder itself lives in artifacts/api-server/src/lib/
 * creator-rank.ts; this module mirrors only what the client needs:
 * the rank DTO shape and the grandfather rule for control exposure.
 */

export type StarLevelLike = 1 | 2 | 3 | 4 | 5 | 6;

/** The earned-rank DTO returned by GET /api/retention/rank — mirrors
 *  the server's RankResult in lib/creator-rank.ts (API side). */
export interface CreatorRankGateDto {
  key: "businessResults" | "publishedWorks";
  label: string;
  have: number;
  need: number;
  met: boolean;
}

export interface CreatorRankDto {
  stars: number;
  points: number;
  counts: Record<string, number>;
  breakdown: Record<string, number>;
  businessResults: number;
  publishedWorks: number;
  next: {
    stars: number;
    pointsAt: number;
    pointsNeeded: number;
    gates: CreatorRankGateDto[];
  } | null;
  hints: string[];
}

export function clampStars(n: number): StarLevelLike {
  if (!Number.isFinite(n)) return 1;
  return Math.min(6, Math.max(1, Math.floor(n))) as StarLevelLike;
}

/**
 * Gate stars — the grandfather rule in one line. Control exposure
 * (data-min-stars CSS, useMinStars) never shrinks the day earned rank
 * ships: a creator keeps every control their saved (pre-earned-rank)
 * level already exposed, and earned stars take over as soon as they
 * pass it. The saved level is a floor for exposure only; it is never
 * displayed as rank and can never raise rank.
 */
export function gateStarsFor(earnedStars: number, legacyFloor: number): StarLevelLike {
  return clampStars(Math.max(clampStars(earnedStars), clampStars(legacyFloor)));
}
