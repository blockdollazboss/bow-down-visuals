/**
 * Step-dust tests (Stack-100 #2 item 57) — the footstep hook's
 * reader: step-count increments become puffs, puffs live, drift,
 * fade and die on schedule, and the render buffers carry the fade.
 */
import { describe, it, expect } from "vitest";
import {
  createStepDust,
  spawnStepPuff,
  advanceStepDust,
  stepDustAliveCount,
  writeStepDustBuffers,
  stepsLanded,
  STEP_DUST_LIFE_S,
  STEP_DUST_TINT,
  STEP_DUST_BRIGHTNESS,
} from "./step-dust";

describe("stepsLanded — the counter reading", () => {
  it("counts only the increments", () => {
    expect(stepsLanded(0, 0)).toBe(0);
    expect(stepsLanded(3, 4)).toBe(1);
    expect(stepsLanded(3, 7)).toBe(4);
  });

  it("a counter that went down is a re-baseline, never negative steps", () => {
    expect(stepsLanded(9, 0)).toBe(0);
    expect(stepsLanded(9, 2)).toBe(0);
  });
});

describe("the puff pool", () => {
  it("a spawn lives at the footfall, then dies on its life schedule", () => {
    const pool = createStepDust(8);
    spawnStepPuff(pool, 1, 0.04, 2);
    expect(stepDustAliveCount(pool)).toBe(1);
    advanceStepDust(pool, STEP_DUST_LIFE_S / 2);
    expect(stepDustAliveCount(pool)).toBe(1);
    advanceStepDust(pool, STEP_DUST_LIFE_S / 2 + 0.01);
    expect(stepDustAliveCount(pool)).toBe(0);
  });

  it("puffs drift and rise as they age — dust leaves the heel", () => {
    const pool = createStepDust(8);
    spawnStepPuff(pool, 0, 0.04, 0);
    const before = { ...pool.puffs[0]! };
    advanceStepDust(pool, 0.2);
    const after = pool.puffs[0]!;
    expect(after.y).toBeGreaterThan(before.y);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0);
  });

  it("the ring recycles at capacity instead of growing or dropping dead air", () => {
    const pool = createStepDust(4);
    for (let i = 0; i < 10; i++) spawnStepPuff(pool, i, 0, 0);
    expect(pool.puffs).toHaveLength(4);
    expect(stepDustAliveCount(pool)).toBe(4);
    expect(pool.spawns).toBe(10);
  });

  it("buffers carry position and the life fade — bright at birth, dark at death", () => {
    const pool = createStepDust(8);
    spawnStepPuff(pool, 3, 0.04, -2);
    const positions = new Float32Array(24);
    const colors = new Float32Array(24);
    expect(writeStepDustBuffers(pool, positions, colors)).toBe(1);
    expect(positions[0]).toBeCloseTo(3);
    expect(positions[1]).toBeCloseTo(0.04);
    expect(positions[2]).toBeCloseTo(-2);
    expect(colors[0]).toBeCloseTo(STEP_DUST_TINT.r * STEP_DUST_BRIGHTNESS);
    advanceStepDust(pool, STEP_DUST_LIFE_S * 0.9);
    writeStepDustBuffers(pool, positions, colors);
    expect(colors[0]).toBeLessThan(STEP_DUST_TINT.r * STEP_DUST_BRIGHTNESS * 0.2);
    expect(colors[0]).toBeGreaterThan(0);
  });

  it("dead puffs write nothing", () => {
    const pool = createStepDust(8);
    const positions = new Float32Array(24);
    const colors = new Float32Array(24);
    expect(writeStepDustBuffers(pool, positions, colors)).toBe(0);
    spawnStepPuff(pool, 0, 0, 0);
    advanceStepDust(pool, STEP_DUST_LIFE_S + 0.1);
    expect(writeStepDustBuffers(pool, positions, colors)).toBe(0);
  });
});
