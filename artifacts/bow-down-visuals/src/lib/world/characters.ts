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
   *  has no image yet. */
  portraitUrl: string | null;
  /** The character's living loop (the row's reference video), or
   *  null when it has none. A character with a loop but no portrait
   *  CAN stand in the hall — its living portrait is the figure —
   *  and the picker shows the loop itself as its tile. Only a
   *  character with neither shows disabled, with the reason. */
  loopUrl: string | null;
  /** True only when the row is the signed-in member's OWN character
   *  (its user_id is theirs). The vault read also returns characters
   *  shared with their team — usable, but manage verbs (rename,
   *  remove) are the owner's alone: the server scopes its writes to
   *  the owner and silently no-ops for anyone else while still
   *  answering success, so the UI must never offer them on a row it
   *  cannot prove is theirs. False whenever no current user id was
   *  supplied to compare against. */
  isOwn: boolean;
}

/** Shape the /api/artist-vaults payload into picker rows. Defensive
 *  by design (DTO disease is this codebase's endemic bug): rows may
 *  arrive snake_case (the DB's own names) or camelCase; anything
 *  unrecognizable is skipped rather than guessed at. Server order
 *  (newest first) is preserved. `currentUserId` (the signed-in
 *  member's id) marks which rows are their OWN — see VaultCharacter. */
export function normalizeVaultCharacters(payload: unknown, currentUserId?: string | null): VaultCharacter[] {
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
    const loopRaw = r["reference_video_url"] ?? r["referenceVideoUrl"];
    const loopUrl = typeof loopRaw === "string" && loopRaw.trim() ? loopRaw.trim() : null;
    const ownerRaw = r["user_id"] ?? r["userId"];
    const isOwn = typeof currentUserId === "string" && currentUserId !== "" && ownerRaw === currentUserId;
    out.push({ id, name, portraitUrl, loopUrl, isOwn });
  }
  return out;
}

/** The monogram a portrait-less character wears in the picker: the
 *  first letter or digit of its name, uppercased. The picker draws
 *  it on a gold disc — a house placeholder, never a broken-image
 *  glyph. Names are normalized non-empty upstream, but stay safe:
 *  anything without a letter/digit gets the house mark "B". */
export function characterMonogram(name: string): string {
  const m = /[a-z0-9]/i.exec(name ?? "");
  return m ? m[0].toUpperCase() : "B";
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
  return characters.some((c) => c.id === storedId && (c.portraitUrl || c.loopUrl)) ? storedId : null;
}

/** Fetch the signed-in member's vault characters for the picker.
 *  `currentUserId` marks own vs team-shared rows (see VaultCharacter). */
export async function fetchVaultCharacters(
  getAccessToken: () => Promise<string | null>,
  fetchFn: typeof fetch = fetch,
  currentUserId?: string | null,
): Promise<VaultCharacter[]> {
  const token = await getAccessToken().catch(() => null);
  const res = await fetchFn("/api/artist-vaults", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`artist-vaults ${res.status}`);
  return normalizeVaultCharacters(await res.json(), currentUserId);
}

/* ── Manage verbs (rename / remove) ───────────────────────────────────
   The picker is where a member meets their characters in the World,
   so it carries the two vault manage verbs the server already rails:
   PUT /api/artist-vaults/:id (owner-scoped) and DELETE
   /api/artist-vaults/:id (owner-scoped soft delete — the row is
   hidden, never destroyed). Everything else about a character —
   portrait, look, locked regalia, voice — is edited in the Creative
   Vault; nothing here touches an appearance field. */

/** The PUT body for renaming one vault row. The server's update is a
 *  FULL-body write: any field left out is stored back as null, so a
 *  rename must round-trip the stored row exactly and change only the
 *  name — the same mapping the Creative Vault page saves with. The
 *  reference video is not part of the update schema at all (the
 *  server never touches it on PUT), so the living loop survives.
 *  `voiceProfile` rides along only when the row carries the field:
 *  absent means the server leaves the stored profile untouched. */
