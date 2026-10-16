/* ─── Unified asset library client (Stack 4 #5) ──────────────────────────────
   The shared client for GET /api/asset-library — the one library across
   desks (hub-project assets + generation history, merged server-side).
   Desks' pickers read through here instead of keeping per-tool lists.
   Throws on failure: callers must show an honest error state, never a
   fake empty library. */

export type LibraryMediaKind = "audio" | "video" | "image" | "stems" | "script" | "other";
export type LibraryOrigin = "project" | "generation";

export interface LibraryAsset {
  id: string;
  mediaKind: LibraryMediaKind;
  hubKind: string | null;
  label: string;
  url: string;
  origin: LibraryOrigin;
  detail: string | null;
  createdAt: string; // ISO
}

export async function fetchAssetLibrary(getAccessToken: () => Promise<string | null>): Promise<LibraryAsset[]> {
  const token = await getAccessToken();
  const res = await fetch("/api/asset-library", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`asset library failed: ${res.status}`);
  const data = (await res.json()) as { assets: LibraryAsset[] };
  return Array.isArray(data.assets) ? data.assets : [];
}

export function libraryAssetsOfKind(assets: LibraryAsset[], mediaKind: LibraryMediaKind): LibraryAsset[] {
  return assets.filter((a) => a.mediaKind === mediaKind);
}
