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
 *   A (0) tap                → jump (edge) — the bottom face
 *                              button is where thumbs look for it
 *   A (0) held ≥ 400 ms      → step the voice mode forward
 *                              (long-press edge; bindings.ts
 *                              PAD_JUMP_BUTTON carries the why)
 *   LT (6)                   → step the voice mode BACKWARD (edge)
 *   Y (3)                    → toggle first/third person (edge)
 *   LB (4)                   → contextual interact (edge): the door
 *                              or courtesy at the showing prompt
 *   The seven ACTION SLOTS (D-pad ↑ → ↓ ←, X, B, RB) perform the
 *   ACTIVE PAGE's actions (bindings.ACTION_PAGES): page 1 is the
 *   shipped layout — D↑ Bow · D→ Cheer · D↓ Sit · D← Wave · X Clap
 *   · B Dance · RB Spin — and Back (8) cycles to page 2 (Point ·
 *   Laugh · Kneel · Beckon · Salute · High-five · Shrug).
 *   Start (9) tap            → toggle the World settings
 *                              (edge; bindings.ts PAD_MENU_BUTTON
 *                              carries the why — the owner's menu
 *                              button, "like normal stuff")
 *   Start (9) held ≥ 400 ms  → photo mode (long-press edge;
 *                              the same share as A and Back —
 *                              the tap that begins the hold has
 *                              already opened the settings, and
 *                              photo mode's entry retires them)
 *   Back (8) held ≥ 600 ms   → toggle fullscreen (long-press
 *                              edge; bindings.ts PAD_PAGE_BUTTON
 *                              carries the why — Back's tap stays
 *                              the action-page cycle)
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
  PAD_JUMP_BUTTON,
  PAD_VOICE_LONG_PRESS_MS,
  PAD_PAGE_BUTTON,
  PAD_FULLSCREEN_LONG_PRESS_MS,
  PAD_MENU_BUTTON,
  PAD_PHOTO_LONG_PRESS_MS,
  actionForPadButton,
  actionForSlot,
  DEFAULT_ACTION_PAGE,
  type ActionPageId,
  type WorldVerb,
} from "./bindings";
import { padVerbIndices, type ControllerProfile } from "./controller-profile";

export const GAMEPAD_DEADZONE = 0.18;

export interface GamepadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
  /** The pad's identity string, when the object carries one
   *  (a real Gamepad does). controller-profile.ts classifies
   *  the family from it; the poll itself never reads it. */
  id?: string;
  /** The pad's reported mapping ("standard" for every family
   *  the classifier knows). Carried for the same reason as
   *  `id`; the positional table is the contract either way. */
  mapping?: string;
}

