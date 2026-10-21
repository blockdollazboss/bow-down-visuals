/**
 * track-analysis.ts — full-track DJ analysis for the Set-Prep Pack:
 * tempo (BPM) + musical key + Camelot code for a creator's own songs.
 *
 * Why this exists alongside lib/melody-analysis.ts: that module reads a
 * MONOPHONIC hum (pitch-track histogram, 60 s cap) — useless on a finished
 * polyphonic track. This module works the way DJ software does:
 *
 *  - Key: a chromagram (STFT → pitch-class energy) matched against
 *    Krumhansl-Schmuckler key profiles with Pearson correlation. Pearson
 *    (mean-centered) matters: a flat chroma (drums, noise, speech) scores
 *    ~0 against every key, so "no clear key" is an honest answer instead
 *    of a confident wrong one.
 *  - Tempo: the onset envelope is lib/melody-analysis.ts's own
 *    `onsetEnvelope` (imported, not re-implemented — one envelope
 *    engine site-wide), autocorrelated with two DJ-grade additions the
 *    hum pipeline doesn't need: a peak-prominence gate (a beatless pad
 *    gets "no tempo", not a confident invention) and a confidence
 *    label. melody-analysis's own estimator crowns the argmax lag and
 *    reports no confidence, so it can't be reused for this contract.
 *
 * Everything returned is an ESTIMATE and carries a confidence label —
 * callers must surface it. A low-confidence key is a rough guess, never
 * a fact; a null key means the audio gave us nothing to stand on.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { onsetEnvelope } from "./melody-analysis";

export { onsetEnvelope };
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

export const ANALYZER_VERSION = 1;

export type Confidence = "high" | "medium" | "low";

export interface KeyEstimate {
  /** Pitch class 0–11 (0 = C, 9 = A). */
  root: number;
  mode: "major" | "minor";
  /** Display label, e.g. "A minor". */
  label: string;
  /** Camelot wheel code, e.g. "8A". */
  camelot: string;
  /** Winning K-S Pearson correlation (0–1). */
  score: number;
  confidence: Confidence;
}

export interface TrackAnalysis {
  durationSec: number;
  bpm: number | null;
  bpmConfidence: Confidence | null;
  key: KeyEstimate | null;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/* Camelot wheel, indexed by pitch class. Major = "B" side, minor = "A". */
const MAJOR_CAMELOT: Record<number, number> = {
  0: 8, 1: 3, 2: 10, 3: 5, 4: 12, 5: 7, 6: 2, 7: 9, 8: 4, 9: 11, 10: 6, 11: 1,
};
const MINOR_CAMELOT: Record<number, number> = {
  0: 5, 1: 12, 2: 7, 3: 2, 4: 9, 5: 4, 6: 11, 7: 6, 8: 1, 9: 8, 10: 3, 11: 10,
};

export function camelotFor(root: number, mode: "major" | "minor"): string {
  const n = mode === "major" ? MAJOR_CAMELOT[root]! : MINOR_CAMELOT[root]!;
  return `${n}${mode === "major" ? "B" : "A"}`;
}

/** Rekordbox-style tonality string: "C", "F#", "Am", "G#m". */
export function tonalityFor(root: number, mode: "major" | "minor"): string {
  return mode === "minor" ? `${NOTE_NAMES[root]}m` : NOTE_NAMES[root]!;
}

/* ── FFT (iterative radix-2, dependency-free) ─────────────────────────── */

function fftMagnitudes(frame: Float32Array): Float32Array {
  const n = frame.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // Bit-reversal permutation.
  for (let i = 0, j = 0; i < n; i++) {
    re[j] = frame[i]!;
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const vRe = re[b]! * curRe - im[b]! * curIm;
        const vIm = re[b]! * curIm + im[b]! * curRe;
        re[b] = re[a]! - vRe;
        im[b] = im[a]! - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  const mags = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mags[i] = Math.hypot(re[i]!, im[i]!);
  return mags;
}

/* ── Chroma ───────────────────────────────────────────────────────────── */

const CHROMA_FFT = 8192;
const CHROMA_HOP = 8192;
const CHROMA_MIN_HZ = 50;
const CHROMA_MAX_HZ = 5000;

/**
 * Mean pitch-class energy profile over the audio. Frames that are
 * effectively silent are skipped so intros/pauses don't dilute the key.
 * Exported for tests (pure — no ffmpeg).
 */
export function computeChroma(samples: Float32Array, sampleRate: number): Float64Array {
  const chroma = new Float64Array(12);
  // Precompute each FFT bin's pitch class (-1 = out of range).
  const binPc = new Int16Array(CHROMA_FFT / 2).fill(-1);
  for (let k = 1; k < CHROMA_FFT / 2; k++) {
    const freq = (k * sampleRate) / CHROMA_FFT;
    if (freq < CHROMA_MIN_HZ || freq > CHROMA_MAX_HZ) continue;
    const midi = 69 + 12 * Math.log2(freq / 440);
    binPc[k] = ((Math.round(midi) % 12) + 12) % 12;
  }
  const window = new Float32Array(CHROMA_FFT);
  for (let i = 0; i < CHROMA_FFT; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (CHROMA_FFT - 1)); // Hann
  }
  const frame = new Float32Array(CHROMA_FFT);
  let usedFrames = 0;
  for (let start = 0; start + CHROMA_FFT <= samples.length; start += CHROMA_HOP) {
    let energy = 0;
    for (let i = 0; i < CHROMA_FFT; i++) {
      const s = samples[start + i]!;
      energy += s * s;
      frame[i] = s * window[i]!;
    }
    if (Math.sqrt(energy / CHROMA_FFT) < 0.01) continue; // silence gate
    const mags = fftMagnitudes(frame);
    for (let k = 1; k < CHROMA_FFT / 2; k++) {
      const pc = binPc[k]!;
      if (pc < 0) continue;
      // Power, mildly compressed so one loud partial can't own the profile.
      chroma[pc]! += Math.pow(mags[k]!, 1.5);
    }
    usedFrames++;
  }
  if (usedFrames > 0) {
    for (let pc = 0; pc < 12; pc++) chroma[pc]! /= usedFrames;
  }
  return chroma;
}

/* ── Key detection (Krumhansl-Schmuckler over chroma) ─────────────────── */

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/**
 * Best-matching key for a chroma profile, or null when the profile
 * carries no tonal signal worth naming (flat chroma: noise, drums-only,
 * speech). Pure — exported for tests.
 */
export function detectKeyFromChroma(chroma: ArrayLike<number>): KeyEstimate | null {
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i]!;
  if (total <= 0) return null;

