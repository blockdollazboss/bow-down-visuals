/**
 * figure.ts — which standing figure a presence wears in the hall.
 *
 * Three kinds, one pipeline:
 *  - "portrait": a Creative Vault character — the member's own art
 *    on the gold-framed easel panel, lips landmarked (unchanged).
 *  - "default": the house default — a life-size full-body figure of
 *    a King Shark palace guard (the owner's ruling: a King Shark,
 *    never his main character), rendered from the art in the slot at
 *    public/world/default-character.png. The slot is deliberately
 *    just a path: approved art drops in and every default presence
 *    in the hall wears it — no code change. The guard's face is
 *    frontal, so the same landmarked-lips treatment applies.
 *  - "capsule": the fallback ONLY — what stands while the default
 *    art is still loading, or if the slot file can't load at all
 *    (exactly how a failed portrait load behaved before it).
 *
 * Pure decisions + measurements, unit-tested; the scene does the
 * three.js lifting.
 */

/** The asset slot for the approved palace-guard art (public/). */
export const DEFAULT_CHARACTER_PATH = "/world/default-character.png";

/** Life-size: the same standing height family as the capsule it
 *  replaces (capsule head tops out ~2.04 m; the guard stands 1.92). */
export const DEFAULT_FIGURE_HEIGHT = 1.92;

export type DefaultArtState = "pending" | "ready" | "failed";
export type FigureKind = "portrait" | "default" | "capsule";

export function figureKindFor(hasCharacter: boolean, defaultArt: DefaultArtState): FigureKind {
  if (hasCharacter) return "portrait";
  return defaultArt === "ready" ? "default" : "capsule";
}

/** The slot path resolved the way the hall resolves its textures
 *  (BASE_URL-aware). */
export function defaultCharacterUrl(baseUrl: string): string {
  return `${baseUrl}${DEFAULT_CHARACTER_PATH.replace(/^\//, "")}`;
}

/** Width for a standing figure of `height` from the art's aspect
 *  (w/h) — aspect preserved, never stretched; a wild aspect is
 *  clamped to a sane humanoid band rather than trusted blindly. */
export function figureWidthForHeight(height: number, aspect: number): number {
  const a = Number.isFinite(aspect) && aspect > 0 ? Math.min(1.5, Math.max(0.25, aspect)) : 0.5;
  return height * a;
}

/** The canvas a default figure's art is drawn onto: tall enough to
 *  stay crisp at life size, sized to the ART's aspect so the shared
 *  cover-fit drawing lands edge-to-edge with nothing cropped and
 *  nothing stretched. */
export function defaultFigureCanvasSize(aspect: number): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.5;
  const h = 768;
  const w = Math.min(1024, Math.max(128, Math.round(h * a)));
  return { w, h };
}
