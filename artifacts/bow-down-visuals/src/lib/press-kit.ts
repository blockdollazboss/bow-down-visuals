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

/* ─── Page layout ─────────────────────────────────────────────────────────
   Section order + visibility for the public page, mirroring the server
   contract in lib/db/src/schema/press-kits.ts (pressKitLayoutSchema is
   the save-time authority; this list must name exactly the same keys).
   The public page renders six content sections under its fixed hero
   header; a kit with no saved layout renders all six, visible, in this
   canonical order — the order the page has always used. */

export const PRESS_KIT_SECTION_KEYS = [
  "bio",
  "achievements",
  "press_quotes",
  "top_tracks",
  "photos",
  "contact",
] as const;

export type PressKitSectionKey = (typeof PRESS_KIT_SECTION_KEYS)[number];

export interface PressKitLayoutEntry {
  key: PressKitSectionKey;
  visible: boolean;
}

/** The default layout: every section visible, in canonical order. */
export function defaultPressKitLayout(): PressKitLayoutEntry[] {
  return PRESS_KIT_SECTION_KEYS.map((key) => ({ key, visible: true }));
}

/** Normalize any stored layout into the full ordered section list:
    saved entries keep their order + visibility; unmentioned sections
    append in canonical order, visible; unknown/duplicate keys drop. */
export function resolvePressKitLayout(layout: unknown): PressKitLayoutEntry[] {
  if (!Array.isArray(layout)) return defaultPressKitLayout();
  const out: PressKitLayoutEntry[] = [];
  const seen = new Set<string>();
  for (const raw of layout) {
    if (!raw || typeof raw !== "object") continue;
    const { key, visible } = raw as { key?: unknown; visible?: unknown };
    if (typeof key !== "string" || seen.has(key)) continue;
    if (!(PRESS_KIT_SECTION_KEYS as readonly string[]).includes(key)) continue;
    seen.add(key);
    out.push({ key: key as PressKitSectionKey, visible: visible !== false });
  }
  for (const key of PRESS_KIT_SECTION_KEYS) {
    if (!seen.has(key)) out.push({ key, visible: true });
  }
  return out;
}

/** Move one section up (-1) or down (+1). At either end it's a no-op. */
export function movePressKitLayoutEntry(
  layout: PressKitLayoutEntry[],
  key: PressKitSectionKey,
  dir: -1 | 1,
): PressKitLayoutEntry[] {
  const i = layout.findIndex((e) => e.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const next = [...layout];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Show or hide one section, leaving order untouched. */
export function setPressKitSectionVisible(
  layout: PressKitLayoutEntry[],
  key: PressKitSectionKey,
  visible: boolean,
): PressKitLayoutEntry[] {
  return layout.map((e) => (e.key === key ? { ...e, visible } : e));
}
