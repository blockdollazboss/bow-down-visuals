/**
 * stick-visual.ts — the touch stick's drawn face (stack900 G4).
 *
 * The World's touch stick is dynamic-origin: a thumb landing in
 * the canvas's left 45% becomes the stick, and 52px of travel is
 * full deflection (hall-scene's pointer handlers). The movement
 * half of that stick has existed since the touch layer landed —
 * but it drew NOTHING: the thumb grabbed an invisible stick, got
 * no anchor for where it landed, and no read on how far it had
 * pushed (Lane D2's census recorded the gap verbatim: "the stick
 * has no drawn on-screen nub"). This module is the drawing half,
 * kept as pure state + geometry so the scene's movement math is
 * never touched by it:
 *
 *   - The state machine mirrors the scene's stick lifecycle —
 *     down (touch only), move, release (up AND cancel land on the
 *     same scene release), blur — and nothing else. The scene
 *     feeds it the same events it already handles, AFTER its own
 *     stick writes, and renders what it returns. The drawing
 *     reads the stick's world; it never writes back into it.
 *   - Geometry: the nub FOLLOWS THE THUMB — its offset is the
 *     thumb's raw travel, clamped RADIALLY to the throw radius
 *     (the ring is a circle, so the edge is a circle). The
 *     movement axes keep their own per-axis clamp in the scene,
 *     byte for byte; the nub's radial clamp is a drawing choice,
 *     not a movement one — at full diagonal push the nub pins to
 *     the ring in the thumb's direction.
 *   - Style: the World's gold (#d4af37) in both themes, but the
 *     stick floats over the 3D scene, not the page — so the
 *     contrast problem is the SCENE's: a bright day plaza behind
 *     the light theme, a dark hall behind the dark one. Each
 *     theme's treatment pairs the gold with the glass that reads
 *     against its scene (dark glass at night, cream glass by
 *     day), and both rings/nubs carry an edge dark enough to
 *     hold on either ground.
 *
 * Pure only: no three.js, no DOM, fully unit-tested. The scene
 * owns the two divs and applies what this module computes.
 */

import type { HallTheme } from "./hall-looks";

/** The stick's throw: 52px of thumb travel is full deflection.
 *  This is the SAME number the scene's pointermove divides by
 *  (`const max = 52` in hall-scene's stick branch) — one value,
 *  named here for the drawing, pinned against the scene's line
 *  by test so the ring can never drift off the real throw. */
export const STICK_THROW_PX = 52;

/** The base ring's diameter: the throw circle itself — the nub's
 *  centre traces this ring at full deflection, so the ring IS
 *  the map of how far the stick can go. */
export const STICK_RING_DIAMETER_PX = STICK_THROW_PX * 2;

/** The nub's diameter: half the ring, big enough to sit under a
 *  thumb and be seen around it. */
export const STICK_NUB_DIAMETER_PX = 52;

/** The fade the drawing wears in and out — fast enough to feel
 *  attached to the thumb, slow enough not to pop. */
export const STICK_VISUAL_FADE_MS = 140;

/** The drawing's whole state. `active` while the stick touch
 *  lives; `suspended` when the window lost focus mid-hold — the
 *  scene's stick itself rides out a blur (its release arrives
 *  with the pointer), but a drawing left hanging over a blurred
 *  window is a lie, so the face hides until the next stick move
 *  re-syncs it. ox/oy are the origin and dx/dy the nub's offset,
 *  all in canvas-local pixels (client coords minus the canvas
 *  rect — the caller converts; this module never sees the DOM). */
export interface StickVisualState {
  readonly active: boolean;
  readonly suspended: boolean;
  readonly ox: number;
  readonly oy: number;
  readonly dx: number;
  readonly dy: number;
}

/** At rest: no stick, no drawing. */
export const STICK_VISUAL_REST: StickVisualState = {
  active: false,
  suspended: false,
  ox: 0,
  oy: 0,
  dx: 0,
  dy: 0,
};

/** The nub's offset for a thumb at (x, y) from an origin at
 *  (ox, oy): the raw travel, radially clamped to the throw —
 *  inside the ring the nub is exactly under the thumb; past the
 *  ring it pins to the edge in the thumb's direction. */
export function stickNubOffset(
  ox: number,
  oy: number,
  x: number,
  y: number,
): { dx: number; dy: number } {
  const rawX = x - ox;
  const rawY = y - oy;
  const len = Math.hypot(rawX, rawY);
  if (len <= STICK_THROW_PX || len === 0) return { dx: rawX, dy: rawY };
  const scale = STICK_THROW_PX / len;
  return { dx: rawX * scale, dy: rawY * scale };
}

