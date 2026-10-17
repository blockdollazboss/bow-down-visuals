/* ─── Song library client — the creator's songs in the library ────────────
   Backs GET /api/songs (the `songs` table: uploads, generations, and —
   since the DE-6 server wiring — every finished Audio Studio output).
   Audio Studio's upload zones pick from here so a library song can go
   back through cleanup / mastering / finishing without a re-upload, and
   the job records its output chained to the picked song
   (parent_song_id) when the caller passes the id along as sourceSongId.

   Throws on failure: callers show an honest error state, never a fake
   empty library. */

export interface LibrarySong {
  id: string;
  title: string;
  audioUrl: string;
  /** Row provenance: "upload" | "generated" | "cleanup" | "master" | … */
  source: string | null;
  durationSec: number | null;
  createdAt: string | null;
}

type GetAccessToken = () => Promise<string | null>;

/** Map one raw /api/songs row (snake_case) into the client shape.
 *  Rows without a usable id or audio URL are not pickable — dropped. */
export function normalizeLibrarySong(row: unknown): LibrarySong | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const audioUrl = typeof r.audio_url === "string" && r.audio_url ? r.audio_url : null;
  if (!id || !audioUrl) return null;
  const durationRaw = typeof r.duration_sec === "string" ? Number(r.duration_sec) : r.duration_sec;
  return {
    id,
    title: typeof r.title === "string" && r.title.trim() ? r.title : "Untitled song",
    audioUrl,
    source: typeof r.source === "string" ? r.source : null,
    durationSec: typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : null,
    createdAt: typeof r.created_at === "string" ? r.created_at : null,
  };
}

export function normalizeLibrarySongs(data: unknown): LibrarySong[] {
  const rows = (data as { songs?: unknown })?.songs;
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeLibrarySong).filter((s): s is LibrarySong => s !== null);
}

/** The signed-in creator's library songs, newest first. */
export async function fetchLibrarySongs(getAccessToken: GetAccessToken): Promise<LibrarySong[]> {
  const token = await getAccessToken();
  const res = await fetch("/api/songs", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`song library failed: ${res.status}`);
  return normalizeLibrarySongs(await res.json().catch(() => ({})));
}

const EXT_BY_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
};

/** A filesystem-safe file name for a picked song: its title plus the
 *  extension its bytes (or URL) say it is. Server job titles derive from
 *  the file name, so the song keeps its name through the studio. */
export function librarySongFileName(song: LibrarySong, contentType?: string | null): string {
  const base = song.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "song";
  const fromType = contentType ? EXT_BY_TYPE[contentType.split(";")[0]!.trim().toLowerCase()] : undefined;
  const fromUrl = song.audioUrl.split(/[?#]/)[0]!.split(".").pop()?.toLowerCase();
  const ext = fromType ?? (fromUrl && /^[a-z0-9]{2,5}$/.test(fromUrl) ? fromUrl : "mp3");
  return /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(base) ? base : `${base}.${ext}`;
}

/** Download a library song's audio as a File the studio upload zones can
 *  take — the same fetch→File intake the ?audioUrl= deep links use. */
export async function fetchLibrarySongFile(song: LibrarySong): Promise<File> {
  const res = await fetch(song.audioUrl);
  if (!res.ok) throw new Error(`song download failed: ${res.status}`);
  const blob = await res.blob();
  const type = blob.type || "audio/mpeg";
  return new File([blob], librarySongFileName(song, type), { type });
}

/** "3:24" for a duration, or null when unknown. */
export function formatSongDuration(durationSec: number | null): string | null {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec < 0) return null;
  const total = Math.round(durationSec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
