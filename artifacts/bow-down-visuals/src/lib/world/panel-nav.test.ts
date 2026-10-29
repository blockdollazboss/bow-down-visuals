import { describe, expect, it } from "vitest";
import type { GamepadLike } from "./gamepad";
import {
  IDLE_PANEL_PAD_EDGES,
  PANEL_FOCUSABLE_SELECTOR,
  nextPanelFocusIndex,
  pollPanelPad,
} from "./panel-nav";

/* Panel pad navigation (stack700) — the poll that lets a
 * controller WORK an in-world panel: move, confirm, back. The
 * owner hit the missing layer live (2026-10-29): the pad could
 * open a panel (LB at a prompt) but not one control inside it
 * answered the pad. These pins hold the poll's edge discipline
 * to the same standard as the scene's: a held control speaks
 * once, the stick re-arms only after returning to centre, and a
 * vanished pad never replays a stale press. */

function pad(buttonsDown: number[] = [], axes: number[] = [0, 0]): GamepadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: buttonsDown.includes(i) }));
  return { buttons, axes };
}

describe("pollPanelPad — moves", () => {
  it("D-pad down/right move forward, up/left move back — edges only", () => {
    const down = pollPanelPad(pad([13]), IDLE_PANEL_PAD_EDGES);
    expect(down.intent.move).toBe(1);
    const held = pollPanelPad(pad([13]), down.edges);
    expect(held.intent.move).toBe(0);
    const right = pollPanelPad(pad([15]), IDLE_PANEL_PAD_EDGES);
    expect(right.intent.move).toBe(1);
    const up = pollPanelPad(pad([12]), IDLE_PANEL_PAD_EDGES);
    expect(up.intent.move).toBe(-1);
    const left = pollPanelPad(pad([14]), IDLE_PANEL_PAD_EDGES);
    expect(left.intent.move).toBe(-1);
  });

  it("the stick speaks once per push past the line and re-arms at centre", () => {
    const pushed = pollPanelPad(pad([], [0, 0.9]), IDLE_PANEL_PAD_EDGES);
    expect(pushed.intent.move).toBe(1);
    const held = pollPanelPad(pad([], [0, 0.9]), pushed.edges);
    expect(held.intent.move).toBe(0);
    const centred = pollPanelPad(pad([], [0, 0.1]), held.edges);
    const again = pollPanelPad(pad([], [0, -0.9]), centred.edges);
    expect(again.intent.move).toBe(-1);
    const sideways = pollPanelPad(pad([], [0.9, 0]), IDLE_PANEL_PAD_EDGES);
    expect(sideways.intent.move).toBe(1);
  });

  it("a resting stick under the threshold never moves the selection", () => {
    expect(pollPanelPad(pad([], [0.3, -0.4]), IDLE_PANEL_PAD_EDGES).intent.move).toBe(0);
    expect(pollPanelPad(pad([], [0, 0]), IDLE_PANEL_PAD_EDGES).intent.move).toBe(0);
  });
});

describe("pollPanelPad — confirm and back", () => {
  it("A confirms on the edge; B goes back on the edge; held buttons never repeat", () => {
    const a = pollPanelPad(pad([0]), IDLE_PANEL_PAD_EDGES);
    expect(a.intent.confirm).toBe(true);
    expect(a.intent.back).toBe(false);
    expect(pollPanelPad(pad([0]), a.edges).intent.confirm).toBe(false);
    const b = pollPanelPad(pad([1]), IDLE_PANEL_PAD_EDGES);
    expect(b.intent.back).toBe(true);
    expect(b.intent.confirm).toBe(false);
    expect(pollPanelPad(pad([1]), b.edges).intent.back).toBe(false);
  });

  it("the scene's buttons steal nothing here: LB, Back, Start and the triggers stay silent", () => {
    for (const btn of [4, 5, 6, 7, 8, 9, 10, 11]) {
      const { intent } = pollPanelPad(pad([btn]), IDLE_PANEL_PAD_EDGES);
      expect(intent).toEqual({ move: 0, confirm: false, back: false });
    }
  });

  it("a null pad answers idle and resets the edges — a reconnect replays nothing", () => {
    const down = pollPanelPad(pad([0, 13]), IDLE_PANEL_PAD_EDGES);
    const gone = pollPanelPad(null, down.edges);
    expect(gone.intent).toEqual({ move: 0, confirm: false, back: false });
    expect(gone.edges).toEqual(IDLE_PANEL_PAD_EDGES);
    const backAgain = pollPanelPad(pad([0, 13]), gone.edges);
    expect(backAgain.intent.confirm).toBe(true);
    expect(backAgain.intent.move).toBe(1);
  });
});

describe("nextPanelFocusIndex — the wrap", () => {
  it("walks and wraps both ways", () => {
    expect(nextPanelFocusIndex(0, 3, 1)).toBe(1);
    expect(nextPanelFocusIndex(2, 3, 1)).toBe(0);
    expect(nextPanelFocusIndex(0, 3, -1)).toBe(2);
  });

  it("from no selection, forward lands on the first control and backward on the last", () => {
    expect(nextPanelFocusIndex(-1, 4, 1)).toBe(0);
    expect(nextPanelFocusIndex(-1, 4, -1)).toBe(3);
  });

  it("an empty panel has no seat; a zero move changes nothing", () => {
    expect(nextPanelFocusIndex(-1, 0, 1)).toBe(-1);
    expect(nextPanelFocusIndex(2, 0, -1)).toBe(-1);
    expect(nextPanelFocusIndex(1, 3, 0)).toBe(1);
  });
});

describe("the focusable set", () => {
  it("reaches exactly the keyboard's set, minus the disabled", () => {
    expect(PANEL_FOCUSABLE_SELECTOR).toContain("button:not([disabled])");
    expect(PANEL_FOCUSABLE_SELECTOR).toContain("a[href]");
    expect(PANEL_FOCUSABLE_SELECTOR).toContain("input:not([disabled])");
    expect(PANEL_FOCUSABLE_SELECTOR).toContain("select:not([disabled])");
    expect(PANEL_FOCUSABLE_SELECTOR).toContain("textarea:not([disabled])");
  });
});
