/**
 * pricing-free-state.test.ts — /pricing Free-card state matrix
 * (stack700 pricing-free-state).
 *
 * The defect (proven live, Oct 28 stack600 settle walk): signed in on
 * the FREE plan, /pricing's Free card offered an actionable "Start
 * free" button and carried no current-plan marker — the page never
 * read the member's tier. /creator-pricing already derives this from
 * useCreatorTier; these pins hold /pricing to the same truth through
 * the shared pricingCardCta derivation:
 *
 *   free member  → Free card is "your-plan" (marker, no action)
 *   paid member  → Free card is "none" (Free is not a change target —
 *                  /creator-tiers/change takes pro|elite only; leaving
 *                  a paid plan is the Billing cancel-and-glide path)
 *   visitor      → Free card keeps the "start-free" marketing CTA
 *   paid cards   → always "go" (state + Switch live on
 *                  /creator-pricing, where /pricing links)
 */
import { describe, it, expect } from "vitest";
import { pricingCardCta } from "../lib/pricing-card-state";
import type { CreatorTierId } from "../lib/pricing-plans";

const VIEWERS: (CreatorTierId | null)[] = ["free", "pro", "elite", null];

describe("pricingCardCta — the Free card", () => {
  it("a free member's Free card is their current plan — marker, no action", () => {
    expect(pricingCardCta("free", "free")).toBe("your-plan");
  });

  it("a paid member gets NO Free-card action (Free is not a tier-change target)", () => {
    expect(pricingCardCta("free", "pro")).toBe("none");
    expect(pricingCardCta("free", "elite")).toBe("none");
  });

  it("a visitor (tier unknown / signed out) keeps the Start free CTA", () => {
    expect(pricingCardCta("free", null)).toBe("start-free");
  });
});

describe("pricingCardCta — the paid cards", () => {
  it("paid cards always link onward to /creator-pricing, whatever the viewer", () => {
    for (const plan of ["pro", "elite"] as const) {
      for (const viewer of VIEWERS) {
        expect(pricingCardCta(plan, viewer)).toBe("go");
      }
    }
  });
});
