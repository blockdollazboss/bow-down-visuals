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
    const { intent, edges } = pollGamepad(null, { voice: true, view: true, interact: true, lt: true, actions: {} });
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

  it("LB is the station interact — on the press edge only", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [4]), IDLE_GAMEPAD_EDGES);
    expect(down.intent.interact).toBe(true);
    const held = pollGamepad(pad([0, 0, 0, 0], [4]), down.edges);
    expect(held.intent.interact).toBe(false);
    const up = pollGamepad(pad([0, 0, 0, 0], []), held.edges);
    const again = pollGamepad(pad([0, 0, 0, 0], [4]), up.edges);
    expect(again.intent.interact).toBe(true);
  });

  it("LT steps the voice mode back — on the press edge only (item 59)", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [6]), IDLE_GAMEPAD_EDGES);
    expect(down.intent.voiceBack).toBe(true);
    const held = pollGamepad(pad([0, 0, 0, 0], [6]), down.edges);
    expect(held.intent.voiceBack).toBe(false);
    const up = pollGamepad(pad([0, 0, 0, 0], []), held.edges);
    const again = pollGamepad(pad([0, 0, 0, 0], [6]), up.edges);
    expect(again.intent.voiceBack).toBe(true);
  });

  it("LT steals nothing: not sprint, not the forward voice step, not an action", () => {
    const { intent } = pollGamepad(pad([0, 0, 0, 0], [6]), IDLE_GAMEPAD_EDGES);
    expect(intent.sprint).toBe(false);
    expect(intent.toggleVoice).toBe(false);
    expect(intent.toggleView).toBe(false);
    expect(intent.interact).toBe(false);
    expect(intent.action).toBeNull();
    // …and RT beside it keeps its own job: sprint, never voice-back.
    const rt = pollGamepad(pad([0, 0, 0, 0], [7]), IDLE_GAMEPAD_EDGES).intent;
    expect(rt.sprint).toBe(true);
    expect(rt.voiceBack).toBe(false);
  });

  it("LB steals nothing: it is not an action, a toggle, or sprint", () => {
    const { intent } = pollGamepad(pad([0, 0, 0, 0], [4]), IDLE_GAMEPAD_EDGES);
    expect(intent.action).toBeNull();
    expect(intent.toggleVoice).toBe(false);
    expect(intent.toggleView).toBe(false);
    expect(intent.sprint).toBe(false);
    // …and the buttons LB lives beside keep their own jobs.
    expect(pollGamepad(pad([0, 0, 0, 0], [5]), IDLE_GAMEPAD_EDGES).intent.action).toBe("spin");
    expect(pollGamepad(pad([0, 0, 0, 0], [4]), IDLE_GAMEPAD_EDGES).intent.interact).toBe(true);
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

describe("avatar action buttons", () => {
  it("maps the D-pad, X, B and RB to the seven actions on the press edge", () => {
    const cases: Array<[number, string]> = [
      [12, "bow"],
      [15, "cheer"],
      [13, "sit"],
      [14, "wave"],
      [2, "clap"],
      [1, "dance"],
      [5, "spin"],
    ];
    for (const [button, action] of cases) {
      const { intent } = pollGamepad(pad([0, 0, 0, 0], [button]), IDLE_GAMEPAD_EDGES);
      expect(intent.action).toBe(action);
    }
  });

  it("holding an action button fires once, never per frame", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [12]), IDLE_GAMEPAD_EDGES);
    expect(down.intent.action).toBe("bow");
    const held = pollGamepad(pad([0, 0, 0, 0], [12]), down.edges);
    expect(held.intent.action).toBeNull();
    const up = pollGamepad(pad([0, 0, 0, 0], []), held.edges);
    const again = pollGamepad(pad([0, 0, 0, 0], [12]), up.edges);
    expect(again.intent.action).toBe("bow");
  });

  it("two fresh presses in one frame perform the first in map order", () => {
    const { intent } = pollGamepad(pad([0, 0, 0, 0], [1, 12]), IDLE_GAMEPAD_EDGES);
    expect(intent.action).toBe("bow");
  });

  it("the voice/view toggles are untouched by the action map", () => {
    const { intent } = pollGamepad(pad([0, 0, 0, 0], [0, 3]), IDLE_GAMEPAD_EDGES);
    expect(intent.toggleVoice).toBe(true);
    expect(intent.toggleView).toBe(true);
    expect(intent.action).toBeNull();
  });
});

describe("the paged layout + the three new verbs", () => {
  it("on the social page the same slots perform the social set", () => {
    const cases: Array<[number, string]> = [
      [12, "point"],
      [15, "laugh"],
      [13, "kneel"],
      [14, "beckon"],
      [2, "salute"],
      [1, "highfive"],
      [5, "shrug"],
    ];
    for (const [button, action] of cases) {
      const { intent } = pollGamepad(pad([0, 0, 0, 0], [button]), IDLE_GAMEPAD_EDGES, "social");
      expect(intent.action).toBe(action);
    }
    // …and page 1's bow button is a point now — no page bleeds.
    expect(pollGamepad(pad([0, 0, 0, 0], [12]), IDLE_GAMEPAD_EDGES, "perform").intent.action).toBe("bow");
  });

  it("Back, Start and R3 edge-fire page, photo and claim — and steal nothing", () => {
    const back = pollGamepad(pad([0, 0, 0, 0], [8]), IDLE_GAMEPAD_EDGES);
    expect(back.intent.pageCycle).toBe(true);
    expect(back.intent.action).toBeNull();
    expect(back.intent.toggleVoice).toBe(false);
    const held = pollGamepad(pad([0, 0, 0, 0], [8]), back.edges);
    expect(held.intent.pageCycle).toBe(false);

    const start = pollGamepad(pad([0, 0, 0, 0], [9]), IDLE_GAMEPAD_EDGES);
    expect(start.intent.photoMode).toBe(true);
    expect(start.intent.action).toBeNull();

    const r3 = pollGamepad(pad([0, 0, 0, 0], [11]), IDLE_GAMEPAD_EDGES);
    expect(r3.intent.momentClaim).toBe(true);
    expect(r3.intent.sprint).toBe(false); // L3 (10) sprints; R3 (11) claims
    expect(r3.intent.action).toBeNull();
  });

  it("the new verbs ride the same reset rule: a vanished pad forgets them", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [8, 9, 11]), IDLE_GAMEPAD_EDGES);
    expect(down.intent.pageCycle).toBe(true);
    const gone = pollGamepad(null, down.edges);
    expect(gone.edges).toEqual(IDLE_GAMEPAD_EDGES);
    const back_ = pollGamepad(pad([0, 0, 0, 0], [8]), gone.edges);
    expect(back_.intent.pageCycle).toBe(true);
  });
});
