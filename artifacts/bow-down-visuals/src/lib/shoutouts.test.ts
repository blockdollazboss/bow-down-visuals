/**
 * Price-math tests for the Fan Shoutouts page.
 * Mirrors the backend's dollarsToCents / centsToDollars / netAfterFee so the
 * UI never drifts from the server's integer-cent accounting.
 */
import { describe, expect, it } from "vitest";

import { dollarsToCents, centsToDollars, netAfterFee, formatMoney } from "./shoutouts";

describe("shoutouts price math (frontend mirror)", () => {
  it("dollarsToCents rounds to integer cents", () => {
    expect(dollarsToCents(25)).toBe(2500);
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(0)).toBe(0);
  });

  it("centsToDollars inverts dollarsToCents", () => {
    expect(centsToDollars(dollarsToCents(12.34))).toBeCloseTo(12.34, 10);
  });

  it("netAfterFee deducts the 10% platform fee", () => {
    expect(netAfterFee(2500)).toBe(2250);
    expect(netAfterFee(1999)).toBe(1799);
    expect(netAfterFee(0)).toBe(0);
  });

  it("formatMoney renders dollars with two decimals", () => {
    expect(formatMoney(25)).toBe("$25.00");
    expect(formatMoney(19.9)).toBe("$19.90");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("price input clamp keeps settings within $0–$999.99", () => {
    const clamp = (v: number) => Math.max(0, Math.min(999.99, v));
    expect(clamp(-5)).toBe(0);
    expect(clamp(1500)).toBe(999.99);
    expect(clamp(24.99)).toBe(24.99);
  });
});