export interface GamepadEdges {
  voice: boolean;
  view: boolean;
  interact: boolean;
  /** When the current A hold began (poll clock ms), 0 = A is
   *  up. A's tap is the jump; the hold's age is what turns the
   *  same press into voiceStep at the long-press line. */
  aHeldSince: number;
  /** The current A hold has already fired its voiceStep. */
  aVoiced: boolean;
  /** LT held at the last poll (the voice-back edge state). */
  lt: boolean;
  /** Back held at the last poll (the page-cycle edge state). */
  page: boolean;
  /** When the current Back hold began (poll clock ms), 0 = Back
   *  is up. Back's tap is the page cycle; the hold's age is what
   *  turns the same press into the fullscreen toggle. */
  pageHeldSince: number;
  /** The current Back hold has already fired its fullscreen
   *  toggle. */
  pageFiredFs: boolean;
  /** Start held at the last poll (the menu button's edge state —
   *  one button, two gestures: the settings tap and the photo
   *  hold below). */
  photo: boolean;
  /** When the current Start hold began (poll clock ms), 0 =
   *  Start is up. Start's TAP is the settings toggle; the
   *  hold's age is what turns the same press into the photo
   *  frame. */
  menuHeldSince: number;
  /** The current Start hold has already fired its photo frame. */
  menuFiredPhoto: boolean;
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
  /** Edge-triggered: A went down this frame — the jump. (A's
   *  toggleVoice now rides the LONG-PRESS of the same button:
   *  holding A past PAD_VOICE_LONG_PRESS_MS fires it once, and
   *  the tap that started the hold has already jumped — the
   *  documented cost of the share, bindings.ts.) */
  jump: boolean;
  /** Edge-triggered: LT went down this frame — step the voice
   *  mode BACKWARD (the A button's reverse). */
  voiceBack: boolean;
  toggleView: boolean;
  /** Edge-triggered: LB went down this frame — the contextual
   *  interact (the door or courtesy at the showing prompt). */
  interact: boolean;
  /** Edge-triggered: Back went down — cycle the action page. */
  pageCycle: boolean;
  /** Edge-triggered: Back's hold crossed
   *  PAD_FULLSCREEN_LONG_PRESS_MS this frame — toggle
   *  fullscreen. (Back's pageCycle now rides the HOLD of the
   *  same button: the tap that starts the hold has already
   *  cycled the page — the documented cost of the share,
   *  bindings.ts.) */
  fullscreenToggle: boolean;
  /** Edge-triggered: Start went down — toggle the World
   *  settings panel. (Start's TAP now rides the menu button:
   *  settings is what a walker opening a menu means; the photo
   *  frame moved to the hold, below — bindings.ts
   *  PAD_MENU_BUTTON carries the why.) */
  settingsToggle: boolean;
  /** Edge-triggered: Start's hold crossed
   *  PAD_PHOTO_LONG_PRESS_MS this frame — toggle photo mode.
   *  The tap that started the hold has already toggled the
   *  settings (open), and entering photo mode retires every
   *  panel, settings included — the documented cost of the
   *  share, bindings.ts. */
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
  jump: false,
  voiceBack: false,
  toggleView: false,
  interact: false,
  pageCycle: false,
  fullscreenToggle: false,
  settingsToggle: false,
  photoMode: false,
  momentClaim: false,
  action: null,
};

export const IDLE_GAMEPAD_EDGES: GamepadEdges = {
  voice: false,
  view: false,
  interact: false,
  aHeldSince: 0,
  aVoiced: false,
  lt: false,
  page: false,
  pageHeldSince: 0,
  pageFiredFs: false,
  photo: false,
  menuHeldSince: 0,
  menuFiredPhoto: false,
  claim: false,
  actions: {},
};

