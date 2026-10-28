/**
 * fullscreen.ts — the World view's Fullscreen API helpers.
 *
 * Deliberately structural (the page passes `document` and the page
 * root element; tests pass fakes) so the enter/exit logic is
 * unit-tested without a browser. Fullscreen is a pure view state:
 * entering or leaving it never touches the render loop, the socket,
 * pointer lock or an XR session — the browser's own Esc exit lands
 * in the same `fullscreenchange` the page already listens to, so no
 * exit path can strand the session.
 *
 * The fullscreen root is the PAGE root, not the room box: every
 * in-world surface (station sheets, the character / Screen / host
 * panels, the radio dock, the control row) renders under the page
 * root, so all of it stays on screen and usable while fullscreen —
 * the browser only renders the fullscreen element's subtree, and a
 * panel mounted outside it is a panel the walker cannot see until
 * they leave fullscreen. That was the owner's live report
 * (2026-10-28): doing anything in the World cost him fullscreen.
 */

export interface FullscreenElementLike {
  requestFullscreen?: () => Promise<void> | void;
}

export interface FullscreenDocLike {
  fullscreenElement: unknown | null;
  exitFullscreen?: () => Promise<void> | void;
}

export function isFullscreenActive(doc: FullscreenDocLike): boolean {
  return doc.fullscreenElement !== null && doc.fullscreenElement !== undefined;
}

export function fullscreenSupported(doc: FullscreenDocLike, el: FullscreenElementLike | null): boolean {
  return typeof el?.requestFullscreen === "function" && typeof doc.exitFullscreen === "function";
}

/** Toggle fullscreen on the element. Resolves to the fullscreen
 *  state after the attempt (false when unsupported or rejected —
 *  the caller re-reads the document on `fullscreenchange` anyway,
 *  which is the ground truth for Esc exits too). */
export async function toggleFullscreen(
  doc: FullscreenDocLike,
  el: FullscreenElementLike | null,
): Promise<boolean> {
  try {
    if (isFullscreenActive(doc)) {
      await doc.exitFullscreen?.();
      return false;
    }
    if (!el || typeof el.requestFullscreen !== "function") return false;
    await el.requestFullscreen();
    return true;
  } catch {
    return isFullscreenActive(doc);
  }
}

/* ── Platform-exit recovery ────────────────────────────────────────
 * Some exits are not the walker's choice: Esc (which the browser
 * couples to pointer-lock release), the Safari file chooser, an OS
 * gesture. The page cannot re-enter on its own — requestFullscreen
 * needs a user gesture — so the recovery is a one-shot offer: a
 * platform exit ARMS the recovery, and the next in-world click
 * (itself a valid gesture) re-enters exactly once. The click is
 * never swallowed; it does its own job too. An exit the walker
 * asked for (the toggle button) never arms — leaving on purpose is
 * respected until they ask to go back in. Pure state machine, so
 * the arming rules are unit-tested without a browser. */
export interface FullscreenRecoveryState {
  /** Fullscreen was entered and not yet observed lost. */
  engaged: boolean;
  /** A platform exit dropped us — the next in-world click re-enters. */
  armed: boolean;
  /** The exit now in flight is the toggle button's own doing. */
  selfExit: boolean;
}

export const initialFullscreenRecovery: FullscreenRecoveryState = {
  engaged: false,
  armed: false,
  selfExit: false,
};

/** The toggle button was pressed. Pressing it while fullscreen is
 *  a deliberate exit (mark it, so the change event doesn't arm the
 *  recovery); pressing it while windowed is a deliberate enter,
 *  which supersedes any armed recovery. */
export function fsRecoveryOnToggle(
  state: FullscreenRecoveryState,
  active: boolean,
): FullscreenRecoveryState {
  if (active) return { ...state, selfExit: true };
  return { ...state, armed: false };
}

/** One `fullscreenchange` observation. Entering (or re-entering)
 *  settles everything; leaving arms the recovery only when the
 *  fullscreen was ours and the exit wasn't our own toggle. */
export function fsRecoveryOnChange(
  state: FullscreenRecoveryState,
  active: boolean,
): FullscreenRecoveryState {
  if (active) return { engaged: true, armed: false, selfExit: false };
  if (state.selfExit) return { engaged: false, armed: false, selfExit: false };
  if (state.engaged) return { engaged: false, armed: true, selfExit: false };
  return { ...state, engaged: false };
}

/** A click landed while the recovery was armed. The arm is spent
 *  either way (one offer, never a loop); `reenter` says whether
 *  this click should also re-enter fullscreen. */
export function fsRecoveryOnReenterClick(state: FullscreenRecoveryState): {
  state: FullscreenRecoveryState;
  reenter: boolean;
} {
  if (!state.armed) return { state, reenter: false };
  return { state: { ...state, armed: false }, reenter: true };
}
