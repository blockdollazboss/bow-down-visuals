/* ─── Viral Effects — client seam ─────────────────────────────────────────
   The recipe library itself lives server-side (artifacts/api-server
   src/lib/scene-effects.ts) and is served by GET /api/scene-effects/recipes
   so there is exactly one source of truth. This module holds only the
   pure client helpers that run on that payload: camera-move
   normalization + the effect/camera conflict rule, so Scene Studio can
   warn the creator BEFORE they generate. The server re-checks nothing
   about conflicts (a conflict is a warning, never a block) but resolves
   effect ids authoritatively at generation time. */

/** Mirror of the server's MAX_STACKED_EFFECTS (lib/scene-effects.ts). */
export const MAX_STACKED_EFFECTS_CLIENT = 2;

export type EffectNeeds = "none" | "start-frame" | "end-frame" | "both";

export interface EffectRecipe {
  id: string;
  name: string;
  category: string;
  bestFor: string;
  weave: string;
  needs: EffectNeeds;
  conflictsWithMoves: string[];
  cameraNeed?: string;
  trendTags: string[];
  energy: "calm" | "punchy" | "wild";
}

export interface MoveKeywordRule {
  move: string;
  keywords: string[];
}

export interface EffectRecipesPayload {
  recipes: EffectRecipe[];
  maxStack: number;
  moveKeywords: MoveKeywordRule[];
}

export const CAMERA_MOVE_LABELS_CLIENT: Record<string, string> = {
  "dolly-in": "a dolly-in (camera pushing closer)",
  orbit: "an orbiting camera",
  "crane-up": "a crane-up",
  handheld: "handheld camera shake",
  "static-wide": "a locked-off static camera",
  "whip-pan": "a whip pan",
  tracking: "a tracking shot",
  aerial: "an aerial / drone move",
};

/** Normalize a scene's free-text camera direction to canonical moves,
 *  using the keyword map served with the library. */
export function normalizeCameraMovesClient(
  cameraText: string | null | undefined,
  moveKeywords: MoveKeywordRule[],
): Set<string> {
  const text = (cameraText ?? "").toLowerCase();
  const found = new Set<string>();
  if (!text.trim()) return found;
  for (const { move, keywords } of moveKeywords) {
    if (keywords.some((k) => text.includes(k))) found.add(move);
  }
  return found;
}

export interface EffectConflict {
  effectId: string;
  effectName: string;
  move: string;
  message: string;
}

/** The conflict rule, same conservative shape as the server's: only
 *  physically contradictory pairings warn, and a warning never blocks. */
export function effectConflictsClient(
  cameraText: string | null | undefined,
  picked: readonly EffectRecipe[],
  moveKeywords: MoveKeywordRule[],
): EffectConflict[] {
  const moves = normalizeCameraMovesClient(cameraText, moveKeywords);
  if (moves.size === 0) return [];
  const conflicts: EffectConflict[] = [];
  for (const recipe of picked) {
    for (const move of recipe.conflictsWithMoves) {
      if (!moves.has(move)) continue;
      conflicts.push({
        effectId: recipe.id,
        effectName: recipe.name,
        move,
        message:
          `"${recipe.name}" needs ${recipe.cameraNeed ?? "a different camera move"} — ` +
          `it fights ${CAMERA_MOVE_LABELS_CLIENT[move] ?? move}. One of them will win in the render; ` +
          `pick which before you generate.`,
      });
    }
  }
  return conflicts;
}

/** Honest requirement label for an effect card. Start-frame effects lean
 *  on the scene's reference image; end-frame effects land on a look the
 *  creator describes — neither is faked as a wired parameter. */
export function effectNeedsLabel(needs: EffectNeeds): string | null {
  switch (needs) {
    case "start-frame":
      return "Works best with a reference photo";
    case "end-frame":
      return "Lands on a final look — describe it in your prompt";
    case "both":
      return "Best with a reference photo + the final look in your prompt";
    default:
      return null;
  }
}

/** Read the creator's tracked trends (Trend Predictor watchlist, the
 *  exact localStorage the Trends page writes) as matcher signals. */
export interface TrackedTrendSignal {
  trend: string;
  confidence: number;
  timeframe?: string;
  reasoning?: string;
  earlySignals?: string[];
}

const TREND_WATCHLIST_KEY = "bdv-trend-watchlist";

export function loadTrackedTrendSignals(): TrackedTrendSignal[] {
  try {
    const raw = localStorage.getItem(TREND_WATCHLIST_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    return j
      .filter((t) => t && typeof t.trend === "string" && typeof t.confidence === "number")
      .slice(0, 5)
      .map((t) => ({
        trend: t.trend,
        confidence: t.confidence,
        timeframe: typeof t.timeframe === "string" ? t.timeframe : undefined,
        reasoning: typeof t.reasoning === "string" ? t.reasoning : undefined,
        earlySignals: Array.isArray(t.earlySignals) ? t.earlySignals.filter((s: unknown) => typeof s === "string") : undefined,
      }));
  } catch {
    return [];
  }
}
