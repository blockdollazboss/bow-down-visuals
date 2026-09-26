import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TOUR_STEPS,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_START_EVENT,
  hasCompletedOnboarding,
  markOnboardingComplete,
  resetOnboarding,
  requestOnboardingTour,
  computeTooltipPosition,
} from "./onboarding";

/* ── step config ─────────────────────────────────────────────────────── */

describe("TOUR_STEPS", () => {
  it("has the 7 expected steps in order", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      "welcome",
      "credits",
      "make-video",
      "video-editor",
      "artist-vault",
      "explore",
      "done",
    ]);
  });

  it("gives every step a non-empty title and body", () => {
    for (const s of TOUR_STEPS) {
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(s.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses data-tour selectors for targeted steps", () => {
    const targeted = TOUR_STEPS.filter((s) => s.target);
    expect(targeted.length).toBeGreaterThan(0);
    for (const s of targeted) {
      expect(s.target).toMatch(/^\[data-tour="[\w-]+"\]$/);
    }
  });

  it("has unique step ids", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ── persistence (mocked localStorage — node env has no window) ─────── */

function installFakeStorage() {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("window", {
    localStorage: fake,
    dispatchEvent: vi.fn(),
  });
  return { store, fake };
}

describe("onboarding persistence", () => {
  beforeEach(() => installFakeStorage());
  afterEach(() => vi.unstubAllGlobals());

  it("starts uncompleted, completes, and resets", () => {
    expect(hasCompletedOnboarding()).toBe(false);
    markOnboardingComplete();
    expect(hasCompletedOnboarding()).toBe(true);
    resetOnboarding();
    expect(hasCompletedOnboarding()).toBe(false);
  });

  it("writes the bdv_onboarded flag", () => {
    const { store } = installFakeStorage();
    markOnboardingComplete();
    expect(store.get(ONBOARDING_STORAGE_KEY)).toBe("1");
  });

  it("requestOnboardingTour dispatches the start event", () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { localStorage: null, dispatchEvent: dispatch });
    requestOnboardingTour();
    expect(dispatch).toHaveBeenCalledTimes(1);
    const evt = dispatch.mock.calls[0][0] as CustomEvent;
    expect(evt.type).toBe(ONBOARDING_START_EVENT);
  });
});

/* ── tooltip placement ───────────────────────────────────────────────── */

describe("computeTooltipPosition", () => {
  const vp = { width: 1280, height: 800 };
  const tip = { width: 340, height: 220 };

  it("centers when there is no target", () => {
    const p = computeTooltipPosition(null, tip, vp);
    expect(p.anchor).toBe("center");
    expect(p.top).toBe((800 - 220) / 2);
    expect(p.left).toBe((1280 - 340) / 2);
  });

  it("prefers below the target when it fits", () => {
    const p = computeTooltipPosition(
      { top: 100, left: 100, width: 200, height: 40 },
      tip,
      vp,
    );
    expect(p.anchor).toBe("below");
    expect(p.top).toBe(100 + 40 + 14);
  });

  it("goes above when there is no room below", () => {
    const p = computeTooltipPosition(
      { top: 700, left: 100, width: 200, height: 40 },
      tip,
      vp,
    );
    expect(p.anchor).toBe("above");
    expect(p.top).toBe(700 - 220 - 14);
  });

  it("centers when neither above nor below fits", () => {
    const tall = { width: 340, height: 780 };
    const p = computeTooltipPosition(
      { top: 300, left: 100, width: 200, height: 40 },
      tall,
      vp,
    );
    expect(p.anchor).toBe("center");
  });

  it("clamps horizontally inside the viewport", () => {
    const p = computeTooltipPosition(
      { top: 100, left: 1200, width: 60, height: 40 },
      tip,
      vp,
    );
    expect(p.left + 340).toBeLessThanOrEqual(1280 - 16);
    expect(p.left).toBeGreaterThanOrEqual(16);
  });

  it("uses a bottom sheet on mobile viewports", () => {
    const mobile = { width: 390, height: 844 };
    const p = computeTooltipPosition(
      { top: 100, left: 20, width: 200, height: 40 },
      { width: 366, height: 220 },
      mobile,
    );
    expect(p.anchor).toBe("sheet");
    expect(p.left).toBe(12);
    expect(p.top).toBe(844 - 220 - 12);
  });
});
