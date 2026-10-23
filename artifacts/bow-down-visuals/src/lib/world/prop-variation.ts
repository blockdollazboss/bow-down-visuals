/**
 * prop-variation.ts — deterministic variation for the plaza's
 * repeated props (overhaul stage B, board item 18).
 *
 * The audit's geometry #18: the courtyard repeats its props as
 * perfect clones — nine identical planters, six identical columns,
 * one gate kit stamped six times — and perfect clones are the
 * strongest "prototype" cue after the void itself. This module is
 * the cure's arithmetic: a seeded hash + a small PRNG, so every
 * prop instance gets a stable rotation / scale / colour jitter and
 * a variant index (0–2) — THE SAME on every visit, for every
 * walker. No per-load randomness: the world does not reshuffle
 * between visits, and two clients standing in the same plaza see
 * the same slightly-imperfect planter.
 *
 * Pure data (no three.js, no DOM): hall-scene.ts turns a
 * PropVariation into mesh transforms and cloned-material tints.
 * Collision and layout rects are NOT varied — variation is skin,
 * never floor plan (palace-layout.ts is untouched by this).
 */

/** FNV-1a over the seed text — small, stable, dependency-free. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny deterministic PRNG stream from one seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PropKind = "crown" | "trough" | "column" | "gate" | "finial";

export interface PropVariation {
  /** Yaw jitter in radians (0 for structural props whose faces
   *  must stay square to the walls they stand against). */
  rotY: number;
  /** Uniform footprint scale (0.94–1.06 class). */
  scale: number;
  /** Vertical scale — crowns read tall / round / squat by it. */
  scaleY: number;
  /** Hue shift for a cloned material, in HSL turns (±0.03). */
  hueShift: number;
  /** Lightness shift for a cloned material (±0.05). */
  lightnessShift: number;
  /** Which of the 2–3 build variants this instance takes. */
  variant: 0 | 1 | 2;
}

/* Per-kind jitter envelopes. Crowns (foliage blobs) may turn
 * freely — an icosahedron has no "front" — and stretch vertically;
 * troughs and columns stay near-square to their walls (a rotated
 * trough would poke off its line), gates barely breathe (they are
 * architecture, and two posts of one gate must stay a pair — the
 * scene asks for the GATE's variation once, not per post). */
const ENVELOPES: Record<PropKind, { rot: number; scale: number; scaleY: number }> = {
  crown: { rot: Math.PI, scale: 0.16, scaleY: 0.45 },
  trough: { rot: 0.012, scale: 0.05, scaleY: 0.06 },
  column: { rot: 0, scale: 0.05, scaleY: 0.03 },
  gate: { rot: 0, scale: 0.03, scaleY: 0.04 },
  finial: { rot: Math.PI, scale: 0.2, scaleY: 0.1 },
};

/**
 * The variation for the `index`-th instance of a prop kind.
 * Deterministic in (kind, index) alone — the same call always
 * returns the same variation, on every client, on every load.
 */
export function propVariation(kind: PropKind, index: number): PropVariation {
  const rng = seededRandom(hashSeed(`prop:${kind}:${index}`));
  const env = ENVELOPES[kind];
  const spread = (range: number) => (rng() * 2 - 1) * range;
  return {
    rotY: spread(env.rot) + 0, // +0 folds a zero-range -0 into 0
    scale: 1 + spread(env.scale),
    scaleY: 1 + spread(env.scaleY),
    hueShift: spread(0.03),
    lightnessShift: spread(0.05),
    variant: Math.min(2, Math.floor(rng() * 3)) as 0 | 1 | 2,
  };
}
