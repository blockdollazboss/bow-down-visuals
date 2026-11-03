/* ── Beat Studio MP3 encoding ───────────────────────────────────────────
 * The offline beat render is an AudioBuffer; the page's WAV encoder
 * turns it into a WAV blob. This module is its MP3 sibling: the same
 * rendered buffer, encoded to MP3 for sharing (a fraction of the WAV's
 * size). Manual tool = FREE, like every other beat export.
 *
 * Encoder: LAME via @breezystack/lamejs (LGPL-3.0), pinned exact. It is
 * a SEPARATE, REPLACEABLE module by design:
 *   • loaded with a dynamic import() at encode time ONLY — the ~200 KB
 *     encoder ships as its own lazy chunk, fetched solely when a user
 *     actually exports an MP3; it never enters the main bundle;
 *   • its source is not modified in any way;
 *   • its license note ships at public/third-party-licenses/lamejs-LICENSE.txt
 *     and the beat export surface carries the "Uses the LAME MP3
 *     encoder" attribution line.
 *
 * The entry point takes a structural channel source (the shape of an
 * AudioBuffer) so the encode is unit-testable with plain Float32Arrays
 * — no WebAudio context needed. Stereo sources encode as stereo; a
 * one-channel source encodes as mono; anything wider is capped at the
 * first two channels, exactly like the WAV encoder.
 */

/** Default MP3 bit rate: 192 kbps CBR — beat-appropriate, ~1.4 MB/min
 *  versus WAV's ~10 MB/min. */
export const BEAT_MP3_KBPS = 192;

/** The slice of an AudioBuffer the encoder reads. A real AudioBuffer
 *  satisfies this shape; tests hand in plain channel data. */
export interface BeatMp3Source {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/* One MPEG audio frame carries 1152 samples per channel — the block
 * size the encoder consumes per encodeBuffer call. */
const MP3_BLOCK_SAMPLES = 1152;

/** Float PCM → 16-bit PCM with the same clamp and rounding the page's
 *  WAV encoder uses (positive peaks scale by 0x7fff, negative by
 *  0x8000), so WAV and MP3 bounces of one render start from identical
 *  samples. */
export function floatTo16BitPcm(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Encode a rendered buffer to an MP3 blob ("audio/mpeg"). Async
 *  because the encoder chunk loads on first use. */
export async function audioBufferToMp3(
  source: BeatMp3Source,
  kbps: number = BEAT_MP3_KBPS,
): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const channels = Math.min(2, Math.max(1, source.numberOfChannels));
  const encoder = new Mp3Encoder(channels, source.sampleRate, kbps);
  const leftAll = floatTo16BitPcm(source.getChannelData(0));
  const rightAll = channels > 1 ? floatTo16BitPcm(source.getChannelData(1)) : null;
  const length = leftAll.length;
  const parts: Uint8Array[] = [];
  for (let start = 0; start < length; start += MP3_BLOCK_SAMPLES) {
    const end = Math.min(start + MP3_BLOCK_SAMPLES, length);
    const left = leftAll.subarray(start, end);
    const part = rightAll
      ? encoder.encodeBuffer(left, rightAll.subarray(start, end))
      : encoder.encodeBuffer(left);
    if (part.length > 0) parts.push(part);
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    bytes.set(p, off);
    off += p.length;
  }
  return new Blob([bytes.buffer as ArrayBuffer], { type: "audio/mpeg" });
}