export function buildVaultRenameBody(row: unknown, newName: string): Record<string, unknown> {
  const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "string") return v;
      if (v === null) return null;
    }
    return null;
  };
  const body: Record<string, unknown> = {
    artistName: newName.trim(),
    artistType: pick("artist_type", "artistType"),
    genre: pick("genre"),
    voiceStyle: pick("voice_style", "voiceStyle"),
    visualStyle: pick("visual_style", "visualStyle"),
    hair: pick("hair"),
    tattoos: pick("tattoos"),
    jewelry: pick("jewelry"),
    clothingStyle: pick("clothing_style", "clothingStyle"),
    brandColors: pick("brand_colors", "brandColors"),
    themeId: pick("theme_id", "themeId"),
    personality: pick("personality"),
    doNotChangeRules: pick("do_not_change_rules", "doNotChangeRules"),
    artistDescription: pick("description", "artistDescription"),
    specialStyleRules: pick("special_style_rules", "specialStyleRules"),
    referenceImageUrl: pick("reference_image_url", "referenceImageUrl"),
    referenceImagePath: pick("reference_image_path", "referenceImagePath"),
    consistencyPrompt: pick("consistency_prompt", "consistencyPrompt"),
  };
  const voiceProfile = r["voice_profile"] ?? r["voiceProfile"];
  if (voiceProfile !== undefined) body["voiceProfile"] = voiceProfile;
  return body;
}

async function vaultErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data?.error === "string" && data.error.trim()) return data.error;
  } catch {
    /* no body to read — the fallback speaks */
  }
  return fallback;
}

/** Rename one of the member's OWN vault characters. Re-reads the
 *  vault first so the PUT round-trips the row as it stands NOW (a
 *  stale copy could resurrect fields another surface just changed),
 *  and refuses — before any write — when the row is absent or isn't
 *  the member's own (a team-shared row would no-op silently
 *  server-side while claiming success). Returns the renamed
 *  character in picker shape. */
export async function renameVaultCharacter(
  getAccessToken: () => Promise<string | null>,
  id: string,
  newName: string,
  currentUserId?: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<VaultCharacter> {
  const name = newName.trim();
  if (!name) throw new Error("Give the character a name first.");
  const token = await getAccessToken().catch(() => null);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const listRes = await fetchFn("/api/artist-vaults", { headers });
  if (!listRes.ok) throw new Error(`artist-vaults ${listRes.status}`);
  const payload: unknown = await listRes.json();
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { vaults?: unknown }).vaults)
      ? ((payload as { vaults: unknown[] }).vaults)
      : [];
  const row = rows.find(
    (x) => x && typeof x === "object" && (x as Record<string, unknown>)["id"] === id,
  ) as Record<string, unknown> | undefined;
  if (!row) throw new Error("That character isn't in your vault anymore.");
  const ownerRaw = row["user_id"] ?? row["userId"];
  if (typeof currentUserId === "string" && currentUserId !== "" && ownerRaw !== currentUserId) {
    throw new Error("Only the owner can rename this character.");
  }
  const res = await fetchFn(`/api/artist-vaults/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(buildVaultRenameBody(row, name)),
  });
  if (!res.ok) throw new Error(await vaultErrorMessage(res, "Couldn't rename the character. Please try again."));
  const [renamed] = normalizeVaultCharacters({ vaults: [row] }, currentUserId);
  return { ...(renamed ?? { id, name, portraitUrl: null, loopUrl: null, isOwn: true }), name };
}

/** Remove one of the member's OWN vault characters. The server's
 *  DELETE is a soft delete — the character is hidden everywhere,
 *  its data kept. Owner-scoped server-side; the picker only offers
 *  it on own rows, and this throws on any non-OK answer rather than
 *  letting the caller pretend the character is gone. */
export async function removeVaultCharacter(
  getAccessToken: () => Promise<string | null>,
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const token = await getAccessToken().catch(() => null);
  const res = await fetchFn(`/api/artist-vaults/${id}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await vaultErrorMessage(res, "Couldn't remove the character. Please try again."));
}
