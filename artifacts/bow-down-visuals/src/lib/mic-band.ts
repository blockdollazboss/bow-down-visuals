/**
 * mic-band.ts — pure helpers for the hero hanging-mic promo band.
 *
 * The band's CONTENT is never defined on the frontend: it comes from
 * GET /api/mic-band/promos, which aggregates the standing promotions
 * from their sources of truth (SITE_LAUNCH_PROMO, the live Cheat Code
 * Jackpot event, SPOTLIGHT_OFFER, LOADING_SCREEN_OFFER). This module
 * only carries the band's shape, its rotation step, the payload guard
 * for that endpoint, and the user's on/off preference.
 */

export interface MicBandPromo {
  id: string;
  kicker: string;
  headline: string;
  detail: string;
  href: string | null;
}

/** How long each promotion stays on the band before the next rotates in. */
export const MIC_BAND_ROTATE_MS = 4500;

/** Advance the rotation: wraps at the end, pins to 0 for empty lists. */
export function nextMicBandIndex(current: number, count: number): number {
  if (count <= 0) return 0;
  return (current + 1) % count;
}

/** Runtime guard for the /api/mic-band/promos payload — a malformed or
    error payload yields NO promos (the band hides) rather than any
    invented fallback copy. */
export function parseMicBandPromos(payload: unknown): MicBandPromo[] {
  if (!payload || typeof payload !== "object") return [];
  const promos = (payload as { promos?: unknown }).promos;
  if (!Array.isArray(promos)) return [];
  const out: MicBandPromo[] = [];
  for (const p of promos) {
    if (!p || typeof p !== "object") continue;
    const { id, kicker, headline, detail, href } = p as Record<string, unknown>;
    if (
      typeof id === "string" &&
      typeof kicker === "string" &&
      typeof headline === "string" &&
      headline.length > 0 &&
      typeof detail === "string"
    ) {
      out.push({
        id,
        kicker,
        headline,
        detail,
        href: typeof href === "string" ? href : null,
      });
    }
  }
  return out;
}

/* ─── User-facing on/off ─────────────────────────────────────────────
   Persisted in localStorage under the app's `bdv:` key convention
   (same pattern as use-sidebar-collapsed). Default ON; only an
   explicit stored "0" hides the band. Storage failures (private
   mode) fall back to visible and never throw. */

export const MIC_BAND_STORAGE_KEY = "bdv:mic-band-visible";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readMicBandVisible(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(MIC_BAND_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeMicBandVisible(
  visible: boolean,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(MIC_BAND_STORAGE_KEY, visible ? "1" : "0");
  } catch {
    /* private mode etc. — the choice just doesn't persist */
  }
}
