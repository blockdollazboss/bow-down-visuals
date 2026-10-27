/**
 * Thumbnail Duels (#174) — pure rules. Resolution is mechanical: real
 * counts only, a duel resolves at/over the view target only when one cover
 * strictly leads on clicks, and results always carry the raw numbers.
 */
import { describe, it, expect } from "vitest";
import {
  pickDuelCover,
  duelOutcome,
  duelResultsView,
  clampDuelTargetViews,
  DUEL_TARGET_VIEWS_MIN,
  DUEL_TARGET_VIEWS_MAX,
  DUEL_TARGET_VIEWS_DEFAULT,
} from "../thumbnail-duels";

describe("thumbnail-duels rotation", () => {
  it("serves the cover with fewer views; ties start with A", () => {
    expect(pickDuelCover({ viewsA: 0, viewsB: 0 })).toBe("a");
    expect(pickDuelCover({ viewsA: 1, viewsB: 0 })).toBe("b");
    expect(pickDuelCover({ viewsA: 1, viewsB: 1 })).toBe("a");
    expect(pickDuelCover({ viewsA: 5, viewsB: 9 })).toBe("a");
    expect(pickDuelCover({ viewsA: 9, viewsB: 5 })).toBe("b");
  });
});

describe("thumbnail-duels outcome", () => {
  const base = { viewsA: 60, viewsB: 60, clicksA: 10, clicksB: 4, targetViews: 100 };

  it("does not resolve below the view target even with a click leader", () => {
    const out = duelOutcome({ ...base, viewsA: 40, viewsB: 40 });
    expect(out.resolved).toBe(false);
    expect(out.winner).toBeNull();
    expect(out.totalViews).toBe(80);
  });

  it("resolves at the target when one cover strictly leads on clicks", () => {
    const out = duelOutcome(base);
    expect(out.resolved).toBe(true);
    expect(out.winner).toBe("a");
    expect(duelOutcome({ ...base, clicksA: 2, clicksB: 9 }).winner).toBe("b");
  });

  it("a click tie at/over the target keeps the duel running", () => {
    const out = duelOutcome({ ...base, clicksA: 7, clicksB: 7 });
    expect(out.resolved).toBe(false);
    expect(out.winner).toBeNull();
  });
});

describe("thumbnail-duels results view", () => {
  it("always carries raw counts; percentages ride along, never alone", () => {
    const view = duelResultsView({ viewsA: 50, viewsB: 50, clicksA: 5, clicksB: 10, targetViews: 100 });
    expect(view.viewsA).toBe(50);
    expect(view.viewsB).toBe(50);
    expect(view.clicksA).toBe(5);
    expect(view.clicksB).toBe(10);
    expect(view.totalViews).toBe(100);
    expect(view.totalClicks).toBe(15);
    expect(view.clickRateA).toBe(10);
    expect(view.clickRateB).toBe(20);
  });

  it("zero views read as 0% rates, not NaN", () => {
    const view = duelResultsView({ viewsA: 0, viewsB: 0, clicksA: 0, clicksB: 0, targetViews: 100 });
    expect(view.clickRateA).toBe(0);
    expect(view.clickRateB).toBe(0);
  });
});

describe("thumbnail-duels target clamping", () => {
  it("clamps into the allowed band and defaults junk input", () => {
    expect(clampDuelTargetViews(5)).toBe(DUEL_TARGET_VIEWS_MIN);
    expect(clampDuelTargetViews(999999)).toBe(DUEL_TARGET_VIEWS_MAX);
    expect(clampDuelTargetViews(250.6)).toBe(251);
    expect(clampDuelTargetViews(undefined)).toBe(DUEL_TARGET_VIEWS_DEFAULT);
    expect(clampDuelTargetViews("lots")).toBe(DUEL_TARGET_VIEWS_DEFAULT);
    expect(clampDuelTargetViews(Number.NaN)).toBe(DUEL_TARGET_VIEWS_DEFAULT);
  });
});
