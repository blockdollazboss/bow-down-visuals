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
  type GamepadEdges,
  type GamepadLike,
} from "./gamepad";
import { PAD_PHOTO_LONG_PRESS_MS } from "./bindings";
import { classifyGamepadId, type ControllerProfile } from "./controller-profile";

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

  it("Y toggles view — on the press edge only", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [3]), IDLE_GAMEPAD_EDGES);
    expect(down.intent.toggleView).toBe(true);
    const held = pollGamepad(pad([0, 0, 0, 0], [3]), down.edges);
    expect(held.intent.toggleView).toBe(false);
    const up = pollGamepad(pad([0, 0, 0, 0], []), held.edges);
    const again = pollGamepad(pad([0, 0, 0, 0], [3]), up.edges);
    expect(again.intent.toggleView).toBe(true);
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

describe("A — tap jumps, hold steps voice (stack300)", () => {
  it("a tap is a jump — edge only, never a voice step", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [0]), IDLE_GAMEPAD_EDGES, "perform", 1000);
    expect(down.intent.jump).toBe(true);
    expect(down.intent.toggleVoice).toBe(false);
    const held = pollGamepad(pad([0, 0, 0, 0], [0]), down.edges, "perform", 1100);
    expect(held.intent.jump).toBe(false);
    expect(held.intent.toggleVoice).toBe(false);
    const up = pollGamepad(pad([0, 0, 0, 0], []), held.edges, "perform", 1150);
    const again = pollGamepad(pad([0, 0, 0, 0], [0]), up.edges, "perform", 1200);
    expect(again.intent.jump).toBe(true);
    expect(again.intent.toggleVoice).toBe(false);
  });

  it("holding A past the long-press line steps voice exactly once — the tap already jumped", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [0]), IDLE_GAMEPAD_EDGES, "perform", 1000);
    expect(down.intent.jump).toBe(true);
    const before = pollGamepad(pad([0, 0, 0, 0], [0]), down.edges, "perform", 1399);
    expect(before.intent.toggleVoice).toBe(false);
    const at = pollGamepad(pad([0, 0, 0, 0], [0]), before.edges, "perform", 1400);
    expect(at.intent.toggleVoice).toBe(true);
    expect(at.intent.jump).toBe(false);
    const after = pollGamepad(pad([0, 0, 0, 0], [0]), at.edges, "perform", 2400);
    expect(after.intent.toggleVoice).toBe(false);
    expect(after.intent.jump).toBe(false);
  });

  it("a fresh hold after release can voice-step again", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [0]), IDLE_GAMEPAD_EDGES, "perform", 1000);
    const voiced = pollGamepad(pad([0, 0, 0, 0], [0]), down.edges, "perform", 1500);
    expect(voiced.intent.toggleVoice).toBe(true);
    const up = pollGamepad(pad([0, 0, 0, 0], []), voiced.edges, "perform", 1600);
    const down2 = pollGamepad(pad([0, 0, 0, 0], [0]), up.edges, "perform", 2000);
    expect(down2.intent.jump).toBe(true);
    const voiced2 = pollGamepad(pad([0, 0, 0, 0], [0]), down2.edges, "perform", 2500);
    expect(voiced2.intent.toggleVoice).toBe(true);
  });

  it("A steals nothing else: not sprint, not an action, not view", () => {
    const { intent } = pollGamepad(pad([0, 0, 0, 0], [0]), IDLE_GAMEPAD_EDGES, "perform", 1000);
    expect(intent.sprint).toBe(false);
    expect(intent.action).toBeNull();
    expect(intent.toggleView).toBe(false);
    expect(intent.interact).toBe(false);
  });
});

