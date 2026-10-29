/**
 * creator-pricing-free-card.test.ts — /creator-pricing Free-card state
 * matrix (stack700 creator-pricing-free-card).
 *
 * The defect (pre-existing stack600 behavior, flagged by the
 * pricing-free-state lane): /creator-pricing's Free card showed a FREE
 * member the honest "Your current plan" marker, but showed a PAID
 * member an actionable "Start free" link → /dashboard — the same small
 * dishonesty the sibling lane removed from /pricing. A paid member
 * cannot "start free": /creator-tiers/change takes pro|elite targets
 * only (lib/tier-change's PaidTier excludes "free" — a swap needs a
 * Stripe price to swap to), and leaving a paid plan is the
 * Settings → Billing cancel-and-glide path. So the Free card's CTA is
 * derived through the SAME pricingCardCta the /pricing lane shipped:
 *
 *   free member  → "your-plan"  (marker, no action — already true here)
 *   paid member  → "none"       (no CTA; an empty aligned slot)
 *   visitor      → "start-free" (the marketing CTA survives)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pricingCardCta } from "../lib/pricing-card-state";

describe("pricingCardCta — the /creator-pricing Free card", () => {
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

describe("/creator-pricing page wiring — the Free card renders the derivation", () => {
  const page = readFileSync(new URL("./creator-pricing.tsx", import.meta.url), "utf8");
  const freeBranch = page.slice(
    page.indexOf('{p.tier === "free" ? ('),
    page.indexOf(") : currentTier === p.tier ? ("),
  );

  it("the page imports the shared derivation", () => {
    expect(page).toContain('from "@/lib/pricing-card-state"');
  });

  it("the Free card derives its CTA through pricingCardCta", () => {
    expect(freeBranch).toContain("pricingCardCta(p.tier, currentTier)");
    expect(freeBranch).toContain('=== "your-plan"');
    expect(freeBranch).toContain('=== "start-free"');
  });

  it("the your-plan state renders the established marker, non-actionable", () => {
    const marker = freeBranch.slice(
      freeBranch.indexOf('=== "your-plan"'),
      freeBranch.indexOf('=== "start-free"'),
    );
    expect(marker).toContain("Your current plan");
    expect(marker).not.toContain("<Link");
    expect(marker).not.toContain("<button");
  });

  it("the none state is an empty aligned slot — no link, no button, no Start free", () => {
    const slotAt = freeBranch.indexOf('className="h-10"');
    expect(slotAt).toBeGreaterThan(freeBranch.indexOf('=== "start-free"'));
    expect(freeBranch).toContain('aria-hidden="true"');
    const slot = freeBranch.slice(slotAt);
    expect(slot).not.toContain("<Link");
    expect(slot).not.toContain("<button");
    expect(slot).not.toContain("Start free");
  });

  it("Start free survives exactly once — the visitor door, inside the start-free state", () => {
    expect(freeBranch.split("Start free").length - 1).toBe(1);
    expect(page.split('href="/dashboard"').length - 1).toBe(1);
    const startFree = freeBranch.slice(freeBranch.indexOf('=== "start-free"'));
    expect(startFree).toContain("Start free");
    expect(startFree).toContain('href="/dashboard"');
  });

  it("the paid cards' own states are untouched (current-plan marker + Switch)", () => {
    expect(page).toContain("currentTier === p.tier");
    expect(page).toContain("Switch to");
  });
});
