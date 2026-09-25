/**
 * Price-math helpers for the Fan Shoutouts page.
 * Mirrors the backend's dollarsToCents / centsToDollars / netAfterFee so the
 * UI never drifts from the server's integer-cent accounting.
 */

export function dollarsToCents(d: number): number {
  return Math.round(d * 100);
}

export function centsToDollars(c: number): number {
  return c / 100;
}

export function netAfterFee(cents: number, feePct = 10): number {
  return Math.round((cents * (100 - feePct)) / 100);
}

export function formatMoney(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}
