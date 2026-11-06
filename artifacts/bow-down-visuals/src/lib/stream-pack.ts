/**
 * stream-pack.ts — the client half of the stream-pack library + the
 * Go Live studio tray.
 *
 * The server records every generated stream-pack graphic on the
 * generations rail (metadata.kind "stream-pack"); that record is the
 * ownership proof and the single source of truth for "applied to my
 * studio". This module is the one reading of that wire: a tolerant
 * normalizer for the DTO plus the two fetch helpers both surfaces use
 * (the Branding Kit → Stream Pack library, and the studio's
 * SourcesPanel tray), so a graphic applied on either surface reads
 * identically on the other.
 */

export interface StreamPackAssetRecord {
  id: string;
  assetKey: string;
  label: string;
  themeId: string | null;
  channelName: string | null;
  url: string;
  appliedToStudio: boolean;
  createdAt: string | null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** One DTO row → a record, or null when it can't be one (no id, no
 *  playable URL, no asset key — nothing honest to render). */
export function normalizeStreamPackAsset(v: unknown): StreamPackAssetRecord | null {
  const r = asRecord(v);
  const id = str(r["id"]);
  const url = str(r["url"]);
  const assetKey = str(r["assetKey"]);
  if (!id || !url || !assetKey) return null;
  return {
    id,
    assetKey,
    label: str(r["label"]) ?? assetKey,
    themeId: str(r["themeId"]),
    channelName: str(r["channelName"]),
    url,
    appliedToStudio: r["appliedToStudio"] === true,
    createdAt: str(r["createdAt"]),
  };
}

/** The GET /api/stream-pack/mine payload → the caller's records. */
export function normalizeStreamPackAssets(payload: unknown): StreamPackAssetRecord[] {
  const list = asRecord(payload)["assets"];
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => normalizeStreamPackAsset(item))
    .filter((a): a is StreamPackAssetRecord => a !== null);
}

/** The studio tray is exactly the applied slice of the library. */
export function streamPackTrayAssets(
  assets: StreamPackAssetRecord[],
): StreamPackAssetRecord[] {
  return assets.filter((a) => a.appliedToStudio);
}

/** The endpoint that sets (or clears) a record's applied flag. */
export function streamPackApplyPath(applied: boolean): string {
  return applied ? "/api/stream-pack/apply" : "/api/stream-pack/unapply";
}

/* ─── Theme display copy (Stack 200 Lane E1, item E-2) ──────────────
   The theme catalog itself is server-owned (GET /api/stream-pack/
   catalog serves each theme's English name + blurb — the canonical
   source the catalog values mirror). Display resolves through the
   locale catalogs by theme id (streamPack.theme.<id>.name/.blurb)
   whenever the caller hands over its translator; the served string
   rides as the defaultValue, so a theme the catalogs don't know
   yet still reads exactly as the server named it. */

export type StreamPackTranslate = (
  key: string,
  opts?: Record<string, unknown>,
) => string;

export function streamPackThemeName(
  theme: { id: string; name: string },
  t?: StreamPackTranslate,
): string {
  return t
    ? t(`streamPack.theme.${theme.id}.name`, { defaultValue: theme.name })
    : theme.name;
}

export function streamPackThemeBlurb(
  theme: { id: string; blurb: string },
  t?: StreamPackTranslate,
): string {
  return t
    ? t(`streamPack.theme.${theme.id}.blurb`, { defaultValue: theme.blurb })
    : theme.blurb;
}

async function authHeaders(
  getAccessToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getAccessToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Fetch the signed-in member's recorded stream-pack graphics. */
export async function fetchMyStreamPackAssets(
  getAccessToken: () => Promise<string | null>,
  fetchFn: typeof fetch = fetch,
): Promise<StreamPackAssetRecord[]> {
  const res = await fetchFn("/api/stream-pack/mine", {
    headers: await authHeaders(getAccessToken),
  });
  if (!res.ok) throw new Error(`stream-pack/mine ${res.status}`);
  return normalizeStreamPackAssets(await res.json());
}

/**
 * Apply (or unapply) one of the member's own graphics. The server
 * re-checks ownership on every call — another member's id answers
 * 404 there, never a silent success here. Resolves with the updated
 * record exactly as the server now reads it.
 */
export async function setStreamPackAssetApplied(
  getAccessToken: () => Promise<string | null>,
  generationId: string,
  applied: boolean,
  fetchFn: typeof fetch = fetch,
): Promise<StreamPackAssetRecord> {
  const res = await fetchFn(streamPackApplyPath(applied), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders(getAccessToken)),
    },
    body: JSON.stringify({ generationId }),
  });
  if (!res.ok) throw new Error(`stream-pack apply ${res.status}`);
  const updated = normalizeStreamPackAsset(asRecord(await res.json())["asset"]);
  if (!updated) throw new Error("stream-pack apply: unparseable response");
  return updated;
}
