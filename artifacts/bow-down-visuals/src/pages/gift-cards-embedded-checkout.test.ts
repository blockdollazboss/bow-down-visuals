/**
 * gift-cards-embedded-checkout.test.ts — stack400 lane 7.
 *
 * The gift-card purchase on the storefront product page (POST
 * /api/gift-cards/checkout) minted hosted-only Stripe sessions and
 * this page redirected every buyer to Stripe's hosted page (owner
 * law 2026-10-26: "we should never have to leave my site") — the
 * named remainder of lane 6's storefront fix. Source-contract pins
 * for the frontend half:
 *  - the gift branch asks for the embedded presentation (uiMode)
 *    whenever the device can mount it, recipient fields unchanged;
 *  - on a clientSecret it mounts EmbeddedSessionCheckout right in
 *    the gift panel; the hosted redirect remains ONLY as the
 *    fallback when no clientSecret comes back;
 *  - cancelling the mount restores the gift panel with no charge;
 *  - the verify-on-return flow is untouched, so an embedded payment
 *    lands on ?gift=success and issues the card exactly like a
 *    hosted one did.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSrc = readFileSync(join(__dirname, "storefront-product.tsx"), "utf8");

/* The gift-card branch of buyNow(): from its checkout fetch up to
   the storefront checkout fetch that follows it. */
const giftRegion = pageSrc.slice(
  pageSrc.indexOf('fetch("/api/gift-cards/checkout"'),
  pageSrc.indexOf('fetch("/api/storefront/checkout"'),
);

describe("storefront product page — gift-card embedded-first checkout", () => {
  it("uses the shared embedded checkout mount + publishable-key gate", () => {
    expect(pageSrc).toContain('from "@/components/checkout/EmbeddedCheckout"');
    expect(pageSrc).toContain("hasStripePublishableKey()");
  });

  it("the gift branch asks for the embedded presentation, recipient fields unchanged", () => {
    expect(giftRegion).toContain('uiMode: "embedded"');
    expect(giftRegion).toContain("hasStripePublishableKey()");
    expect(giftRegion).toContain("recipientEmail: recipientEmail.trim()");
    expect(giftRegion).toContain("amountCents: amount");
  });

  it("mounts the embedded checkout on a clientSecret before the hosted fallback", () => {
    const embeddedBranch = giftRegion.indexOf("setGiftEmbeddedSecret(body.clientSecret)");
    const hostedBranch = giftRegion.indexOf("window.location.href = body.url");
    expect(embeddedBranch).toBeGreaterThan(-1);
    expect(hostedBranch).toBeGreaterThan(embeddedBranch);
  });

  it("the gift panel mounts the shared checkout with a no-charge cancel", () => {
    expect(pageSrc).toContain("<EmbeddedSessionCheckout clientSecret={giftEmbeddedSecret} />");
    expect(pageSrc).toContain('data-testid="gift-card-embedded-checkout"');
    expect(pageSrc).toContain("onClick={() => setGiftEmbeddedSecret(null)}");
    expect(pageSrc).toContain("Cancel — no charge");
  });

  it("the verify-on-return flow still issues the card after the return", () => {
    expect(pageSrc).toContain('qs.get("gift") !== "success"');
    expect(pageSrc).toContain('fetch("/api/gift-cards/verify"');
    expect(pageSrc).toContain("setGiftIssued(");
  });
});
