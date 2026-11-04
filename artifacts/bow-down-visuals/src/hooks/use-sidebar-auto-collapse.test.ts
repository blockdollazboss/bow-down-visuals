import { describe, expect, it } from "vitest";
import {
  SidebarAutoCollapseController,
  SIDEBAR_AUTO_COLLAPSE_DELAY_MS,
  SIDEBAR_INTERACTION_GRACE_MS,
} from "./use-sidebar-auto-collapse";

/**
 * QC-200 fix #3 pins: the sidebar auto-collapse must never fire out
 * from under an active user. Deterministic harness — the controller
 * takes an injected clock + scheduler, so no fake-timer magic.
 */
function createHarness() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    advance: (ms: number) => {
      const target = now + ms;
      for (;;) {
        let dueId = -1;
        let dueAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= target && t.at < dueAt) {
            dueAt = t.at;
            dueId = id;
          }
        }
        if (dueId === -1) break;
        const t = timers.get(dueId)!;
        timers.delete(dueId);
        now = t.at;
        t.fn();
      }
      now = target;
    },
  };
}

function createController() {
  const harness = createHarness();
  let collapses = 0;
  const controller = new SidebarAutoCollapseController({
    onCollapse: () => {
      collapses += 1;
    },
    now: harness.now,
    setTimer: harness.setTimer,
    clearTimer: harness.clearTimer,
  });
  return { harness, controller, collapses: () => collapses };
}

describe("SidebarAutoCollapseController", () => {
  it("collapses once after the delay when the user never engages", () => {
    const { harness, controller, collapses } = createController();
    controller.start();
    harness.advance(SIDEBAR_AUTO_COLLAPSE_DELAY_MS - 1);
    expect(collapses()).toBe(0);
    harness.advance(1);
    expect(collapses()).toBe(1);
    harness.advance(60_000);
    expect(collapses()).toBe(1);
  });

  it("never fires while the pointer is over the sidebar, then restarts the full delay", () => {
    const { harness, controller, collapses } = createController();
    controller.start();
    controller.setHovered(true);
    harness.advance(120_000);
    expect(collapses()).toBe(0);
    controller.setHovered(false);
    harness.advance(SIDEBAR_AUTO_COLLAPSE_DELAY_MS - 1);
    expect(collapses()).toBe(0);
    harness.advance(1);
    expect(collapses()).toBe(1);
  });

  it("never fires while focus is inside the sidebar (e.g. the search box)", () => {
    const { harness, controller, collapses } = createController();
    controller.start();
    harness.advance(1000);
    controller.setFocused(true);
    harness.advance(120_000);
    expect(collapses()).toBe(0);
    controller.setFocused(false);
    harness.advance(SIDEBAR_AUTO_COLLAPSE_DELAY_MS);
    expect(collapses()).toBe(1);
  });

  it("hover released before the deadline still restarts the full delay", () => {
    const { harness, controller, collapses } = createController();
    controller.start();
    controller.setHovered(true);
    harness.advance(1000);
    controller.setHovered(false);
    // Original mount deadline (3000) passes with no fire: leaving the
    // sidebar at t=1000 moved the deadline to t=4000.
    harness.advance(2000);
    expect(collapses()).toBe(0);
    harness.advance(999);
    expect(collapses()).toBe(0);
    harness.advance(1);
    expect(collapses()).toBe(1);
  });

  it("an interaction inside the sidebar opens the grace window", () => {
    const { harness, controller, collapses } = createController();
    controller.start();
    harness.advance(SIDEBAR_AUTO_COLLAPSE_DELAY_MS - 100);
    controller.noteInteraction();
    harness.advance(100);
    expect(collapses()).toBe(0);
    harness.advance(SIDEBAR_INTERACTION_GRACE_MS - 101);
    expect(collapses()).toBe(0);
    harness.advance(1);
    expect(collapses()).toBe(1);
  });

  it("a manual toggle cancels the auto-collapse for the session", () => {
    const { harness, controller, collapses } = createController();
    controller.start();
    harness.advance(1000);
    controller.noteManualToggle();
    harness.advance(300_000);
    expect(collapses()).toBe(0);
  });

  it("stop() disarms a pending collapse (unmount)", () => {
    const { harness, controller, collapses } = createController();
    controller.start();
    harness.advance(1000);
    controller.stop();
    harness.advance(300_000);
    expect(collapses()).toBe(0);
  });

  it("hover and focus are independent holds — both must clear", () => {
    const { harness, controller, collapses } = createController();
    controller.start();
    controller.setHovered(true);
    controller.setFocused(true);
    controller.setHovered(false);
    harness.advance(120_000);
    expect(collapses()).toBe(0);
    controller.setFocused(false);
    harness.advance(SIDEBAR_AUTO_COLLAPSE_DELAY_MS);
    expect(collapses()).toBe(1);
  });
});
