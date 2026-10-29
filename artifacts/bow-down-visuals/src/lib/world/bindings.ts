/**
 * bindings.ts — who can press what, where: the ONE binding table
 * every World input family reads (design: .lane/ACTIONS-DESIGN
 * §2.9 in the world-actions lane).
 *
 * The owner's order was "assign more things to buttons." The pad
 * ran out of buttons at seven actions, so the action slots are
 * PAGED: one action-page state, and the gamepad slots, the
 * keyboard digits and the touch deck all follow it. Nothing in
 * gamepad.ts, the scene, or the page keeps its own copy of the
 * layout — they resolve through here, and the tests pin the table
 * (every input has exactly one job; every action has a pad slot,
 * a digit and a deck home; page 1 is byte-identical to the layout
 * that shipped, so nobody's muscle memory breaks).
 *
 * Verbs vs actions: an ACTION is a figure performance (relayed by
 * the server, seen by the room). A VERB is a local control —
 * stepping the voice ring, opening a door, claiming the live
 * moment, framing a photo. Admin punishment verbs (mute, remove,
 * locks, herald) are deliberately NOT in this table for any role:
 * they keep their Host panel and its confirmations (peace law).
 */
import type { WorldActionId } from "./actions";

export type WorldRole = "guest" | "member" | "admin";

export type ActionPageId = "perform" | "social";

export interface ActionPageDef {
  id: ActionPageId;
  label: string;
  /** The page's actions in SLOT order (see PAD_SLOTS): index i of
   *  this array is what slot i performs while the page is up. */
  slots: readonly WorldActionId[];
}

/** The paged action slots, in slot order: D-pad up, D-pad right,
 *  D-pad down, D-pad left, X, B, RB. Page 1's slot order IS the
 *  shipped layout (bow/cheer/sit/wave on the cross, clap/dance/
 *  spin on the buttons); page 2 mirrors its discipline (down is
 *  the kneel, as down was the sit). */
export const ACTION_PAGES: readonly ActionPageDef[] = [
  {
    id: "perform",
    label: "Perform",
    slots: ["bow", "cheer", "sit", "wave", "clap", "dance", "spin"],
  },
  {
    id: "social",
    label: "Social",
    slots: ["point", "laugh", "kneel", "beckon", "salute", "highfive", "shrug"],
  },
];

export const DEFAULT_ACTION_PAGE: ActionPageId = "perform";

export function actionPageById(id: ActionPageId): ActionPageDef {
  return ACTION_PAGES.find((p) => p.id === id) ?? ACTION_PAGES[0]!;
}

export function nextActionPage(id: ActionPageId): ActionPageId {
  const i = ACTION_PAGES.findIndex((p) => p.id === id);
  return ACTION_PAGES[(i + 1) % ACTION_PAGES.length]!.id;
}

/** Standard-mapping button indices of the paged action slots, in
 *  slot order (the order of ActionPageDef.slots). */
export const PAD_SLOTS: readonly number[] = [12, 15, 13, 14, 2, 1, 5];

/** Held sprint buttons (right trigger, left-stick click). */
export const PAD_SPRINT_BUTTONS: readonly number[] = [7, 10];

export type WorldVerb =
  | "voiceStep"
  | "voiceBack"
  | "viewToggle"
  | "interact"
  | "pageCycle"
  | "momentClaim"
  | "photoMode"
  | "fullscreen"
  | "jump";

/** Fixed (never paged) pad verbs: button index → verb. Back (8)
 *  cycles the action page; Start (9) frames a photo; R3 (11) is
 *  the moment claim — the three buttons that were still free.
 *  A (0) carries TWO gestures (stack300, below): its entry here
 *  is the long-press one. */
export const PAD_VERBS: Readonly<Record<number, WorldVerb>> = {
  0: "voiceStep", // A / Cross — LONG-PRESS (see PAD_JUMP_BUTTON)
  6: "voiceBack", // LT / L2
  3: "viewToggle", // Y / Triangle
  4: "interact", // LB / L1
  8: "pageCycle", // Back / Select
  9: "photoMode", // Start / Menu
  11: "momentClaim", // R3 (right-stick click)
};

/** The jump's pad home (stack300): A / Cross (0), the bottom
 *  face button — where every player's thumb already looks for a
 *  jump. Every one of the 16 standard buttons already had a job
 *  when jump arrived, so A SHARES by gesture rather than taking
 *  a job away: a TAP of A is the jump (press edge); HOLDING A
 *  for PAD_VOICE_LONG_PRESS_MS steps the voice mode, exactly
 *  what A always did (voice-stepping is a stand-still act, and
 *  the tap that begins the hold hops first — the documented
 *  cost of the share). The alternatives lost on feel: L3's click
 *  edge would hop at the start of every L3 sprint hold, and R3's
 *  moment claim matters most exactly when a drop lands and the
 *  room is scrambling. gamepad.ts polls this split; the keyboard
 *  (Space) and touch (Jump button) families never share. */
