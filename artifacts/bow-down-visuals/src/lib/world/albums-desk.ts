/* ─── Albums desk seam (stack1100 world parity) ────────────────────
   Album & EP building, native at My Studio — on the albums router's
   own rails, the same endpoints pages/songs.tsx's Albums tab
   (pages/songs/albums-section.tsx) calls:

     GET    /api/albums              → { albums } (caller's, with
                                        track_count)
     POST   /api/albums              → create a draft (FREE)
     GET    /api/albums/:id          → detail with the tracklist
     PATCH  /api/albums/:id          → fields and/or the FULL
                                        replacement song_ids order
     DELETE /api/albums/:id          → delete
     POST   /api/album-publish/:id   → publish: 300 Visual Bucs,
                                        mints the public slug
                                        (registry-pinned; the rail
                                        refunds any failure after
                                        the charge)
     GET    /api/songs               → the caller's library, for
                                        the track picker (the same
                                        list the Release Desk reads)

   Drafting is free; publishing is the only charge, named on the
   button and in the credit confirmation before the ask. Rows are
   snake_case by the router's contract (title / album_type /
   release_notes / cover_art_url / status / slug / track_count);
   the tracklist's order IS the album's order — the desk's
   move/remove/add all PATCH the full replacement list, exactly
   like the page's add-to-album chain. */

export const ALBUMS_PATH = "/api/albums";
export const SONGS_PATH = "/api/songs";

export function albumPath(id: string): string {
  return `/api/albums/${encodeURIComponent(id)}`;
}

export function albumPublishPath(id: string): string {
  return `/api/album-publish/${encodeURIComponent(id)}`;
}

/** The registry's pinned price (lib/credit-costs.ts:
 *  "/api/album-publish": { cost: 300, feature: "Publish Album" }). */
export const ALBUM_PUBLISH_COST_VB = 300;
export const ALBUM_PUBLISH_FEATURE = "Publish Album";

export const ALBUM_TYPE_OPTIONS = [
  { key: "album", label: "Album" },
  { key: "ep", label: "EP" },
] as const;

export function albumTypeLabel(key: string): string {
  return ALBUM_TYPE_OPTIONS.find((t) => t.key === key)?.label ?? "Album";
}

/** The published album's public page (App.tsx: /albums/:slug). */
export function albumPublicPath(slug: string): string {
  return `/albums/${slug}`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export interface AlbumSummary {
  id: string;
  title: string;
  albumType: string;
  releaseNotes: string;
  coverArtUrl: string | null;
  status: string;
  slug: string | null;
  trackCount: number;
}

function normalizeAlbumRow(r: Record<string, unknown>): AlbumSummary | null {
  const id = str(r["id"]);
  const title = str(r["title"]);
  if (!id || !title) return null;
  return {
    id,
    title,
    albumType: str(r["album_type"]) || "album",
    releaseNotes: str(r["release_notes"]),
    coverArtUrl: strOrNull(r["cover_art_url"]),
    status: str(r["status"]) || "draft",
    slug: strOrNull(r["slug"]),
    trackCount: num(r["track_count"]),
  };
}

export function normalizeAlbums(payload: unknown): AlbumSummary[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["albums"])) return null;
  const out: AlbumSummary[] = [];
  for (const raw of root["albums"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const row = normalizeAlbumRow(r);
    if (!row) return null;
    out.push(row);
  }
  return out;
}

export interface AlbumTrack {
  songId: string;
  title: string;
}

export interface AlbumDetail extends AlbumSummary {
  tracks: AlbumTrack[];
}

export function normalizeAlbumDetail(payload: unknown, untitled = "Untitled song"): AlbumDetail | null {
  const root = asRecord(payload);
  const album = root ? asRecord(root["album"]) : null;
  if (!album) return null;
  const base = normalizeAlbumRow(album);
  if (!base) return null;
  const tracks: AlbumTrack[] = [];
  if (Array.isArray(album["tracks"])) {
    for (const raw of album["tracks"]) {
      const t = asRecord(raw);
      if (!t) return null;
      const songId = str(t["song_id"]) || str(t["id"]);
      if (!songId) return null;
      tracks.push({ songId, title: str(t["title"]) || untitled });
    }
  }
  return { ...base, trackCount: tracks.length, tracks };
}

/* ─── The library picker ─────────────────────────────────────────── */

export interface LibrarySong {
  id: string;
  title: string;
}

export function normalizeLibrarySongs(payload: unknown, untitled = "Untitled song"): LibrarySong[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["songs"])) return null;
  const out: LibrarySong[] = [];
  for (const raw of root["songs"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const id = str(r["id"]);
    if (!id) return null;
    out.push({ id, title: str(r["title"]) || untitled });
  }
  return out;
}

/* ─── Forms — the rail's zod rules ─────────────────────────────────
   Create/Patch: title 1–120, album_type in the enum, release_notes
   ≤2000, cover_art_url ≤2048, song_ids ≤30 owned songs. */

export interface AlbumForm {
  title: string;
  albumType: string;
  releaseNotes: string;
  coverArtUrl: string;
}

export function albumFormReady(form: AlbumForm): boolean {
  const title = form.title.trim();
  return (
    title.length >= 1 &&
    title.length <= 120 &&
    ALBUM_TYPE_OPTIONS.some((t) => t.key === form.albumType) &&
    form.releaseNotes.length <= 2000 &&
    form.coverArtUrl.trim().length <= 2048
  );
}

export function buildAlbumCreateBody(form: AlbumForm, songIds: string[]): Record<string, unknown> {
  return {
    title: form.title.trim(),
    album_type: form.albumType,
    release_notes: form.releaseNotes.trim(),
    cover_art_url: form.coverArtUrl.trim() || null,
    song_ids: songIds.slice(0, 30),
  };
}

export function buildAlbumPatchBody(form: AlbumForm): Record<string, unknown> {
  return {
    title: form.title.trim(),
    album_type: form.albumType,
    release_notes: form.releaseNotes.trim(),
    cover_art_url: form.coverArtUrl.trim() || null,
  };
}

/** The full-replacement tracklist after one edit — the PATCH body
 *  the rail expects ({ song_ids }), order preserved. */
export function buildTracklistBody(songIds: string[]): Record<string, unknown> {
  return { song_ids: songIds.slice(0, 30) };
}

/** Move one track up (-1) or down (+1); an edge move is a no-op
 *  returning the same order (the desk disables those buttons, this
 *  is the belt under the braces). */
export function moveTrackId(ids: string[], index: number, dir: -1 | 1): string[] {
  const target = index + dir;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}
