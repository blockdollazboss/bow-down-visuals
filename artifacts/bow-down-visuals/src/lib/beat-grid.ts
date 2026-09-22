/**
 * Beat-grid detection for the Studio timeline dock.
 *
 * Runs client-side Web Audio analysis on the song audio to derive an
 * evenly-spaced grid of beat times. Trim handles, the split tool, and the
 * export-range handles all snap to this grid instead of only clip edges,
 * so edits land musically in time with the track.
 *
 * Detection is cached per audio URL (module-level) since it is somewhat
 * expensive and the same song audio is reused across the whole editing
 * session.
 */
import { guess } from "web-audio-beat-detector";

export interface BeatGrid {
  bpm: number;
  /** Seconds — time of the first beat in the grid. */
  offset: number;
  /** All beat times (seconds) across the full song duration. */
  beats: number[];
}

const cache = new Map<string, Promise<BeatGrid | null>>();

/**
 * Detect the beat grid for a song's audio. Returns null if detection fails
 * (e.g. CORS-blocked fetch, silent/ambient track with no clear tempo).
 */
export function detectBeatGrid(audioUrl: string | null | undefined, durationSec: number | null): Promise<BeatGrid | null> {
  if (!audioUrl) return Promise.resolve(null);
  const cached = cache.get(audioUrl);
  if (cached) return cached;

  const promise = (async (): Promise<BeatGrid | null> => {
    try {
      const res = await fetch(audioUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextCtor();
      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const { bpm, offset } = await guess(audioBuffer);
        const totalDur = durationSec && durationSec > 0 ? durationSec : audioBuffer.duration;
        const beatInterval = 60 / bpm;
        let start = offset % beatInterval;
        while (start < 0) start += beatInterval;
        const beats: number[] = [];
        for (let t = start; t <= totalDur; t += beatInterval) beats.push(t);
        return { bpm, offset, beats };
      } finally {
        void ctx.close();
      }
    } catch (e) {
      console.warn("[beat-grid] detection failed:", e);
      return null;
    }
  })();

  cache.set(audioUrl, promise);
  return promise;
}

/** Snap a time value (seconds) to the nearest beat, if one is within tolerance. */
export function snapToBeat(timeSec: number, beats: number[] | null | undefined, toleranceSec = 0.12): number {
  if (!beats || beats.length === 0) return timeSec;
  let closest = beats[0]!;
  let minDist = Math.abs(timeSec - closest);
  for (let i = 1; i < beats.length; i++) {
    const b = beats[i]!;
    const d = Math.abs(timeSec - b);
    if (d < minDist) { minDist = d; closest = b; }
    if (b > timeSec + toleranceSec) break; // beats are sorted ascending — no closer match ahead
  }
  return minDist <= toleranceSec ? closest : timeSec;
}
