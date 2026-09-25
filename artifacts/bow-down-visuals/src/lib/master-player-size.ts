/**
 * Master player fit — pure sizing math for the video-editor's master preview player.
 *
 * Guarantees (for every aspect ratio and viewport):
 *  1. video height + player chrome (drag header + transport rows) never exceeds the
 *     vertical band between the top toolbar and the timeline dock, so transport
 *     controls are ALWAYS fully visible — never cut off, never collapsed.
 *  2. video width never exceeds the measured center-column width, so the canvas
 *     aspect-ratio box stays exact (no silent `max-width: 100%` clamp distorting
 *     the box and letterboxing the video tiny inside it).
 *  3. landscape formats (16:9) still grow to a readable height instead of
 *     rendering as a thin strip — but only when the space actually exists.
 *
 * The old inline math floored the width at MASTER_PLAYER_MIN_WIDTH even when the
 * vertical band couldn't fit that height (short laptop viewports + tall 9:16),
 * pushing the transport rows below the fold. The floor is now clamped by the fit
 * itself: fit always wins over the minimum size.
 */
import {
  MASTER_PLAYER_MAX_WIDTH,
  MASTER_PLAYER_MIN_WIDTH,
  MASTER_PLAYER_MIN_HEIGHT,
} from "./editor-settings";

/** Width of the minimized player chip (matches video-editor.tsx). */
export const MASTER_PLAYER_MINIMIZED_CHIP_WIDTH = 96;

/** Margin (px) kept above/below the player inside the toolbar↔dock band. */
export const MASTER_PLAYER_FIT_MARGIN = 16;

export interface MasterPlayerFitInput {
  /** window.innerHeight at render time. */
  viewportHeight: number;
  /** Measured height of the editor's top toolbar. */
  headerHeight: number;
  /** Measured height of the timeline dock. */
  dockHeight: number;
  /** Measured height of the player's own chrome (drag header + transport rows). */
  chromeHeight: number;
  /** Measured px width of the center column content box; <= 0 means unknown. */
  columnWidth: number;
  /** Locked video aspect ratio (width / height), e.g. 16/9. Non-positive → 9:16. */
  aspect: number;
  /** User-preferred player width (persisted setting or live resize drag). */
  savedWidth: number;
  /** Minimized chip state. */
  minimized: boolean;
}

export interface MasterPlayerFit {
  /** Rendered video width in px. */
  width: number;
  /** Rendered video height in px (width / aspect). */
  height: number;
}

export function computeMasterPlayerFit(input: MasterPlayerFitInput): MasterPlayerFit {
  const aspect = input.aspect > 0 ? input.aspect : 9 / 16;

  if (input.minimized) {
    const width = MASTER_PLAYER_MINIMIZED_CHIP_WIDTH;
    return { width, height: Math.round(width / aspect) };
  }

  /* Vertical band strictly between the top toolbar and the timeline dock,
   * minus the player's own chrome and the margin on both ends. This is the
   * VIDEO height budget — chrome lives outside the canvas. */
  const bandH = Math.max(
    0,
    input.viewportHeight - input.headerHeight - input.dockHeight - input.chromeHeight - MASTER_PLAYER_FIT_MARGIN * 2
  );

  /* Hard width ceiling: design max, and the measured column (unknown → ignore). */
  const maxW = Math.min(
    MASTER_PLAYER_MAX_WIDTH,
    input.columnWidth > 0 ? input.columnWidth : Infinity
  );

  /* Hard fit: video height must fit the band → width ≤ bandH * aspect.
   * This is the constraint the old code broke with its MIN_WIDTH floor. */
  const fitW = Math.min(maxW, bandH * aspect);

  /* Grow landscape-ish formats so 16:9 never renders as a thin strip —
   * but never beyond what actually fits. */
  const desired = Math.max(input.savedWidth, MASTER_PLAYER_MIN_HEIGHT * aspect);

  /* The min-width floor must never bust the fit: clamp the floor itself.
   * When the band is tiny the video shrinks (chrome stays visible); when
   * the band is gone entirely the canvas collapses to 0 but the transport
   * rows — separate flex children — still render. */
  const floor = Math.min(MASTER_PLAYER_MIN_WIDTH, fitW);
  const width = Math.max(floor, Math.min(desired, fitW));

  return { width: Math.round(width), height: Math.round(width / aspect) };
}