/** Button index per fixed verb, inverted from the table. */
const VERB_BUTTON: Record<WorldVerb, number> = (() => {
  const out = {} as Record<WorldVerb, number>;
  for (const [btn, verb] of Object.entries(PAD_VERBS)) out[verb] = Number(btn);
  /* The settings toggle has no PAD_VERBS row of its own — its
   *  button IS the photo button, shared by gesture — so the
   *  inversion names it explicitly. */
  out.settingsToggle = PAD_MENU_BUTTON;
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
 *  or repeats a press). `nowMs` is the poll clock — injectable so
 *  A's tap/hold split is testable without a wall clock.
 *
 *  `profile` (stack900) is the connected pad's controller
 *  profile: when the caller passes it, every button index
 *  resolves through the profile's own table instead of the
 *  bindings constants. The two tables name the same positions
 *  today for every family (the standard mapping is positional);
 *  resolving through the profile is what keeps the scene, the
 *  panels and the painted names reading from one identity. */
export function pollGamepad(
  pad: GamepadLike | null,
  prev: GamepadEdges,
  page: ActionPageId = DEFAULT_ACTION_PAGE,
  nowMs: number = Date.now(),
  profile?: ControllerProfile | null,
): { intent: GamepadIntent; edges: GamepadEdges } {
  if (!pad) return { intent: IDLE_GAMEPAD_INTENT, edges: IDLE_GAMEPAD_EDGES };
  const verbs = profile ? padVerbIndices(profile) : null;
  const [moveX, moveY] = applyRadialDeadzone(axis(pad, 0), axis(pad, 1));
  const [lookX, lookY] = applyRadialDeadzone(axis(pad, 2), axis(pad, 3));
  const actionEdges: Partial<Record<WorldActionId, boolean>> = {};
  let action: WorldActionId | null = null;
  const slotChecks: { button: number; id: WorldActionId | null }[] = verbs
    ? verbs.slots.map((button, pos) => ({ button, id: actionForSlot(page, pos) }))
    : PAD_SLOTS.map((button) => ({ button, id: actionForPadButton(page, button) }));
  for (const { button, id } of slotChecks) {
    if (!id) continue;
    const down = pressed(pad, button);
    actionEdges[id] = down;
    if (action === null && down && prev.actions[id] !== true) action = id;
  }
  /* A (PAD_JUMP_BUTTON = VERB_BUTTON.voiceStep — one button, two
   *  gestures): the press edge is the jump; the hold crossing
   *  PAD_VOICE_LONG_PRESS_MS is the voice step, once per hold. */
  const aDown = pressed(pad, verbs ? verbs.jump : PAD_JUMP_BUTTON);
  const prevAHeldSince = typeof prev.aHeldSince === "number" ? prev.aHeldSince : 0;
  const aHeldSince = aDown ? (prevAHeldSince > 0 ? prevAHeldSince : nowMs) : 0;
  const aVoiced =
    aDown &&
    (prev.aVoiced === true ||
      (aHeldSince > 0 && nowMs - aHeldSince >= PAD_VOICE_LONG_PRESS_MS));
  /* Back (PAD_PAGE_BUTTON = VERB_BUTTON.pageCycle — one button,
   *  two gestures, A's pattern): the press edge is the page
   *  cycle; the hold crossing PAD_FULLSCREEN_LONG_PRESS_MS is
   *  the fullscreen toggle, once per hold. */
  const backDown = pressed(pad, verbs ? verbs.pageCycle : PAD_PAGE_BUTTON);
  const prevBackHeldSince = typeof prev.pageHeldSince === "number" ? prev.pageHeldSince : 0;
  const pageHeldSince = backDown ? (prevBackHeldSince > 0 ? prevBackHeldSince : nowMs) : 0;
  const pageFiredFs =
    backDown &&
    (prev.pageFiredFs === true ||
      (pageHeldSince > 0 && nowMs - pageHeldSince >= PAD_FULLSCREEN_LONG_PRESS_MS));
  /* Start (PAD_MENU_BUTTON = VERB_BUTTON.settingsToggle — one
   *  button, two gestures, Back's pattern): the press edge is
   *  the settings toggle; the hold crossing
   *  PAD_PHOTO_LONG_PRESS_MS is the photo frame, once per hold. */
  const menuDown = pressed(pad, verbs ? verbs.menu : PAD_MENU_BUTTON);
  const prevMenuHeldSince = typeof prev.menuHeldSince === "number" ? prev.menuHeldSince : 0;
  const menuHeldSince = menuDown ? (prevMenuHeldSince > 0 ? prevMenuHeldSince : nowMs) : 0;
  const menuFiredPhoto =
    menuDown &&
    (prev.menuFiredPhoto === true ||
      (menuHeldSince > 0 && nowMs - menuHeldSince >= PAD_PHOTO_LONG_PRESS_MS));
  const edges: GamepadEdges = {
    voice: aDown,
    view: pressed(pad, verbs ? verbs.viewToggle : VERB_BUTTON.viewToggle),
    interact: pressed(pad, verbs ? verbs.interact : VERB_BUTTON.interact),
    aHeldSince,
    aVoiced,
    lt: pressed(pad, verbs ? verbs.voiceBack : VERB_BUTTON.voiceBack),
    page: backDown,
    pageHeldSince,
    pageFiredFs,
    photo: menuDown,
    menuHeldSince,
    menuFiredPhoto,
    claim: pressed(pad, verbs ? verbs.momentClaim : VERB_BUTTON.momentClaim),
    actions: actionEdges,
  };
  return {
    intent: {
      moveX,
      moveY,
      lookX,
      lookY,
      sprint: (verbs ? verbs.sprint : PAD_SPRINT_BUTTONS).some((b) => pressed(pad, b)),
      toggleVoice: aDown && aVoiced && prev.aVoiced !== true,
      jump: aDown && prevAHeldSince === 0,
      voiceBack: edges.lt && !prev.lt,
      toggleView: edges.view && !prev.view,
      interact: edges.interact && !prev.interact,
      pageCycle: edges.page && !prev.page,
      fullscreenToggle: pageFiredFs && prev.pageFiredFs !== true,
      settingsToggle: edges.photo && !prev.photo,
      photoMode: menuFiredPhoto && prev.menuFiredPhoto !== true,
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
