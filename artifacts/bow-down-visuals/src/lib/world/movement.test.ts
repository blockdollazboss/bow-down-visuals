import { describe, expect, it } from "vitest";
import {
  createMover,
  createVertical,
  stepMover,
  stepVertical,
  easeFigureHeight,
  MOVER_WALK_SPEED,
  BOB_AMP_M,
  JUMP_GRAVITY,
  JUMP_TAKEOFF_V,
  JUMP_DOUBLE_V,
  JUMP_MAX_JUMPS,
  type VerticalState,
} from "./movement";

/**
 * Drive a mover the way the scene does: desired velocity in, the
 * figure moves by the eased velocity, the new position feeds back.
 * Facing −Z (rotY = π in three.js convention? No — forward is
 * (−sin, −cos): rotY 0 faces −Z). Walking "forward" here = −Z.
 */
function drive(
  s: ReturnType<typeof createMover>,
  desired: { x: number; z: number },
  facing: number,
  seconds: number,
  dt = 1 / 60,
) {
  const pos = { x: s.px, z: s.pz };
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    stepMover(s, pos, desired.x, desired.z, facing, dt);
    pos.x += s.vx * dt;
    pos.z += s.vz * dt;
  }
  return pos;
}

const FORWARD = { x: 0, z: -MOVER_WALK_SPEED }; // facing rotY = 0

describe("acceleration — no more instant full speed", () => {
  it("ramps up instead of snapping to pace", () => {
    const s = createMover(0, 0);
    stepMover(s, { x: 0, z: 0 }, FORWARD.x, FORWARD.z, 0, 1 / 60);
    expect(Math.abs(s.vz)).toBeGreaterThan(0);
    expect(Math.abs(s.vz)).toBeLessThan(MOVER_WALK_SPEED * 0.2);
    drive(s, FORWARD, 0, 0.6);
    expect(Math.abs(s.vz)).toBeGreaterThan(MOVER_WALK_SPEED * 0.95);
  });

  it("eases out on stop instead of freezing mid-stride", () => {
    const s = createMover(0, 0);
    const pos = drive(s, FORWARD, 0, 1);
    stepMover(s, pos, 0, 0, 0, 1 / 60);
    expect(Math.abs(s.vz)).toBeGreaterThan(0.5); // still traveling
    drive(s, { x: 0, z: 0 }, 0, 0.5);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThan(0.05);
  });
});

describe("stride bob", () => {
  it("bobs at walk pace, synced to distance — still when still", () => {
    const s = createMover(0, 0);
    drive(s, FORWARD, 0, 1.5); // up to pace, phase running
    expect(s.bobAmp).toBeGreaterThan(0.9);
    expect(s.stepCount).toBeGreaterThanOrEqual(4);
    // Bob actually oscillates through the stride…
    const samples = new Set<number>();
    const pos = { x: s.px, z: s.pz };
    for (let i = 0; i < 40; i++) {
      stepMover(s, pos, FORWARD.x, FORWARD.z, 0, 1 / 60);
      pos.x += s.vx / 60;
      pos.z += s.vz / 60;
      samples.add(Math.round(s.bobY * 200));
    }
    expect(samples.size).toBeGreaterThan(6);
    expect(Math.abs(s.bobY)).toBeLessThanOrEqual(BOB_AMP_M + 0.02);
    // …and a stopped body does not bob at all.
    const still = createMover(0, 0);
    for (let i = 0; i < 60; i++) stepMover(still, { x: 0, z: 0 }, 0, 0, 0, 1 / 60);
    expect(still.bobY).toBe(0);
    expect(still.stepCount).toBe(0);
  });

  it("a wall stops the gait: fed positions that don't move don't advance the phase", () => {
    const s = createMover(0, 0);
    // Desired pace, but the position never changes (pressed to a wall).
    for (let i = 0; i < 90; i++) stepMover(s, { x: 0, z: 0 }, FORWARD.x, FORWARD.z, 0, 1 / 60);
    expect(s.speed).toBe(0);
    expect(s.stepCount).toBe(0);
    expect(s.bobY).toBe(0);
  });
});

