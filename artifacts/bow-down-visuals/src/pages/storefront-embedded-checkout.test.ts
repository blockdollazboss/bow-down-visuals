/**
 * storefront-embedded-checkout.test.ts — stack400 lane 6.
 *
 * The profile-storefront rail (POST /api/storefront/checkout) minted
 * hosted-only Stripe sessions and this page redirected every buyer to
 * Stripe's hosted page (owner law 2026-10-26: "we should never have to
 * leave my site"). Source-contract pins for the frontend half of the
 * fix:
 *  - Buy Now asks for the embedded presentation (uiMode) whenever the
 *    device can mount it, and mounts EmbeddedSessionCheckout on the
 *    clientSecret right in the buy panel;
 *  - the hosted redirect remains ONLY as the fallback when no
 *    clientSecret comes back;
 *  - the make-an-offer buy follows the same embedded-first discipline;
 *  - the full-gift-card in-place path (paidWithGiftCard) still
 *    short-circuits before any card checkout is mounted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSrc = readFileSync(join(__dirname, "storefront-product.tsx"), "utf8");

describe("storefront product page — embedded-first checkout", () => {
  it("uses the shared embedded checkout mount + publishable-key gate", () => {
    expect(pageSrc).toContain('from "@/components/checkout/EmbeddedCheckout"');
    expect(pageSrc).toContain("hasStripePublishableKey()");
    expect(pageSrc).toContain("<EmbeddedSessionCheckout clientSecret={embeddedSecret} />");
    expect(pageSrc).toContain('data-testid="storefront-embedded-checkout"');
  });

  it("Buy Now asks for the embedded presentation", () => {
    const buyNow = pageSrc.slice(pageSrc.indexOf("async function buyNow"));
    expect(buyNow).toContain('uiMode: "embedded"');
    expect(buyNow).toContain("hasStripePublishableKey()");
  });

  it("mounts the embedded checkout on a clientSecret before the hosted fallback", () => {
    /* Slice from the storefront checkout fetch: the gift-card branch
       above it has its own hosted redirect, which is a different rail. */
    const region = pageSrc.slice(pageSrc.indexOf('fetch("/api/storefront/checkout"'));
    const embeddedBranch = region.indexOf("setEmbeddedSecret(body.clientSecret)");
    const hostedBranch = region.indexOf("window.location.href = body.url");
    expect(embeddedBranch).toBeGreaterThan(-1);
    expect(hostedBranch).toBeGreaterThan(embeddedBranch);
  });

  it("the full-gift-card path still short-circuits before any card checkout", () => {
    const giftBranch = pageSrc.indexOf("if (body.paidWithGiftCard)");
    const embeddedBranch = pageSrc.indexOf("setEmbeddedSecret(body.clientSecret)");
    expect(giftBranch).toBeGreaterThan(-1);
    expect(embeddedBranch).toBeGreaterThan(giftBranch);
  });

  it("the make-an-offer buy follows the same embedded-first discipline", () => {
    const offerFn = pageSrc.slice(pageSrc.indexOf("async function buyWithOffer"));
    expect(offerFn).toContain('uiMode: "embedded"');
    expect(offerFn).toContain("setEmbeddedSecret(body.clientSecret)");
  });

  it("cancelling the embedded mount restores the buy panel with no charge", () => {
    expect(pageSrc).toContain("onClick={() => setEmbeddedSecret(null)}");
    expect(pageSrc).toContain("Cancel — no charge");
  });
});
