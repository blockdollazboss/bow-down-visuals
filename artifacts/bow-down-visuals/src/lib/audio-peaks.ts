/**
 * Real audio peak data for the Studio timeline waveform.
 *
 * Client-side Web Audio analysis: fetches the song audio, decodes it, and
 * reduces it to per-bucket peak amplitudes. Cached per audio URL (module-level)
 * since decode is somewhat expensive and the same song is reused across the
 * whole editing session. Same fetch/decode pattern as lib/beat-grid.ts.
 */

/** Peak amplitudes in [0, 1], one per bucket, across the full audio duration. */
export type AudioPeaks = number[];

const cache = new Map<string, Promise<AudioPeaks | null>>();

/**
 * Compute peak amplitudes for a song's audio. Returns null if analysis fails
 * (e.g. CORS-blocked fetch, undecodable file) — callers should fall back to a
 * decorative placeholder in that case, never block the UI on it.
 */
export function getAudioPeaks(
  audioUrl: string | null | undefined,
  bucketCount = 240,
): Promise<AudioPeaks | null> {
  if (!audioUrl) return Promise.resolve(null);
  const key = `${audioUrl}::${bucketCount}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<AudioPeaks | null> => {
    try {
      const res = await fetch(audioUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextCtor();
      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const channel = audioBuffer.getChannelData(0);
        const bucketSize = Math.max(1, Math.floor(channel.length / bucketCount));
        const peaks: number[] = [];
        let globalMax = 0;
        for (let b = 0; b < bucketCount; b++) {
          const start = b * bucketSize;
          const end = Math.min(channel.length, start + bucketSize);
          let max = 0;
          // Sample every Nth frame inside the bucket to keep this cheap on long tracks.
          const step = Math.max(1, Math.floor((end - start) / 64));
          for (let i = start; i < end; i += step) {
            const v = Math.abs(channel[i] ?? 0);
            if (v > max) max = v;
          }
          peaks.push(max);
          if (max > globalMax) globalMax = max;
        }
        // Normalize so the loudest bucket hits 1 — the waveform always reads well.
        const norm = globalMax > 0 ? peaks.map((p) => Math.max(0.06, p / globalMax)) : null;
        return norm;
      } finally {
        void ctx.close();
      }
    } catch (e) {
      console.warn("[audio-peaks] analysis failed:", e);
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}
