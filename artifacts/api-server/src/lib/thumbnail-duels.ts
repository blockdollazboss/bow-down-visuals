/* ─── Thumbnail Duels (#174) — pure rules ───────────────────────────────────
   The audience is served cover A and cover B in rotation; every serve is a
   counted VIEW for that cover, every click-through to the video is a counted
   CLICK (deduped per audience member per cover at the route layer).
   Resolution is mechanical, never vibes: the duel resolves when total views
   reach the target AND one cover strictly leads on clicks. A tie at/over the
   target keeps the duel running until a click breaks it. */

export type DuelCover = "a" | "b";

export interface DuelCounts {
  viewsA: number;
  viewsB: number;
  clicksA: number;
  clicksB: number;
  targetViews: number;
}

/** Rotation: whichever cover has been served fewer times goes next;
    ties alternate starting with A. Keeps the split honest 50/50. */
export function pickDuelCover(counts: Pick<DuelCounts, "viewsA" | "viewsB">): DuelCover {
  return counts.viewsA <= counts.viewsB ? "a" : "b";
}

export interface DuelOutcome {
  resolved: boolean;
  winner: DuelCover | null;
  totalViews: number;
}

export function duelOutcome(counts: DuelCounts): DuelOutcome {
  const totalViews = counts.viewsA + counts.viewsB;
  if (totalViews < counts.targetViews) return { resolved: false, winner: null, totalViews };
  if (counts.clicksA === counts.clicksB) return { resolved: false, winner: null, totalViews };
  return { resolved: true, winner: counts.clicksA > counts.clicksB ? "a" : "b", totalViews };
}

/** Public results shape — REAL counts only, always with the raw numbers.
    Percentages may ride along but never appear without the counts. */
export function duelResultsView(counts: DuelCounts) {
  const totalViews = counts.viewsA + counts.viewsB;
  const totalClicks = counts.clicksA + counts.clicksB;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  return {
    viewsA: counts.viewsA,
    viewsB: counts.viewsB,
    clicksA: counts.clicksA,
    clicksB: counts.clicksB,
    totalViews,
    totalClicks,
    targetViews: counts.targetViews,
    clickRateA: pct(counts.clicksA, counts.viewsA),
    clickRateB: pct(counts.clicksB, counts.viewsB),
  };
}

export const DUEL_TARGET_VIEWS_MIN = 20;
export const DUEL_TARGET_VIEWS_MAX = 10000;
export const DUEL_TARGET_VIEWS_DEFAULT = 100;

export function clampDuelTargetViews(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DUEL_TARGET_VIEWS_DEFAULT;
  return Math.min(DUEL_TARGET_VIEWS_MAX, Math.max(DUEL_TARGET_VIEWS_MIN, n));
}
