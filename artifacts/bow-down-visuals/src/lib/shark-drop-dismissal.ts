/* ─── Shark-drop dismissal memory — per drop, keyed to the drop ─────────
   QC-200 fix queue #4 (Sitting A, live-verified Nov 3, 2026): the
   "Shark dropped … VB" surprise modal reappeared on EVERY dashboard
   visit after "Maybe later". The mechanism: the server holds the drop
   as a durable row and GET /api/retention/shark-drop returns the same
   pending unclaimed drop (same id) on every visit until it is claimed
   or expires at 48h — while the dashboard's dismissal lived only in
   React state (`setSharkDrop(null)`), so the next mount re-fetched and
   re-showed the identical drop.

   The fix mirrors the DailyDropCard precedent (dismissal persisted
   per item under `bdv_daily_drop_dismissed_<date>`): a dismissal is
   stored against the drop's own id. The same drop never re-opens
   after dismissal; a genuinely NEW drop carries a new server-minted
   id and still shows. There is deliberately no time window — the id
   IS the scope, and the drop itself is gone (claimed or expired)
   long before the key could matter again.

   Drop ids are server-minted UUIDs unique to one member's drop row,
   so a dismissal key can never collide with another member's drop on
   a shared browser.

   Storage failures (private mode, quota) never throw — a failed read
   means "not dismissed" and a failed write simply means the modal
   may show again next visit (the pre-fix behavior, never worse). */

type DismissalStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): DismissalStorage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function resolveStorage(
  storage: DismissalStorage | null | undefined,
): DismissalStorage | null {
  return storage === undefined ? defaultStorage() : storage;
}

/** The localStorage key one drop's dismissal lives under. */
export function sharkDropDismissalKey(dropId: string): string {
  return `bdv_shark_drop_dismissed_${dropId}`;
}

/**
 * True when THIS drop was already dismissed ("Maybe later", X,
 * backdrop, or Escape — every exit from the modal that is not a
 * claim). A different drop id always reads false.
 */
export function isSharkDropDismissed(
  dropId: string,
  storage?: DismissalStorage | null,
): boolean {
  if (!dropId) return false;
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    return store.getItem(sharkDropDismissalKey(dropId)) !== null;
  } catch {
    return false;
  }
}

/** Record the dismissal of one drop, keyed to its id. Never throws. */
export function recordSharkDropDismissal(
  dropId: string,
  storage?: DismissalStorage | null,
): void {
  if (!dropId) return;
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(sharkDropDismissalKey(dropId), "1");
  } catch {
    /* private mode — hiding for this view is enough */
  }
}