  const scored: Array<{ root: number; mode: "major" | "minor"; score: number }> = [];
  for (let root = 0; root < 12; root++) {
    for (const [profile, mode] of [
      [MAJOR_PROFILE, "major"],
      [MINOR_PROFILE, "minor"],
    ] as const) {
      const rotated = new Array<number>(12);
      for (let pc = 0; pc < 12; pc++) rotated[pc] = profile[(pc - root + 12) % 12]!;
      scored.push({ root, mode, score: pearson(chroma, rotated) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const second = scored[1]!;
  // Peakedness gate: tonal audio concentrates energy on a few pitch
  // classes. Broadband content (drum loops, noise bursts, speech) keeps
  // the chroma nearly flat — its best Pearson match is a mirage, so the
  // honest answer is "no key", however well a profile happens to fit.
  let chromaMean = 0;
  let chromaMax = 0;
  for (let i = 0; i < 12; i++) {
    chromaMean += chroma[i]!;
    if (chroma[i]! > chromaMax) chromaMax = chroma[i]!;
  }
  chromaMean /= 12;
  if (chromaMax / chromaMean < 1.45) return null;
  // Below this correlation floor there is no key to report either.
  if (best.score < 0.35) return null;
  const margin = best.score - second.score;
  const confidence: Confidence =
    best.score >= 0.75 && margin >= 0.04
      ? "high"
      : best.score >= 0.55 && margin >= 0.02
        ? "medium"
        : "low";
  return {
    root: best.root,
    mode: best.mode,
    label: `${NOTE_NAMES[best.root]} ${best.mode}`,
    camelot: camelotFor(best.root, best.mode),
    score: Math.round(best.score * 1000) / 1000,
    confidence,
  };
}

/* ── Tempo (onset-envelope autocorrelation) ───────────────────────────── */

/** Hop of melody-analysis's onsetEnvelope (frame 1024 / hop 512) — the
 *  frames-per-second divisor for the shared envelope. */
const ONSET_HOP = 512;

/**
 * Tempo from the onset envelope's autocorrelation (55–210 BPM search,
 * folded into 60–200). Confidence comes from the winning peak's
 * prominence over the rest of the autocorrelation — a sharp metronome
 * peak is high; a smeared peak is low/absent.
 *
 * Density gate first: a beat is SPARSE transients (a click train's
 * onset envelope is ~90% zeros), while a beatless pad's envelope is
 * DENSE — tiny energy wobble in half its frames, from partials beating
 * against each other. That wobble is quasi-periodic, so autocorrelation
 * alone crowns it (~99 BPM, "high confidence") — a confident invention.
 * When more than a third of frames carry onset energy there is no
 * transient train to read, and the honest answer is no tempo.
 * Exported for tests.
 */
export function estimateTrackTempo(
  onset: Float32Array,
  framesPerSecond: number,
): { bpm: number; confidence: Confidence } | null {
  if (onset.length < 64) return null;
  let active = 0;
  for (const v of onset) if (v > 0) active++;
  if (active / onset.length > 1 / 3) return null;
  const minLag = Math.floor((60 / 210) * framesPerSecond);
  const maxLag = Math.ceil((60 / 55) * framesPerSecond);
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= onset.length;

  const upper = Math.min(maxLag, onset.length - 1);
  const vals: Array<{ lag: number; val: number }> = [];
  let bestVal = 0;
  for (let lag = minLag; lag <= upper; lag++) {
    let r = 0;
    let n = 0;
    for (let i = 0; i + lag < onset.length; i++) {
      r += (onset[i]! - mean) * (onset[i + lag]! - mean);
      n++;
    }
    const val = n > 0 ? r / n : 0;
    vals.push({ lag, val });
    if (val > bestVal) bestVal = val;
  }
  if (bestVal <= 1e-9) return null;
  // Prominence vs the MEDIAN autocorrelation: a real beat's peak towers
  // over the typical lag, while a flat envelope (a sustained pad, whose
  // autocorrelation is one low plateau) sits at ~1× and is rejected.
  const sorted = [...vals].sort((a, b) => a.val - b.val);
  const median = sorted[Math.floor(sorted.length / 2)]!.val;
  const prominence = median > 0 ? bestVal / median : 10;
  if (prominence < 1.6) return null;
  // Octave discipline: the double-period lag often edges out the true
  // period (every other beat aligns too). Take the SMALLEST lag that
  // reaches 72% of the best — the fastest consistent pulse in range —
  // rather than crowning the double.
  const chosenIdx = vals.findIndex((v) => v.val >= 0.72 * bestVal);
  const chosen = vals[chosenIdx >= 0 ? chosenIdx : vals.length - 1]!;
  // The true period usually falls BETWEEN two lags; refine with a
  // parabolic fit over the winner's neighbors (117.5 → 119.4, not 117).
  let refinedLag = chosen.lag;
  const prev = vals[chosenIdx - 1];
  const next = vals[chosenIdx + 1];
  if (chosenIdx > 0 && prev && next) {
    const denom = prev.val - 2 * chosen.val + next.val;
    if (denom !== 0) {
      const delta = 0.5 * (prev.val - next.val) / denom;
      if (Math.abs(delta) <= 1) refinedLag = chosen.lag + delta;
    }
  }
  let bpm = (60 * framesPerSecond) / refinedLag;
  while (bpm < 60) bpm *= 2;
  while (bpm > 200) bpm /= 2;
  const confidence: Confidence = prominence >= 3 ? "high" : prominence >= 2 ? "medium" : "low";
  return { bpm: Math.round(bpm), confidence };
}

/* ── Full pipeline ────────────────────────────────────────────────────── */

export const TRACK_SAMPLE_RATE = 22050;
const MAX_ANALYZE_SECONDS = 150;
const MAX_INPUT_BYTES = 80 * 1024 * 1024;

/** Pure PCM core — exported so tests can drive it with synthetic audio. */
export function analyzePcm(samples: Float32Array, sampleRate: number): TrackAnalysis {
  const durationSec = Math.round((samples.length / sampleRate) * 10) / 10;
  const chroma = computeChroma(samples, sampleRate);
  const key = detectKeyFromChroma(chroma);
  const tempo = estimateTrackTempo(onsetEnvelope(samples), sampleRate / ONSET_HOP);
  return {
    durationSec,
    bpm: tempo?.bpm ?? null,
    bpmConfidence: tempo?.confidence ?? null,
    key,
  };
}

/**
 * Analyze an audio file buffer (any format ffmpeg reads). Throws with a
 * plain-language message on undecodable/too-short audio — callers turn
 * that into an honest per-song failure, never a fake result.
 */
export async function analyzeTrackAudio(audio: Buffer): Promise<TrackAnalysis> {
  if (audio.length > MAX_INPUT_BYTES) {
    throw new Error("That file is too large to analyze.");
  }
  const id = randomUUID();
  const inPath = join(tmpdir(), `${id}-dj-in.bin`);
  const outPath = join(tmpdir(), `${id}-dj.raw`);
  try {
    await writeFile(inPath, audio);
    await execFileAsync(
      "ffmpeg",
      [
        "-v", "error",
        "-i", inPath,
        "-t", String(MAX_ANALYZE_SECONDS),
        "-ac", "1",
        "-ar", String(TRACK_SAMPLE_RATE),
        "-f", "f32le",
        "-acodec", "pcm_f32le",
        outPath,
      ],
      { timeout: 120_000 },
    );
    const bytes = await readFile(outPath);
    const samples = new Float32Array(Math.floor(bytes.length / 4));
    for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
    if (samples.length / TRACK_SAMPLE_RATE < 4) {
      throw new Error("That track is too short to analyze — under four seconds gave us nothing to read.");
    }
    return analyzePcm(samples, TRACK_SAMPLE_RATE);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}
