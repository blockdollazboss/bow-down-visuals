/**
 * Price-math helpers for the Fan Memberships page.
 * Mirrors the backend's dollarsToCents / centsToDollars / netAfterFee so the
 * UI never drifts from the server's integer-cent accounting.
 */
import { describe, expect, it } from "vitest";

export function dollarsToCents(d: number): number {
  return Math.round(d * 100);
}

export function centsToDollars(c: number): number {
  return c / 100;
}

export function netAfterFee(cents: number, feePct = 10): number {
  return Math.round((cents * (100 - feePct)) / 100);
}

describe("memberships price math (frontend mirror)", () => {
  it("dollarsToCents rounds to integer cents", () => {
    expect(dollarsToCents(5)).toBe(500);
    expect(dollarsToCents(4.99)).toBe(499);
    expect(dollarsToCents(0)).toBe(0);
  });

  it("centsToDollars inverts dollarsToCents", () => {
    expect(centsToDollars(dollarsToCents(12.34))).toBeCloseTo(12.34, 10);
  });

  it("netAfterFee deducts the 10% platform fee", () => {
    expect(netAfterFee(1000)).toBe(900);
    expect(netAfterFee(999)).toBe(899);
    expect(netAfterFee(0)).toBe(0);
  });

  it("price input clamp keeps tiers within $0–$999.99", () => {
    const clamp = (v: number) => Math.max(0, Math.min(999.99, v));
    expect(clamp(-5)).toBe(0);
    expect(clamp(1500)).toBe(999.99);
    expect(clamp(9.99)).toBe(9.99);
  });
});
