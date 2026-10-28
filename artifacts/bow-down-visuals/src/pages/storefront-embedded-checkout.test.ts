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

describe("storefront product page — checkout reachability (stack600 audit)", () => {
  /* Gate Pass 2's drawer trap (shop.tsx, fixed in
     stack600/checkout-drawer-scroll) was a height-capped fixed
     drawer whose only scroll region excluded the checkout. This
     page carries TWO EmbeddedSessionCheckout mounts — the gift-card
     rail (giftEmbeddedSecret) and the buy rail (embeddedSecret) —
     and the audit verdict for both is SAFE, by structure: they
     render in plain document flow on a `min-h-screen` page, inside
     an auto-height card, so the document itself is the scroll
     region and the full-height Stripe iframe (~700–950 px) is
     reachable at document-scroll bottom at any viewport height.
     These pins freeze that shape: if a height cap or a
     non-scrolling overflow region ever lands on this page, the
     mounts must be re-audited against the drawer contract. */

  it("both mounts sit in plain flow wrappers (spacing only, no trap classes)", () => {
    expect(pageSrc).toContain('<div className="mt-4" data-testid="gift-card-embedded-checkout">');
    expect(pageSrc).toContain("<EmbeddedSessionCheckout clientSecret={giftEmbeddedSecret} />");
    expect(pageSrc).toContain('<div className="mt-4" data-testid="storefront-embedded-checkout">');
    expect(pageSrc).toContain("<EmbeddedSessionCheckout clientSecret={embeddedSecret} />");
  });

  it("the page root grows with its content (min-h-screen, never capped)", () => {
    expect(pageSrc).toContain('<div className="min-h-screen bg-black text-white">');
  });

  it("no height-capped or scroll-trapping container exists anywhere in the page", () => {
    expect(pageSrc).not.toContain("max-h-");
    expect(pageSrc).not.toContain("h-dvh");
    expect(pageSrc).not.toContain("h-svh");
    expect(pageSrc).not.toContain("overflow-y-auto");
    expect(pageSrc).not.toContain("overflow-y-hidden");
    expect(pageSrc).not.toContain("overflow-y-scroll");
  });

  it("the only overflow-hidden is the decorative auto-height product card", () => {
    expect(pageSrc.split("overflow-hidden").length - 1).toBe(1);
    const card = pageSrc.slice(pageSrc.indexOf("overflow-hidden") - 40, pageSrc.indexOf("overflow-hidden") + 40);
    expect(card).toContain("rounded-2xl");
  });
});
