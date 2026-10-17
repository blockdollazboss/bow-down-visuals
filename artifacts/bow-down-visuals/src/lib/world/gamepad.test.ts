/**
 * Gamepad mapping tests — the pure poll math behind Bluetooth
 * controller support in the hall: radial deadzone shaping, the
 * standard button mapping, and edge-triggered toggles.
 */
import { describe, it, expect } from "vitest";
import {
  applyRadialDeadzone,
  pollGamepad,
  firstGamepad,
  IDLE_GAMEPAD_EDGES,
  type GamepadLike,
} from "./gamepad";

function pad(axes: number[], pressedIdx: number[] = []): GamepadLike {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressedIdx.includes(i) })),
  };
}

describe("applyRadialDeadzone", () => {
  it("reads exactly zero inside the zone (no drift)", () => {
    expect(applyRadialDeadzone(0.1, 0.05)).toEqual([0, 0]);
    expect(applyRadialDeadzone(0, 0)).toEqual([0, 0]);
  });

  it("full tilt is still full deflection, direction preserved", () => {
    const [x, y] = applyRadialDeadzone(1, 0);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
    const [dx, dy] = applyRadialDeadzone(0.6, 0.8); // magnitude 1 diagonal
    expect(Math.hypot(dx, dy)).toBeCloseTo(1);
    expect(dx / dy).toBeCloseTo(0.75);
  });

  it("just outside the zone starts gentle (rescaled, not a jump)", () => {
    const [x] = applyRadialDeadzone(0.28, 0); // 0.10 past the 0.18 zone
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(0.28);
    expect(x).toBeCloseTo((0.28 - 0.18) / (1 - 0.18), 5);
  });
});

describe("pollGamepad", () => {
  it("a missing pad is a clean idle and resets the edges", () => {
    const { intent, edges } = pollGamepad(null, { voice: true, view: true });
    expect(intent).toMatchObject({ moveX: 0, moveY: 0, sprint: false, toggleVoice: false });
    expect(edges).toEqual(IDLE_GAMEPAD_EDGES);
  });

  it("maps the sticks: left walks, right looks", () => {
    const { intent } = pollGamepad(pad([0, -1, 0.5, 0]), IDLE_GAMEPAD_EDGES);
    expect(intent.moveY).toBeCloseTo(-1);
    expect(intent.moveX).toBeCloseTo(0);
    expect(intent.lookX).toBeGreaterThan(0);
  });

  it("sprint is RT or L3, held (level, not edge)", () => {
    expect(pollGamepad(pad([0, 0, 0, 0], [7]), IDLE_GAMEPAD_EDGES).intent.sprint).toBe(true);
    expect(pollGamepad(pad([0, 0, 0, 0], [10]), IDLE_GAMEPAD_EDGES).intent.sprint).toBe(true);
    expect(pollGamepad(pad([0, 0, 0, 0], []), IDLE_GAMEPAD_EDGES).intent.sprint).toBe(false);
  });

  it("A toggles voice and Y toggles view — on the press edge only", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [0, 3]), IDLE_GAMEPAD_EDGES);
    expect(down.intent.toggleVoice).toBe(true);
    expect(down.intent.toggleView).toBe(true);
    const held = pollGamepad(pad([0, 0, 0, 0], [0, 3]), down.edges);
    expect(held.intent.toggleVoice).toBe(false);
    expect(held.intent.toggleView).toBe(false);
    const up = pollGamepad(pad([0, 0, 0, 0], []), held.edges);
    const again = pollGamepad(pad([0, 0, 0, 0], [0]), up.edges);
    expect(again.intent.toggleVoice).toBe(true);
  });

  it("short axis/button arrays read as zeros, never crash", () => {
    const { intent } = pollGamepad({ axes: [], buttons: [] }, IDLE_GAMEPAD_EDGES);
    expect(intent).toMatchObject({ moveX: 0, lookX: 0, sprint: false });
  });
});

describe("firstGamepad", () => {
  it("skips disconnected slots", () => {
    const p = pad([0, 0, 0, 0]);
    expect(firstGamepad([null, undefined, p])).toBe(p);
    expect(firstGamepad([null])).toBeNull();
    expect(firstGamepad([])).toBeNull();
  });
});
