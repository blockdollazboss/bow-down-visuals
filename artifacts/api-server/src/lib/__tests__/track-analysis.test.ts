/**
 * track-analysis.test.ts — the DJ analyzer against synthetic audio with
 * KNOWN ground truth: chord progressions synthesized note-by-note in a
 * named key, click trains at an exact BPM, noise, and silence. If the
 * analyzer can't read these, it can't read a real track — and the
 * honest-confidence contract is pinned too: noise and silence must come
 * back "no key", never a confident guess.
 */
import { describe, it, expect } from "vitest";
import {
  analyzePcm,
  computeChroma,
  detectKeyFromChroma,
  estimateTrackTempo,
  onsetEnvelope,
  camelotFor,
  tonalityFor,
} from "../track-analysis";

const SR = 22050;

function midiHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** A chord progression: each entry is the MIDI notes held for `sec`. */
function progressionPcm(chords: Array<{ notes: number[]; sec: number }>): Float32Array {
  const total = chords.reduce((s, c) => s + c.sec, 0);
  const out = new Float32Array(Math.floor(total * SR));
  let cursor = 0;
  for (const chord of chords) {
    const len = Math.floor(chord.sec * SR);
    const fade = Math.floor(0.03 * SR);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / fade, (len - i) / fade);
      let v = 0;
      for (const m of chord.notes) {
        const f = midiHz(m);
        v += Math.sin(2 * Math.PI * f * (i / SR)) * 0.22;
        v += Math.sin(2 * Math.PI * f * 2 * (i / SR)) * 0.1;
        v += Math.sin(2 * Math.PI * f * 3 * (i / SR)) * 0.05;
      }
      out[cursor + i] = v * Math.max(0, env);
    }
    cursor += len;
  }
  return out;
}

/** Deterministic white noise (seeded LCG — same fixture every run). */
function noisePcm(sec: number, seed = 42): Float32Array {
  const out = new Float32Array(Math.floor(sec * SR));
  let s = seed;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out[i] = (s / 2147483648) * 2 - 1;
  }
  return out;
}

/** A click train: short noise bursts every `periodSec`. */
function clickPcm(bpm: number, sec: number): Float32Array {
  const out = new Float32Array(Math.floor(sec * SR));
  const noise = noisePcm(1, 7);
  const period = Math.floor((60 / bpm) * SR);
  const burst = Math.floor(0.025 * SR);
  for (let t = 0; t + burst < out.length; t += period) {
    for (let i = 0; i < burst; i++) out[t + i] = noise[i]! * 0.9;
  }
  return out;
}

describe("camelot + tonality mapping", () => {
  it("maps the wheel correctly", () => {
    expect(camelotFor(9, "minor")).toBe("8A"); // A minor
    expect(camelotFor(0, "major")).toBe("8B"); // C major (its relative)
    expect(camelotFor(7, "major")).toBe("9B"); // G major
    expect(camelotFor(4, "minor")).toBe("9A"); // E minor
    expect(camelotFor(11, "major")).toBe("1B"); // B major
    expect(camelotFor(8, "minor")).toBe("1A"); // G# minor
    expect(tonalityFor(9, "minor")).toBe("Am");
    expect(tonalityFor(6, "major")).toBe("F#");
  });
});

describe("detectKeyFromChroma", () => {
  it("reads a hand-built C-major profile as C major / 8B", () => {
    // Pitch classes C D E F G A B strong, sharps/flats near zero, tonic-weighted.
    const chroma = [10, 1, 6, 1, 8, 6, 1, 9, 1, 6, 1, 5];
    const key = detectKeyFromChroma(chroma);
    expect(key?.label).toBe("C major");
    expect(key?.camelot).toBe("8B");
  });

  it("reads a hand-built A-minor profile as A minor / 8A", () => {
    const chroma = [6, 1, 5, 1, 7, 6, 1, 5, 1, 10, 1, 4];
    const key = detectKeyFromChroma(chroma);
    expect(key?.label).toBe("A minor");
    expect(key?.camelot).toBe("8A");
  });

  it("returns null for a flat chroma — no tonal signal, no guess", () => {
    expect(detectKeyFromChroma(new Array(12).fill(1))).toBeNull();
    expect(detectKeyFromChroma(new Array(12).fill(0))).toBeNull();
  });
});

