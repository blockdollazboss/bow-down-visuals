/**
 * Panel pad navigation — the pure half (stack700).
 *
 * The owner's law, from his live controller-first walk
 * (2026-10-29): "Once I click to do something in the VR world,
 * my controller just stops. I can't select anything on that
 * screen… I should be able to use my controller for everything
 * inside that VR world. Shouldn't have to go look for a mouse."
 *
 * The mechanism he hit is structural, and this module is the
 * missing layer it names: the in-world panels are DOM. The scene
 * polls the gamepad and maps every button to avatar intents —
 * walk, jump, dance — and nothing anywhere translated the pad
 * into DOM selection. A panel could be opened by the pad (LB at
 * a prompt) but not one control inside it could be reached by
 * the pad: no focus, no confirm, no back (B was a Dance slot).
 * The walker's controller did not break; it was never wired to
 * the layer the panels live on.
 *
 * This module polls one panel's worth of pad input into three
 * intents — move the selection, confirm, go back — with the
 * same edge discipline gamepad.ts uses for the scene (a held
 * button speaks once; the stick speaks once per push past the
 * line, never a held-scroll). It knows nothing about the DOM:
 * the hook (src/hooks/use-panel-pad-nav.ts) owns focus, and the
 * scene stands its own pad verbs down while a panel is open
 * (hall-scene's padPanelHold), so the two readers of the same
 * pad never fight.
 *
 * The mapping mirrors the convention every console teaches:
 * D-pad / left stick move, A (0) confirms, B (1) goes back.
 * Nothing else is claimed — the triggers, Back, Start and the
 * action slots keep the jobs bindings.ts gave them (Back's hold
 * is fullscreen's, and it stands down with the rest of the scene
 * verbs while a panel owns the pad: a panel's B is the way out,
 * and out is where fullscreen lives).
 */

import type { GamepadLike } from "./gamepad";

/** The pad buttons panel navigation reads (standard mapping). */
export const PANEL_PAD_BUTTONS = {
  up: 12,
  down: 13,
  left: 14,
  right: 15,
  confirm: 0,
  back: 1,
} as const;

/** How far the left stick must travel before it speaks a move.
 *  Past the scene's own deadzone (0.18) by a wide margin: a
 *  resting thumb's drift must never wander a panel's selection. */
export const PANEL_STICK_THRESHOLD = 0.6;

/** What one poll of a panel-owned pad asks for. */
export interface PanelPadIntent {
  /** -1 = selection up/left, +1 = down/right, 0 = no move. */
  move: -1 | 0 | 1;
  /** Edge-triggered: A went down — activate the selection. */
  confirm: boolean;
  /** Edge-triggered: B went down — close / go back. */
  back: boolean;
}

/** The held-state one poll hands to the next (edge memory). */
export interface PanelPadEdges {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  /** The stick's last spoken direction per axis (-1/0/+1): the
   *  stick re-arms only after returning inside the threshold. */
  stickX: number;
  stickY: number;
}

export const IDLE_PANEL_PAD_EDGES: PanelPadEdges = {
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  back: false,
  stickX: 0,
  stickY: 0,
};

export const IDLE_PANEL_PAD_INTENT: PanelPadIntent = { move: 0, confirm: false, back: false };

function pressed(pad: GamepadLike, index: number): boolean {
  return pad.buttons[index]?.pressed === true;
}

function stickDirection(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value >= PANEL_STICK_THRESHOLD) return 1;
  if (value <= -PANEL_STICK_THRESHOLD) return -1;
  return 0;
}

/**
 * Poll one frame of panel pad input. Pure: the same
 * (pad, prev) always answers the same (intent, edges), and a
 * null pad answers the idle intent with the edges reset — a
 * reconnect never replays a stale press.
 */
export function pollPanelPad(
  pad: GamepadLike | null | undefined,
  prev: PanelPadEdges,
): { intent: PanelPadIntent; edges: PanelPadEdges } {
  if (!pad) return { intent: IDLE_PANEL_PAD_INTENT, edges: IDLE_PANEL_PAD_EDGES };
  const edges: PanelPadEdges = {
    up: pressed(pad, PANEL_PAD_BUTTONS.up),
    down: pressed(pad, PANEL_PAD_BUTTONS.down),
    left: pressed(pad, PANEL_PAD_BUTTONS.left),
    right: pressed(pad, PANEL_PAD_BUTTONS.right),
    confirm: pressed(pad, PANEL_PAD_BUTTONS.confirm),
    back: pressed(pad, PANEL_PAD_BUTTONS.back),
    stickX: stickDirection(pad.axes[0]),
    stickY: stickDirection(pad.axes[1]),
  };
  let move: -1 | 0 | 1 = 0;
  if ((edges.down && !prev.down) || (edges.right && !prev.right)) move = 1;
  else if ((edges.up && !prev.up) || (edges.left && !prev.left)) move = -1;
  else if (edges.stickY !== 0 && prev.stickY === 0) move = edges.stickY > 0 ? 1 : -1;
  else if (edges.stickX !== 0 && prev.stickX === 0) move = edges.stickX > 0 ? 1 : -1;
  return {
    intent: {
      move,
      confirm: edges.confirm && !prev.confirm,
      back: edges.back && !prev.back,
    },
    edges,
  };
}

/**
 * The selection's next seat: a linear wrap over the panel's
 * focusable controls in DOM order. From no selection (-1), a
 * forward move lands on the first control and a backward move
 * on the last — the pad always lands somewhere on its first
 * press. An empty panel answers -1.
 */
export function nextPanelFocusIndex(current: number, count: number, move: number): number {
  if (count <= 0 || move === 0) return count <= 0 ? -1 : current;
  if (current < 0 || current >= count) return move < 0 ? count - 1 : 0;
  return (((current + move) % count) + count) % count;
}

/**
 * The controls a panel offers the pad: the same set keyboard
 * Tab reaches, minus the disabled. The hook re-reads this list
 * on every move — panels re-render their contents (a station's
 * pages, a desk's results) and the selection must follow the
 * live DOM, never a snapshot.
 */
export const PANEL_FOCUSABLE_SELECTOR =
  "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
