/**
 * Creator Room evolution — the pure client dressing (Ring 3,
 * Phase 5).
 *
 * The LADDER lives server-side in lib/creator-rank (the single
 * source): the room DTO carries the owner's earned stars + the
 * rung names. This module owns only how a tier LOOKS and how the
 * panels phrase it — a gold progression that deepens as the room
 * levels, from a plain bronze trim at ★1 to the radiant house gold
 * at ★6. No names, thresholds or points math live here: the words
 * come off the DTO, and an unmeasured room (evolution null) gets
 * no dressing and no line at all.
 */

import type { CreatorRoomEvolution } from "./creator-rooms";

/** The trim color per tier (index 0 = ★1 … 5 = ★6): bronze warming
 *  into the house gold and past it. */
export const CREATOR_TIER_TRIMS: readonly string[] = [
  "#8a6d3b", // ★1 — plain bronze
  "#a07d2c", // ★2 — worked bronze
  "#b08a24", // ★3 — antique gold
  "#c9a84c", // ★4 — the house gold
  "#e3c566", // ★5 — bright gold
  "#f5d778", // ★6 — radiant gold
] as const;

export interface CreatorRoomTierDressing {
  /** 0-based tier index (stars − 1, clamped to the ladder). */
  tierIndex: number;
  trimHex: string;
}

/** The dressing for a star count — clamped to the ladder's ends,
 *  so an out-of-range count dresses as the nearest real rung. */
export function creatorRoomTierDressing(stars: number): CreatorRoomTierDressing {
  const tierIndex = Math.min(
    CREATOR_TIER_TRIMS.length - 1,
    Math.max(0, (Math.floor(stars) || 1) - 1),
  );
  return { tierIndex, trimHex: CREATOR_TIER_TRIMS[tierIndex]! };
}

/** The star row alone: "★★★" — the scene's rank plate and the
 *  panels share the shape. */
export function creatorRoomStars(stars: number): string {
  const n = Math.min(6, Math.max(1, Math.floor(stars) || 1));
  return "★".repeat(n);
}

/** The scene's rank plate line: the stars + the rung's own name,
 *  off the DTO. Null when the room is unmeasured. */
export function creatorRoomRankLine(evolution: CreatorRoomEvolution | null): string | null {
  if (!evolution) return null;
  return `${creatorRoomStars(evolution.stars)} ${evolution.tierName}`;
}

/** The panels' evolution line: where the room stands and what
 *  stands next — the next rung's name and (when the server
 *  measured one) the points still needed. At the top of the
 *  ladder it says so. Null when unmeasured. */
export function creatorRoomEvolutionLine(evolution: CreatorRoomEvolution | null): string | null {
  if (!evolution) return null;
  const head = `${creatorRoomStars(evolution.stars)} ${evolution.tierName}`;
  if (!evolution.nextTierName) return `${head} — the top of the ladder`;
  const pts =
    evolution.pointsNeeded !== null && evolution.pointsNeeded > 0
      ? ` · ${evolution.pointsNeeded.toLocaleString("en-US")} pts to go`
      : "";
  return `${head} — next: ${evolution.nextTierName}${pts}`;
}