/** A thumb landed where the stick lives. Only a TOUCH may raise
 *  the drawing — the stick itself is touch-born (the scene's
 *  branch checks pointerType before it ever calls this), and the
 *  guard is doubled here so no future caller can paint the nub
 *  for a mouse or a pad: those families never see it. A down
 *  while already active re-anchors — a fresh grab is a fresh
 *  origin. */
export function stickVisualDown(
  _prev: StickVisualState,
  pointerType: string,
  x: number,
  y: number,
): StickVisualState {
  if (pointerType !== "touch") return STICK_VISUAL_REST;
  return { active: true, suspended: false, ox: x, oy: y, dx: 0, dy: 0 };
}

/** The stick thumb moved: the nub follows, and a suspended
 *  drawing re-syncs (a live move is proof the hold is real
 *  again). A move with no stick is nothing — the state rests. */
export function stickVisualMove(
  prev: StickVisualState,
  x: number,
  y: number,
): StickVisualState {
  if (!prev.active) return prev;
  const { dx, dy } = stickNubOffset(prev.ox, prev.oy, x, y);
  return { ...prev, suspended: false, dx, dy };
}

/** The hold ended — lift or cancel, the scene's one release:
 *  the drawing rests. From rest, still rest. */
export function stickVisualRelease(_prev: StickVisualState): StickVisualState {
  return STICK_VISUAL_REST;
}

/** The window lost focus mid-hold: hide the face, keep the
 *  geometry — if the hold is still real, its next move restores
 *  the drawing exactly where it was; if the release already
 *  happened, the state was rest and stays rest. */
export function stickVisualBlur(prev: StickVisualState): StickVisualState {
  if (!prev.active) return prev;
  return { ...prev, suspended: true };
}

/** Whether the drawing shows this frame: a live, unsuspended
 *  stick — and nothing else ever. */
export function stickVisualVisible(state: StickVisualState): boolean {
  return state.active && !state.suspended;
}

/** Where the two pieces sit, canvas-local: the ring centred on
 *  the origin, the nub centred on origin + offset. The scene
 *  positions both by their top-left corner, so the centres are
 *  resolved here, once. */
export function stickVisualPositions(state: StickVisualState): {
  ringLeft: number;
  ringTop: number;
  nubLeft: number;
  nubTop: number;
} {
  return {
    ringLeft: state.ox - STICK_RING_DIAMETER_PX / 2,
    ringTop: state.oy - STICK_RING_DIAMETER_PX / 2,
    nubLeft: state.ox + state.dx - STICK_NUB_DIAMETER_PX / 2,
    nubTop: state.oy + state.dy - STICK_NUB_DIAMETER_PX / 2,
  };
}

/** One theme's treatment for the drawing — complete CSS values,
 *  applied verbatim by the scene. */
export interface StickVisualStyle {
  ringBorder: string;
  ringBackground: string;
  ringBoxShadow: string;
  nubBorder: string;
  nubBackground: string;
  nubBoxShadow: string;
}

/** The World's gold, dressed for the scene it floats over:
 *  dark theme = the night hall (near-black ground), so the ring
 *  is gold over dark glass with a black keyline; light theme =
 *  the day plaza (bright paving and sky), so the gold deepens
 *  to the house bronze over cream glass with a pale keyline —
 *  and the nub wears the same gold gradient with a dark bronze
 *  rim in both, so it holds against either ground. */
export function stickVisualStyleFor(theme: HallTheme): StickVisualStyle {
  if (theme === "light") {
    return {
      ringBorder: "2px solid rgba(122, 90, 18, 0.95)",
      ringBackground: "rgba(252, 247, 234, 0.30)",
      ringBoxShadow:
        "0 0 0 1px rgba(255, 252, 240, 0.55), inset 0 0 22px rgba(122, 90, 18, 0.20)",
      nubBorder: "2px solid rgba(58, 42, 6, 0.9)",
      nubBackground:
        "radial-gradient(circle at 35% 30%, #ffe9a8 0%, #d4af37 55%, #8a6a14 100%)",
      nubBoxShadow: "0 3px 10px rgba(60, 45, 5, 0.35)",
    };
  }
  return {
    ringBorder: "2px solid rgba(212, 175, 55, 0.9)",
    ringBackground: "rgba(8, 6, 3, 0.30)",
    ringBoxShadow:
      "0 0 0 1px rgba(0, 0, 0, 0.45), inset 0 0 22px rgba(0, 0, 0, 0.35)",
    nubBorder: "2px solid rgba(46, 34, 4, 0.85)",
    nubBackground:
      "radial-gradient(circle at 35% 30%, #f6dc8f 0%, #d4af37 55%, #a07d22 100%)",
    nubBoxShadow: "0 3px 10px rgba(0, 0, 0, 0.5)",
  };
}
