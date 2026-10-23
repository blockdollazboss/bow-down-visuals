import { describe, expect, it } from "vitest";
import {
  createMover,
  stepMover,
  MOVER_WALK_SPEED,
  BOB_AMP_M,
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
