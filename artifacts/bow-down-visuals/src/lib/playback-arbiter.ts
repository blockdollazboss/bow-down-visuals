import { createContext, useContext } from "react";

/**
 * Editor playback arbiter — the editor's single transport truth.
 *
 * The video editor mounts two independent playback engines for the same
 * song: the timeline (master) player (an HTML <audio> element driven by
 * TimelinePreviewPlayer) and the Music Studio mix preview (a Web Audio
 * AudioMixEngine auditioning the stems). They used to share nothing, so
 * both could sound at once — the same song twice, slightly apart (an
 * echo) — and their buttons/clocks disagreed.
 *
 * Both engines register with the one arbiter instance owned by the editor
 * page. When a participant reports that it started playing, the arbiter
 * pauses every other participant. Registration is deliberately dumb:
 * participants own their real play state (the arbiter only reads it via
 * `isPlaying()` when a peer starts), so the arbiter can never drift from
 * the engines it coordinates.
 */

export const MASTER_PLAYBACK_ID = "master";
export const MIX_PLAYBACK_ID = "mix";

export interface PlaybackParticipant {
  /** Stable id — "master" (timeline player) or "mix" (stem-mix preview). */
  id: string;
  /** Live read of the engine's real play state. */
  isPlaying: () => boolean;
  /** Pause the engine. Must be safe to call when already paused. */
  pause: () => void;
}

export class PlaybackArbiter {
  private participants = new Map<string, PlaybackParticipant>();
  private activeId: string | null = null;

  /**
   * Register a participant. Returns an unregister function; unregistering
   * only removes the entry if it is still THIS participant object, so a
   * stale cleanup can never evict a newer registration under the same id
   * (e.g. a panel mounted twice — desktop + mobile sheet).
   */
  register(participant: PlaybackParticipant): () => void {
    this.participants.set(participant.id, participant);
    return () => {
      if (this.participants.get(participant.id) === participant) {
        this.participants.delete(participant.id);
        if (this.activeId === participant.id) this.activeId = null;
      }
    };
  }

  /**
   * A participant started playing: it becomes the active source and every
   * OTHER participant that is currently playing is paused. Pausing a peer
   * may synchronously notify back (notifyStopped) — that only updates
   * bookkeeping, so iterate over a snapshot.
   */
  notifyPlaying(id: string): void {
    this.activeId = id;
    for (const participant of [...this.participants.values()]) {
      if (participant.id === id) continue;
      if (participant.isPlaying()) participant.pause();
    }
  }

  /** A participant paused/stopped: clear it as the active source. */
  notifyStopped(id: string): void {
    if (this.activeId === id) this.activeId = null;
  }

  /** The participant most recently reported playing, if any. */
  getActiveId(): string | null {
    return this.activeId;
  }
}

/**
 * The editor page provides its single arbiter instance; participants
 * (useMixPreview) consume it. Outside the editor the context is null and
 * registration is a no-op — the mix preview keeps working standalone.
 */
export const PlaybackArbiterContext = createContext<PlaybackArbiter | null>(null);

export function usePlaybackArbiter(): PlaybackArbiter | null {
  return useContext(PlaybackArbiterContext);
}

/* ─── Music Studio header transport selection ────────────────────────────
 * The Music Studio "Now Playing" header shows the project song. When the
 * master (timeline) player exists and no stem is solo'd, the header IS
 * the master's transport: its button toggles the master and its clock is
 * the shared master clock — one clock for the song. A solo'd stem turns
 * the header back into a stem audition driven by the mix engine (whose
 * own transport also lives in the Manual DAW's PreviewTransport). */

export interface HeaderTransportState {
  source: "master" | "mix";
  isPlaying: boolean;
  /** Seconds — from the selected engine's clock, never a blend. */
  position: number;
  /** Seconds — the selected engine's duration (master falls back to the
   *  mix engine's probed duration until its own metadata lands). */
  duration: number;
}

export function selectHeaderTransport(args: {
  /** Master clock snapshot, or null when the timeline has no audio. */
  master: {
    isPlaying: boolean;
    currentTime: number;
    audioDuration: number | null;
  } | null;
  /** Any stem solo'd → the header is auditioning stems, not the song. */
  anySolo: boolean;
  mixPlaying: boolean;
  mixPosition: number;
  mixDuration: number;
}): HeaderTransportState {
  const { master, anySolo, mixPlaying, mixPosition, mixDuration } = args;
  if (master && !anySolo) {
    return {
      source: "master",
      isPlaying: master.isPlaying,
      position: master.currentTime,
      duration: master.audioDuration ?? mixDuration,
    };
  }
  return {
    source: "mix",
    isPlaying: mixPlaying,
    position: mixPosition,
    duration: mixDuration,
  };
}
