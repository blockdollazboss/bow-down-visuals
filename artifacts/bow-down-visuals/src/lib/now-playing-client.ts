/**
 * now-playing-client.ts — the pure half of the now-playing overlay
 * (stack900 lane D3): the page a creator pastes into OBS /
 * Streamlabs as a browser source (/overlay/now-playing) to show the
 * track playing on their stream.
 *
 * The shape mirrors the API DTO in artifacts/api-server/src/routes/
 * now-playing.ts (which mirrors lib/now-playing.ts): title + artist
 * + duration + timing, nothing else — an overlay read carries no
 * ids. Everything here is string/number work — defensive parsing,
 * progress math, clock formatting — so it is unit-testable without
 * a DOM. The fetch glue lives in use-now-playing-feed.ts.
 *
 * JOIN NOTE (stack900): lane C2's stream-overlay-client.ts is the
 * family home for overlay parsing; at the join this file's parser
 * and DTO fold into it, next to parseOverlayMessage.
 */

export interface NowPlayingData {
  title: string;
  artist: string;
  /** Null when the studio doesn't know the track's length — the
   *  card shows no progress bar rather than a guessed one. */
  durationSec: number | null;
  startedAt: string;
  expiresAt: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseTrack(v: unknown): NowPlayingData | null {
  if (!isRecord(v)) return null;
  if (typeof v["title"] !== "string" || v["title"].length === 0) return null;
  if (typeof v["artist"] !== "string" || v["artist"].length === 0) return null;
  if (typeof v["startedAt"] !== "string" || typeof v["expiresAt"] !== "string") return null;
  const duration = v["durationSec"];
  if (duration !== null && typeof duration !== "number") return null;
  return {
    title: v["title"],
    artist: v["artist"],
    durationSec: duration,
    startedAt: v["startedAt"],
    expiresAt: v["expiresAt"],
  };
}

/** Parse one GET /api/overlay/now-playing response. A valid "nothing
 *  playing" answer and a malformed one both read as null — an
 *  overlay must never crash or invent a track on its own feed. */
export function parseNowPlayingResponse(v: unknown): NowPlayingData | null {
  if (!isRecord(v)) return null;
  if (v["nowPlaying"] === null) return null;
  return parseTrack(v["nowPlaying"]);
}

/** Progress through the track as a whole percent (0–100), or null
 *  when the length is unknown — no bar is the honest render then.
 *  Elapsed is measured from the server's startedAt, never from when
 *  this page happened to load. */
export function nowPlayingProgress(np: NowPlayingData, nowMs: number): number | null {
  if (np.durationSec == null || np.durationSec <= 0) return null;
  const startedMs = Date.parse(np.startedAt);
  if (!Number.isFinite(startedMs)) return null;
  const elapsed = Math.max(0, (nowMs - startedMs) / 1000);
  return Math.round(Math.min(1, elapsed / np.durationSec) * 100);
}

/** Elapsed seconds through the track (for the clock readout), or
 *  null when the start can't be read. */
export function nowPlayingElapsedSec(np: NowPlayingData, nowMs: number): number | null {
  const startedMs = Date.parse(np.startedAt);
  if (!Number.isFinite(startedMs)) return null;
  return Math.max(0, Math.floor((nowMs - startedMs) / 1000));
}

/** True once the state's own expiry has passed — the page drops a
 *  stale track the moment its bound lapses, even between polls. */
export function isNowPlayingExpired(np: NowPlayingData, nowMs: number): boolean {
  const expiresMs = Date.parse(np.expiresAt);
  if (!Number.isFinite(expiresMs)) return true;
  return expiresMs <= nowMs;
}

/** m:ss (or h:mm:ss) — the overlay clock format. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}
