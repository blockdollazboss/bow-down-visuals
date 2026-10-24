/**
 * Product-review presentation math (Stack-100 #3, #14): star slots,
 * average labels, distribution shares. These mirror the API summary
 * exactly — a page must never show a different average than the
 * server computed from the same reviews.
 */
import { describe, it, expect } from "vitest";
import {
  starsFor, averageLabel, distributionPct, summarizeVisible, flagReasonLabel, EMPTY_SUMMARY,
} from "./product-reviews";

describe("starsFor", () => {
  it("integer ratings fill exactly that many stars", () => {
    expect(starsFor(5)).toEqual(["full", "full", "full", "full", "full"]);
    expect(starsFor(1)).toEqual(["full", "empty", "empty", "empty", "empty"]);
    expect(starsFor(3)).toEqual(["full", "full", "full", "empty", "empty"]);
  });

  it("fractional averages use half steps at the boundary", () => {
    expect(starsFor(3.3)).toEqual(["full", "full", "full", "half", "empty"]);
    expect(starsFor(4.8)).toEqual(["full", "full", "full", "full", "full"]);
    expect(starsFor(4.6)).toEqual(["full", "full", "full", "full", "half"]);
  });

  it("null / out-of-range averages render an empty row, never a fake score", () => {
    expect(starsFor(null)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
    expect(starsFor(0)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
    expect(starsFor(99)).toEqual(["full", "full", "full", "full", "full"]);
  });
});

describe("summary mirror", () => {
  it("matches the server math: one-decimal average over visible reviews", () => {
    const s = summarizeVisible([{ rating: 5 }, { rating: 4 }, { rating: 1 }]);
    expect(s.count).toBe(3);
    expect(s.average).toBe(3.3);
    expect(s.distribution).toEqual({ "1": 1, "2": 0, "3": 0, "4": 1, "5": 1 });
    expect(averageLabel(s)).toBe("3.3");
    expect(distributionPct(s, 5)).toBe(33);
  });

  it("the empty state has no average and no shares", () => {
    expect(averageLabel(EMPTY_SUMMARY)).toBeNull();
    expect(distributionPct(EMPTY_SUMMARY, 5)).toBe(0);
    expect(summarizeVisible([]).average).toBeNull();
  });
});

describe("flag vocabulary", () => {
  it("labels known reasons and never invents a 'negative review' reason", () => {
    expect(flagReasonLabel("spam")).toBe("Spam or advertising");
    expect(flagReasonLabel("negative")).toBe("Flagged for moderation");
    expect(flagReasonLabel(null)).toBe("Flagged for moderation");
  });
});
