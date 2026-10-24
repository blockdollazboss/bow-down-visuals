/**
 * Order bumps (Stack-100 #3, feature #13) — pure money math + target
 * validation. These pin the invariants the whole feature stands on:
 * the flat 5% story never changes, per-line splits always sum exactly
 * to the session totals, and the no-bump path is byte-identical to the
 * pre-bump rail.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_BUMP_PERCENT_OFF,
  readBumpConfig,
  validateBumpTarget,
  bumpUnitCents,
  splitOrderAmounts,
} from "../order-bumps";
import { feeSplit, PLATFORM_FEE_BPS } from "../platform-fees";

const MAIN = { id: "11111111-1111-4111-8111-111111111111", profileId: "22222222-2222-4222-8222-222222222222" };
const TARGET = {
  id: "33333333-3333-4333-8333-333333333333",
  profileId: MAIN.profileId,
  priceCents: 1500,
  isActive: true,
  inventory: -1,
};

describe("readBumpConfig", () => {
  it("reads the raw SQL row shape", () => {
    expect(readBumpConfig({ bump_product_id: TARGET.id, bump_percent_off: 20 }))
      .toEqual({ bumpProductId: TARGET.id, percentOff: 20 });
  });
  it("reads the camelCase shape and defaults percent to 0", () => {
    expect(readBumpConfig({ bumpProductId: TARGET.id }))
      .toEqual({ bumpProductId: TARGET.id, percentOff: 0 });
  });
  it("returns null when the columns are absent (pre-migration rows)", () => {
    expect(readBumpConfig({ id: MAIN.id, price_cents: 100 })).toBeNull();
    expect(readBumpConfig(null)).toBeNull();
    expect(readBumpConfig(undefined)).toBeNull();
  });
  it("returns null for malformed values instead of throwing", () => {
    expect(readBumpConfig({ bump_product_id: "not-a-uuid", bump_percent_off: 10 })).toBeNull();
    expect(readBumpConfig({ bump_product_id: TARGET.id, bump_percent_off: 91 })).toBeNull();
    expect(readBumpConfig({ bump_product_id: TARGET.id, bump_percent_off: -1 })).toBeNull();
    expect(readBumpConfig({ bump_product_id: TARGET.id, bump_percent_off: 12.5 })).toBeNull();
    expect(readBumpConfig({ bump_product_id: TARGET.id, bump_percent_off: "abc" })).toBeNull();
  });
});

describe("validateBumpTarget", () => {
  it("accepts a normal same-seller priced target", () => {
    expect(validateBumpTarget(MAIN, TARGET)).toEqual({ ok: true });
  });
  it("rejects the product itself", () => {
    expect(validateBumpTarget(MAIN, { ...TARGET, id: MAIN.id }).ok).toBe(false);
    expect(validateBumpTarget(MAIN, { ...TARGET, id: MAIN.id })).toMatchObject({ code: "BUMP_SELF" });
  });
  it("rejects another seller's product", () => {
    expect(validateBumpTarget(MAIN, { ...TARGET, profileId: "99999999-9999-4999-8999-999999999999" }))
      .toMatchObject({ ok: false, code: "BUMP_OTHER_SELLER" });
  });
  it("rejects inactive, free and sold-out targets", () => {
    expect(validateBumpTarget(MAIN, { ...TARGET, isActive: false })).toMatchObject({ code: "BUMP_INACTIVE" });
    expect(validateBumpTarget(MAIN, { ...TARGET, priceCents: 0 })).toMatchObject({ code: "BUMP_FREE" });
    expect(validateBumpTarget(MAIN, { ...TARGET, inventory: 0 })).toMatchObject({ code: "BUMP_SOLD_OUT" });
  });
  it("accepts a target with exactly 1 left in stock", () => {
    expect(validateBumpTarget(MAIN, { ...TARGET, inventory: 1 })).toEqual({ ok: true });
  });
});

describe("bumpUnitCents", () => {
  it("is the seller-set price at 0% off", () => {
    expect(bumpUnitCents(1500, 0)).toBe(1500);
  });
  it("applies the seller-set percent off, rounded to the cent", () => {
    expect(bumpUnitCents(1500, 20)).toBe(1200);
    expect(bumpUnitCents(999, 33)).toBe(669);
    expect(bumpUnitCents(101, 50)).toBe(51);
  });
  it("never rounds a priced product down to a $0 line", () => {
    expect(bumpUnitCents(1, MAX_BUMP_PERCENT_OFF)).toBe(1);
    expect(bumpUnitCents(5, 90)).toBe(1);
  });
  it("clamps out-of-range percents", () => {
    expect(bumpUnitCents(1000, 140)).toBe(bumpUnitCents(1000, MAX_BUMP_PERCENT_OFF));
    expect(bumpUnitCents(1000, -5)).toBe(1000);
  });
  it("a free product prices at 0 (validation refuses it upstream)", () => {
    expect(bumpUnitCents(0, 50)).toBe(0);
  });
});

describe("splitOrderAmounts", () => {
  it("no bump: identical to the rail's existing feeSplit on the total", () => {
    for (const total of [1, 99, 100, 101, 1299, 12345, 999999]) {
      const s = splitOrderAmounts(total, 0);
      const base = feeSplit(total, PLATFORM_FEE_BPS);
      expect(s.bump).toBeNull();
      expect(s.main).toEqual({ grossCents: base.gross, feeCents: base.fee, creatorCents: base.net });
      expect(s.totalFeeCents).toBe(base.fee);
      expect(s.feeBps).toBe(PLATFORM_FEE_BPS);
    }
  });
  it("with bump: lines sum exactly to the session totals", () => {
    const cases: Array<[number, number]> = [
      [2500, 1200], [101, 1], [999, 669], [10000, 3333], [7, 3], [50, 49],
    ];
    for (const [total, bump] of cases) {
      const s = splitOrderAmounts(total, bump);
      expect(s.bump).not.toBeNull();
      expect(s.main.grossCents + s.bump!.grossCents).toBe(s.totalGrossCents);
      expect(s.main.feeCents + s.bump!.feeCents).toBe(s.totalFeeCents);
      expect(s.main.creatorCents + s.bump!.creatorCents).toBe(s.totalCreatorCents);
      expect(s.totalFeeCents).toBe(feeSplit(total, PLATFORM_FEE_BPS).fee);
      expect(s.bump!.feeCents).toBe(feeSplit(bump, PLATFORM_FEE_BPS).fee);
      for (const line of [s.main, s.bump!]) {
        expect(line.grossCents - line.feeCents).toBe(line.creatorCents);
        expect(line.feeCents).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it("the main line absorbs the rounding remainder (odd-cent case)", () => {
    /* total 101: session fee = round(101*5%) = 5. bump 1: fee round(0.05)=0.
       main must carry 5 so the lines still sum to the session fee. */
    const s = splitOrderAmounts(101, 1);
    expect(s.totalFeeCents).toBe(5);
    expect(s.bump!.feeCents).toBe(0);
    expect(s.main.feeCents).toBe(5);
    expect(s.main.grossCents).toBe(100);
  });
  it("a bump gross larger than the total is clamped to the total", () => {
    const s = splitOrderAmounts(500, 900);
    expect(s.bump!.grossCents).toBe(500);
    expect(s.main.grossCents).toBe(0);
  });
  it("zero totals stay zero", () => {
    const s = splitOrderAmounts(0, 0);
    expect(s).toMatchObject({ totalGrossCents: 0, totalFeeCents: 0, totalCreatorCents: 0, bump: null });
  });
});