export const PAD_JUMP_BUTTON = 0;
/** How long A must be held before the press becomes voiceStep
 *  instead of just a jump (ms). */
export const PAD_VOICE_LONG_PRESS_MS = 400;

/** The fullscreen toggle's pad home (stack700): Back (8), the
 *  pageCycle button — shared by gesture exactly the way A is
 *  shared above. Every standard button already had a job when
 *  the owner's controller-first walk (2026-10-29: "my controller
 *  just stops… I should be able to use my controller for
 *  everything") demanded a pad road into fullscreen, so Back
 *  SHARES: a TAP cycles the action page, exactly what it always
 *  did; HOLDING Back for PAD_FULLSCREEN_LONG_PRESS_MS toggles
 *  fullscreen, once per hold. The documented cost of the share,
 *  mirroring A's: the tap that begins the hold cycles the page
 *  first — a cosmetic, instantly reversible act — and pageCycle
 *  is a stand-still act beside it. The alternatives lost on the
 *  same grounds A rejected: Start's tap frames photo mode (a
 *  hold there would fire the photo frame first AND strand the
 *  chrome), and the triggers/sticks are movement's own. The
 *  keyboard and touch families never share: the header button
 *  is theirs. gamepad.ts polls this split. */
export const PAD_PAGE_BUTTON = 8;
/** How long Back must be held before the press becomes the
 *  fullscreen toggle instead of just a page cycle (ms). Longer
 *  than A's line: cycling pages back-to-back in a hurry is a
 *  real pad habit, and a fullscreen flip is a bigger act than a
 *  voice step. */
export const PAD_FULLSCREEN_LONG_PRESS_MS = 600;

/** Keyboard verbs (KeyboardEvent.code). Movement keeps WASD /
 *  arrows / Shift — read by the scene as it always was; E was the
 *  door key long before this table named it. Space joined with
 *  the jump (stack300): the scene owns the key (edge + the
 *  preventDefault that keeps a focused page button from eating
 *  it), the table names it so the family stays one table. */
export const KEY_VERBS: Readonly<Record<string, WorldVerb>> = {
  KeyE: "interact",
  KeyQ: "pageCycle",
  KeyC: "momentClaim",
  KeyP: "photoMode",
  Space: "jump",
};

/** The action a pad button performs on a page, or null when the
 *  button is not an action slot. */
export function actionForPadButton(page: ActionPageId, button: number): WorldActionId | null {
  const slot = PAD_SLOTS.indexOf(button);
  if (slot < 0) return null;
  return actionPageById(page).slots[slot] ?? null;
}

/** The pad button an action sits on (on the page that holds it),
 *  or null when the action is not paged (none today). */
export function padButtonForAction(action: WorldActionId): { page: ActionPageId; button: number } | null {
  for (const page of ACTION_PAGES) {
    const slot = page.slots.indexOf(action);
    if (slot >= 0) return { page: page.id, button: PAD_SLOTS[slot]! };
  }
  return null;
}

/** The action behind a slot index on a page — the deck's and the
 *  digit keys' view of the same table. */
export function actionForSlot(page: ActionPageId, slot: number): WorldActionId | null {
  return actionPageById(page).slots[slot] ?? null;
}

/** Digit1..Digit7 perform the active page's slots, in order. */
export function actionForKey(page: ActionPageId, code: string): WorldActionId | null {
  const m = /^Digit([1-7])$/.exec(code);
  if (!m) return null;
  return actionForSlot(page, Number(m[1]) - 1);
}

/** Which page holds an action (for the deck to light the right
 *  tab when a held toggle is showing). */
export function pageForAction(action: WorldActionId): ActionPageId | null {
  return padButtonForAction(action)?.page ?? null;
}

/**
 * Role gating (access law): guests look, listen and move — the
 * deck already pitches them sign-in instead of dead buttons, and
 * every input family resolves through these same gates so a pad
 * or a keyboard can never do what the deck would not show.
 * Photo mode and the view toggle are looking, so guests keep
 * them; the jump is MOVING (guests walk and hurry too), so
 * guests keep it. Everything that performs, speaks, opens or
 * claims is a member act. Admins get the member set here — host
 * power lives in its panel, not on the pad (see the header).
 */
export function verbRoleOk(verb: WorldVerb, role: WorldRole): boolean {
  if (role !== "guest") return true;
  return verb === "photoMode" || verb === "viewToggle" || verb === "jump" || verb === "fullscreen";
}

export function actionRoleOk(role: WorldRole): boolean {
  return role !== "guest";
}
