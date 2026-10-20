/* Catalog export builder options. These live in a plain .ts module (not
   in TrustPanels.tsx) so tests can import them without pulling the .tsx
   component module into the vitest pipeline.
   Builder field options mirror the server whitelist in routes/trust.ts
   (CATALOG_EXPORT_KINDS) exactly — the server rejects anything else. */
export const CATALOG_EXPORT_KIND_OPTIONS = [
  { kind: "tracks", label: "Tracks" },
  { kind: "releases", label: "Releases" },
  { kind: "videos", label: "Videos" },
] as const;
export const CATALOG_EXPORT_FIELD_OPTIONS: Record<string, { key: string; label: string }[]> = {
  tracks: [
    { key: "id", label: "ID" }, { key: "title", label: "Title" }, { key: "source", label: "Source" },
    { key: "durationSec", label: "Duration (sec)" }, { key: "fileUrl", label: "File link" }, { key: "createdAt", label: "Created" },
  ],
  releases: [
    { key: "id", label: "ID" }, { key: "title", label: "Title" }, { key: "artistName", label: "Artist" },
    { key: "status", label: "Status" }, { key: "fileUrl", label: "Audio link" }, { key: "artworkUrl", label: "Artwork link" },
    { key: "createdAt", label: "Created" },
  ],
  videos: [
    { key: "id", label: "ID" }, { key: "title", label: "Title" }, { key: "status", label: "Status" },
    { key: "fileUrl", label: "Video link" }, { key: "thumbnailUrl", label: "Thumbnail link" }, { key: "createdAt", label: "Created" },
  ],
};
