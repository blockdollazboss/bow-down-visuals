import { describe, it, expect } from "vitest";
import {
  normalizeWatchProgress,
  normalizeLoyaltyState,
  pendingRedemptionsFromPayload,
} from "./reach-watch";

/* DTO guard batch #2 — partial reach payloads must degrade to the
   panels' honest states, never crash render or invent numbers. */

const goodProgress = {
  secondsWatched: 600,
  thresholds: [{ seconds: 300, amountVb: 50, earned: true, progressSeconds: 300 }],
  weeklyBudget: { capVb: 1000, spentVb: 200, remainingVb: 800 },
  budgetReached: false,
};

describe("normalizeWatchProgress", () => {
  it("passes a complete payload through with its real numbers", () => {
    const p = normalizeWatchProgress(goodProgress);
    expect(p?.thresholds).toHaveLength(1);
    expect(p?.weeklyBudget.remainingVb).toBe(800);
  });
  it("returns null when thresholds or the budget is missing (no fake budget line)", () => {
    expect(normalizeWatchProgress({ weeklyBudget: goodProgress.weeklyBudget })).toBeNull();
    expect(normalizeWatchProgress({ thresholds: [] })).toBeNull();
    expect(normalizeWatchProgress({ thresholds: [], weeklyBudget: { capVb: 100 } })).toBeNull();
    expect(normalizeWatchProgress(null)).toBeNull();
    expect(normalizeWatchProgress("nope")).toBeNull();
  });
  it("drops reward rows whose numbers are not real, keeps the honest ones", () => {
    const p = normalizeWatchProgress({
      ...goodProgress,
      thresholds: [
        { seconds: 300, amountVb: 50, earned: false, progressSeconds: 12 },
        { seconds: "soon", amountVb: 999 },
        null,
      ],
    });
    expect(p?.thresholds).toHaveLength(1);
    expect(p?.thresholds[0]?.progressSeconds).toBe(12);
  });
});

describe("normalizeLoyaltyState", () => {
  it("normalizes perks/redemptions and keeps the real points balance", () => {
    const s = normalizeLoyaltyState({
      profileId: "p1",
      enabled: true,
      myPoints: 250,
      perks: [{ kind: "shoutout", label: "Shout-out", cost: 100 }, { kind: 7, label: "bad" }],
      myRedemptions: [{ id: "r1", perkKind: "shoutout", perkLabel: "Shout-out", pointsCost: 100, status: "pending", createdAt: null }],
      notice: "Points are this channel's own.",
    });
    expect(s?.myPoints).toBe(250);
    expect(s?.perks).toHaveLength(1);
    expect(s?.myRedemptions).toHaveLength(1);
  });
  it("returns null when the balance is not a real number (never invents points)", () => {
    expect(normalizeLoyaltyState({ enabled: true, perks: [] })).toBeNull();
    expect(normalizeLoyaltyState({})).toBeNull();
    expect(normalizeLoyaltyState(undefined)).toBeNull();
  });
  it("missing perk/redemption lists become empty lists, not a crash", () => {
    const s = normalizeLoyaltyState({ enabled: true, myPoints: 0 });
    expect(s?.perks).toEqual([]);
    expect(s?.myRedemptions).toEqual([]);
  });
});

describe("pendingRedemptionsFromPayload", () => {
  it("keeps only pending rows", () => {
    const rows = pendingRedemptionsFromPayload({
      redemptions: [
        { id: "a", perkLabel: "Shout-out", pointsCost: 100, status: "pending" },
        { id: "b", perkLabel: "Song pick", pointsCost: 200, status: "fulfilled" },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });
  it("a payload missing the list is the honest empty queue", () => {
    expect(pendingRedemptionsFromPayload({})).toEqual([]);
    expect(pendingRedemptionsFromPayload(null)).toEqual([]);
  });
});
