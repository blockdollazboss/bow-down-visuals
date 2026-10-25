/**
 * gamepad.ts — Bluetooth/USB gamepad → hall intent (Gamepad API).
 *
 * Controllers paired over Bluetooth (Xbox / PlayStation style) show
 * up as standard-mapping gamepads; this module is the pure part —
 * stick shaping + button mapping + edge detection — unit-tested
 * without hardware. The scene polls it each frame and merges the
 * intent with keyboard/mouse/touch, which stay exactly as they were.
 *
 * The button LAYOUT lives in bindings.ts — the one table every
 * input family reads — and this module only polls it:
 *   axes[0..1]  left stick   → walk (x = strafe, y = forward/back)
 *   axes[2..3]  right stick  → look (x = yaw, y = pitch)
 *   RT (7) / L3 (10) held    → hurry/sprint
 *   A (0)                    → step the voice mode forward (edge)
 *   LT (6)                   → step the voice mode BACKWARD (edge)
 *   Y (3)                    → toggle first/third person (edge)
 *   LB (4)                   → contextual interact (edge): the door
 *                              or courtesy at the showing prompt
 *   The seven ACTION SLOTS (D-pad ↑ → ↓ ←, X, B, RB) perform the
 *   ACTIVE PAGE's actions (bindings.ACTION_PAGES): page 1 is the
 *   shipped layout — D↑ Bow · D→ Cheer · D↓ Sit · D← Wave · X Clap
 *   · B Dance · RB Spin — and Back (8) cycles to page 2 (Point ·
 *   Laugh · Kneel · Beckon · Salute · High-five · Shrug).
 *   Start (9)                → photo mode (edge)
 *   R3 (11)                  → moment claim (edge): the live drop
 *                              or the King's gift, when one is up
 * Avatar actions ride the same edge discipline as the toggles:
 * one press, one performance — holding a button never machine-guns
 * the room with bows.
 */
import type { WorldActionId } from "./actions";
import {
  PAD_SLOTS,
  PAD_SPRINT_BUTTONS,
  PAD_VERBS,
  actionForPadButton,
  DEFAULT_ACTION_PAGE,
  type ActionPageId,
  type WorldVerb,
} from "./bindings";

export const GAMEPAD_DEADZONE = 0.18;

export interface GamepadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

export interface GamepadEdges {
  voice: boolean;
  view: boolean;
  interact: boolean;
  /** LT held at the last poll (the voice-back edge state). */
  lt: boolean;
  /** Back held at the last poll (the page-cycle edge state). */
  page: boolean;
  /** Start held at the last poll (the photo edge state). */
  photo: boolean;
  /** R3 held at the last poll (the moment-claim edge state). */
  claim: boolean;
  /** Action buttons held at the last poll, by action id. */
  actions: Partial<Record<WorldActionId, boolean>>;
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
  /** Edge-triggered: LT went down this frame — step the voice
   *  mode BACKWARD (the A button's reverse). */
  voiceBack: boolean;
  toggleView: boolean;
  /** Edge-triggered: LB went down this frame — the contextual
   *  interact (the door or courtesy at the showing prompt). */
  interact: boolean;
  /** Edge-triggered: Back went down — cycle the action page. */
  pageCycle: boolean;
  /** Edge-triggered: Start went down — toggle photo mode. */
  photoMode: boolean;
  /** Edge-triggered: R3 went down — claim the live moment. */
  momentClaim: boolean;
  /** Edge-triggered avatar action for this frame (the first fresh
   *  press, in slot order), or null. */
  action: WorldActionId | null;
}

export const IDLE_GAMEPAD_INTENT: GamepadIntent = {
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
  sprint: false,
  toggleVoice: false,
  voiceBack: false,
  toggleView: false,
  interact: false,
  pageCycle: false,
  photoMode: false,
  momentClaim: false,
  action: null,
};

export const IDLE_GAMEPAD_EDGES: GamepadEdges = {
  voice: false,
  view: false,
  interact: false,
  lt: false,
  page: false,
  photo: false,
  claim: false,
  actions: {},
};

/** Button index per fixed verb, inverted from the table. */
const VERB_BUTTON: Record<WorldVerb, number> = (() => {
  const out = {} as Record<WorldVerb, number>;
  for (const [btn, verb] of Object.entries(PAD_VERBS)) out[verb] = Number(btn);
  return out;
})();

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
 *  carry into the next poll. `page` is the active action page —
 *  the seven slots perform ITS actions. A missing pad reads as a
 *  clean idle (and resets the edges, so a reconnect never swallows
 *  or repeats a press). */
export function pollGamepad(
  pad: GamepadLike | null,
  prev: GamepadEdges,
  page: ActionPageId = DEFAULT_ACTION_PAGE,
): { intent: GamepadIntent; edges: GamepadEdges } {
  if (!pad) return { intent: IDLE_GAMEPAD_INTENT, edges: IDLE_GAMEPAD_EDGES };
  const [moveX, moveY] = applyRadialDeadzone(axis(pad, 0), axis(pad, 1));
  const [lookX, lookY] = applyRadialDeadzone(axis(pad, 2), axis(pad, 3));
  const actionEdges: Partial<Record<WorldActionId, boolean>> = {};
  let action: WorldActionId | null = null;
  for (const button of PAD_SLOTS) {
    const id = actionForPadButton(page, button);
    if (!id) continue;
    const down = pressed(pad, button);
    actionEdges[id] = down;
    if (action === null && down && prev.actions[id] !== true) action = id;
  }
  const edges: GamepadEdges = {
    voice: pressed(pad, VERB_BUTTON.voiceStep),
    view: pressed(pad, VERB_BUTTON.viewToggle),
    interact: pressed(pad, VERB_BUTTON.interact),
    lt: pressed(pad, VERB_BUTTON.voiceBack),
    page: pressed(pad, VERB_BUTTON.pageCycle),
    photo: pressed(pad, VERB_BUTTON.photoMode),
    claim: pressed(pad, VERB_BUTTON.momentClaim),
    actions: actionEdges,
  };
  return {
    intent: {
      moveX,
      moveY,
      lookX,
      lookY,
      sprint: PAD_SPRINT_BUTTONS.some((b) => pressed(pad, b)),
      toggleVoice: edges.voice && !prev.voice,
      voiceBack: edges.lt && !prev.lt,
      toggleView: edges.view && !prev.view,
      interact: edges.interact && !prev.interact,
      pageCycle: edges.page && !prev.page,
      photoMode: edges.photo && !prev.photo,
      momentClaim: edges.claim && !prev.claim,
      action,
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
