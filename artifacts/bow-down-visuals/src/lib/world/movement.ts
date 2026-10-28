/**
 * Human-like movement for World figures — the end of the glide.
 *
 * v1 figures moved at constant speed the instant input arrived
 * and stopped the instant it ended: statues on ice. A body does
 * none of that. It leans into the start, takes a beat to reach
 * pace, bobs with its stride, leans into a turn, and settles —
 * a small dip and recovery — when it stops. This module is that
 * body, as pure math: no three.js, no DOM, fully unit-tested.
 *
 * The contract is feed-and-read:
 *   1. the caller computes the DESIRED velocity (input direction
 *      × speed for the local walker; a chase vector for a peer
 *      following its network target),
 *   2. stepMover eases the body's actual velocity toward it
 *      (acceleration-limited), derives stride/bob/lean/settle from
 *      the AUTHORITATIVE position the caller feeds back (so wall
 *      contact, doorway resolves and network corrections all bend
 *      the gait truthfully — a body pressed against a wall stops
 *      bobbing, because it stopped moving),
 *   3. the caller moves the figure by (vx, vz) × dt, resolves
 *      collisions, and feeds the resolved position in next frame.
 *
 * Facing frame: forward = (−sin rotY, −cos rotY) on the floor
 * plane (three.js convention, matching the scene). tiltX NEGATIVE
 * leans the figure forward (its front is −Z), per actions.ts.
 */

/** Full walk pace (m/s) — bob/lean normalize against this. */
export const MOVER_WALK_SPEED = 3.4;
/** Acceleration limits (m/s²): starting is gentler than stopping,
 *  the way legs actually work. */
export const MOVER_ACCEL = 14;
export const MOVER_DECEL = 20;
/** Floor distance of one full stride cycle (two steps). Tuned
 *  (item 44): 1.5 → 1.6 m — a slightly longer stride cycle slows
 *  the bob's rhythm at the same pace, grounded rather than busy. */
export const STRIDE_CYCLE_M = 1.6;
/** Peak bob height (m) at full walk pace. Tuned (item 44):
 *  0.032 → 0.026 — the bob should read in the feet, not swim in
 *  the view; the first-person camera rides a gentled share of it. */
export const BOB_AMP_M = 0.026;

export interface MoverState {
  /** Smoothed velocity — the body's current belief (m/s). */
  vx: number;
  vz: number;
  /** Last authoritative position fed in (teleport-safe). */
  px: number;
  pz: number;
  /** Stride phase in cycles (advances only while actually moving). */
  phase: number;
  /** Smoothed bob amplitude 0..1 (ramps with speed, never pops). */
  bobAmp: number;
  /** Current vertical offset (m): stride bob + stop settle. */
  bobY: number;
  /** Lean, composed onto the figure's tilts by the caller. */
  leanPitch: number;
  leanRoll: number;
  /** Stop-settle spring: dips negative, overshoots, decays. */
  settle: number;
  settleVel: number;
  /** Actual speed (m/s) measured from fed positions last step. */
  speed: number;
  /** Completed steps — the footstep hook reads increments of
   *  this counter: the scene's step-dust (step-dust.ts, item 57)
   *  raises a puff per landed step. (No footstep SOUND exists —
   *  the counter's only reader is the dust.) */
  stepCount: number;
}

