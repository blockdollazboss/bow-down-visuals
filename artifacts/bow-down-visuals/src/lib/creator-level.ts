import { useUserMode, type StarLevel } from "@/contexts/UserModeContext";

/**
 * Creator Level — EARNED RANK (owner ruling, 2026-10-17: "Make stars
 * earned rank").
 *
 * Stars are no longer a self-picked difficulty dial. The server computes
 * them from recorded work (artifacts/api-server/src/lib/creator-rank.ts
 * is the single ladder: published tracks/videos, completed exports,
 * followers, streams hosted, tips received, store/shop sales, paid
 * memberships — points with caps, thresholds 0/25/100/300/700/1400, and
 * business gates at ★5/★6). Rank is never purchasable: no plan tier,
 * pack, or balance moves it. `useUserMode().stars` is that earned rank,
 * read from GET /api/retention/rank.
 *
 * HOW GATING WORKS NOW
 * 1. Rank displays (sidebar, nameplate, celebrations) show EARNED stars.
 * 2. Control exposure — `data-min-stars="N"` attributes (global CSS) and
 *    `useMinStars(N)` — evaluates against GATE stars:
 *      gateStars = max(earnedStars, your pre-earned-rank saved level)
 *    The second term is the grandfather rule: the day earned rank
 *    shipped, nobody's controls shrank because of it. Your saved dial
 *    value is a floor for exposure only — it is never displayed as rank
 *    and it can never raise your rank. New accounts have no saved
 *    level, so their exposure is purely earned.
 * 3. Turbo/Advanced (simple/advanced) remains a display MODE the user
 *    picks (sidebar/editor switch, persisted separately); it is not a
 *    rank and it is not gated by one beyond the editor's Pro switch,
 *    which follows gate stars like every other exposure gate.
 *
 * HARD RULES (unchanged)
 * - More stars only ever ADD controls; quality never drops at low stars.
 * - NEVER gate the primary CTA (Generate / Create / Export).
 * - NEVER gate the only path to confirm, cancel, close, or view credits.
 * - Prices and credit confirmations are identical at every level.
 */

export const STAR_RANKS = [
  "Street Punk",
  "Hustler",
  "Gangster",
  "Shot Caller",
  "Crime Boss",
  "Kingpin",
] as const;

export const STAR_TAGLINES = [
  "Turbo. Just create.",
  "AI runs it, you approve.",
  "AI + your tweaks.",
  "Your call, AI assists.",
  "Pro controls unlocked.",
  "Every knob, every setting.",
] as const;

export interface CreatorLevelInfo {
  stars: StarLevel;
  rank: (typeof STAR_RANKS)[number];
  tagline: (typeof STAR_TAGLINES)[number];
}

export const CREATOR_LEVELS: CreatorLevelInfo[] = ([1, 2, 3, 4, 5, 6] as const).map(
  (stars) => ({
    stars,
    rank: STAR_RANKS[stars - 1],
    tagline: STAR_TAGLINES[stars - 1],
  }),
);

export function levelInfo(stars: StarLevel): CreatorLevelInfo {
  return CREATOR_LEVELS[stars - 1];
}

/** The earned-rank DTO returned by GET /api/retention/rank — mirrors
 *  the server's RankResult in lib/creator-rank.ts. */
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

function clampStars(n: number): StarLevel {
  if (!Number.isFinite(n)) return 1;
  return Math.min(6, Math.max(1, Math.floor(n))) as StarLevel;
}

/**
 * Gate stars — the grandfather rule in one line. Control exposure never
 * shrinks the day earned rank ships: a creator keeps every control
 * their saved (pre-earned-rank) level already exposed, and earned stars
 * take over as soon as they pass it. The saved level is a floor for
 * exposure only; it is never rank.
 */
export function gateStarsFor(earnedStars: number, legacyFloor: number): StarLevel {
  return clampStars(Math.max(clampStars(earnedStars), clampStars(legacyFloor)));
}

/** True when the user's GATE stars (earned, grandfather-floored) reach
 *  `level`. Control-exposure checks use this — see the header. */
export function useMinStars(level: StarLevel): boolean {
  const { gateStars } = useUserMode();
  return gateStars >= level;
}
