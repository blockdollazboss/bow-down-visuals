/* ─── Notification read-state transitions (2D header bell) ───────
   Pure helpers behind components/discovery/NotificationsBell.tsx so
   the bell's read behaviour is pinnable without a DOM.

   THE BUG THESE PIN (stack29): the header bell's rows only navigated
   — opening a notification never marked it read, locally or on the
   rail, so the gold dot and the badge survived every open and only
   "Mark all read" ever cleared them. The World bell
   (components/world/WorldNotificationsBell.tsx) already opens
   correctly: flip the one item, drop the badge by one, POST the id.
   These helpers give the header bell the same transitions:

     markItemRead   — flip exactly one item; reports whether it was
                      unread, so the badge only moves when the rail
                      truth moved.
     decrementUnread— badge − 1, never below zero.
     markAllItemsRead — flip everything (mark-all's local half). */

export interface ReadStateItem {
  id: string;
  is_read: boolean;
}

/** Flip one item to read. Returns the list untouched (same reference)
 *  plus wasUnread=false when the id is unknown or already read. */
export function markItemRead<T extends ReadStateItem>(
  items: T[],
  id: string,
): { items: T[]; wasUnread: boolean } {
  const target = items.find((i) => i.id === id);
  if (!target || target.is_read) return { items, wasUnread: false };
  return {
    items: items.map((i) => (i.id === id ? { ...i, is_read: true } : i)),
    wasUnread: true,
  };
}

/** Badge count after one unread item is read: −1, floored at zero. */
export function decrementUnread(unread: number): number {
  return Math.max(0, unread - 1);
}

/** Mark-all's local half: every item read; already-read items keep
 *  their identity so React doesn't repaint rows that didn't change. */
export function markAllItemsRead<T extends ReadStateItem>(items: T[]): T[] {
  return items.map((i) => (i.is_read ? i : { ...i, is_read: true }));
}
