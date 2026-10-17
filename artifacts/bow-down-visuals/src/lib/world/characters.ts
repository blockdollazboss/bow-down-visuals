/**
 * characters.ts — "Walk in as": the world entry picker over the
 * Creative Vault. A creator's characters already live server-side in
 * the vault (GET /api/artist-vaults, the same read the vault page
 * uses); this lib only shapes that payload for the picker, remembers
 * the pick on the device, and fetches with the session token.
 *
 * The pick itself is just an id: the world presence server verifies
 * ownership and resolves the portrait (lib/world-room.ts), so nothing
 * here can dress a member in a character that isn't theirs.
 */

import { houseGuardVariantForId } from "./figure";

export interface VaultCharacter {
  id: string;
  name: string;
  /** The character's reference portrait, or null when the vault row
   *  has no image yet — such a character can't stand in the hall, so
   *  the picker shows it disabled with the reason, not as a dead end. */
  portraitUrl: string | null;
}

/** Shape the /api/artist-vaults payload into picker rows. Defensive
 *  by design (DTO disease is this codebase's endemic bug): rows may
 *  arrive snake_case (the DB's own names) or camelCase; anything
 *  unrecognizable is skipped rather than guessed at. Server order
 *  (newest first) is preserved. */
export function normalizeVaultCharacters(payload: unknown): VaultCharacter[] {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { vaults?: unknown }).vaults)
      ? ((payload as { vaults: unknown[] }).vaults)
      : [];
  const out: VaultCharacter[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r["id"] === "string" ? r["id"] : "";
    if (!id) continue;
    const nameRaw = r["artist_name"] ?? r["artistName"];
    const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim().slice(0, 80) : "Untitled character";
    const portraitRaw = r["reference_image_url"] ?? r["referenceImageUrl"];
    const portraitUrl = typeof portraitRaw === "string" && portraitRaw.trim() ? portraitRaw.trim() : null;
    out.push({ id, name, portraitUrl });
  }
  return out;
}

/* ── Device memory ────────────────────────────────────────────────────
   The pick is a device preference, not account data: it lives in
   localStorage so the hall greets you as your character next visit;
   presence itself carries the choice to the room (no migration). */

export const WORLD_CHARACTER_STORAGE_KEY = "bdv.worldCharacterId";

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

export function loadStoredCharacterId(storage: StorageLike | null = defaultStorage()): string | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(WORLD_CHARACTER_STORAGE_KEY);
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

export function storeCharacterId(id: string | null, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (id) storage.setItem(WORLD_CHARACTER_STORAGE_KEY, id);
    else storage.removeItem(WORLD_CHARACTER_STORAGE_KEY);
  } catch {
    /* private mode etc. — the pick still applies this visit */
  }
}

/** Keep a remembered pick honest: if the vault no longer holds that
 *  character (deleted, or a first visit on a shared device), the
 *  remembered id is dropped rather than sent to be refused. A house
 *  guard pick needs no vault row — it always stands. */
export function reconcileStoredPick(characters: VaultCharacter[], storedId: string | null): string | null {
  if (!storedId) return null;
  if (houseGuardVariantForId(storedId)) return storedId;
  return characters.some((c) => c.id === storedId && c.portraitUrl) ? storedId : null;
}

/** Fetch the signed-in member's vault characters for the picker. */
export async function fetchVaultCharacters(
  getAccessToken: () => Promise<string | null>,
  fetchFn: typeof fetch = fetch,
): Promise<VaultCharacter[]> {
  const token = await getAccessToken().catch(() => null);
  const res = await fetchFn("/api/artist-vaults", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`artist-vaults ${res.status}`);
  return normalizeVaultCharacters(await res.json());
}
