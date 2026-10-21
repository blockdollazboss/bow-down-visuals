/**
 * active-artist.ts — the session's active character, by ID.
 *
 * The active artist is a Creative Vault row the creator picked once
 * ("Who's In Front of the Camera") and every creation surface then
 * works as. Only the vault row's ID is remembered on the device; the
 * row itself is always resolved fresh from GET /api/artist-vaults,
 * so a portrait, voice or style edit made in the vault reaches every
 * tool on the next load or refresh — never a frozen localStorage
 * snapshot of the whole row (the old storage format, migrated on
 * read: a stored snapshot contributes its id and is then replaced
 * by the id alone).
 */

import type { ArtistVault } from "@/components/ArtistVaultSelector";

export const ACTIVE_ARTIST_STORAGE_KEY = "bdv_active_artist";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The remembered active-artist id, whatever shape the stored value
 * is in: the current format (the bare id), the legacy format (the
 * whole vault row as JSON — its id is taken), or a JSON string.
 * Anything unrecognizable resolves to null rather than a guess.
 */
export function readStoredActiveArtistId(storage: StorageLike | null = defaultStorage()): string | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(ACTIVE_ARTIST_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed ? parsed : null;
      if (parsed && typeof parsed === "object") {
        const id = (parsed as { id?: unknown }).id;
        return typeof id === "string" && id ? id : null;
      }
      return null;
    } catch {
      return null;
    }
  }
  return trimmed;
}

/**
 * The legacy stored snapshot itself, when one is still on the device.
 * First-paint seed only: the fresh row replaces it the moment the
 * vault read lands, and the stored value is rewritten as the bare id.
 */
export function readLegacyActiveArtistSnapshot(
  storage: StorageLike | null = defaultStorage(),
): ArtistVault | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(ACTIVE_ARTIST_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw || !raw.trim().startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as { id?: unknown }).id === "string") {
      return parsed as ArtistVault;
    }
    return null;
  } catch {
    return null;
  }
}

/** Remember (or forget) the active artist — the id and nothing else. */
export function writeStoredActiveArtistId(
  id: string | null,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (id) storage.setItem(ACTIVE_ARTIST_STORAGE_KEY, id);
    else storage.removeItem(ACTIVE_ARTIST_STORAGE_KEY);
  } catch {
    /* private mode etc. — the pick still applies this visit */
  }
}

/**
 * Resolve the remembered id against a freshly fetched vault list.
 * The row returned is the list's own object, so whatever the row
 * holds NOW (portrait, voice, rules) is what creation works with.
 * A missing id resolves to null — the caller drops the dead pick
 * instead of resurrecting a deleted character from a stale copy.
 */
export function resolveActiveArtist(rows: ArtistVault[], id: string | null): ArtistVault | null {
  if (!id) return null;
  return rows.find((r) => r.id === id) ?? null;
}
