/**
 * charts-radio.ts — Charts Radio (Stack-200 #156), the FE half.
 *
 * The house's 24/7 station, docked on the Charts page and in the
 * World plaza. The rotation comes from GET /api/discovery/radio —
 * built server-side from the REAL week chart + newest drops; this
 * module only normalizes that payload and owns the playback math
 * that needs no DOM.
 *
 * Smart law, pinned here where the surfaces read it:
 * RADIO_STARTS_ON_LOAD is false — the station NEVER plays with
 * sound on page load, on either surface, ever. A member's tuned-in
 * choice (GET/PATCH /api/discovery/radio/prefs) is only a resume
 * hint: "you tuned in last time — press play to pick it back up."
 * Listening is free — no Visual Bucs, no cash.
 */

export const RADIO_STARTS_ON_LOAD = false;

export interface RadioEntry {
  position: number;
  trackId: string;
  title: string;
  artistName: string | null;
  artistSlug: string | null;
  artworkUrl: string | null;
  audioUrl: string;
  durationSec: number | null;
  genre: string | null;
  source: "chart" | "new-drop";
  chartRank: number | null;
  plays: number | null;
}

export interface RadioStationPayload {
  name: string;
  tagline: string;
  onAir: boolean;
  rotation: RadioEntry[];
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Normalize one raw rotation row; null when it can't honestly play
 *  (no audio URL / no id / no title — never paper over a gap). */
export function normalizeRadioEntry(raw: unknown): RadioEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const trackId = str(r.track_id);
  const audioUrl = str(r.audio_url);
  const title = str(r.title);
  if (!trackId || !audioUrl || !title) return null;
  return {
    position: num(r.position) ?? 0,
    trackId,
    title,
    artistName: str(r.artist_name),
    artistSlug: str(r.artist_slug),
    artworkUrl: str(r.artwork_url),
    audioUrl,
    durationSec: num(r.duration_sec),
    genre: str(r.genre),
    source: r.source === "new-drop" ? "new-drop" : "chart",
    chartRank: num(r.chart_rank),
    plays: num(r.plays),
  };
}

export function normalizeRadioPayload(raw: unknown): RadioStationPayload {
  const empty: RadioStationPayload = {
    name: "Charts Radio",
    tagline: "",
    onAir: false,
    rotation: [],
  };
  if (!raw || typeof raw !== "object") return empty;
  const p = raw as Record<string, unknown>;
  const station = (p.station ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(p.rotation) ? p.rotation : [];
  const rotation = rows
    .map(normalizeRadioEntry)
    .filter((e): e is RadioEntry => e !== null)
    .sort((a, b) => a.position - b.position);
  return {
    name: str(station.name) ?? "Charts Radio",
    tagline: str(station.tagline) ?? "",
    onAir: station.on_air === true && rotation.length > 0,
    rotation,
  };
}

/** The next spin: advance one, wrapping to the top — a station
 *  doesn't end. -1 when the rotation is empty. */
export function nextRadioIndex(rotation: RadioEntry[], current: number): number {
  if (rotation.length === 0) return -1;
  if (current < 0 || current >= rotation.length) return 0;
  return (current + 1) % rotation.length;
}

/** The honest label for an entry's origin — real chart rank or a
 *  fresh drop, never a fabricated stat. */
export function radioEntryBadge(e: RadioEntry): string {
  return e.source === "chart" && e.chartRank ? `#${e.chartRank} this week` : "New drop";
}

/** Copy for the resume hint — shown only when the member tuned in
 *  before. Playback still waits for their press. */
export function radioResumeHint(tunedIn: boolean): string | null {
  return tunedIn ? "You tuned in last time — press play to pick the station back up." : null;
}
