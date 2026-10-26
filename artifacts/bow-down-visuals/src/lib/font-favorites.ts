/**
 * Creator font favorites (Stack-200 fonts lane).
 *
 * Favorites are creator-font ids (see lib/creator-fonts.ts), kept in
 * localStorage so the picker is instant and works signed-out. The
 * provisional server table (lib/db/migrations/9999-fonts.sql —
 * user_font_favorites) is the future sync target; until that migration
 * is numbered and applied, localStorage is the source of truth and
 * nothing here calls the API.
 */
import { getCreatorFont } from "./creator-fonts";

export const FONT_FAVORITES_STORAGE_KEY = "bdv:creator-font-favorites:v1";

/** Parse a stored favorites payload; unknown/garbage ids are dropped. */
export function parseFontFavorites(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of parsed) {
      if (typeof v !== "string" || seen.has(v)) continue;
      if (!getCreatorFont(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  } catch {
    return [];
  }
}

export function loadFontFavorites(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return parseFontFavorites(localStorage.getItem(FONT_FAVORITES_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveFontFavorites(ids: string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FONT_FAVORITES_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* storage full/blocked — favorites stay in-memory for the session */
  }
}

/** Toggle one id; returns the NEW favorites list (order = favorited order). */
export function toggleFontFavorite(ids: string[], fontId: string): string[] {
  if (!getCreatorFont(fontId)) return ids;
  return ids.includes(fontId) ? ids.filter((x) => x !== fontId) : [...ids, fontId];
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cached: string[] | null = null;

export function getFontFavoritesSnapshot(): string[] {
  if (!cached) cached = loadFontFavorites();
  return cached;
}

export function subscribeFontFavorites(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setFontFavorite(fontId: string, favorite: boolean): string[] {
  const current = getFontFavoritesSnapshot();
  const has = current.includes(fontId);
  if (has === favorite) return current;
  cached = toggleFontFavorite(current, fontId);
  saveFontFavorites(cached);
  listeners.forEach((fn) => fn());
  return cached;
}
