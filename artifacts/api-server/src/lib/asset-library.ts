/* ─── Unified asset library (Stack 4 #5) ────────────────────────────────────
   One library over the creator's assets across every desk: what lives in
   the active hub project (uploads + desk outputs reported via addAsset)
   plus the server-side generation history. Desks read from
   GET /api/asset-library instead of keeping per-tool lists. Pure mapping /
   merge helpers live here so the route stays thin and testable. */

export type LibraryMediaKind = "audio" | "video" | "image" | "stems" | "script" | "other";
export type LibraryOrigin = "project" | "generation";

export interface LibraryAssetDTO {
  id: string;
  mediaKind: LibraryMediaKind;
  /** The finer-grained hub kind when the asset came from the project. */
  hubKind: string | null;
  label: string;
  url: string;
  origin: LibraryOrigin;
  detail: string | null;
  createdAt: string; // ISO
}

const HUB_KIND_TO_MEDIA: Record<string, LibraryMediaKind> = {
  beat: "audio",
  song: "audio",
  sfx: "audio",
  hum: "audio",
  stems: "stems",
  video: "video",
  clip: "video",
  image: "image",
  thumbnail: "image",
  script: "script",
  other: "other",
};

export function hubKindToMediaKind(kind: string): LibraryMediaKind {
  return HUB_KIND_TO_MEDIA[kind] ?? "other";
}

interface HubAssetLike {
  id: string;
  kind: string;
  url: string;
  label: string;
  detail?: string;
  createdAt: number;
}

export function libraryAssetFromHub(asset: HubAssetLike): LibraryAssetDTO | null {
  if (!asset || typeof asset.url !== "string" || !asset.url) return null;
  return {
    id: `hub:${asset.id}`,
    mediaKind: hubKindToMediaKind(asset.kind),
    hubKind: asset.kind,
    label: asset.label || "Untitled asset",
    url: asset.url,
    origin: "project",
    detail: asset.detail ?? null,
    createdAt: new Date(typeof asset.createdAt === "number" ? asset.createdAt : 0).toISOString(),
  };
}

interface GenerationRowLike {
  id: string;
  generationType: string | null;
  result: unknown;
  createdAt: Date | string | null;
}

export function libraryAssetFromGeneration(row: GenerationRowLike): LibraryAssetDTO | null {
  const result = (typeof row.result === "object" && row.result !== null ? row.result : {}) as {
    videoUrl?: string;
    thumbnailUrl?: string;
    songTitle?: string;
    actionLabel?: string;
  };
  const videoUrl = typeof result.videoUrl === "string" && result.videoUrl ? result.videoUrl : null;
  const thumbnailUrl = typeof result.thumbnailUrl === "string" && result.thumbnailUrl ? result.thumbnailUrl : null;
  const url = videoUrl ?? thumbnailUrl;
  if (!url) return null; // text-only generations are not library media
  const created = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt ?? 0);
  return {
    id: `gen:${row.id}`,
    mediaKind: videoUrl ? "video" : "image",
    hubKind: null,
    label: result.songTitle || result.actionLabel || row.generationType || "Generation",
    url,
    origin: "generation",
    detail: row.generationType ?? null,
    createdAt: created.toISOString(),
  };
}

/** Merge library sources: dedupe by URL (first source wins — callers pass
    project assets first so the project copy, with its label/detail, is the
    canonical one), newest first, capped. */
export function mergeLibraryAssets(lists: LibraryAssetDTO[][], cap = 300): LibraryAssetDTO[] {
  const seen = new Set<string>();
  const merged: LibraryAssetDTO[] = [];
  for (const list of lists) {
    for (const asset of list) {
      if (seen.has(asset.url)) continue;
      seen.add(asset.url);
      merged.push(asset);
    }
  }
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return merged.slice(0, cap);
}