describe("key detection on synthetic audio", () => {
  it("hears C major in a C–F–G–C progression", () => {
    const pcm = progressionPcm([
      { notes: [48, 60, 64, 67], sec: 2 },
      { notes: [53, 65, 69, 72], sec: 2 },
      { notes: [55, 67, 71, 74], sec: 2 },
      { notes: [48, 60, 64, 67], sec: 2 },
    ]);
    const key = analyzePcm(pcm, SR).key;
    expect(key?.label).toBe("C major");
    expect(key?.camelot).toBe("8B");
    expect(key?.score).toBeGreaterThan(0.5);
  });

  it("hears A minor in an Am–F–C–G progression weighted to the tonic", () => {
    const pcm = progressionPcm([
      { notes: [45, 57, 60, 64], sec: 3 },
      { notes: [53, 65, 69, 72], sec: 2 },
      { notes: [48, 60, 64, 67], sec: 2 },
      { notes: [55, 67, 71, 74], sec: 2 },
      { notes: [45, 57, 60, 64], sec: 3 },
    ]);
    const key = analyzePcm(pcm, SR).key;
    expect(key?.label).toBe("A minor");
    expect(key?.camelot).toBe("8A");
  });

  it("hears G major in a G–C–D–G progression", () => {
    const pcm = progressionPcm([
      { notes: [55, 59, 62], sec: 2 },
      { notes: [48, 60, 64], sec: 2 },
      { notes: [50, 62, 66], sec: 2 },
      { notes: [55, 59, 62], sec: 2 },
    ]);
    expect(analyzePcm(pcm, SR).key?.label).toBe("G major");
  });

  it("says 'no key' for white noise and for silence — never a guess", () => {
    expect(analyzePcm(noisePcm(8), SR).key).toBeNull();
    expect(analyzePcm(new Float32Array(SR * 8), SR).key).toBeNull();
    expect(detectKeyFromChroma(computeChroma(noisePcm(8), SR))).toBeNull();
  });
});

describe("tempo estimation", () => {
  it("reads a 120 BPM click train at 120 (±2), high confidence", () => {
    const tempo = estimateTrackTempo(onsetEnvelope(clickPcm(120, 24)), SR / 512);
    expect(tempo).not.toBeNull();
    expect(Math.abs(tempo!.bpm - 120)).toBeLessThanOrEqual(2);
    expect(tempo!.confidence).toBe("high");
  });

  it("reads a 100 BPM click train at 100 (±2)", () => {
    const tempo = estimateTrackTempo(onsetEnvelope(clickPcm(100, 24)), SR / 512);
    expect(tempo).not.toBeNull();
    expect(Math.abs(tempo!.bpm - 100)).toBeLessThanOrEqual(2);
  });

  it("finds no tempo in a sustained chord — a pad has no beat to invent", () => {
    const pcm = progressionPcm([{ notes: [57, 60, 64], sec: 10 }]);
    expect(analyzePcm(pcm, SR).bpm).toBeNull();
  });

  it("finds no tempo in a QUIET pad either — turning it down creates no beat", () => {
    // The pad's false tempo came from dense partial-wobble in the onset
    // envelope, which is level-independent; the density gate must hold
    // at any volume, not just the loud fixture above.
    const pcm = progressionPcm([{ notes: [57, 60, 64], sec: 10 }]);
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i]! * 0.05;
    expect(analyzePcm(pcm, SR).bpm).toBeNull();
  });

  it("full pipeline: clicks give tempo but no key; chords give key", () => {
    const clicks = analyzePcm(clickPcm(128, 16), SR);
    expect(clicks.bpm).not.toBeNull();
    expect(Math.abs(clicks.bpm! - 128)).toBeLessThanOrEqual(2);
    expect(clicks.key).toBeNull();
  });
});
