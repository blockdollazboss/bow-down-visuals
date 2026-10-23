import { describe, it, expect } from "vitest";
import {
  PLATFORM_FEE_BPS,
  TIER_FEE_BPS,
  feeSplit,
  feeSplitForTier,
  bpsToPct,
  formatUsd,
  meetsTier,
  tierFromLegacyPlan,
  breakEvenSalesUsd,
  monthlySavingsUsd,
  TIER_PLANS,
} from "../platform-fees";

describe("platform-fees: single source of truth", () => {
  it("base fee is 10% (matches the existing storefront fee)", () => {
    expect(PLATFORM_FEE_BPS).toBe(1000);
    expect(bpsToPct(PLATFORM_FEE_BPS)).toBe("10%");
  });

  it("feeSplit rounds half-up and reconciles exactly", () => {
    const s = feeSplit(1000); // $10.00
    expect(s).toEqual({ gross: 1000, fee: 100, net: 900, feeBps: 1000 });
    const odd = feeSplit(333); // $3.33 → fee 33.3 → 33
    expect(odd.fee + odd.net).toBe(odd.gross);
    expect(odd.fee).toBe(33);
    const zero = feeSplit(0);
    expect(zero).toEqual({ gross: 0, fee: 0, net: 0, feeBps: 1000 });
  });

  it("every tier fee reconciles: fee + net === gross", () => {
    for (const tier of ["free", "pro", "elite"] as const) {
      for (const cents of [1, 99, 100, 333, 1999, 100_000]) {
        const s = feeSplitForTier(cents, tier);
        expect(s.fee + s.net).toBe(s.gross);
        expect(s.feeBps).toBe(TIER_FEE_BPS[tier]);
      }
    }
  });

  it("tier fees are the flat 5% the checkout rails charge on every tier (Stack-28 #4)", () => {
    expect(TIER_FEE_BPS).toEqual({ free: 500, pro: 500, elite: 500 });
  });

  it("meetsTier ranks correctly", () => {
    expect(meetsTier("free", "free")).toBe(true);
    expect(meetsTier("free", "pro")).toBe(false);
    expect(meetsTier("pro", "pro")).toBe(true);
    expect(meetsTier("pro", "elite")).toBe(false);
    expect(meetsTier("elite", "pro")).toBe(true);
  });

  it("legacy plan names map up, never down", () => {
    expect(tierFromLegacyPlan("Pro Artist")).toBe("pro");
    expect(tierFromLegacyPlan("Studio")).toBe("pro");
    expect(tierFromLegacyPlan("VIP")).toBe("elite");
    expect(tierFromLegacyPlan("MVP")).toBe("elite");
    expect(tierFromLegacyPlan("Creator")).toBe("free");
    expect(tierFromLegacyPlan(null)).toBe("free");
  });

  it("the tier catalog sells no stars — rank is earned, never a tier perk", () => {
    for (const p of TIER_PLANS) {
      expect(p).not.toHaveProperty("maxStars");
      for (const f of p.features) {
        expect(f.label).not.toMatch(/stars? \d/i);
      }
    }
  });

  it("pays-for-itself math: no tier fee savings exist at the flat 5% (Stack-28 #4)", () => {
    expect(breakEvenSalesUsd("pro")).toBeNull();
    expect(breakEvenSalesUsd("elite")).toBeNull();
  });

  it("monthly savings: every tier pays the same 5%, so fee savings are $0 (Stack-28 #4)", () => {
    expect(monthlySavingsUsd("pro", 1000)).toBe(0);
    expect(monthlySavingsUsd("elite", 1000)).toBe(0);
  });

  it("formatUsd never leaks Visual Bucs copy", () => {
    expect(formatUsd(1299)).toBe("$12.99");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("tier catalog carries honest fee data for every tier", () => {
    for (const p of TIER_PLANS) {
      expect(p.feeBps).toBe(TIER_FEE_BPS[p.tier]);
      expect(p.features.length).toBeGreaterThan(3);
      for (const f of p.features) {
        expect(f.detailsUrl.length).toBeGreaterThan(0);
      }
    }
  });
});
