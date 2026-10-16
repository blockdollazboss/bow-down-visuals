/**
 * cooldown.ts — one coercion for "seconds until X" values arriving
 * from an API payload. A missing/non-numeric value must become the
 * caller's fallback (or 0), NEVER NaN: NaN slips past every `<= 0`
 * check, survives Math.max, and renders as the literal text "NaNs"
 * (the floating Mystery Crate chip did exactly that on a partial
 * /api/bonus/status payload — Lane V4 item 4).
 */
export function coerceCooldownSeconds(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : fallback;
}

/** True when a seconds value is safe to count down and format. */
export function isUsableSeconds(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
