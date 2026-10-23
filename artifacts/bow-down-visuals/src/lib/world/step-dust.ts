/**
 * step-dust.ts — the footstep hook's reader (Stack-100 #2 item 57).
 *
 * movement.ts has always counted completed steps on every mover
 * (`stepCount`, "the footstep hook (dust, sound) reads increments
 * of this counter") — but until this item nothing read it: the
 * stride/bob half of the gait was wired into the render loop
 * (applyActionPose composes bobY, the first-person camera rides a
 * gentled share), while the step counter itself was dead.
 *
 * This module is the dust half of that hook, as pure math (no
 * three.js, no DOM): a small fixed pool of footstep puffs. The
 * scene feeds it each figure's step-count increments and feet
 * positions; each puff lives half a second — a faint warm breath
 * of dust at the heel that drifts a touch, rises a touch, and
 * fades. The scene renders the pool as ONE Points cloud with
 * per-point colours under additive blending, so a puff's fade is
 * its colour walking to black.
 *
 * Deterministic: puff drift comes from a golden-angle spread over
 * the pool's own spawn counter, never Math.random — the same
 * steps always raise the same dust, in tests and in the hall.
 */

/** Pool capacity — one puff per step, ~30 figures walking hard
 *  raise at most a few dozen live puffs; 240 is generous headroom
 *  and still a single tiny draw. */
export const STEP_DUST_CAPACITY = 240;
/** A puff's whole life (s): a breath, not a weather system. */
export const STEP_DUST_LIFE_S = 0.55;
/** How fast a puff rises (m/s) — it lifts off the heel, barely. */
export const STEP_DUST_RISE = 0.1;
/** The puff's warm dust tint at birth (additive — black = gone). */
export const STEP_DUST_TINT = { r: 1.0, g: 0.93, b: 0.78 };
/** Birth brightness: a footstep should whisper, never flash. */
export const STEP_DUST_BRIGHTNESS = 0.5;

export interface StepPuff {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  /** Outward drift (m/s), set at spawn from the golden angle. */
  vx: number;
  vz: number;
  age: number;
  life: number;
}

export interface StepDustPool {
  puffs: StepPuff[];
  /** Ring cursor: the next slot a spawn overwrites. */
  cursor: number;
  /** Total spawns ever — the drift spread's seed. */
  spawns: number;
}

export function createStepDust(capacity: number = STEP_DUST_CAPACITY): StepDustPool {
  return {
    puffs: Array.from({ length: capacity }, () => ({
      alive: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vz: 0,
      age: 0,
      life: STEP_DUST_LIFE_S,
    })),
    cursor: 0,
    spawns: 0,
  };
}

/** Steps completed between two readings of a mover's counter.
 *  A counter that went DOWN (a fresh mover on respawn / snap) is
 *  a re-baseline, not negative steps — it lands nothing. */
export function stepsLanded(prevCount: number, nextCount: number): number {
  return nextCount > prevCount ? nextCount - prevCount : 0;
}

/** Raise one puff at a footfall. Overwrites the ring's oldest slot,
 *  so a crowded floor recycles silently instead of growing. */
export function spawnStepPuff(pool: StepDustPool, x: number, y: number, z: number): void {
  const puff = pool.puffs[pool.cursor];
  if (!puff) return;
  pool.cursor = (pool.cursor + 1) % pool.puffs.length;
  pool.spawns += 1;
  // Golden-angle spread: consecutive steps drift different ways,
  // never a mechanical rotation.
  const angle = pool.spawns * 2.399963;
  const drift = 0.05 + (pool.spawns % 5) * 0.012;
  puff.alive = true;
  puff.x = x;
  puff.y = y;
  puff.z = z;
  puff.vx = Math.cos(angle) * drift;
  puff.vz = Math.sin(angle) * drift;
  puff.age = 0;
  puff.life = STEP_DUST_LIFE_S;
}

/** Age every live puff one frame: drift, rise, and die on time.
 *  `dt` is frame time — the scene's tick already clamps it, so
 *  the pool takes it as given. */
export function advanceStepDust(pool: StepDustPool, dt: number): void {
  if (!(dt > 0)) return;
  for (const puff of pool.puffs) {
    if (!puff.alive) continue;
    puff.age += dt;
    if (puff.age >= puff.life) {
      puff.alive = false;
      continue;
    }
    puff.x += puff.vx * dt;
    puff.z += puff.vz * dt;
    puff.y += STEP_DUST_RISE * dt;
  }
}

export function stepDustAliveCount(pool: StepDustPool): number {
  let n = 0;
  for (const puff of pool.puffs) if (puff.alive) n += 1;
  return n;
}

/**
 * Compact the live puffs into render buffers (positions + colours,
 * 3 floats each) and return how many were written. Colour is the
 * tint × remaining-life fade × birth brightness — under additive
 * blending a dying puff simply darkens away.
 */
export function writeStepDustBuffers(
  pool: StepDustPool,
  positions: Float32Array,
  colors: Float32Array,
): number {
  let n = 0;
  for (const puff of pool.puffs) {
    if (!puff.alive) continue;
    const i = n * 3;
    if (i + 2 >= positions.length || i + 2 >= colors.length) break;
    positions[i] = puff.x;
    positions[i + 1] = puff.y;
    positions[i + 2] = puff.z;
    const fade = (1 - puff.age / puff.life) * STEP_DUST_BRIGHTNESS;
    colors[i] = STEP_DUST_TINT.r * fade;
    colors[i + 1] = STEP_DUST_TINT.g * fade;
    colors[i + 2] = STEP_DUST_TINT.b * fade;
    n += 1;
  }
  return n;
}
