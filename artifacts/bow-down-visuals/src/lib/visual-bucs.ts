/* ─── Visual Bucs formatting (x100 convention) ─────────────────────────────
   The site runs on hundreds: 1 old credit = 100 Visual Bucs. Every amount
   rendered anywhere must already be in hundreds — NEVER divide by 100 for
   display, and never render single-digit values as if they were whole.
   Prize pools, balances, and payouts all flow through here. */

/** "10,000 Visual Bucs" — the canonical money rendering. */
export function formatBucs(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  return `${v.toLocaleString("en-US")} Visual Bucs`;
}

/** Compact: "10K" for tight spaces (badges, chips). */
export function formatBucsShort(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

/** Ordinal: 1st, 2nd, 3rd, 4th… */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}
