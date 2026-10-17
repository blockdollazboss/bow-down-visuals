/**
 * gamepad.ts — Bluetooth/USB gamepad → hall intent (Gamepad API).
 *
 * Controllers paired over Bluetooth (Xbox / PlayStation style) show
 * up as standard-mapping gamepads; this module is the pure part —
 * stick shaping + button mapping + edge detection — unit-tested
 * without hardware. The scene polls it each frame and merges the
 * intent with keyboard/mouse/touch, which stay exactly as they were.
 *
 * Standard mapping (the W3C "standard" layout both controller
 * families report):
 *   axes[0..1]  left stick   → walk (x = strafe, y = forward/back)
 *   axes[2..3]  right stick  → look (x = yaw, y = pitch)
 *   buttons[7]  right trigger ┐
 *   buttons[10] L3 (stick click) ┘ → hurry/sprint (held)
 *   buttons[0]  A / Cross    → toggle proximity voice (edge)
 *   buttons[3]  Y / Triangle → toggle first/third person (edge)
 */

export const GAMEPAD_DEADZONE = 0.18;

export interface GamepadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

export interface GamepadEdges {
  voice: boolean;
  view: boolean;
}

export interface GamepadIntent {
  /** Left stick after deadzone shaping, -1..1 each. */
  moveX: number;
  moveY: number;
  /** Right stick after deadzone shaping, -1..1 each. */
  lookX: number;
  lookY: number;
  /** Held: RT or L3. */
  sprint: boolean;
  /** Edge-triggered: true only on the frame the button goes down. */
  toggleVoice: boolean;
  toggleView: boolean;
}

export const IDLE_GAMEPAD_INTENT: GamepadIntent = {
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
  sprint: false,
  toggleVoice: false,
  toggleView: false,
};

export const IDLE_GAMEPAD_EDGES: GamepadEdges = { voice: false, view: false };

/** Radial deadzone with rescaling: inside the zone the stick reads
 *  exactly zero (no drift); outside it, the remaining travel is
 *  stretched back over 0..1 so full tilt is still full speed and
 *  the first step out of the zone is gentle, not a jump. */
export function applyRadialDeadzone(
  x: number,
  y: number,
  deadzone: number = GAMEPAD_DEADZONE,
): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone || mag === 0) return [0, 0];
  const capped = Math.min(mag, 1);
  const scale = ((capped - deadzone) / (1 - deadzone)) / mag;
  return [x * scale, y * scale];
}

function axis(pad: GamepadLike, i: number): number {
  const v = pad.axes[i];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function pressed(pad: GamepadLike, i: number): boolean {
  return pad.buttons[i]?.pressed === true;
}

/** One poll: the pad's intent for this frame + the edge state to
 *  carry into the next poll. A missing pad reads as a clean idle
 *  (and resets the edges, so a reconnect never swallows or repeats
 *  a press). */
export function pollGamepad(
  pad: GamepadLike | null,
  prev: GamepadEdges,
): { intent: GamepadIntent; edges: GamepadEdges } {
  if (!pad) return { intent: IDLE_GAMEPAD_INTENT, edges: IDLE_GAMEPAD_EDGES };
  const [moveX, moveY] = applyRadialDeadzone(axis(pad, 0), axis(pad, 1));
  const [lookX, lookY] = applyRadialDeadzone(axis(pad, 2), axis(pad, 3));
  const edges: GamepadEdges = { voice: pressed(pad, 0), view: pressed(pad, 3) };
  return {
    intent: {
      moveX,
      moveY,
      lookX,
      lookY,
      sprint: pressed(pad, 7) || pressed(pad, 10),
      toggleVoice: edges.voice && !prev.voice,
      toggleView: edges.view && !prev.view,
    },
    edges,
  };
}

/** The first connected pad in the browser's list (nulls are
 *  disconnected slots). */
export function firstGamepad(pads: readonly (GamepadLike | null | undefined)[]): GamepadLike | null {
  for (const pad of pads) if (pad) return pad;
  return null;
}
