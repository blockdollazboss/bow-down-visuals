/**
 * now-playing-reporter.ts — the studio side of the now-playing feed
 * (stack900 lane D3). The feed the stream overlays read exists only
 * because the studio tells the truth about its own program:
 *
 *   - WHAT COUNTS: a media source on the PROGRAM scene, visible,
 *     whose stage element is actually playing, whose URL is one of
 *     the creator's own library tracks (matched against
 *     GET /api/dj/library). A media URL that matches no library
 *     track reports NOTHING — the source's free-text name is not a
 *     track identity, and an unmatched URL gets no invented title.
 *   - URL MATCHING: signed storage URLs rotate their query token,
 *     so matching compares origin + path only — the same stored
 *     object, whatever token it currently wears.
 *   - THE REPORTER: observe() is called on a short interval while
 *     the stream is live. A new track posts a start; the same track
 *     re-posts as a heartbeat every HEARTBEAT_MS (the server keeps
 *     the original start time and only extends the expiry — see
 *     lib/now-playing.ts on the API side for the TTL defence); no
 *     track posts one clear. Sends are best-effort: a failed send
 *     changes no local state, so the next observe retries.
 *
 * The pure pieces (URL normalization, library parsing, resolution,
 * the reporter's decision logic with injected senders) are
 * unit-tested in now-playing-reporter.test.ts; the fetch glue is a
 * thin factory at the bottom.
 */

export interface LibraryTrackLite {
  id: string;
  title: string;
  audioUrl: string;
  durationSec: number | null;
}

export interface ProgramMediaLite {
  mediaUrl: string | null;
  visible: boolean;
  playing: boolean;
}

export interface NowPlayingTrackReport {
  songId: string;
  title: string;
  artist: string;
  durationSec: number | null;
}

/** Origin + path of a media URL — the identity that survives a
 *  signed URL's rotating token. Unparseable URLs compare as their
 *  query-stripped selves. */
export function normalizeMediaUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw.split(/[?#]/)[0] ?? raw;
  }
}

function toDurationSec(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

/** Parse GET /api/dj/library into the lite catalog the resolver
 *  matches against. Malformed entries are dropped, never repaired
 *  into invented tracks. */
export function parseDjLibrary(json: unknown): LibraryTrackLite[] {
  if (typeof json !== "object" || json === null) return [];
  const tracks = (json as Record<string, unknown>)["tracks"];
  if (!Array.isArray(tracks)) return [];
  const out: LibraryTrackLite[] = [];
  for (const t of tracks) {
    if (typeof t !== "object" || t === null) continue;
    const row = t as Record<string, unknown>;
    if (typeof row["id"] !== "string" || typeof row["title"] !== "string") continue;
    if (typeof row["audioUrl"] !== "string" || row["audioUrl"] === "") continue;
    const analysis = row["analysis"] as Record<string, unknown> | null;
    out.push({
      id: row["id"],
      title: row["title"],
      audioUrl: row["audioUrl"],
      durationSec: toDurationSec(row["durationSec"]) ?? toDurationSec(analysis?.["durationSec"]),
    });
  }
  return out;
}

/** The track on the program right now: the first visible, playing
 *  media source whose URL is a library track. Scene order decides
 *  ties — the same order the program draws in. */
export function resolveProgramTrack(
  media: readonly ProgramMediaLite[],
  catalog: readonly LibraryTrackLite[],
): LibraryTrackLite | null {
  const byUrl = new Map(catalog.map((t) => [normalizeMediaUrl(t.audioUrl), t]));
  for (const m of media) {
    if (!m.visible || !m.playing || !m.mediaUrl) continue;
    const track = byUrl.get(normalizeMediaUrl(m.mediaUrl));
    if (track) return track;
  }
  return null;
}

export const NOW_PLAYING_HEARTBEAT_MS = 30_000;

export interface NowPlayingSenders {
  post: (track: NowPlayingTrackReport) => Promise<void>;
  clear: () => Promise<void>;
  now?: () => number;
  heartbeatMs?: number;
}

/** Decides what (if anything) to send from successive observations
 *  of the program. One instance per live stream. */
export class NowPlayingReporter {
  private sentKey: string | null = null;
  private lastSentAt = 0;
  private readonly now: () => number;
  private readonly heartbeatMs: number;

  constructor(private readonly senders: NowPlayingSenders) {
    this.now = senders.now ?? (() => Date.now());
    this.heartbeatMs = senders.heartbeatMs ?? NOW_PLAYING_HEARTBEAT_MS;
  }

  private static keyOf(track: NowPlayingTrackReport): string {
    return `${track.songId}::${track.title}::${track.artist}`;
  }

  async observe(track: NowPlayingTrackReport | null): Promise<void> {
    if (track) {
      const key = NowPlayingReporter.keyOf(track);
      const due =
        this.sentKey !== key || this.now() - this.lastSentAt >= this.heartbeatMs;
      if (!due) return;
      try {
        await this.senders.post(track);
        this.sentKey = key;
        this.lastSentAt = this.now();
      } catch {
        /* best-effort: nothing marked sent, the next observe retries */
      }
      return;
    }
    if (this.sentKey !== null) {
      try {
        await this.senders.clear();
        this.sentKey = null;
        this.lastSentAt = 0;
      } catch {
        /* the server's TTL is the backstop for a lost clear */
      }
    }
  }

  /** The studio is closing (or the stream ended here): say stop. */
  async dispose(): Promise<void> {
    await this.observe(null);
  }
}

/** The fetch-backed reporter for one live stream. The artist is the
 *  creator's own channel name — their library is their own catalog,
 *  so the name their profile shows IS the artist name. A studio
 *  that cannot resolve a truthful artist name never constructs
 *  this reporter and reports nothing. `getHeaders` supplies the
 *  studio's auth headers (the report endpoints are owner-only). */
export function createNowPlayingReporter(
  streamId: string,
  artist: string,
  getHeaders: () => Promise<Record<string, string>>,
): NowPlayingReporter {
  return new NowPlayingReporter({
    post: async (track) => {
      const res = await fetch(`/api/live/${streamId}/now-playing`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getHeaders()) },
        body: JSON.stringify({
          title: track.title,
          artist: track.artist,
          durationSec: track.durationSec,
        }),
      });
      if (!res.ok) throw new Error(`now-playing report ${res.status}`);
    },
    clear: async () => {
      const res = await fetch(`/api/live/${streamId}/now-playing`, {
        method: "DELETE",
        headers: { ...(await getHeaders()) },
      });
      if (!res.ok) throw new Error(`now-playing clear ${res.status}`);
    },
  });
}

/** The report for one resolved library track, under the creator's
 *  channel name. */
export function trackReport(
  track: LibraryTrackLite,
  artist: string,
): NowPlayingTrackReport {
  return {
    songId: track.id,
    title: track.title,
    artist,
    durationSec: track.durationSec,
  };
}