describe("lean", () => {
  it("leans forward into the start, settles upright at pace", () => {
    const s = createMover(0, 0);
    const pos = { x: 0, z: 0 };
    let peakLean = 0;
    for (let i = 0; i < 30; i++) {
      stepMover(s, pos, FORWARD.x, FORWARD.z, 0, 1 / 60);
      pos.x += s.vx / 60;
      pos.z += s.vz / 60;
      peakLean = Math.min(peakLean, s.leanPitch);
    }
    expect(peakLean).toBeLessThan(-0.05); // visibly into the start
    drive(s, FORWARD, 0, 1.5);
    expect(s.leanPitch).toBeLessThan(0); // pace lean stays forward…
    expect(s.leanPitch).toBeGreaterThan(-0.06); // …but gentler than the launch
  });

  it("leans into a strafe and into braking", () => {
    const s = createMover(0, 0);
    drive(s, { x: MOVER_WALK_SPEED, z: 0 }, 0, 0.8); // strafe right, facing −Z
    expect(s.leanRoll).toBeLessThan(-0.03); // top tips toward the move
    const braking = createMover(0, 0);
    drive(braking, FORWARD, 0, 1);
    drive(braking, { x: 0, z: 0 }, 0, 0.12);
    expect(braking.leanPitch).toBeGreaterThan(0.01); // braking tips back
  });
});

describe("settle — the stop has weight", () => {
  it("dips on arrival and recovers to zero", () => {
    const s = createMover(0, 0);
    const pos = drive(s, FORWARD, 0, 1.2);
    // Stop feeding movement; desired zero; positions stay put.
    let dipped = 0;
    for (let i = 0; i < 90; i++) {
      stepMover(s, pos, 0, 0, 0, 1 / 60);
      dipped = Math.min(dipped, s.bobY);
    }
    expect(dipped).toBeLessThan(-0.01); // a real dip happened
    expect(Math.abs(s.bobY)).toBeLessThan(0.004); // and it recovered
    expect(Math.abs(s.settle)).toBeLessThan(0.05);
  });

  it("a gentle stop barely settles — the impulse scales with pace", () => {
    const s = createMover(0, 0);
    const pos = drive(s, { x: 0, z: -0.8 }, 0, 1.2); // slow drift (< 1.2 threshold)
    let dipped = 0;
    for (let i = 0; i < 60; i++) {
      stepMover(s, pos, 0, 0, 0, 1 / 60);
      dipped = Math.min(dipped, s.bobY);
    }
    expect(dipped).toBeGreaterThan(-0.01);
  });
});

describe("reduced motion (item 44) — bobScale silences the vertical, never the gait", () => {
  it("bobScale 0: the body walks at pace with zero bob and zero settle, lean intact", () => {
    const s = createMover(0, 0);
    const pos = { x: s.px, z: s.pz };
    for (let i = 0; i < 90; i++) {
      stepMover(s, pos, FORWARD.x, FORWARD.z, 0, 1 / 60, 0);
      pos.x += s.vx / 60;
      pos.z += s.vz / 60;
      expect(Math.abs(s.bobY)).toBe(0);
    }
    expect(Math.abs(s.vz)).toBeGreaterThan(MOVER_WALK_SPEED * 0.95); // pace reached
    expect(s.stepCount).toBeGreaterThan(4); // the stride still counts (footstep hooks live)
    expect(s.leanPitch).toBeLessThan(0); // posture still leans into the pace
    // And the stop settles silently too.
    for (let i = 0; i < 60; i++) {
      stepMover(s, pos, 0, 0, 0, 1 / 60, 0);
      expect(Math.abs(s.bobY)).toBe(0);
    }
  });

  it("bobScale defaults to 1 — existing callers keep the full gait", () => {
    const s = createMover(0, 0);
    drive(s, FORWARD, 0, 1.5);
    expect(s.bobAmp).toBeGreaterThan(0.9);
    expect(Math.abs(s.bobY)).toBeGreaterThan(0); // mid-stride at pace, the bob is alive
  });
});

describe("teleports re-anchor cleanly", () => {
  it("a spawn jump doesn't spin the gait or throw the body", () => {
    const s = createMover(0, 0);
    drive(s, FORWARD, 0, 0.5);
    stepMover(s, { x: 40, z: -30 }, FORWARD.x, FORWARD.z, 0, 1 / 60);
    expect(s.speed).toBe(0);
    expect(s.vx).toBe(0);
    expect(s.bobY).toBe(0);
    expect(s.px).toBe(40);
  });
});

