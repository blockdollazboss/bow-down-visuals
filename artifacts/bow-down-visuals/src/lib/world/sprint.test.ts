/**
 * Sprint tests (Q194) — the pure pace seam behind every input
 * family: the shared speeds, the sprint-state → pace resolution,
 * the touch hold's transitions, and the three-family merge the
 * scene's frame reads. The scene/page wiring is pinned by the
 * source tests at the bottom of this file.
 */
import { describe, it, expect } from "vitest";
import {
  WALK_SPEED,
  RUN_SPEED,
  moveSpeed,
  touchSprintAfter,
  sprintFromInputs,
} from "./sprint";

describe("the shared paces", () => {
  it("walk is 3.4 m/s and run is 6 m/s — the desktop numbers, unmoved", () => {
    expect(WALK_SPEED).toBe(3.4);
    expect(RUN_SPEED).toBe(6);
    expect(RUN_SPEED).toBeGreaterThan(WALK_SPEED);
  });

  it("moveSpeed resolves the sprint state to exactly those paces", () => {
    expect(moveSpeed(false)).toBe(WALK_SPEED);
    expect(moveSpeed(true)).toBe(RUN_SPEED);
  });
});

describe("the touch sprint hold", () => {
  it("a press holds the sprint, from rest or already held", () => {
    expect(touchSprintAfter(false, "press")).toBe(true);
    expect(touchSprintAfter(true, "press")).toBe(true);
  });

  it("every release lets go, from held or already at rest — nothing sticks on", () => {
    expect(touchSprintAfter(true, "release")).toBe(false);
    expect(touchSprintAfter(false, "release")).toBe(false);
  });

  it("press then release returns to rest (the full hold cycle)", () => {
    const held = touchSprintAfter(false, "press");
    expect(touchSprintAfter(held, "release")).toBe(false);
  });
});

describe("sprintFromInputs — the one merge every family feeds", () => {
  it("no input held is no sprint (non-sprint movement is untouched)", () => {
    expect(sprintFromInputs({ keyboard: false, gamepad: false, touch: false })).toBe(false);
    expect(moveSpeed(sprintFromInputs({ keyboard: false, gamepad: false, touch: false }))).toBe(
      WALK_SPEED,
    );
  });

  it("the touch hold alone sprints — at the same pace as the desktop inputs", () => {
    const touchRun = sprintFromInputs({ keyboard: false, gamepad: false, touch: true });
    const keysRun = sprintFromInputs({ keyboard: true, gamepad: false, touch: false });
    const padRun = sprintFromInputs({ keyboard: false, gamepad: true, touch: false });
    expect(touchRun).toBe(true);
    expect(moveSpeed(touchRun)).toBe(moveSpeed(keysRun));
    expect(moveSpeed(touchRun)).toBe(moveSpeed(padRun));
    expect(moveSpeed(touchRun)).toBe(RUN_SPEED);
  });

  it("families merge: touch beside keys or pad changes nothing and breaks nothing", () => {
    expect(sprintFromInputs({ keyboard: true, gamepad: false, touch: true })).toBe(true);
    expect(sprintFromInputs({ keyboard: false, gamepad: true, touch: true })).toBe(true);
    /* Releasing the touch hold while Shift stays down keeps the
     * run — the merge is an OR, not a handoff. */
    expect(sprintFromInputs({ keyboard: true, gamepad: false, touch: false })).toBe(true);
  });
});

