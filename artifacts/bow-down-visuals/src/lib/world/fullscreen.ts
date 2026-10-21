/**
 * fullscreen.ts — the World view's Fullscreen API helpers.
 *
 * Deliberately structural (the page passes `document` and the room
 * container element; tests pass fakes) so the enter/exit logic is
 * unit-tested without a browser. Fullscreen is a pure view state:
 * entering or leaving it never touches the render loop, the socket,
 * pointer lock or an XR session — the browser's own Esc exit lands
 * in the same `fullscreenchange` the page already listens to, so no
 * exit path can strand the session.
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