describe("Back — tap cycles the page, hold toggles fullscreen (stack700)", () => {
  it("a tap is a page cycle — edge only, never a fullscreen toggle", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [8]), IDLE_GAMEPAD_EDGES, "perform", 1000);
    expect(down.intent.pageCycle).toBe(true);
    expect(down.intent.fullscreenToggle).toBe(false);
    const held = pollGamepad(pad([0, 0, 0, 0], [8]), down.edges, "perform", 1100);
    expect(held.intent.pageCycle).toBe(false);
    expect(held.intent.fullscreenToggle).toBe(false);
    const up = pollGamepad(pad([0, 0, 0, 0], []), held.edges, "perform", 1150);
    const again = pollGamepad(pad([0, 0, 0, 0], [8]), up.edges, "perform", 1200);
    expect(again.intent.pageCycle).toBe(true);
    expect(again.intent.fullscreenToggle).toBe(false);
  });

  it("holding Back past the long-press line toggles fullscreen exactly once — the tap already cycled", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [8]), IDLE_GAMEPAD_EDGES, "perform", 1000);
    expect(down.intent.pageCycle).toBe(true);
    const before = pollGamepad(pad([0, 0, 0, 0], [8]), down.edges, "perform", 1599);
    expect(before.intent.fullscreenToggle).toBe(false);
    const at = pollGamepad(pad([0, 0, 0, 0], [8]), before.edges, "perform", 1600);
    expect(at.intent.fullscreenToggle).toBe(true);
    expect(at.intent.pageCycle).toBe(false);
    const after = pollGamepad(pad([0, 0, 0, 0], [8]), at.edges, "perform", 2600);
    expect(after.intent.fullscreenToggle).toBe(false);
  });

  it("a fresh hold after release can toggle fullscreen again", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [8]), IDLE_GAMEPAD_EDGES, "perform", 1000);
    const fired = pollGamepad(pad([0, 0, 0, 0], [8]), down.edges, "perform", 1700);
    expect(fired.intent.fullscreenToggle).toBe(true);
    const up = pollGamepad(pad([0, 0, 0, 0], []), fired.edges, "perform", 1800);
    const down2 = pollGamepad(pad([0, 0, 0, 0], [8]), up.edges, "perform", 2000);
    expect(down2.intent.pageCycle).toBe(true);
    const fired2 = pollGamepad(pad([0, 0, 0, 0], [8]), down2.edges, "perform", 2700);
    expect(fired2.intent.fullscreenToggle).toBe(true);
  });

  it("Back steals nothing else: not an action, not sprint, not photo", () => {
    const { intent } = pollGamepad(pad([0, 0, 0, 0], [8]), IDLE_GAMEPAD_EDGES, "perform", 1000);
    expect(intent.action).toBeNull();
    expect(intent.sprint).toBe(false);
    expect(intent.photoMode).toBe(false);
    expect(intent.jump).toBe(false);
  });

  it("a disconnected pad mid-hold resets the hold — a reconnect never fires a stale toggle", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [8]), IDLE_GAMEPAD_EDGES, "perform", 1000);
    const gone = pollGamepad(null, down.edges, "perform", 5000);
    expect(gone.intent.fullscreenToggle).toBe(false);
    expect(gone.edges.pageHeldSince).toBe(0);
    expect(gone.edges.pageFiredFs).toBe(false);
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
    /* A is a jump now (its voice step is the long-press, below);
     *  Y still toggles the view; neither performs an action. */
    expect(intent.jump).toBe(true);
    expect(intent.toggleVoice).toBe(false);
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

  it("Back, Start and R3 edge-fire page, settings and claim — and steal nothing", () => {
    const back = pollGamepad(pad([0, 0, 0, 0], [8]), IDLE_GAMEPAD_EDGES);
    expect(back.intent.pageCycle).toBe(true);
    expect(back.intent.action).toBeNull();
    expect(back.intent.toggleVoice).toBe(false);
    const held = pollGamepad(pad([0, 0, 0, 0], [8]), back.edges);
    expect(held.intent.pageCycle).toBe(false);

    /* Start's TAP edge-fires the settings toggle now (stack900);
     * the photo frame moved to the hold — the share suite below
     * carries it. */
    const start = pollGamepad(pad([0, 0, 0, 0], [9]), IDLE_GAMEPAD_EDGES);
    expect(start.intent.settingsToggle).toBe(true);
    expect(start.intent.photoMode).toBe(false);
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

describe("the menu button share — Start's tap is settings, its hold is the photo (stack900)", () => {
  /* One press script, replayed per family: down at t, held
   * frames, release. The poll resolves the button through the
   * profile each family hands it. */
  const press = (
    pressedIdx: number[],
    times: number[],
    profile?: ControllerProfile,
  ) => {
    let edges: GamepadEdges = IDLE_GAMEPAD_EDGES;
    return times.map((now) => {
      const r = pollGamepad(pad([0, 0, 0, 0], pressedIdx), edges, "perform", now, profile);
      edges = r.edges;
      return r.intent;
    });
  };

  it("a tap fires settingsToggle once and never the photo frame", () => {
    const down = pollGamepad(pad([0, 0, 0, 0], [9]), IDLE_GAMEPAD_EDGES, "perform", 1000);
    expect(down.intent.settingsToggle).toBe(true);
    expect(down.intent.photoMode).toBe(false);
    const stillDown = pollGamepad(pad([0, 0, 0, 0], [9]), down.edges, "perform", 1100);
    expect(stillDown.intent.settingsToggle).toBe(false); // held ≠ re-fired
    const up = pollGamepad(pad([0, 0, 0, 0], []), stillDown.edges, "perform", 1200);
    expect(up.intent.settingsToggle).toBe(false);
    const again = pollGamepad(pad([0, 0, 0, 0], [9]), up.edges, "perform", 2000);
    expect(again.intent.settingsToggle).toBe(true); // a fresh tap toggles back
  });

  it("a hold crosses into the photo frame exactly once, at the line", () => {
    const frames = press([9], [1000, 1000 + PAD_PHOTO_LONG_PRESS_MS - 1, 1000 + PAD_PHOTO_LONG_PRESS_MS, 2000]);
    expect(frames[0]!.settingsToggle).toBe(true); // the tap that begins the hold opens settings
    expect(frames[0]!.photoMode).toBe(false);
    expect(frames[1]!.photoMode).toBe(false); // one ms short of the line: still just a tap
    expect(frames[2]!.photoMode).toBe(true); // the crossing frame
    expect(frames[2]!.settingsToggle).toBe(false);
    expect(frames[3]!.photoMode).toBe(false); // held past the line: no machine-gun
  });

  it("releasing before the line is a pure settings tap — no photo, ever", () => {
    let edges: GamepadEdges = IDLE_GAMEPAD_EDGES;
    const t0 = 5000;
    const down = pollGamepad(pad([0, 0, 0, 0], [9]), edges, "perform", t0);
    edges = down.edges;
    const mid = pollGamepad(pad([0, 0, 0, 0], [9]), edges, "perform", t0 + PAD_PHOTO_LONG_PRESS_MS - 50);
    edges = mid.edges;
    const up = pollGamepad(pad([0, 0, 0, 0], []), edges, "perform", t0 + PAD_PHOTO_LONG_PRESS_MS + 500);
    expect(down.intent.settingsToggle).toBe(true);
    expect(mid.intent.photoMode).toBe(false);
    expect(up.intent.photoMode).toBe(false);
    expect(up.edges.menuHeldSince).toBe(0); // the hold clock resets with the button
    expect(up.edges.menuFiredPhoto).toBe(false);
  });

  it("every family gets the same share through its own profile — the button is the profile's rightMenu", () => {
    const ids: Array<[string, string]> = [
      ["DualSense Wireless Controller (Vendor: 054c Product: 0ce6)", "playstation"],
      ["Xbox Wireless Controller (Vendor: 045e Product: 0b13)", "xbox"],
      ["Pro Controller (Vendor: 057e Product: 2009)", "switch"],
      ["8BitDo Pro 2 (Vendor: 2dc8 Product: 6001)", "generic"],
    ];
    for (const [id, family] of ids) {
      const profile = classifyGamepadId(id);
      expect(profile.family).toBe(family);
      const tap = press([9], [100], profile);
      expect(tap[0]!.settingsToggle).toBe(true);
      expect(tap[0]!.photoMode).toBe(false);
      const hold = press([9], [100, 100 + PAD_PHOTO_LONG_PRESS_MS], profile);
      expect(hold[1]!.photoMode).toBe(true);
      /* …and with no profile at all, the bindings fallback reads
       * the identical button (PAD_MENU_BUTTON). */
      const bare = press([9], [100]);
      expect(bare[0]!.settingsToggle).toBe(true);
    }
  });
});
