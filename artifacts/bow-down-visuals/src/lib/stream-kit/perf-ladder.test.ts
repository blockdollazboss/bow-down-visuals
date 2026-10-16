/**
 * PerfLadder (perf-ladder.ts): the Pro engine's performance
 * governor — warmup is ignored, sustained slowness steps quality
 * down and finally asks for a degrade, sustained speed climbs back
 * with hysteresis.
 */
import { describe, it, expect } from "vitest";
import { PerfLadder, type PerfAction } from "./perf-ladder";

function feed(ladder: PerfLadder, ms: number, frames: number): PerfAction[] {
  const actions: PerfAction[] = [];
  for (let i = 0; i < frames; i++) actions.push(ladder.sample(ms));
  return actions;
}

describe("PerfLadder", () => {
  it("ignores the warmup window even when frames are slow", () => {
    const ladder = new PerfLadder({ maxStep: 2 });
    expect(feed(ladder, 120, 12).every((a) => a === "none")).toBe(true);
    expect(ladder.step).toBe(0);
  });

  it("steps down on sustained slowness, then asks to degrade at the last step", () => {
    const ladder = new PerfLadder({ maxStep: 2 });
    const first = feed(ladder, 100, 36); // warmup 12 + eval at 36
    expect(first[first.length - 1]).toBe("step-down");
    expect(ladder.step).toBe(1);
    const second = feed(ladder, 100, 36);
    expect(second[second.length - 1]).toBe("step-down");
    expect(ladder.step).toBe(2);
    const third = feed(ladder, 100, 36);
    expect(third[third.length - 1]).toBe("degrade");
    expect(ladder.step).toBe(2); // stays at the floor; the caller acts
  });

  it("a single slow spike does not move the ladder (EMA, not peak)", () => {
    const ladder = new PerfLadder({ maxStep: 2 });
    feed(ladder, 20, 12); // warmup at a healthy pace
    const actions = feed(ladder, 20, 200);
    expect(actions.every((a) => a === "none")).toBe(true);
  });

  it("mid-range performance is a stable 'none' (no oscillation)", () => {
    const ladder = new PerfLadder({ maxStep: 3 });
    const actions = feed(ladder, 30, 600); // between fastMs 12 and slowMs 46
    expect(actions.every((a) => a === "none")).toBe(true);
    expect(ladder.step).toBe(0);
  });

  it("climbs back up after sustained speed, and only after many good evals", () => {
    const ladder = new PerfLadder({ maxStep: 2 });
    feed(ladder, 100, 36); // -> step 1
    expect(ladder.step).toBe(1);
    // 9 good evaluations are not enough...
    const almost = feed(ladder, 5, 12 + 24 * 9);
    expect(almost.every((a) => a === "none")).toBe(true);
    expect(ladder.step).toBe(1);
    // ...the 10th consecutive good evaluation steps up.
    const rest = feed(ladder, 5, 24);
    expect(rest[rest.length - 1]).toBe("step-up");
    expect(ladder.step).toBe(0);
  });

  it("reset() returns to the best step and clears the EMA", () => {
    const ladder = new PerfLadder({ maxStep: 2 });
    feed(ladder, 100, 36);
    expect(ladder.step).toBe(1);
    ladder.reset();
    expect(ladder.step).toBe(0);
    expect(ladder.emaMs).toBeNull();
  });
});
