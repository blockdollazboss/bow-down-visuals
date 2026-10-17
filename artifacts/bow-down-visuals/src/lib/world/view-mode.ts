/**
 * view-mode.ts — how you watch yourself in the King's Hall.
 *
 * First person is the classic walk (you are the camera). Third
 * person pulls the camera behind your figure so you can SEE who
 * you're standing as — the owner asked for it after walking the
 * hall blind to his own character (2026-10-16). Third person is a
 * flat-screen mode: in a headset the XR camera rules stand and the
 * figure steps aside (see hall-scene's camera handling).
 *
 * A device preference like the others: localStorage, default first
 * person (today's hall), remembered across visits.
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

/** Anything unrecognized is first person — the hall as it always was. */
export function normalizeViewMode(value: string | null | undefined): HallViewMode {
  return value === "third" ? "third" : "first";
}

export function loadViewMode(storage: StorageLike | null = defaultStorage()): HallViewMode {
  if (!storage) return "first";
  try {
    return normalizeViewMode(storage.getItem(WORLD_VIEW_STORAGE_KEY));
  } catch {
    return "first";
  }
}

export function storeViewMode(mode: HallViewMode, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (mode === "third") storage.setItem(WORLD_VIEW_STORAGE_KEY, "third");
    else storage.removeItem(WORLD_VIEW_STORAGE_KEY);
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
