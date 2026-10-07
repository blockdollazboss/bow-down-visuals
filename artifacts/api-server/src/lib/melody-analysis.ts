/**
 * melody-analysis.ts — lightweight, dependency-free melody reference extraction
 * for the Hum-to-Song pipeline (POST /api/hum-to-song).
 *
 * Decodes any audio upload to mono 16 kHz PCM via ffmpeg, then:
 *  - estimates tempo via onset-envelope autocorrelation (60–200 BPM),
 *  - estimates key via a Krumhansl-Schmuckler pitch-class profile match,
 *  - measures pitch confidence + note count via normalized-autocorrelation
 *    pitch tracking (60–1000 Hz, voiced-frame gating).
 *
 * Everything is an *estimate* and is reported as such — a phone-mic hum in a
 * noisy room is not a studio MIDI file. Callers surface `confidence` so the
 * UI can say "estimated" instead of pretending certainty.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

export interface MelodyAnalysis {
  /** Trimmed audio length in seconds (cap: 60). */
  durationSec: number;
  /** Estimated tempo in BPM, or null when the onset signal is too weak. */
  tempoBpm: number | null;
  /** Estimated key, e.g. "A minor" / "C major", or null when unclear. */
  keyEstimate: string | null;
  /** Fraction of analyzed frames with a confident pitch (0–1). */
  pitchConfidence: number;
  /** Count of distinct voiced note segments. */
  noteCount: number;
  /** Overall trust level of the tempo/key estimates. */
  confidence: "high" | "medium" | "low";
}

const SAMPLE_RATE = 16000;
const MAX_SECONDS = 60;
const MIN_FREQ = 60;
const MAX_FREQ = 1000;

/** Decode to mono 16 kHz float32 PCM, trimmed to the first 60 s.
 *  NOTE: ffmpeg reads from a temp file, not stdin — the WAV/MP3 demuxers
 *  try to seek on pipe:0 and hang in this runtime. */
