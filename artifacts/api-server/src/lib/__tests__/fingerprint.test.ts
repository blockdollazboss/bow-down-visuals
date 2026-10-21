/**
 * Stack 10 #1 — fingerprint proofs on synthetic audio.
 * True positive: a query containing the reference tone sequence (at a
 * known offset, under additive noise, and time-shifted) must match
 * with a measured offset near the truth. True negative: unrelated
 * tones must NOT match. Deterministic pseudo-noise (seeded LCG) so
 * the suite never flakes.
 */
import { describe, it, expect } from "vitest";
import { computeFingerprint, matchFingerprints } from "../fingerprint";

const SR = 8000;
function lcg(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* Distinct chord per segment (3 notes + a harmonic) — real music is
   spectrally varied; a single repeated pure tone is degenerate for
   landmark hashing (every frame looks like every other frame). */
const CHORDS: number[][] = [
  [220, 330, 440], [262, 392, 523], [294, 440, 587],
  [330, 494, 659], [349, 523, 698], [392, 587, 784],
];
function toneBurst(_freqs: number[], seconds: number, seed = 7, noiseAmp = 0, chords = CHORDS): Float32Array {
  const rand = lcg(seed);
  const out = new Float32Array(Math.floor(seconds * SR));
  const seg = Math.floor(out.length / chords.length);
  for (let i = 0; i < out.length; i++) {
    const chord = chords[Math.min(chords.length - 1, Math.floor(i / seg))]!;
    let v = 0;
    for (const f of chord) v += 0.3 * Math.sin((2 * Math.PI * f * i) / SR);
    v += 0.12 * Math.sin((2 * Math.PI * chord[0]! * 2 * i) / SR);
    out[i] = v + (rand() - 0.5) * 2 * noiseAmp;
  }
  return out;
}

function embed(ref: Float32Array, offsetSec: number, totalSec: number, seed = 99): Float32Array {
  const rand = lcg(seed);
  const out = new Float32Array(Math.floor(totalSec * SR));
  for (let i = 0; i < out.length; i++) out[i] = (rand() - 0.5) * 0.06; // quiet bed
  const off = Math.floor(offsetSec * SR);
  for (let i = 0; i < ref.length && off + i < out.length; i++) out[off + i] = out[off + i]! + ref[i]!;
  return out;
}

const REF_FREQS = [440, 660, 550, 880, 520, 740];

describe("audio fingerprinting (synthetic)", () => {
  it("identical audio matches itself with ~zero offset", () => {
    const ref = computeFingerprint(toneBurst(REF_FREQS, 6), SR);
    expect(ref.landmarks.length).toBeGreaterThan(20);
    const m = matchFingerprints(ref, ref);
    expect(m.matched).toBe(true);
    expect(Math.abs(m.offsetSeconds)).toBeLessThan(0.2);
    expect(m.confidence).toBeGreaterThan(0.5);
  });

  it("true positive: the reference embedded at 2s in a longer clip is found at that offset, under noise", () => {
    const refAudio = toneBurst(REF_FREQS, 6, 7, 0.05);
    const ref = computeFingerprint(refAudio, SR);
    const query = computeFingerprint(embed(refAudio, 2, 10), SR);
    const m = matchFingerprints(query, ref);
    expect(m.matched).toBe(true);
    expect(Math.abs(m.offsetSeconds - 2)).toBeLessThan(0.35);
    expect(m.matchedLandmarks).toBeGreaterThanOrEqual(8);
    expect(m.confidence).toBeLessThanOrEqual(1);
  });

  it("true negative: unrelated tones do not match", () => {
    const ref = computeFingerprint(toneBurst(REF_FREQS, 6), SR);
    const otherChords = [[110, 165, 220], [131, 196, 262], [147, 220, 294], [165, 247, 330], [175, 262, 349], [196, 294, 392]];
    const other = computeFingerprint(toneBurst(REF_FREQS, 6, 3, 0, otherChords), SR);
    const m = matchFingerprints(other, ref);
    expect(m.matched).toBe(false);
  });

  it("true negative: noise alone does not match", () => {
    const ref = computeFingerprint(toneBurst(REF_FREQS, 6), SR);
    const rand = lcg(1234);
    const noise = new Float32Array(6 * SR);
    for (let i = 0; i < noise.length; i++) noise[i] = (rand() - 0.5) * 1.4;
    const m = matchFingerprints(computeFingerprint(noise, SR), ref);
    expect(m.matched).toBe(false);
  });
});
