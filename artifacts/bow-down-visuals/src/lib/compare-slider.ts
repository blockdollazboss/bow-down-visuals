/**
 * Before/after compare slider helpers for the video editor's master player.
 *
 * Pure functions (no DOM) so the compare math is unit-testable. The player
 * component in `pages/video-editor.tsx` drives the actual drag/keyboard
 * interaction and video mirroring off these helpers.
 */

/** Compare split position, as a percentage of the preview width. 0 = the
 *  "after" (effected) side fills the frame, 100 = the "before" (raw) side
 *  fills it. */
export const COMPARE_POS_MIN = 0;
export const COMPARE_POS_MAX = 100;
/** Default split: right down the middle. */
export const COMPARE_POS_DEFAULT = 50;
/** Keyboard step (plain arrows) and large step (shift+arrows), in percent. */
export const COMPARE_KEY_STEP = 2;
export const COMPARE_KEY_STEP_LARGE = 10;

/** Clamp a raw split position into the valid 0–100 range. */
export function clampComparePos(pos: number): number {
  if (!Number.isFinite(pos)) return COMPARE_POS_DEFAULT;
  return Math.min(COMPARE_POS_MAX, Math.max(COMPARE_POS_MIN, pos));
}

/**
 * CSS `clip-path` for the effected ("after") layer: everything left of the
 * split is cut away so the raw ("before") mirror video underneath shows
 * through. LEFT = before, RIGHT = after.
 */
export function compareClipPath(pos: number): string {
  return `inset(0 0 0 ${clampComparePos(pos)}%)`;
}

/**
 * Convert a pointer clientX into a split position given the track's bounding
 * rect. Used by the drag handler on the split handle.
 */
export function comparePosFromClientX(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
): number {
  if (!Number.isFinite(rectWidth) || rectWidth <= 0) return COMPARE_POS_DEFAULT;
  const frac = Math.min(1, Math.max(0, (clientX - rectLeft) / rectWidth));
  return Math.round(frac * 100);
}

export interface VisualEffectFlags {
  testEffectActive: boolean;
  testOverlayActive: boolean;
  /** Number of color/effect filters applied (settings.effects.length). */
  effectCount: number;
  /** Number of animated overlay chips active (settings.overlays.length). */
  overlayChipCount: number;
  /** A single overlay being solo-previewed, if any. */
  soloPreviewOverlay: string | null | undefined;
}

/**
 * Whether any visual effect is actually altering the picture right now. The
 * compare toggle is only shown when this is true — otherwise it's clutter.
 */
export function hasActiveVisualEffects(flags: VisualEffectFlags): boolean {
  return (
    flags.testEffectActive ||
    flags.testOverlayActive ||
    flags.effectCount > 0 ||
    flags.overlayChipCount > 0 ||
    !!flags.soloPreviewOverlay
  );
}
