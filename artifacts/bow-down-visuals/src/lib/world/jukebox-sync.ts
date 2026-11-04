/**
 * jukebox-sync.ts — where the Music Hall jukebox is, right now.
 *
 * The room server stamps the current song's position at broadcast
 * time (an anchor, the watch-party math). Between broadcasts the
 * position is derived: the stamp plus the time since THIS client
 * received it, while playing; the stamp itself, while paused. The
 * page mirrors a plain <audio> element to the derived playback —
 * this module is the whole derivation, kept pure so the sync rule
 * is testable without a socket or an element.
 */
import type { WorldJukeboxState } from "./world-client";

interface JukeboxPlaybackNow {
  /** The track's playable URL (server-derived; never client-made). */
  url: string;
  playing: boolean;
  /** Seconds into the song, right now. */
  positionSec: number;
  entryId: string;
}

/**
 * The playback the room means to be hearing at `nowMs`, given the
 * state as received at `receivedAtMs`. Null = the jukebox is idle
 * (nothing to hear — the honest state of an untouched jukebox).
 */
export function jukeboxPlaybackNow(
  state: WorldJukeboxState | null,
  receivedAtMs: number,
  nowMs: number,
): JukeboxPlaybackNow | null {
  const cur = state?.current;
  if (!cur) return null;
  const driftSec = cur.playback.playing ? Math.max(0, (nowMs - receivedAtMs) / 1000) : 0;
  return {
    url: cur.entry.track.url,
    playing: cur.playback.playing,
    positionSec: Math.max(0, cur.playback.positionSec + driftSec),
    entryId: cur.entry.entryId,
  };
}

/** How far the local element may drift from the room's position
 *  before it is pulled back into step (seconds). Deliberately
 *  loose: a room of listeners within a breath of each other is the
 *  promise, frame-perfect sync is not. */
const JUKEBOX_DRIFT_TOLERANCE_SEC = 2.0;

/** Whether the local element needs a corrective seek. */
export function jukeboxNeedsSeek(
  desired: JukeboxPlaybackNow,
  elementPositionSec: number,
): boolean {
  return Math.abs(elementPositionSec - desired.positionSec) > JUKEBOX_DRIFT_TOLERANCE_SEC;
}

/** The denial lines, one per room reason. The panel passes its
 *  active language's bundle (worldAudioDesk keys); other callers
 *  get these English defaults, byte-identical to the pre-i18n
 *  copy. */
export interface JukeboxDeniedStrings {
  guests: string;
  unplayable: string;
  queueFull: string;
  listeningParty: string;
  notYours: string;
  fallback: string;
}

export const JUKEBOX_DENIED_STRINGS_EN: JukeboxDeniedStrings = {
  guests: "Guests listen in — sign in to put a song on.",
  unplayable: "That song can't play here — it isn't a published track the room can reach.",
  queueFull: "The queue is full — twenty songs deep is the room's whole evening.",
  listeningParty: "A listening party owns the queue right now — the host's program plays out first.",
  notYours: "That hand isn't yours — the song's adder (or the host) works this transport.",
  fallback: "The jukebox said no — nothing changed.",
};

/** The denial reasons the room sends, in the words the panel
 *  speaks them. Unknown reasons fall back to an honest shrug. */
export function jukeboxDeniedCopy(reason: string, strings: JukeboxDeniedStrings = JUKEBOX_DENIED_STRINGS_EN): string {
  switch (reason) {
    case "guests":
      return strings.guests;
    case "unplayable":
      return strings.unplayable;
    case "queue-full":
      return strings.queueFull;
    case "listening-party":
      return strings.listeningParty;
    case "not-yours":
      return strings.notYours;
    default:
      return strings.fallback;
  }
}
