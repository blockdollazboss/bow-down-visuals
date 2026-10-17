/* ── Storefront product page helpers ───────────────────────────────────────
   Quantity on /storefront/product/:id is bounded by what the seller
   actually has: unlimited stock (-1 in the rail's convention, surfaced
   as `unlimited`) and untracked stock (0 = "not tracked" on the detail
   DTO — soldOut carries the real zero) both allow the house cap of 99;
   a tracked positive inventory caps at the stock on hand. The server
   re-validates at checkout — this only keeps the picker honest. */

export const MAX_QUANTITY = 99;

export function clampQuantity(quantity: number, inventory: number, unlimited: boolean): number {
  const cap = !unlimited && inventory > 0 ? Math.min(MAX_QUANTITY, inventory) : MAX_QUANTITY;
  if (!Number.isFinite(quantity)) return 1;
  return Math.max(1, Math.min(cap, Math.floor(quantity)));
}

export function maxQuantity(inventory: number, unlimited: boolean): number {
  return !unlimited && inventory > 0 ? Math.min(MAX_QUANTITY, inventory) : MAX_QUANTITY;
}
