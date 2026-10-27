/**
 * sprint.ts — the World's pace, one source for every input family
 * (Q194).
 *
 * Walking and running are the scene's two paces, and until now the
 * run pace was reachable only from the keyboard (Shift) and a
 * paired controller (RT / L3): the touch scheme had no sprint
 * input at all, so a phone walker was capped at walk speed no
 * matter what they did. This module is the shared seam the fix
 * rides:
 *
 *   - WALK_SPEED / RUN_SPEED live HERE, once. The scene imports
 *     them; no input family — keyboard, gamepad, touch, XR — may
 *     fork its own copy of either number.
 *   - moveSpeed(run) is the one resolution from the sprint state
 *     to a pace: every family feeds the same boolean in and walks
 *     (or runs) at the same speed.
 *   - The touch sprint is a HOLD, exactly like Shift and RT: the
 *     on-screen Sprint button holds it while a thumb is down and
 *     lets go the moment the thumb lifts, leaves or is cancelled.
 *     touchSprintAfter is that hold's pure transition, and
 *     sprintFromInputs is the one merge the scene's frame reads —
 *     touch joins the merge as a peer of the other two families,
 *     never as a replacement for either.
 *
 * Pure math only: no three.js, no DOM, fully unit-tested.
 */

/** Walk pace (m/s) — every family's unhurried speed. */
export const WALK_SPEED = 3.4;
/** Run pace (m/s) — the sprint speed, identical for Shift, the
 *  controller's hurry buttons and the touch Sprint hold. */
export const RUN_SPEED = 6;

/** The pace for a sprint state: held → RUN_SPEED, else WALK_SPEED.
 *  This is the ONLY place the boolean becomes a number. */
export function moveSpeed(run: boolean): number {
  return run ? RUN_SPEED : WALK_SPEED;
}

/** One press on the touch Sprint control. `press` is the thumb
 *  landing; every way a hold can end — lift, slide-off, the
 *  browser cancelling the pointer, the window losing focus —
 *  arrives as `release`, so a sprint can never stick on. */
export type TouchSprintAction = "press" | "release";

/** The touch hold's next state: a press holds the sprint, a
 *  release lets it go, from either starting state. */
export function touchSprintAfter(_held: boolean, action: TouchSprintAction): boolean {
  return action === "press";
}

/** The three sprint inputs of one frame, as their families report
 *  them: Shift (either) on the keys, the pad's hurry intent, and
 *  the touch Sprint hold. */
export interface SprintInputs {
  keyboard: boolean;
  gamepad: boolean;
  touch: boolean;
}

/** The frame's one sprint state: ANY family holding its sprint
 *  input runs — the families merge, they never outvote or replace
 *  each other, so touch sprint and Shift sprint are the same
 *  state driving the same pace through moveSpeed. */
export function sprintFromInputs(inputs: SprintInputs): boolean {
  return inputs.keyboard || inputs.gamepad || inputs.touch;
}
