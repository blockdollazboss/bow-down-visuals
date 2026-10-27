/* Pure helpers for the Sponsor Marketplace page (/sponsors).
 * Kept dependency-free so they run in the frontend unit-test suite. */

export function formatBudgetRange(min: number, max: number): string {
  const f = (n: number) => "$" + Math.max(0, Math.floor(n)).toLocaleString("en-US");
  return `${f(min)}–${f(max)}`;
}

export function daysLeftLabel(deadlineIso: string, nowMs: number = Date.now()): string {
  const ms = new Date(deadlineIso).getTime() - nowMs;
  if (Number.isNaN(ms)) return "No deadline";
  if (ms < 0) return "Closed";
  if (ms < 86400000) return "Ends today";
  const d = Math.floor(ms / 86400000);
  if (d === 1) return "1 day left";
  return `${d} days left`;
}

/* Pre-pay split preview for a direct profile sponsorship. Mirrors the
   backend sponsorFeeSplit() exactly (fee = round(gross * bps / 10000),
   net = gross − fee) so what the buyer sees before paying is what the
   release step writes. The feeBps comes from the server quote
   (SPONSOR_PLATFORM_FEE_BPS on the sponsor rail — 1500 = 15% default);
   it is NEVER hardcoded here. */
export function sponsorSplitPreview(
  grossCents: number,
  feeBps: number,
): { feeCents: number; netCents: number } {
  const gross = Math.max(0, Math.round(grossCents));
  const feeCents = Math.round((gross * feeBps) / 10000);
  return { feeCents, netCents: gross - feeCents };
}

/* Clamp a matcher score into 0–100 (mirrors the backend clamp). */
export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
