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
  /** Provenance record (Stack-100 #3 lane F7), attached by the API. */
  provenance?: ProvenanceRecord | null;
}

/* ─── Provenance & licence (lane F7) ─────────────────────────────────────
   Mirrors artifacts/api-server/src/lib/provenance.ts. The record rides
   with the library payload; the doors below read a fresh copy, save the
   creator's licence choice, and download the licence certificate. */
export type LicenceId =
  | "all-rights-reserved"
  | "cc-by-4.0"
  | "cc-by-sa-4.0"
  | "cc-by-nc-4.0"
  | "cc0-1.0";

export interface ProvenanceRecord {
  assetId: string;
  title: string;
  mediaKind: LibraryMediaKind;
  creator: { id: string; name: string | null };
  createdWith: { tool: string; model: string | null; platform: string };
  createdAt: string; // ISO
  /** True only when AI generation is proven by stored data. */
  aiGenerated: boolean;
  /** Honest AI-involvement state: "ai" = proven by a generation record
      (directly or via a hub entry linked by URL); "unknown" = no
      generation record is stored, so AI is neither confirmed nor ruled
      out. Never render "unknown" as "no AI". */
  aiInvolvement: "ai" | "unknown";
  editHistory: string[];
  licence: LicenceId;
  disclosureDefaultEnabled: boolean;
}

export interface LicenceOption {
  id: LicenceId;
  name: string;
  summary: string;
  url: string | null;
}

function provenancePath(assetId: string, suffix = ""): string | null {
  const idx = assetId.indexOf(":");
  if (idx <= 0) return null;
  const kind = assetId.slice(0, idx);
  const id = assetId.slice(idx + 1);
  if ((kind !== "hub" && kind !== "gen") || !id) return null;
  return `/api/provenance/${kind}/${encodeURIComponent(id)}${suffix}`;
}

async function authHeaders(getAccessToken: () => Promise<string | null>): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchProvenance(
  getAccessToken: () => Promise<string | null>,
  assetId: string,
): Promise<{ record: ProvenanceRecord; licenceOptions: LicenceOption[] } | null> {
  const path = provenancePath(assetId);
  if (!path) return null;
  const res = await fetch(path, { headers: await authHeaders(getAccessToken) });
  if (!res.ok) return null;
  return (await res.json()) as { record: ProvenanceRecord; licenceOptions: LicenceOption[] };
}

export async function saveAssetLicence(
  getAccessToken: () => Promise<string | null>,
  assetId: string,
  licence: LicenceId,
): Promise<ProvenanceRecord | null> {
  const path = provenancePath(assetId, "/licence");
  if (!path) return null;
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
    body: JSON.stringify({ licence }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { record: ProvenanceRecord };
  return data.record ?? null;
}

/** Download the branded licence-certificate PDF for an asset. Returns
    false when the certificate could not be produced. */
export async function downloadLicenceCertificate(
  getAccessToken: () => Promise<string | null>,
  assetId: string,
  fallbackName: string,
): Promise<boolean> {
  const path = provenancePath(assetId, "/certificate");
  if (!path) return false;
  const res = await fetch(path, { headers: await authHeaders(getAccessToken) });
  if (!res.ok) return false;
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
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