export function createMover(x: number, z: number): MoverState {
  return {
    vx: 0,
    vz: 0,
    px: x,
    pz: z,
    phase: 0,
    bobAmp: 0,
    bobY: 0,
    leanPitch: 0,
    leanRoll: 0,
    settle: 0,
    settleVel: 0,
    speed: 0,
    stepCount: 0,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ── Figure height (Stack-100 #2 items 50/55) ───────────────────
 * A figure's y is its standing height above the room floor — the
 * ground truth is palace-layout's groundHeightAt (step zones at
 * their authored tops, 0 elsewhere), and movement's step limits
 * (STEP_UP_MAX / STEP_DOWN_MAX, enforced per-sample by the
 * layout's segmentWalkable) decide which grounds a step may
 * reach at all. What remains for the body is the FOLLOW: ease
 * the rendered height toward the ground under the figure, fast
 * enough that a tread registers as a step, smooth enough that
 * it never reads as a teleport pop. Settling (spawn, doorway
 * landings) is NOT eased — the placement code sets the height
 * outright; the ease is for walking only. */

/** Height-follow rate (1/s): at 60 fps a 0.36 m step is ~90%
 *  ridden within a quarter second — a step, felt as a step. */
export const HEIGHT_EASE_RATE = 10;

/** Ease a figure's height toward the ground under it. Snaps the
 *  last millimetre so a standing figure rests exactly on its
 *  ground (and height reports settle to the authored number). */
export function easeFigureHeight(current: number, ground: number, dt: number): number {
  if (!(dt > 0)) return current;
  const step = Math.min(dt, 0.05);
  const next = current + (ground - current) * (1 - Math.exp(-HEIGHT_EASE_RATE * step));
  return Math.abs(ground - next) < 0.001 ? ground : next;
}

/**
 * Advance the body one frame.
 *
 * @param s         the mover state (mutated)
 * @param pos       the figure's CURRENT authoritative position
 * @param desiredVx desired velocity (world, m/s)
 * @param desiredVz desired velocity (world, m/s)
 * @param facingRotY the figure's facing (lean is measured in it)
 * @param dt        frame seconds (clamped internally)
 * @param bobScale  vertical-motion scale (item 44): 1 = full
 *                  stride bob + settle; 0 silences both for a
 *                  reduced-motion walker. Lean and easing are
 *                  NOT scaled — they are posture, not oscillation.
 */
export function stepMover(
  s: MoverState,
  pos: { x: number; z: number },
  desiredVx: number,
  desiredVz: number,
  facingRotY: number,
  dt: number,
  bobScale = 1,
): void {
  if (!(dt > 0)) return;
  const step = Math.min(dt, 0.05);

  // ── Actual motion, from the fed positions ────────────────────
  const movedX = pos.x - s.px;
  const movedZ = pos.z - s.pz;
  const moved = Math.hypot(movedX, movedZ);
  // A jump past any plausible frame distance is a teleport
  // (spawn, doorway landing, snap correction): re-anchor without
  // spinning the gait up.
  if (moved > 2.5) {
    s.px = pos.x;
    s.pz = pos.z;
    s.speed = 0;
    s.vx = 0;
    s.vz = 0;
    s.bobAmp = 0;
    s.bobY = 0;
    return;
  }
  const prevSpeed = s.speed;
  s.speed = moved / step;
  s.px = pos.x;
  s.pz = pos.z;

  // ── Velocity: ease toward desired, acceleration-limited ─────
  const prevVx = s.vx;
  const prevVz = s.vz;
  const dvx = desiredVx - s.vx;
  const dvz = desiredVz - s.vz;
  const dv = Math.hypot(dvx, dvz);
  const speeding =
    Math.hypot(desiredVx, desiredVz) > Math.hypot(s.vx, s.vz) + 0.01;
  const maxDelta = (speeding ? MOVER_ACCEL : MOVER_DECEL) * step;
  if (dv > maxDelta && dv > 0) {
    s.vx += (dvx / dv) * maxDelta;
    s.vz += (dvz / dv) * maxDelta;
  } else {
    s.vx = desiredVx;
    s.vz = desiredVz;
  }
  const accelX = (s.vx - prevVx) / step;
  const accelZ = (s.vz - prevVz) / step;

  // ── Stride + bob: from ACTUAL speed, so walls stop the gait ──
  s.phase += (s.speed * step) / STRIDE_CYCLE_M;
  s.stepCount = Math.floor(s.phase * 2);
  const ampTarget = clamp(s.speed / MOVER_WALK_SPEED, 0, 1);
  s.bobAmp += (ampTarget - s.bobAmp) * (1 - Math.exp(-8 * step));
  // One rise-and-fall per stride cycle (two steps) — the body's
  // dominant gait rhythm; twice that reads as a buzz, not a walk.
  // Gated hard by actual speed: below a shuffle the bob is gone,
  // so a stopping body's vertical is the settle's alone (the two
  // signals must never fight in the arrival window).
  const gaitGate = clamp(s.speed / 0.8, 0, 1);
  const strideBob = Math.sin(s.phase * Math.PI * 2) * BOB_AMP_M * s.bobAmp * gaitGate;

  // ── Settle: the stop has weight ──────────────────────────────
  if (prevSpeed > 1.2 && s.speed < 0.25) {
    // Arrived: impulse proportional to the pace we carried in.
    s.settleVel -= prevSpeed * 1.0;
  }
  const settleAcc = -120 * s.settle - 13 * s.settleVel;
  s.settleVel += settleAcc * step;
  s.settle += s.settleVel * step;
  const settleY = clamp(s.settle, -1.4, 1.4) * 0.08;
  s.bobY = (strideBob + settleY) * bobScale;

  // ── Lean: into the acceleration, and a touch into the pace ───
  const fx = -Math.sin(facingRotY);
  const fz = -Math.cos(facingRotY);
  const rx = -fz;
  const rz = fx;
  const aF = accelX * fx + accelZ * fz;
  const aL = accelX * rx + accelZ * rz;
  const vF = s.vx * fx + s.vz * fz;
  const vL = s.vx * rx + s.vz * rz;
  const pitchTarget = clamp(-(aF * 0.013 + vF * 0.009), -0.16, 0.13);
  const rollTarget = clamp(-(aL * 0.013 + vL * 0.012), -0.14, 0.14);
  const blend = 1 - Math.exp(-10 * step);
  s.leanPitch += (pitchTarget - s.leanPitch) * blend;
  s.leanRoll += (rollTarget - s.leanRoll) * blend;
}

/* ── Jump (stack300) ────────────────────────────────────────────
 * The vertical half of the body, as pure math beside the gait.
 * There is no physics engine in the World and this adds none:
 * the ground is still the layout's authored ground-follow (the
 * caller eases it, grounded only) and a jump is an OFFSET above
 * that ground, integrated here under gravity. The offset never
 * feeds the palace resolver, whose step gates read the ground
 * alone — so a jump cannot vault a wall, a terrace or a blocked
 * rectangle: while airborne the body crosses exactly the ground
 * it could have walked, and lands on the ground under it. What
 * you CAN do is leave the floor, twice: the second impulse is
 * the double jump, sized inside the same server envelope (the
 * room validates height against these constants' predictions —
 * keep the two in step).
 *
 * Feel: weighty, not floaty. Real gravity (9.8) reads as moon
 * drift at game scale; 22 m/s² with a 7.5 m/s takeoff gives a
 * ~1.28 m apex in ~0.34 s and a ~0.68 s full hop — a jump with
 * intent, landed before it can feel like flying. */

/** Downward acceleration (m/s²). */
export const JUMP_GRAVITY = 22;
/** Take-off velocity (m/s): apex = v²/2g ≈ 1.28 m. */
export const JUMP_TAKEOFF_V = 7.5;
/** Second-impulse velocity (m/s, 0.92× the first): fired at the
 *  first apex it tops out ≈ 2.36 m above the take-off ground. */
export const JUMP_DOUBLE_V = 6.9;
/** Impulses per airborne episode: the jump + the double. */
export const JUMP_MAX_JUMPS = 2;
/** Grace after the ground falls away (a step-down the height
 *  ease is still riding): a press inside it is still the FIRST
 *  jump — the press the player swears they made on the ledge. */
export const JUMP_COYOTE_S = 0.1;
/** A press slightly BEFORE landing is held this long and fires
 *  on the landing frame instead of dying mid-air. */
export const JUMP_BUFFER_S = 0.12;

export interface VerticalState {
  /** Height above the caller's ground-follow (m) — the offset
   *  the caller adds to its eased ground height. */
  yOffset: number;
  /** Vertical velocity (m/s, up positive). */
  vy: number;
  /** Standing on the ground-follow (offset 0, supported). */
  grounded: boolean;
  /** Impulses spent since the last grounded frame. */
  jumpsUsed: number;
  /** Coyote grace remaining (s) after support was lost. */
  coyote: number;
  /** Buffered-press life remaining (s). */
  buffer: number;
  /** Impact speed (m/s) of the landing on THIS step, 0 when the
   *  step did not land — the caller feeds it to the settle
   *  spring so a landing dips like a stop does. */
  landSpeed: number;
}

export function createVertical(): VerticalState {
  return {
    yOffset: 0,
    vy: 0,
    grounded: true,
    jumpsUsed: 0,
    coyote: 0,
    buffer: 0,
    landSpeed: 0,
  };
}

/**
 * Advance the jump one frame. Returns true on the frame the body
 * lands (read `s.landSpeed` for the impact).
 *
 * @param s         the vertical state (mutated)
 * @param dt        frame seconds (clamped internally, like the gait)
 * @param pressed   a jump press EDGE this frame (input families
 *                  edge-detect; a held button is one press)
 * @param supported the ground is under the body at offset 0: the
 *                  caller's ground-follow has arrived at the
 *                  ground under the figure. Support lost without
 *                  a jump (stepping down a tier the ease is still
 *                  riding) starts coyote time instead of falling —
 *                  the offset rides the easing ground, and only a
 *                  real jump separates the body from it.
 */
export function stepVertical(
  s: VerticalState,
  dt: number,
  pressed: boolean,
  supported = true,
): boolean {
  if (!(dt > 0)) return false;
  const step = Math.min(dt, 0.05);
  s.landSpeed = 0;
  if (pressed) s.buffer = JUMP_BUFFER_S;
  else if (s.buffer > 0) s.buffer = Math.max(0, s.buffer - step);
  if (s.coyote > 0) s.coyote = Math.max(0, s.coyote - step);

  if (s.grounded) {
    if (!supported) {
      /* The ground fell away under a standing body (a step-down
       * the ease is riding out): airborne on paper, but the
       * offset stays pinned to the easing ground — coyote runs,
       * and only its expiry spends the free first jump. */
      s.grounded = false;
      s.coyote = JUMP_COYOTE_S;
      s.vy = 0;
    } else if (s.buffer > 0) {
      s.vy = JUMP_TAKEOFF_V;
      s.jumpsUsed = 1;
      s.grounded = false;
      s.buffer = 0;
      s.coyote = 0;
    } else {
      return false;
    }
  }

  if (!s.grounded) {
    if (s.buffer > 0 && s.jumpsUsed === 0 && s.coyote > 0) {
      /* Pressed inside coyote grace: still the first jump. */
      s.vy = JUMP_TAKEOFF_V;
      s.jumpsUsed = 1;
      s.buffer = 0;
      s.coyote = 0;
    } else if (s.buffer > 0 && s.jumpsUsed >= 1 && s.jumpsUsed < JUMP_MAX_JUMPS) {
      /* The double jump — a fresh impulse, wherever the arc is. */
      s.vy = JUMP_DOUBLE_V;
      s.jumpsUsed += 1;
      s.buffer = 0;
    }
    if (s.coyote === 0 && s.jumpsUsed === 0) {
      /* Coyote ran out with no press: the free jump is spent —
       * from here a press is the double-jump allowance, never a
       * fresh first jump out of thin air. */
      s.jumpsUsed = 1;
    }
    if (s.yOffset > 0 || s.vy > 0) {
      s.vy -= JUMP_GRAVITY * step;
      s.yOffset += s.vy * step;
    }
    if (s.yOffset <= 0) {
      s.yOffset = 0;
      if (supported) {
        /* Arrival: the caller snaps its ground-follow to the
         * ground under the landing (a placement, not an ease —
         * the figure-height doctrine), and the settle spring
         * takes the impact from landSpeed. A press buffered
         * into the landing fires next frame off the grounded
         * branch, so a held rhythm of hops never drops one. */
        const impact = Math.abs(s.vy);
        s.vy = 0;
        s.grounded = true;
        s.jumpsUsed = 0;
        s.coyote = 0;
        s.landSpeed = impact;
        return true;
      }
      /* Still unsupported (the ground-follow hasn't arrived):
       * rest on it — no sink, no bounce, no landing credit. */
      s.vy = 0;
    }
  }
  return false;
}
