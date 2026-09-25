/**
 * Tests for the Brand Deal Calculator route's pure logic.
 *
 * Covers: 2-credit pricing constant, request validation schema,
 * calculation JSON parsing/validation (good, malformed, and empty
 * outputs), and the prompt builders.
 */
import { describe, expect, it } from "vitest";
import {
  BRAND_CALC_CREDIT_COST,
  PLATFORMS,
  CONTENT_TYPES,
  PLATFORM_LABEL,
  CONTENT_TYPE_LABEL,
  calculateSchema,
  parseCalcJson,
  buildCalcSystemPrompt,
  buildCalcUserPrompt,
} from "../brand-calculator";

describe("BRAND_CALC_CREDIT_COST", () => {
  it("charges 2 credits per calculation", () => {
    expect(BRAND_CALC_CREDIT_COST).toBe(2);
  });
});

describe("calculateSchema", () => {
  const valid = {
    platform: "tiktok",
    followers: 50000,
    avgViews: 25000,
    engagementRate: 4.2,
    contentType: "dedicated_video",
    niche: "Music",
  };

  it("accepts a valid calculation request", () => {
    expect(calculateSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unknown platform", () => {
    expect(
      calculateSchema.safeParse({ ...valid, platform: "myspace" }).success,
    ).toBe(false);
  });

  it("rejects an unknown content type", () => {
    expect(
      calculateSchema.safeParse({ ...valid, contentType: "billboard" }).success,
    ).toBe(false);
  });

  it("rejects fewer than 100 followers", () => {
    expect(
      calculateSchema.safeParse({ ...valid, followers: 50 }).success,
    ).toBe(false);
  });

  it("rejects an engagement rate above 100", () => {
    expect(
      calculateSchema.safeParse({ ...valid, engagementRate: 101 }).success,
    ).toBe(false);
  });

  it("rejects a negative engagement rate", () => {
    expect(
      calculateSchema.safeParse({ ...valid, engagementRate: -1 }).success,
    ).toBe(false);
  });

  it("rejects an empty niche", () => {
    expect(calculateSchema.safeParse({ ...valid, niche: "" }).success).toBe(
      false,
    );
  });

  it("rejects an overlong niche", () => {
    expect(
      calculateSchema.safeParse({ ...valid, niche: "x".repeat(121) }).success,
    ).toBe(false);
  });
});

describe("platforms and content types", () => {
  it("has a label for every platform", () => {
    for (const p of PLATFORMS) {
      expect(PLATFORM_LABEL[p]).toBeTruthy();
    }
  });

  it("has a label for every content type", () => {
    for (const c of CONTENT_TYPES) {
      expect(CONTENT_TYPE_LABEL[c]).toBeTruthy();
    }
  });
});

describe("parseCalcJson", () => {
  const good = JSON.stringify({
    rateRange: { low: 800, high: 1500, currency: "USD" },
    perPost: 1100,
    package3: 3000,
    breakdown: [
      { deliverable: "Dedicated video", low: 800, high: 1500 },
      { deliverable: "Story set", low: 200, high: 400 },
    ],
    usageRights: [{ term: "60-day usage", surcharge: "+25%" }],
    negotiationTips: ["Anchor high.", "Bundle deliverables.", "Get usage in writing."],
    disclaimer: "Rates are estimates based on industry data as of 2026.",
  });

  it("parses a valid calculation", () => {
    const r = parseCalcJson(good);
    expect(r.rateRange.low).toBe(800);
    expect(r.rateRange.high).toBe(1500);
    expect(r.perPost).toBe(1100);
    expect(r.package3).toBe(3000);
    expect(r.breakdown).toHaveLength(2);
    expect(r.usageRights).toHaveLength(1);
    expect(r.negotiationTips).toHaveLength(3);
  });

  it("throws on a zero rate range", () => {
    const bad = JSON.stringify({
      rateRange: { low: 0, high: 0 },
      negotiationTips: ["tip"],
    });
    expect(() => parseCalcJson(bad)).toThrow();
  });

  it("throws when negotiation tips are missing", () => {
    const bad = JSON.stringify({ rateRange: { low: 100, high: 200 } });
    expect(() => parseCalcJson(bad)).toThrow();
  });

  it("throws on malformed JSON", () => {
    expect(() => parseCalcJson("not json")).toThrow();
  });

  it("degrades bad breakdown items instead of throwing", () => {
    const raw = JSON.stringify({
      rateRange: { low: 100, high: 200 },
      breakdown: ["junk", { deliverable: "  ", low: 1, high: 2 }, { deliverable: "Story set", low: -5, high: 400 }],
      negotiationTips: ["tip"],
    });
    const r = parseCalcJson(raw);
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0]!.deliverable).toBe("Story set");
    expect(r.breakdown[0]!.low).toBe(0); // negatives clamp to 0
  });

  it("falls back to the default disclaimer", () => {
    const raw = JSON.stringify({
      rateRange: { low: 100, high: 200 },
      negotiationTips: ["tip"],
    });
    const r = parseCalcJson(raw);
    expect(r.disclaimer).toContain("estimates");
  });

  it("rounds money values to whole dollars", () => {
    const raw = JSON.stringify({
      rateRange: { low: 99.6, high: 200.4 },
      perPost: 149.5,
      negotiationTips: ["tip"],
    });
    const r = parseCalcJson(raw);
    expect(r.rateRange.low).toBe(100);
    expect(r.rateRange.high).toBe(200);
    expect(r.perPost).toBe(150);
  });
});

describe("prompt builders", () => {
  it("system prompt demands ranges and a disclaimer", () => {
    const p = buildCalcSystemPrompt();
    expect(p).toContain("RANGE");
    expect(p).toContain("estimates");
    expect(p).toContain("JSON");
  });

  it("system prompt never promises a fixed rate", () => {
    const p = buildCalcSystemPrompt();
    expect(p).toContain("never a single fixed");
  });

  it("user prompt includes all inputs", () => {
    const p = buildCalcUserPrompt({
      platform: "instagram",
      followers: 120000,
      avgViews: 45000,
      engagementRate: 3.8,
      contentType: "sponsored_post",
      niche: "Fitness",
    });
    expect(p).toContain("Instagram");
    expect(p).toContain("120,000");
    expect(p).toContain("45,000");
    expect(p).toContain("3.8%");
    expect(p).toContain("Fitness");
    expect(p).toContain("Sponsored post");
  });
});
