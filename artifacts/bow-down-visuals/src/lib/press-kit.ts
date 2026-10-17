/* ─── Press kit helpers ───────────────────────────────────────────────────
   Pure client-side utilities for the Press Kit Builder. */

import { getCreditCost } from "./credit-costs";

/* ─── Pricing ──────────────────────────────────────────────────────────
   What the page displays, what the confirmation popup confirms, and
   what the server charges are ONE number per action, read from the
   credit registry — the same table the confirmation system itself
   uses. Generate resolves through its exact registry entry; the bio
   refresh endpoint is parameterized (/api/press-kit/:id/…), so its
   price resolves through the registry's parameterized entry.
   (Before this, the page hard-coded pre-x100 fallbacks — 3 and 1 —
   and the popup confirmed those while the server charged 300/100.) */
export const PRESS_KIT_GENERATE_COST_VISUAL_BUCS =
  getCreditCost("/api/press-kit/generate")?.cost ?? 300;
export const PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS =
  getCreditCost("/api/press-kit/:id/regenerate-bio")?.cost ?? 100;

/** Normalize a string into a URL-safe press-kit handle (lowercase, hyphens). */
export function slugifyHandle(v: string): string {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

/** Validate a press-kit handle per the server rules (3-30 chars, a-z0-9-). */
export function isValidHandle(v: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v) && v.length >= 3 && v.length <= 30;
}

/** Build the public press-kit URL for a handle. */
export function publicPressKitUrl(origin: string, handle: string): string {
  return `${origin.replace(/\/$/, "")}/press/${handle}`;
}
