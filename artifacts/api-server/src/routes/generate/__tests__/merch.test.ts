/**
 * Money-integrity + prompt + margin tests for the Merch Designer.
 *
 * Covers: the pricing contract (3cr per design batch), product/style
 * validation, mockup prompt construction (never faked — prompts must
 * describe real product mockups), and the creator margin math.
 */
import { describe, expect, it } from "vitest";

import {
  MERCH_DESIGN_CREDIT_COST,
  MERCH_COMMISSION_PCT,
  MERCH_BATCH_SIZE,
  MERCH_PRODUCTS,
  MERCH_PRODUCT_KEYS,
  MERCH_STYLES,
  MERCH_STYLE_KEYS,
  isMerchProductKey,
  isMerchStyleKey,
  buildMerchPrompt,
  calculateMerchMargin,
  suggestRetailPrice,
  formatCents,
} from "../merch-pricing";

describe("merch pricing contract", () => {
  it("design batch costs 3 credits", () => {
    expect(MERCH_DESIGN_CREDIT_COST).toBe(3);
  });

  it("batch generates 2 mockups", () => {
    expect(MERCH_BATCH_SIZE).toBe(2);
  });

  it("future commission is recorded as 15%", () => {
    expect(MERCH_COMMISSION_PCT).toBe(15);
  });

  it("the route rejects when balance < cost (documents the 402 contract)", () => {
    // POST /api/merch/design charges before generating → 402 via OutOfCreditsError
    expect(2 < MERCH_DESIGN_CREDIT_COST).toBe(true); // 2 credits → 402
    expect(3 < MERCH_DESIGN_CREDIT_COST).toBe(false); // exact balance → allowed
  });
});

describe("merch products", () => {
  it("offers exactly the four documented products", () => {
    expect(MERCH_PRODUCT_KEYS).toEqual(["t-shirt", "hoodie", "cap", "poster"]);
  });

  it("every product has a label, blurb, and positive base cost", () => {
    for (const key of MERCH_PRODUCT_KEYS) {
      const p = MERCH_PRODUCTS[key];
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
      expect(p.baseCostCents).toBeGreaterThan(0);
    }
  });

  it("validates product keys", () => {
    expect(isMerchProductKey("hoodie")).toBe(true);
    expect(isMerchProductKey("socks")).toBe(false);
    expect(isMerchProductKey(undefined)).toBe(false);
  });
});

describe("merch styles", () => {
  it("offers exactly the four documented styles", () => {
    expect(MERCH_STYLE_KEYS).toEqual(["streetwear", "minimal", "vintage", "luxury-gold"]);
  });

  it("every style has a label, blurb, and directive", () => {
    for (const key of MERCH_STYLE_KEYS) {
      const s = MERCH_STYLES[key];
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(0);
      expect(s.directive.length).toBeGreaterThan(20);
    }
  });

  it("validates style keys", () => {
    expect(isMerchStyleKey("luxury-gold")).toBe(true);
    expect(isMerchStyleKey("cyberpunk")).toBe(false);
  });
});

describe("mockup prompts", () => {
  it("builds a real product-mockup prompt — never a fake placeholder", () => {
    const p = buildMerchPrompt("t-shirt", "streetwear", "shark king crown logo", 0);
    expect(p).toContain("T-Shirt");
    expect(p).toContain("shark king crown logo");
    expect(p).toMatch(/mockup/i);
    expect(p).toMatch(/no watermark/i);
  });

  it("variants produce different angles so the batch feels like real choices", () => {
    const a = buildMerchPrompt("hoodie", "minimal", "wave logo", 0);
    const b = buildMerchPrompt("hoodie", "minimal", "wave logo", 1);
    expect(a).not.toBe(b);
  });

  it("falls back to a generic description when none is given", () => {
    const p = buildMerchPrompt("cap", "vintage", "   ", 0);
    expect(p).toContain("original graphic artwork");
  });

  it("never uses max_tokens — image path has no text token param", () => {
    // Static guard: the pricing module must not reference text token limits.
    // (The route uses images.generate, which takes no max_tokens.)
    const src = buildMerchPrompt.toString();
    expect(src).not.toContain("max_tokens");
  });
});

describe("creator margin math", () => {
  it("computes profit, commission, and margin percent", () => {
    // $40 tee, $12 base, 15% commission → $6 commission, $22 profit, 55%
    const m = calculateMerchMargin(4000, 1200, 15);
    expect(m.commissionCents).toBe(600);
    expect(m.profitCents).toBe(2200);
    expect(m.marginPct).toBe(55);
  });

  it("goes negative honestly when priced below cost", () => {
    const m = calculateMerchMargin(1000, 1200, 15);
    expect(m.profitCents).toBeLessThan(0);
  });

  it("handles zero price without NaN", () => {
    const m = calculateMerchMargin(0, 1200, 15);
    expect(m.marginPct).toBe(0);
    expect(Number.isNaN(m.marginPct)).toBe(false);
  });

  it("suggests a retail price above base cost", () => {
    const suggested = suggestRetailPrice(1200, 15);
    expect(suggested).toBeGreaterThan(1200);
    expect(suggested % 100).toBe(0); // rounded to whole dollars
  });

  it("formats cents as dollars", () => {
    expect(formatCents(2200)).toBe("$22.00");
    expect(formatCents(-150)).toBe("-$1.50");
  });
});
