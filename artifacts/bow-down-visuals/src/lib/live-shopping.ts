/* Live Shopping frontend helpers.
   Pure functions shared by the /live-shopping page: price formatting,
   the 5% platform-fee display math, and purchase-alert copy.
   The server is authoritative for money — these are display helpers only. */

/** Platform fee in basis points (must match the server's LIVE_SHOPPING_FEE_BPS). */
export const LIVE_SHOPPING_FEE_BPS = 500;

/** Format cents as a human price string, e.g. 2499 → "$24.99". */
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Parse a user-typed dollar amount ("24.99") into whole cents. NaN when invalid. */
export function parsePriceToCents(input: string): number {
  const value = Number.parseFloat(input.trim());
  if (!Number.isFinite(value) || value < 0) return Number.NaN;
  return Math.round(value * 100);
}

/** Whole-cent 5% platform fee for a sale total, rounded half-up. */
export function platformFeeCents(totalCents: number): number {
  return Math.round((totalCents * LIVE_SHOPPING_FEE_BPS) / 10000);
}

/** Display line for the dashboard: "5% of $24.99 = $1.25". */
export function feeBreakdown(totalCents: number): string {
  return `5% of ${formatPrice(totalCents)} = ${formatPrice(platformFeeCents(totalCents))}`;
}

/** Overlay alert headline, e.g. "Maya bought 2× — $49.98". */
export function buildAlertText(buyerName: string, quantity: number, totalCents: number): string {
  const buyer = buyerName.trim() || "A viewer";
  return `${buyer} bought ${quantity}× — ${formatPrice(totalCents)}`;
}