async function decodeToMono(audio: Buffer): Promise<Float32Array> {
  const id = randomUUID();
  const inPath = join(tmpdir(), `${id}-hum-in.bin`);
  const outPath = join(tmpdir(), `${id}-hum.raw`);
  try {
    await writeFile(inPath, audio);
    await execFileAsync(
      "ffmpeg",
      [
        "-v", "error",
        "-i", inPath,
        "-t", String(MAX_SECONDS),
        "-ac", "1",
        "-ar", String(SAMPLE_RATE),
        "-f", "f32le",
        "-acodec", "pcm_f32le",
        outPath,
      ],
      { timeout: 60_000 },
    );
    const bytes = await readFile(outPath);
    const out = new Float32Array(Math.floor(bytes.length / 4));
    for (let i = 0; i < out.length; i++) out[i] = bytes.readFloatLE(i * 4);
    return out;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

interface PitchFrame {
  freq: number; // Hz, 0 = unvoiced
  voiced: boolean;
}

/** Normalized-autocorrelation pitch tracking. Frame 2048, hop 1024. */
function trackPitch(samples: Float32Array): PitchFrame[] {
  const frame = 2048;
  const hop = 1024;
  const minLag = Math.floor(SAMPLE_RATE / MAX_FREQ);
  const maxLag = Math.ceil(SAMPLE_RATE / MIN_FREQ);
  const frames: PitchFrame[] = [];

  for (let start = 0; start + frame <= samples.length; start += hop) {
    let r0 = 0;
    for (let i = 0; i < frame; i++) {
      const s = samples[start + i]!;
      r0 += s * s;
    }
    const rms = Math.sqrt(r0 / frame);
    if (rms < 0.015) {
      frames.push({ freq: 0, voiced: false });
      continue;
    }
    let bestLag = -1;
    let bestVal = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let r = 0;
      for (let i = 0; i < frame - lag; i++) {
        r += samples[start + i]! * samples[start + i + lag]!;
      }
      const norm = r / r0;
      if (norm > bestVal) {
        bestVal = norm;
        bestLag = lag;
      }
    }
    // Octave guard: a true sub-harmonic sits at an integer divisor of the
    // best lag — only those lags may replace it, never a nearby lag that
    // merely correlates well (that skews the pitch sharp).
    if (bestLag > 0 && bestVal >= 0.45) {
      let lag = bestLag;
      for (const div of [2, 3, 4, 5]) {
        const l = Math.round(bestLag / div);
        if (l < minLag) continue;
        let r = 0;
        for (let i = 0; i < frame - l; i++) {
          r += samples[start + i]! * samples[start + i + l]!;
        }
        if (r / r0 >= bestVal * 0.9) {
          lag = l;
          break;
        }
      }
      frames.push({ freq: SAMPLE_RATE / lag, voiced: true });
    } else {
      frames.push({ freq: 0, voiced: false });
    }
  }
  return frames;
}

/** 3-frame median smoothing on the pitch track to kill single-frame jumps. */
function smoothPitch(frames: PitchFrame[]): PitchFrame[] {
  return frames.map((f, i) => {
    if (!f.voiced) return f;
    const neighbors = [frames[i - 1]?.freq ?? 0, f.freq, frames[i + 1]?.freq ?? 0].filter(
      (v) => v > 0,
    );
    if (neighbors.length === 0) return f;
    neighbors.sort((a, b) => a - b);
    return { freq: neighbors[Math.floor(neighbors.length / 2)]!, voiced: true };
  });
}

/** Onset envelope: positive spectral-flux proxy via frame-energy difference. */
function onsetEnvelope(samples: Float32Array): Float32Array {
  const frame = 1024;
  const hop = 512;
  const energies: number[] = [];
  for (let start = 0; start + frame <= samples.length; start += hop) {
    let e = 0;
    for (let i = 0; i < frame; i++) {
      const s = samples[start + i]!;
      e += s * s;
    }
    energies.push(Math.sqrt(e / frame));
  }
  const onset = new Float32Array(Math.max(energies.length - 1, 0));
  for (let i = 1; i < energies.length; i++) {
    onset[i - 1] = Math.max(0, energies[i]! - energies[i - 1]!);
  }
  return onset;
}

/** Tempo from the autocorrelation of the onset envelope (60–200 BPM). */
function estimateTempo(onset: Float32Array): number | null {
  if (onset.length < 64) return null;
  const fps = SAMPLE_RATE / 512; // onset frames per second
  const minLag = Math.floor((60 / 200) * fps);
  const maxLag = Math.ceil((60 / 60) * fps);
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= onset.length;
  let bestLag = -1;
  let bestVal = 0;
  for (let lag = minLag; lag <= Math.min(maxLag, onset.length - 1); lag++) {
    let r = 0;
    let n = 0;
    for (let i = 0; i + lag < onset.length; i++) {
      r += (onset[i]! - mean) * (onset[i + lag]! - mean);
      n++;
    }
    const val = n > 0 ? r / n : 0;
    if (val > bestVal) {
      bestVal = val;
      bestLag = lag;
    }
  }
  if (bestLag <= 0 || bestVal <= 1e-9) return null;
  const bpm = Math.round((60 * fps) / bestLag);
  // Fold into 60–200: prefer the musically plausible octave.
  let folded = bpm;
  while (folded < 60) folded *= 2;
  while (folded > 200) folded /= 2;
  return Math.round(folded);
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/* Krumhansl-Schmuckler key profiles. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pitchClass(freq: number): number {
  const midi = 69 + 12 * Math.log2(freq / 440);
  return ((Math.round(midi) % 12) + 12) % 12;
}

function estimateKey(frames: PitchFrame[]): string | null {
  const hist = new Array<number>(12).fill(0);
  let voiced = 0;
  for (const f of frames) {
    if (!f.voiced || f.freq <= 0) continue;
    hist[pitchClass(f.freq)]! += 1;
    voiced++;
  }
  if (voiced < 20) return null;
  const mean = voiced / 12;
  let sd = 0;
  for (const h of hist) sd += (h - mean) ** 2;
  sd = Math.sqrt(sd / 12);
  if (sd < 0.6) return null; // too flat — no tonal center

  let bestScore = -Infinity;
  let bestLabel: string | null = null;
  for (let root = 0; root < 12; root++) {
    for (const [profile, mode] of [
      [MAJOR_PROFILE, "major"],
      [MINOR_PROFILE, "minor"],
    ] as const) {
      let num = 0;
      let dh = 0;
      let dp = 0;
      for (let pc = 0; pc < 12; pc++) {
        const p = profile[(pc - root + 12) % 12]!;
        const h = hist[pc]!;
        num += h * p;
        dh += h * h;
        dp += p * p;
      }
      const score = dh > 0 && dp > 0 ? num / Math.sqrt(dh * dp) : 0;
      if (score > bestScore) {
        bestScore = score;
        bestLabel = `${NOTE_NAMES[root]} ${mode}`;
      }
    }
  }
  return bestScore > 0.45 ? bestLabel : null;
}

function countNotes(frames: PitchFrame[]): number {
  let notes = 0;
  let inNote = false;
  for (const f of frames) {
    if (f.voiced && !inNote) {
      notes++;
      inNote = true;
    } else if (!f.voiced) {
      inNote = false;
    }
  }
  return notes;
}

/**
 * Full melody analysis pipeline. Throws on undecodable audio — callers turn
 * that into a clear 400 ("we couldn't read that audio file").
 */
export async function analyzeMelody(audio: Buffer): Promise<MelodyAnalysis> {
  const samples = await decodeToMono(audio);
  const durationSec = samples.length / SAMPLE_RATE;
  if (durationSec < 1.5) {
    throw new Error("That recording is too short — hum at least a couple of seconds of melody.");
  }

  const pitchFrames = smoothPitch(trackPitch(samples));
  const voiced = pitchFrames.filter((f) => f.voiced).length;
  const pitchConfidence = pitchFrames.length > 0 ? voiced / pitchFrames.length : 0;
  const noteCount = countNotes(pitchFrames);

  const tempoBpm = pitchConfidence > 0.08 ? estimateTempo(onsetEnvelope(samples)) : null;
  const keyEstimate = estimateKey(pitchFrames);

  const confidence: MelodyAnalysis["confidence"] =
    pitchConfidence > 0.45 && noteCount >= 8
      ? "high"
      : pitchConfidence > 0.2 && noteCount >= 4
        ? "medium"
        : "low";

  return {
    durationSec: Math.round(durationSec * 10) / 10,
    tempoBpm,
    keyEstimate,
    pitchConfidence: Math.round(pitchConfidence * 100) / 100,
    noteCount,
    confidence,
  };
}
