/**
 * fingerprint.ts — in-house audio fingerprinting (Stack 10 #1).
 *
 * Spectral-peak landmark hashing, computed by the house itself: no
 * external provider, no spend, no new dependency. The pipeline is the
 * classic landmark approach:
 *   PCM → Hann-windowed STFT (radix-2 FFT) → per-frame spectral peaks
 *   → landmark = hash(peakFreqA, peakFreqB, framesBetween) anchored at
 *   the first peak's frame → matching counts hash collisions whose
 *   time-offset agrees, so confidence and offset are MEASURED, never
 *   invented. Confidence is reported rounded to 3 decimals with the raw
 *   matched/total landmark counts alongside it — no fake precision.
 *
 * What this scans: audio handed to POST /content-id/fingerprints
 * (reference, at opt-in) and POST /content-id/scan (a query clip),
 * both as base64 16-bit PCM in the request body. What it does NOT do:
 * continuous background scanning of the whole catalog (no worker walks
 * stored media) — that remainder is named in the route header.
 */

export interface Landmark { h: number; t: number }
export interface Fingerprint { landmarks: Landmark[]; durationSeconds: number; sampleRate: number }
export interface MatchResult {
  matched: boolean;
  offsetSeconds: number;
  confidence: number;
  matchedLandmarks: number;
  totalLandmarks: number;
}

const FRAME = 2048;
const HOP = 512;
const PEAKS_PER_FRAME = 4;
const FANOUT = 3; // peaks ahead paired with each anchor peak
const MAX_DT = 24; // frames

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j]!, ui = im[i + j]!;
        const vr = re[i + j + len / 2]! * cwr - im[i + j + len / 2]! * cwi;
        const vi = re[i + j + len / 2]! * cwi + im[i + j + len / 2]! * cwr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
}

function hashPair(f1: number, f2: number, dt: number): number {
  // Frequencies quantized to bins (0..1023); pack into one 32-bit int.
  return ((f1 & 1023) * 1048576 + (f2 & 1023) * 1024 + (dt & 1023)) >>> 0;
}

export function computeFingerprint(samples: Float32Array, sampleRate = 8000): Fingerprint {
  const frames: Array<Array<{ bin: number; mag: number }>> = [];
  const window = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
    for (let i = 0; i < FRAME; i++) re[i] = (samples[start + i] ?? 0) * window[i]!;
    fft(re, im);
    const mags: Array<{ bin: number; mag: number }> = [];
    for (let b = 2; b < FRAME / 2; b++) {
      const mag = Math.hypot(re[b]!, im[b]!);
      const prev = Math.hypot(re[b - 1]!, im[b - 1]!), next = Math.hypot(re[b + 1]!, im[b + 1]!);
      if (mag > prev && mag >= next && mag > 0.5) mags.push({ bin: b, mag });
    }
    mags.sort((a, b2) => b2.mag - a.mag);
    frames.push(mags.slice(0, PEAKS_PER_FRAME).sort((a, b2) => a.bin - b2.bin));
  }
  const landmarks: Landmark[] = [];
  for (let t = 0; t < frames.length; t++) {
    for (const anchor of frames[t]!) {
      let paired = 0;
      for (let t2 = t + 1; t2 < Math.min(frames.length, t + 1 + MAX_DT) && paired < FANOUT; t2++) {
        for (const target of frames[t2]!) {
          landmarks.push({ h: hashPair(anchor.bin, target.bin, t2 - t), t });
          paired++;
          if (paired >= FANOUT) break;
        }
      }
    }
  }
  return { landmarks, durationSeconds: samples.length / sampleRate, sampleRate };
}

/** Decode base64 signed-16-bit little-endian PCM → normalized floats. */
export function decodePcm16Base64(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  const n = Math.floor(buf.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}
export function encodePcm16Base64(samples: Float32Array): string {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), i * 2);
  return buf.toString("base64");
}

export const MATCH_MIN_LANDMARKS = 8;
export const MATCH_MIN_CONFIDENCE = 0.12;

/**
 * Match a query fingerprint against one reference. A landmark counts
 * only when its hash collides AND its time delta agrees with the
 * consensus offset; the offset is that consensus, converted to seconds.
 */
export function matchFingerprints(query: Fingerprint, reference: Fingerprint): MatchResult {
  const refByHash = new Map<number, number[]>();
  for (const lm of reference.landmarks) {
    const arr = refByHash.get(lm.h) ?? [];
    arr.push(lm.t); refByHash.set(lm.h, arr);
  }
  const deltaVotes = new Map<number, number>();
  for (const lm of query.landmarks) {
    const times = refByHash.get(lm.h);
    if (!times) continue;
    // One vote per (landmark, delta): a hash that recurs in the
    // reference must not let a single query landmark stuff the ballot.
    const seen = new Set<number>();
    for (const rt of times) {
      const d = rt - lm.t;
      if (seen.has(d)) continue;
      seen.add(d);
      deltaVotes.set(d, (deltaVotes.get(d) ?? 0) + 1);
    }
  }
  let bestDelta = 0, bestVotes = 0;
  for (const [d, v] of deltaVotes) if (v > bestVotes) { bestVotes = v; bestDelta = d; }
  const total = query.landmarks.length;
  const confidence = total > 0 ? Math.round((bestVotes / total) * 1000) / 1000 : 0;
  const matched = bestVotes >= MATCH_MIN_LANDMARKS && confidence >= MATCH_MIN_CONFIDENCE;
  return {
    matched,
    // bestDelta is referenceTime − queryTime; the reported offset is
    // where the reference starts inside the query (its negation).
    offsetSeconds: Math.round((-bestDelta * HOP / query.sampleRate) * 1000) / 1000,
    confidence,
    matchedLandmarks: bestVotes,
    totalLandmarks: total,
  };
}
