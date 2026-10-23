/**
 * night-life.ts — the dark look's living air (overhaul stage B,
 * board item 27; audit lighting D1/D3).
 *
 * What the night plaza was missing after the stage-3 brazier
 * parity (coals + halo are banked): MOTION. Embers rise off the
 * brazier coals, spiral a little, thin out and die — and the
 * district thresholds carry lantern glow sprites after dark.
 * This module is the pure arithmetic: a deterministic ember field
 * per brazier and the closed-form offset of one ember at one
 * moment, so hall-scene.ts only has to pour the numbers into a
 * THREE.Points buffer each frame. Same field, same moment → the
 * same sky, on every client.
 *
 * The quality ladder is consumed, never edited (the table lives
 * in hall-scene.ts and another lane owns it): the ember count per
 * brazier follows the ladder's own spirit — full on high, fewer
 * on medium, NONE on low, the rung whose candle lights are
 * already emissive-only. Light-theme life (pollen, banners) is a
 * separate pick (board item 26) and is NOT built here.
 */

import { hashSeed, seededRandom } from "./prop-variation";

/** Embers per brazier, by quality tier. Low = 0: the low rung
 *  carries no candle point lights either (hall-scene's QUALITY),
 *  and unlit embers would read as dirt on the lens. */
export function emberCountForTier(tier: "high" | "medium" | "low"): number {
  return tier === "high" ? 16 : tier === "medium" ? 9 : 0;
}

/** How high an ember climbs off the coals before it dies (m). */
export const EMBER_RISE_HEIGHT = 1.7;

export interface EmberParticle {
  /** Starting angle around the bowl (radians). */
  angle: number;
  /** Starting radius inside the bowl (m, ≤ bowl radius 0.4). */
  radius: number;
  /** Rise speed (m/s) — coals throw slow and fast alike. */
  speed: number;
  /** Phase of the rise cycle, 0–1: where in its climb this ember
   *  starts, so the field never pulses in unison. */
  phase: number;
  /** Sway phase for the spiral drift. */
  sway: number;
}

/**
 * One brazier's ember field, deterministic in its seed key (the
 * brazier's plaza position, in practice) — the same brazier
 * throws the same embers on every visit.
 */
export function createEmberField(count: number, seedKey: string): EmberParticle[] {
  const rng = seededRandom(hashSeed(`embers:${seedKey}`));
  const out: EmberParticle[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      angle: rng() * Math.PI * 2,
      radius: 0.08 + rng() * 0.3,
      speed: 0.32 + rng() * 0.4,
      phase: rng(),
      sway: rng() * Math.PI * 2,
    });
  }
  return out;
}

export interface EmberOffset {
  x: number;
  y: number;
  z: number;
  /** 1 at the coals, →0 at the top of the climb: the scene fades
   *  by shrinking, and a dead ember parks below the bowl. */
  fade: number;
}

/** Where one ember stands `tSec` seconds after the field lit.
 *  The climb loops: cycle position = phase + t·speed/height. */
export function emberOffsetAt(p: EmberParticle, tSec: number): EmberOffset {
  const cycle = (p.phase + (tSec * p.speed) / EMBER_RISE_HEIGHT) % 1;
  const y = cycle * EMBER_RISE_HEIGHT;
  /* The spiral widens slightly as the ember climbs and cools. */
  const r = p.radius * (1 + cycle * 0.7);
  const a = p.angle + Math.sin(tSec * 0.9 + p.sway) * 0.35 + cycle * 0.6;
  return {
    x: Math.cos(a) * r,
    y,
    z: Math.sin(a) * r,
    fade: 1 - cycle,
  };
}

/** The lantern glow's breathing: a slow ±12% swell, phase-shifted
 *  per lantern so the plaza never throbs in unison. */
export function lanternGlowScale(base: number, tSec: number, phase: number): number {
  return base * (1 + 0.12 * Math.sin(tSec * 1.7 + phase));
}
