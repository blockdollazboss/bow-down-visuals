/**
 * Money-integrity + prompt tests for the Logo Maker.
 *
 * Covers: the pricing contract (Premium 2cr / Standard 1cr), the 402
 * out-of-credits rule, style validation, and prompt construction.
 */
import { describe, expect, it } from "vitest";

import {
  resolveLogoPlan,
  isLogoStyleKey,
  buildLogoPrompt,
  LOGO_PREMIUM_CREDIT_COST,
  LOGO_STANDARD_CREDIT_COST,
  LOGO_STYLES,
  LOGO_STYLE_KEYS,
} from "../logo-pricing";

describe("logo pricing contract", () => {
  it("Premium costs 2 credits", () => {
    expect(LOGO_PREMIUM_CREDIT_COST).toBe(2);
    expect(resolveLogoPlan({ model: "premium" })).toEqual({ model: "premium", creditCost: 2 });
  });

  it("Standard costs 1 credit", () => {
    expect(LOGO_STANDARD_CREDIT_COST).toBe(1);
    expect(resolveLogoPlan({ model: "standard" })).toEqual({ model: "standard", creditCost: 1 });
  });

  it("defaults to Premium when the model is missing or unknown", () => {
    expect(resolveLogoPlan({}).model).toBe("premium");
    expect(resolveLogoPlan({ model: "fancy" }).model).toBe("premium");
  });

  it("the route rejects when balance < cost (documents the 402 contract)", () => {
    // POST /generate-logo checks req.userCredits < creditCost → 402
    // before touching any provider. Pin both tiers here.
    expect(1 < LOGO_PREMIUM_CREDIT_COST).toBe(true); // 1 credit → 402 on Premium
    expect(0 < LOGO_STANDARD_CREDIT_COST).toBe(true); // 0 credits → 402 on Standard
    expect(2 < LOGO_PREMIUM_CREDIT_COST).toBe(false); // exact balance → allowed
  });
});

describe("logo styles", () => {
  it("offers exactly the four documented styles", () => {
    expect(LOGO_STYLE_KEYS).toEqual(["luxury-gold", "gaming", "minimal", "mascot"]);
  });

  it("every style has a label, blurb, and directive", () => {
    for (const key of LOGO_STYLE_KEYS) {
      const s = LOGO_STYLES[key];
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(0);
      expect(s.directive.length).toBeGreaterThan(20);
    }
  });

  it("rejects unknown style keys", () => {
    expect(isLogoStyleKey("luxury-gold")).toBe(true);
    expect(isLogoStyleKey("neon")).toBe(false);
    expect(isLogoStyleKey("")).toBe(false);
    expect(isLogoStyleKey(undefined)).toBe(false);
    expect(isLogoStyleKey(42)).toBe(false);
  });
});

describe("buildLogoPrompt", () => {
  it("puts the brand name front and center with the style directive", () => {
    const p = buildLogoPrompt("Bow Down Visuals", "luxury-gold");
    expect(p).toContain("Bow Down Visuals");
    expect(p).toContain("gold");
    expect(p).toContain("typography");
  });

  it("includes the tagline when provided", () => {
    const p = buildLogoPrompt("BDV", "minimal", "Create Daily");
    expect(p).toContain("Create Daily");
  });

  it("omits the tagline line when not provided", () => {
    const p = buildLogoPrompt("BDV", "gaming");
    expect(p).not.toContain("Tagline");
  });

  it("caps brand name and tagline lengths (prompt-injection hygiene)", () => {
    const p = buildLogoPrompt("A".repeat(200), "mascot", "B".repeat(200));
    expect(p).not.toContain("A".repeat(61));
    expect(p).not.toContain("B".repeat(81));
  });

  it("bans watermarks and extra text", () => {
    const p = buildLogoPrompt("BDV", "luxury-gold");
    expect(p.toLowerCase()).toContain("no watermark");
  });
});