describe("figure height follow (Stack-100 #2 items 50/55)", () => {
  it("eases toward the ground — most of a step within a quarter second, never past it", () => {
    let y = 0;
    for (let i = 0; i < 15; i++) y = easeFigureHeight(y, 0.36, 1 / 60); // 0.25 s up a 0.36 step
    expect(y).toBeGreaterThan(0.3);
    expect(y).toBeLessThanOrEqual(0.36);
    /* And it settles exactly onto the authored number. */
    for (let i = 0; i < 240; i++) y = easeFigureHeight(y, 0.36, 1 / 60);
    expect(y).toBe(0.36);
  });

  it("eases down as honestly as up (stepping off a lawn, down the tiers)", () => {
    let y = 0.95;
    for (let i = 0; i < 15; i++) y = easeFigureHeight(y, 0.62, 1 / 60);
    expect(y).toBeLessThan(0.7);
    expect(y).toBeGreaterThanOrEqual(0.62);
    for (let i = 0; i < 240; i++) y = easeFigureHeight(y, 0.62, 1 / 60);
    expect(y).toBe(0.62);
  });

  it("a zero or negative frame time changes nothing; an at-ground figure rests", () => {
    expect(easeFigureHeight(0.24, 0.36, 0)).toBe(0.24);
    expect(easeFigureHeight(0.24, 0.36, -1)).toBe(0.24);
    expect(easeFigureHeight(0.05, 0.05, 1 / 60)).toBe(0.05);
  });
});

/* ── Jump (stack300) ───────────────────────────────────────────
 * The vertical stepper, driven the way the scene drives it: a
 * press edge in, the offset out. Supported is the scene's
 * ground-follow having arrived at the ground under the figure. */
function fly(s: VerticalState, seconds: number, dt = 1 / 60, supported = true) {
  let landed = false;
  let peak = 0;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    if (stepVertical(s, dt, false, supported)) landed = true;
    peak = Math.max(peak, s.yOffset);
  }
  return { landed, peak };
}

describe("jump — the arc is the tuned jump, not a float", () => {
  it("takes off at the takeoff velocity and peaks at the analytic apex", () => {
    const s = createVertical();
    stepVertical(s, 1 / 60, true);
    expect(s.grounded).toBe(false);
    expect(s.jumpsUsed).toBe(1);
    const { landed, peak } = fly(s, 1.2);
    const apex = (JUMP_TAKEOFF_V * JUMP_TAKEOFF_V) / (2 * JUMP_GRAVITY);
    expect(apex).toBeCloseTo(1.28, 2);
    /* Semi-implicit Euler shaves ~v·dt/2 off the analytic apex. */
    expect(peak).toBeGreaterThan(apex - 0.08);
    expect(peak).toBeLessThan(apex + 0.01);
    expect(landed).toBe(true);
    expect(s.grounded).toBe(true);
    expect(s.yOffset).toBe(0);
    expect(s.jumpsUsed).toBe(0);
  });

  it("is airborne for roughly the analytic airtime — up and down inside a second", () => {
    const s = createVertical();
    stepVertical(s, 1 / 60, true);
    let frames = 1;
    while (!stepVertical(s, 1 / 60, false) && frames < 600) frames++;
    const airtime = frames / 60;
    const analytic = (2 * JUMP_TAKEOFF_V) / JUMP_GRAVITY;
    expect(airtime).toBeGreaterThan(analytic - 0.05);
    expect(airtime).toBeLessThan(analytic + 0.05);
  });

  it("reports the landing impact for the settle spring", () => {
    const s = createVertical();
    stepVertical(s, 1 / 60, true);
    let impact = 0;
    for (let i = 0; i < 120 && impact === 0; i++) {
      if (stepVertical(s, 1 / 60, false)) impact = s.landSpeed;
    }
    /* Falls back at (just under) the speed it left with. */
    expect(impact).toBeGreaterThan(JUMP_TAKEOFF_V - 1);
    expect(impact).toBeLessThanOrEqual(JUMP_TAKEOFF_V + 0.01);
  });

  it("a resting body with no press never leaves the ground", () => {
    const s = createVertical();
    const { landed, peak } = fly(s, 2);
    expect(peak).toBe(0);
    expect(landed).toBe(false);
    expect(s.grounded).toBe(true);
  });
});

