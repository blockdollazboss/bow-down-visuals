import { useUserMode, type StarLevel } from "@/contexts/UserModeContext";

/**
 * Creator Level difficulty engine — the single source of truth for the
 * GTA-style 6-star difficulty dial.
 *
 * 1 star (Street Punk) = easiest: AI autopilot, minimal buttons.
 * 6 stars (Kingpin)   = hardest: every manual control exposed.
 *
 * HOW TO GATE UI
 * 1. Preferred: add `data-min-stars="N"` to any control/section. The global
 *    stylesheet hides it whenever the user's level is below N. No imports,
 *    no re-renders — pure CSS.
 * 2. For expensive subtrees or hook-dependent branches, use the <MinStars>
 *    component (src/components/MinStars.tsx) instead.
 *
 * LEVEL SEMANTICS (what each star unlocks — keep this consistent everywhere)
 * - 1 Street Punk: essential input + the primary AI generate button only.
 * - 2 Hustler:     + key presets / style picks (still guided).
 * - 3 Gangster:    + tweak options (variations, tone, length…).
 * - 4 Shot Caller: + advanced settings panels, manual prompt editing.
 *                   (Equivalent to the old `.advanced-only` class.)
 * - 5 Crime Boss:  + pro controls (model pickers, quality/format, batch).
 * - 6 Kingpin:     + everything (raw/manual overrides, debug, experimental).
 *
 * HARD RULES
 * - More stars only ever ADD controls; quality never drops at low stars.
 * - NEVER gate the primary CTA (Generate / Create / Export) — it stays
 *   visible at every level.
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
  "AI auto-pilot. Just create.",
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

/** True when the user's Creator Level is at least `level`. */
export function useMinStars(level: StarLevel): boolean {
  const { stars } = useUserMode();
  return stars >= level;
}
