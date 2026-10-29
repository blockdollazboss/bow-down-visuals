/**
 * view-mode.ts — how you watch yourself in the King's Hall.
 *
 * Third person pulls the camera behind your figure so you can SEE
 * who you're standing as — and it is the DEFAULT (Oct 29, 2026):
 * the owner walked the Plaza in a fresh (Incognito) window and
 * never once saw himself, because the old first-person default
 * hides the self figure by design and a fresh window has no stored
 * preference to rescue it. Third person is the World law: you walk
 * as the character you picked. First person (you are the camera)
 * stays one toggle away (Y / the view chip) and is remembered
 * EXPLICITLY once chosen — an absent key now means "never chose",
 * never "chose first".
 *
 * Third person is a flat-screen mode: in a headset the XR camera
 * rules stand and the figure steps aside (see hall-scene's camera
 * handling). A device preference like the others: localStorage,
 * remembered across visits.
 */

export type HallViewMode = "first" | "third";

export const WORLD_VIEW_STORAGE_KEY = "bdv.worldViewMode";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Only an explicitly stored "first" is first person. Anything
 *  else — "third", an absent key, a garbled value — is third
 *  person, the default: "never chose" must land on the view that
 *  shows you your own character. */
export function normalizeViewMode(value: string | null | undefined): HallViewMode {
  return value === "first" ? "first" : "third";
}

export function loadViewMode(storage: StorageLike | null = defaultStorage()): HallViewMode {
  if (!storage) return "third";
  try {
    return normalizeViewMode(storage.getItem(WORLD_VIEW_STORAGE_KEY));
  } catch {
    return "third";
  }
}

export function storeViewMode(mode: HallViewMode, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    /* Both modes are stored explicitly: since the default flipped
     * to third, first person can no longer be represented by the
     * ABSENCE of the key — an absent key is "never chose" and
     * loads as third. */
    storage.setItem(WORLD_VIEW_STORAGE_KEY, mode);
  } catch {
    /* private mode etc. — the view still applies this visit */
  }
}

export function toggledViewMode(mode: HallViewMode): HallViewMode {
  return mode === "first" ? "third" : "first";
}

/** Whether YOUR OWN name plate rides over your figure. In third
 *  person the plate billboards straight at the follow camera and
 *  hangs mid-view as a giant sign detached from your figure — you
 *  know who you are, so it never renders there (owner's screenshot,
 *  2026-10-16). Peers' plates are untouched in every view. First
 *  person keeps today's behavior (the self figure — plate and all —
 *  is stepped aside for the camera anyway). */
export function selfPlateVisible(mode: HallViewMode): boolean {
  return mode === "first";
}