describe("double jump — one extra impulse, never a third", () => {
  it("a mid-air press fires the second impulse and tops out at the double apex", () => {
    const s = createVertical();
    stepVertical(s, 1 / 60, true);
    /* Ride to just shy of the first apex, then press again. */
    let guard = 0;
    while (s.vy > 0.5 && guard++ < 120) stepVertical(s, 1 / 60, false);
    const before = s.yOffset;
    stepVertical(s, 1 / 60, true);
    expect(s.jumpsUsed).toBe(2);
    expect(s.vy).toBeGreaterThan(JUMP_DOUBLE_V - JUMP_GRAVITY / 60 - 0.01);
    const { landed, peak } = fly(s, 1.6);
    const doubleApex =
      (JUMP_TAKEOFF_V * JUMP_TAKEOFF_V) / (2 * JUMP_GRAVITY) +
      (JUMP_DOUBLE_V * JUMP_DOUBLE_V) / (2 * JUMP_GRAVITY);
    expect(before).toBeGreaterThan(1.1);
    expect(peak).toBeGreaterThan(doubleApex - 0.16);
    expect(peak).toBeLessThan(doubleApex + 0.05);
    expect(landed).toBe(true);
  });

  it("a third press mid-air does nothing — the allowance is spent", () => {
    const s = createVertical();
    stepVertical(s, 1 / 60, true);
    stepVertical(s, 1 / 60, true);
    expect(s.jumpsUsed).toBe(JUMP_MAX_JUMPS);
    const vyBefore = s.vy;
    stepVertical(s, 1 / 60, true);
    /* Gravity only — no fresh impulse. */
    expect(s.vy).toBeLessThan(vyBefore);
    expect(s.jumpsUsed).toBe(JUMP_MAX_JUMPS);
  });

  it("after landing the full allowance is restored", () => {
    const s = createVertical();
    stepVertical(s, 1 / 60, true);
    stepVertical(s, 1 / 60, true);
    fly(s, 2);
    expect(s.grounded).toBe(true);
    stepVertical(s, 1 / 60, true);
    expect(s.jumpsUsed).toBe(1);
    expect(s.grounded).toBe(false);
  });
});

describe("coyote time + press buffering — the presses players swear they made", () => {
  it("support lost without a press: coyote runs, the offset stays pinned, no landing is credited", () => {
    const s = createVertical();
    /* The ground falls away (a step-down the ease is riding). */
    const landed = stepVertical(s, 1 / 60, false, false);
    expect(landed).toBe(false);
    expect(s.grounded).toBe(false);
    expect(s.yOffset).toBe(0);
    expect(s.jumpsUsed).toBe(0);
    /* Support returns inside the window: standing again, whole. */
    stepVertical(s, 1 / 60, false, true);
    expect(s.grounded).toBe(true);
    expect(s.jumpsUsed).toBe(0);
  });

  it("a press inside coyote grace is the FIRST jump, at full takeoff velocity", () => {
    const s = createVertical();
    stepVertical(s, 1 / 60, false, false);
    stepVertical(s, 0.05, true, false);
    expect(s.jumpsUsed).toBe(1);
    expect(s.vy).toBeGreaterThan(JUMP_TAKEOFF_V - JUMP_GRAVITY * 0.05 - 0.01);
  });

  it("once coyote expires unspent, the free jump is gone — a later press is the double allowance", () => {
    const s = createVertical();
    stepVertical(s, 1 / 60, false, false);
    /* 0.3 s unsupported with no press: coyote (0.1 s) is long gone. */
    for (let i = 0; i < 18; i++) stepVertical(s, 1 / 60, false, false);
    expect(s.jumpsUsed).toBe(1);
    stepVertical(s, 1 / 60, true, false);
    expect(s.jumpsUsed).toBe(2);
    expect(s.vy).toBeGreaterThan(JUMP_DOUBLE_V - JUMP_GRAVITY / 60 - 0.01);
  });

  it("a press just before landing is buffered and fires off the ground", () => {
    const s = createVertical();
    stepVertical(s, 1 / 60, true);
    /* Fall until a hair above the floor, then press: too late
     * for the double to be the point — it buffers... unless the
     * double is still live. Spend the double first so the buffer
     * is the only path. */
    stepVertical(s, 1 / 60, true);
    let guard = 0;
    while (!(s.vy < 0 && s.yOffset < 0.12) && guard++ < 300) stepVertical(s, 1 / 60, false);
    stepVertical(s, 1 / 60, true); // buffered — allowance spent
    /* At this fall speed the press frame may itself be the
     * landing frame; either way the buffered press must take
     * off within a frame or two of touchdown — never die. */
    let tookOffAgain = false;
    for (let i = 0; i < 30; i++) {
      stepVertical(s, 1 / 60, false);
      if (!s.grounded && s.jumpsUsed === 1 && s.vy > 0) {
        tookOffAgain = true;
        break;
      }
    }
    expect(tookOffAgain).toBe(true);
  });

  it("a stale press does not survive: buffer dies in its window", () => {
    const s = createVertical();
    stepVertical(s, 1 / 60, true);
    stepVertical(s, 1 / 60, true); // double spent
    stepVertical(s, 1 / 60, true); // buffered with nothing to spend it on
    /* Rise + fall well past the 0.12 s buffer before landing. */
    fly(s, 2);
    expect(s.grounded).toBe(true);
    stepVertical(s, 1 / 60, false);
    expect(s.grounded).toBe(true);
    expect(s.yOffset).toBe(0);
  });
});
