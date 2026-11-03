/**
 * brand-calculator-desk — stack1500 world parity wave #3
 * item 21 pins. The Brand Deal Calculator desk is the
 * calculator's native form. These pins hold: the price comes
 * from the registry at 200 with the registry's own feature
 * name, matching the route's BRAND_CALC_CREDIT_COST; the
 * payload builder enforces the schema's bounds in-desk
 * (followers 100–1e9 int, views 0–1e9 int, engagement 0–100,
 * known platform + content type, non-empty niche capped at
 * 120); the result guard needs the rate range (the route's
 * bar), rounds money the route's way, drops nameless rows,
 * and keeps the rail's disclaimer; the money format is the
 * desk's one format.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BRAND_CALC_CONTENT_TYPES,
  BRAND_CALC_COST,
  BRAND_CALC_PATH,
  BRAND_CALC_PLATFORMS,
  brandCalcResultOf,
  buildBrandCalcPayload,
  formatMoney,
  type BrandCalcForm,
} from "./brand-calculator-desk";
import { getCreditCost } from "../credit-costs";

const apiSrc = (rel: string) =>
  readFileSync(new URL(`../../../../api-server/src/${rel}`, import.meta.url), "utf8");

const FORM: BrandCalcForm = {
  platform: "youtube",
  followers: "50000",
  avgViews: "20000",
  engagementRate: "4.5",
  contentType: "dedicated_video",
  niche: "indie hip-hop production",
};

describe("price — registry-pinned, route-matched", () => {
  it("the run is 200 from the registry, route constant agrees", () => {
    expect(getCreditCost(BRAND_CALC_PATH)).toMatchObject({ feature: "Brand Deal Calculator", cost: 200 });
    expect(BRAND_CALC_COST).toBe(200);
    expect(apiSrc("routes/generate/brand-calculator.ts")).toContain("BRAND_CALC_CREDIT_COST");
  });
});

describe("the payload builder enforces the schema in-desk", () => {
  it("a good form becomes the schema's numbers", () => {
    expect(buildBrandCalcPayload(FORM)).toEqual({
      platform: "youtube",
      followers: 50000,
      avgViews: 20000,
      engagementRate: 4.5,
      contentType: "dedicated_video",
      niche: "indie hip-hop production",
    });
    expect(BRAND_CALC_PLATFORMS.map((p) => p.key)).toEqual(["youtube", "tiktok", "instagram", "twitch", "x"]);
    expect(BRAND_CALC_CONTENT_TYPES).toHaveLength(6);
  });

  it("out-of-bounds inputs are refused, never sent", () => {
    expect(buildBrandCalcPayload({ ...FORM, followers: "99" })).toBeNull();
    expect(buildBrandCalcPayload({ ...FORM, followers: "50.5" })).toBeNull();
    expect(buildBrandCalcPayload({ ...FORM, avgViews: "-1" })).toBeNull();
    expect(buildBrandCalcPayload({ ...FORM, engagementRate: "101" })).toBeNull();
    expect(buildBrandCalcPayload({ ...FORM, platform: "myspace" })).toBeNull();
    expect(buildBrandCalcPayload({ ...FORM, niche: "  " })).toBeNull();
  });
});

describe("the result guard", () => {
  it("reads the whole card, money rounded, disclaimer kept", () => {
    const r = brandCalcResultOf({
      result: {
        rateRange: { low: 800.4, high: 1500.6, currency: "USD" },
        perPost: 1000,
        package3: 2700,
        breakdown: [{ deliverable: "Dedicated video", low: 900, high: 1400 }, { deliverable: "", low: 1, high: 2 }],
        usageRights: [{ term: "12 months paid usage", surcharge: "+50%" }],
        negotiationTips: ["Anchor high, trade terms not price."],
        disclaimer: "Industry estimates as of 2026 — not a guarantee.",
      },
    })!;
    expect(r.rateLow).toBe(800);
    expect(r.rateHigh).toBe(1501);
    expect(r.perPost).toBe(1000);
    expect(r.breakdown).toHaveLength(1);
    expect(r.usageRights[0]).toEqual({ term: "12 months paid usage", surcharge: "+50%" });
    expect(r.disclaimer).toContain("not a guarantee");
    expect(formatMoney(1501, "USD")).toBe("$1,501");
    expect(formatMoney(900, "EUR")).toBe("EUR 900");
  });

  it("no rate range, no card", () => {
    expect(brandCalcResultOf({ result: {} })).toBeNull();
    expect(brandCalcResultOf({})).toBeNull();
    expect(brandCalcResultOf(null)).toBeNull();
  });
});
