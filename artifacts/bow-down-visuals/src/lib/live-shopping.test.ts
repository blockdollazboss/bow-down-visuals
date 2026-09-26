import { describe, expect, it } from "vitest";
import {
  buildAlertText,
  feeBreakdown,
  formatPrice,
  parsePriceToCents,
  platformFeeCents,
  LIVE_SHOPPING_FEE_BPS,
} from "./live-shopping";

describe("LIVE_SHOPPING_FEE_BPS", () => {
  it("is 5% in basis points, matching the server", () => {
    expect(LIVE_SHOPPING_FEE_BPS).toBe(500);
  });
});

describe("formatPrice", () => {
  it("formats cents as dollars", () => {
    expect(formatPrice(2499)).toBe("$24.99");
    expect(formatPrice(100)).toBe("$1.00");
    expect(formatPrice(0)).toBe("$0.00");
  });
});

describe("parsePriceToCents", () => {
  it("parses dollar strings to whole cents", () => {
    expect(parsePriceToCents("24.99")).toBe(2499);
    expect(parsePriceToCents(" 5 ")).toBe(500);
    expect(parsePriceToCents("0")).toBe(0);
  });

  it("returns NaN for invalid input", () => {
    expect(parsePriceToCents("")).toBeNaN();
    expect(parsePriceToCents("abc")).toBeNaN();
    expect(parsePriceToCents("-5")).toBeNaN();
  });
});

describe("platformFeeCents", () => {
  it("computes the 5% fee, rounding half-up", () => {
    expect(platformFeeCents(10000)).toBe(500);
    expect(platformFeeCents(99)).toBe(5);
    expect(platformFeeCents(10)).toBe(1);
  });
});

describe("feeBreakdown", () => {
  it("renders a readable fee line", () => {
    expect(feeBreakdown(2499)).toBe("5% of $24.99 = $1.25");
  });
});

describe("buildAlertText", () => {
  it("builds the overlay alert headline", () => {
    expect(buildAlertText("Maya", 2, 4998)).toBe("Maya bought 2× — $49.98");
  });

  it("falls back to 'A viewer' for blank names", () => {
    expect(buildAlertText("   ", 1, 2499)).toBe("A viewer bought 1× — $24.99");
  });
});
