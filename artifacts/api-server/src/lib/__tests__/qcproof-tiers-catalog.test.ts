/**
 * qcproof-tiers-catalog.test.ts — QC-200 Q143 residual pin.
 *
 * The ledger claim is that the tier catalog sells Pro at $12/mo and
 * Elite at $29/mo, charged through the Stripe price ids named by
 * STRIPE_PRICE_TIER_PRO / STRIPE_PRICE_TIER_ELITE. Existing suites pin
 * pieces of this (operator-knowledge source-regexes the prices;
 * creator-tiers-billing reads a $12 Pro billing response) but nothing
 * asserted the TIER_PLANS catalog itself — the single source every
 * display and checkout reads. This pins the catalog directly:
 * amounts, env names, and the free tier carrying no price at all.
 * Behavioural legs (guarded checkout + deterministic key, invoice
 * payment_failed → past_due, portal cancel-at-period-end keeping
 * access) are already proven by stripe-checkout-idempotency-rest,
 * creator-tier-sibling-guards and creator-tiers-billing — re-run as
 * part of this lane's evidence, not duplicated here.
 */
import { describe, it, expect } from "vitest";
import { TIER_PLANS } from "../platform-fees";

describe("Q143 — TIER_PLANS catalog (the ruled prices, from code)", () => {
  it("Pro is $12/mo through STRIPE_PRICE_TIER_PRO", () => {
    const pro = TIER_PLANS.find((p) => p.tier === "pro");
    expect(pro).toBeDefined();
    expect(pro!.priceUsdPerMonth).toBe(12);
    expect(pro!.priceIdEnv).toBe("STRIPE_PRICE_TIER_PRO");
  });

  it("Elite is $29/mo through STRIPE_PRICE_TIER_ELITE", () => {
    const elite = TIER_PLANS.find((p) => p.tier === "elite");
    expect(elite).toBeDefined();
    expect(elite!.priceUsdPerMonth).toBe(29);
    expect(elite!.priceIdEnv).toBe("STRIPE_PRICE_TIER_ELITE");
  });

  it("Free carries no price and no Stripe price env", () => {
    const free = TIER_PLANS.find((p) => p.tier === "free");
    expect(free).toBeDefined();
    expect(free!.priceUsdPerMonth).toBeNull();
    expect(free!.priceIdEnv).toBeNull();
  });

  it("the catalog is exactly free/pro/elite — no fourth sellable tier", () => {
    expect(TIER_PLANS.map((p) => p.tier)).toEqual(["free", "pro", "elite"]);
  });
});
