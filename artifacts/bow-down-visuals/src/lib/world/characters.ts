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

/* ── Manage verbs (rename / remove / create / restyle) ───────────────
   The picker is where a member meets their characters in the World,
   so it carries the vault manage verbs the server already rails:
   PUT /api/artist-vaults/:id (owner-scoped) and DELETE
   /api/artist-vaults/:id (owner-scoped soft delete — the row is
   hidden, never destroyed). Since stack-100 #98 it also carries
   creation (POST /api/artist-vaults) and appearance editing (the
   same PUT, full round-trip) — see the #98 section below. */

/** The PUT body for renaming one vault row. The server's update is a
 *  FULL-body write: any field left out is stored back as null, so a
 *  rename must round-trip the stored row exactly and change only the
 *  name — the same mapping the Creative Vault page saves with. The
 *  reference video is not part of the update schema at all (the
 *  server never touches it on PUT), so the living loop survives.
 *  `voiceProfile` rides along only when the row carries the field:
 *  absent means the server leaves the stored profile untouched. */
function vaultRowPick(row: unknown) {
  const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "string") return v;
      if (v === null) return null;
    }
    return null;
  };
  return { r, pick };
}

export function buildVaultRenameBody(row: unknown, newName: string): Record<string, unknown> {
  const { r, pick } = vaultRowPick(row);
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

/* ── Creation + appearance editing (stack-100 #98) ──────────────────
   The picker used to stop at pick/rename/remove: making a character
   or restyling one was a Creative Vault link-out. Both verbs ride
   the vault's own rails — POST /api/artist-vaults (create) and the
   same full-body PUT the rename rides (appearance) — with the same
   round-trip discipline: the PUT writes EVERY field back, so an
   appearance save starts from the row as it stands now and changes
   only the fields the editor touched. The fields edited in-world
   are the look itself: type, genre, voice, visual style, hair,
   tattoos, jewelry, clothing, brand colors, theme, personality,
   description and the portrait URL. Locked rules / consistency
   fields are preserved by the round-trip, never edited here. */

export interface VaultAppearance {
  artistType: string | null;
  genre: string | null;
  voiceStyle: string | null;
  visualStyle: string | null;
  hair: string | null;
  tattoos: string | null;
  jewelry: string | null;
  clothingStyle: string | null;
  brandColors: string | null;
  themeId: string | null;
  personality: string | null;
  artistDescription: string | null;
  referenceImageUrl: string | null;
}

export const VAULT_APPEARANCE_KEYS = [
  "artistType", "genre", "voiceStyle", "visualStyle", "hair", "tattoos",
  "jewelry", "clothingStyle", "brandColors", "themeId", "personality",
  "artistDescription", "referenceImageUrl",
] as const satisfies readonly (keyof VaultAppearance)[];

/** The stored row's appearance, in the editor's shape (snake_case
 *  or camelCase — the vault read has worn both). */
export function vaultAppearanceFromRow(row: unknown): VaultAppearance {
  const { pick } = vaultRowPick(row);
  return {
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
    artistDescription: pick("description", "artistDescription"),
    referenceImageUrl: pick("reference_image_url", "referenceImageUrl"),
  };
}

/** The full-body PUT for an appearance save: the rename round-trip,
 *  with the patch's fields laid over it. A field ABSENT from the
 *  patch keeps the row's stored value; a field present (even as an
 *  empty string) is written — trimmed, empty becoming null, exactly
 *  as the Creative Vault page saves. */
export function buildVaultAppearanceBody(
  row: unknown,
  patch: Partial<VaultAppearance> & { artistName?: string },
): Record<string, unknown> {
  const { pick } = vaultRowPick(row);
  const currentName = pick("artist_name", "artistName") ?? "";
  const body = buildVaultRenameBody(row, patch.artistName ?? currentName);
  for (const key of VAULT_APPEARANCE_KEYS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    body[key] = typeof v === "string" ? (v.trim() ? v.trim() : null) : (v ?? null);
  }
  return body;
}

/** The POST body for a brand-new character: the name plus the
 *  appearance fields, empty strings becoming null, the theme
 *  defaulting to Gold Royalty like the vault page's own form. */
export function buildVaultCreateBody(input: {
  artistName: string;
  appearance?: Partial<VaultAppearance>;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { artistName: input.artistName.trim() };
  const a = input.appearance ?? {};
  for (const key of VAULT_APPEARANCE_KEYS) {
    const v = a[key];
    body[key] = typeof v === "string" ? (v.trim() ? v.trim() : null) : (v ?? null);
  }
  if (!body["themeId"]) body["themeId"] = "gold-royalty";
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
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
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

/* ── #98 fetch verbs: read one row, create, save appearance ──────── */

async function fetchVaultRow(
  getAccessToken: () => Promise<string | null>,
  id: string,
  fetchFn: typeof fetch,
): Promise<{ row: Record<string, unknown>; headers: Record<string, string> }> {
  const token = await getAccessToken().catch(() => null);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
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
  return { row, headers };
}

function assertVaultRowOwned(row: Record<string, unknown>, currentUserId?: string | null): void {
  const ownerRaw = row["user_id"] ?? row["userId"];
  if (typeof currentUserId === "string" && currentUserId !== "" && ownerRaw !== currentUserId) {
    throw new Error("Only the owner can restyle this character.");
  }
}

/** Read one character's stored appearance (for the editor's initial
 *  values) — the same list read the picker itself rides. */
export async function fetchVaultAppearance(
  getAccessToken: () => Promise<string | null>,
  id: string,
  currentUserId?: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<{ name: string; appearance: VaultAppearance }> {
  const { row } = await fetchVaultRow(getAccessToken, id, fetchFn);
  assertVaultRowOwned(row, currentUserId);
  const { pick } = vaultRowPick(row);
  return { name: pick("artist_name", "artistName") ?? "", appearance: vaultAppearanceFromRow(row) };
}

/** Create a new character in the member's vault (POST
 *  /api/artist-vaults — the Creative Vault's own create rail).
 *  Returns the new row's id; the caller re-reads the vault so the
 *  picker shows the row exactly as the server stored it. */
export async function createVaultCharacter(
  getAccessToken: () => Promise<string | null>,
  input: { artistName: string; appearance?: Partial<VaultAppearance> },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (!input.artistName.trim()) throw new Error("Give the character a name first.");
  const token = await getAccessToken().catch(() => null);
  const res = await fetchFn("/api/artist-vaults", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(buildVaultCreateBody(input)),
  });
  if (!res.ok) throw new Error(await vaultErrorMessage(res, "Couldn't create the character. Please try again."));
  const data = (await res.json().catch(() => ({}))) as { id?: unknown };
  if (typeof data.id !== "string" || !data.id) throw new Error("The vault didn't hand back the new character.");
  return data.id;
}

/** Save an appearance edit on one of the member's OWN characters:
 *  re-read the row as it stands now, refuse a row that isn't theirs
 *  (before any write), then PUT the full round-trip body with the
 *  patch laid over it — the rename's discipline, widened. */
export async function saveVaultAppearance(
  getAccessToken: () => Promise<string | null>,
  id: string,
  patch: Partial<VaultAppearance> & { artistName?: string },
  currentUserId?: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const { row, headers } = await fetchVaultRow(getAccessToken, id, fetchFn);
  assertVaultRowOwned(row, currentUserId);
  const res = await fetchFn(`/api/artist-vaults/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(buildVaultAppearanceBody(row, patch)),
  });
  if (!res.ok) throw new Error(await vaultErrorMessage(res, "Couldn't save the new look. Please try again."));
}
