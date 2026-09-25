/* featured-songs.ts — homepage "Featured Songs" playlist data layer.
 *
 * Tracks come from GET /api/featured-songs (owner-curated, DB-backed).
 * The Bow Down Visuals theme song is always the built-in default track —
 * the API serves it when the table is empty, and we mirror it here as a
 * last-resort fallback if the fetch itself fails.
 */

export interface FeaturedTrack {
  id: string;
  title: string;
  artist: string;
  audio_url: string;
  audio_path?: string | null;
  duration_label?: string | null;
  position: number;
}

const THEME_SONG_URL = `${import.meta.env.BASE_URL}audio/bow-down-visuals-theme.mp3`;

export const FALLBACK_TRACKS: FeaturedTrack[] = [
  {
    id: "theme-song",
    title: "Bow Down Visuals (Theme Song)",
    artist: "Bow Down Visuals",
    audio_url: THEME_SONG_URL,
    audio_path: null,
    duration_label: null,
    position: 0,
  },
];

export async function fetchFeaturedSongs(): Promise<FeaturedTrack[]> {
  try {
    const res = await fetch("/api/featured-songs");
    if (!res.ok) return FALLBACK_TRACKS;
    const data = (await res.json()) as { tracks?: unknown };
    if (!Array.isArray(data.tracks) || data.tracks.length === 0) return FALLBACK_TRACKS;
    return data.tracks
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t, i) => ({
        id: String(t["id"] ?? `track-${i}`),
        title: String(t["title"] ?? "Untitled").slice(0, 200),
        artist: String(t["artist"] ?? "Bow Down Visuals").slice(0, 200),
        audio_url: String(t["audio_url"] ?? ""),
        audio_path: typeof t["audio_path"] === "string" ? t["audio_path"] : null,
        duration_label:
          typeof t["duration_label"] === "string" && t["duration_label"] ? t["duration_label"] : null,
        position: typeof t["position"] === "number" ? t["position"] : i,
      }))
      .filter((t) => t.audio_url.length > 0);
  } catch {
    return FALLBACK_TRACKS;
  }
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
