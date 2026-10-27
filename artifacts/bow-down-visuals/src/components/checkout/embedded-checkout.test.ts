/**
 * Embedded checkout FE contract (owner law 2026-10-26: the buyer
 * never leaves bowdownvisuals.com):
 *  - the shared component mounts PaymentElement (packs + plans) and
 *    EmbeddedCheckout (store) with light AND dark Stripe appearances;
 *  - pricing / creator-pricing / store-buy start the embedded flows
 *    and no longer redirect the buyer to a hosted session URL.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("shared embedded checkout component", () => {
  const src = read("./EmbeddedCheckout.tsx");
  it("mounts PaymentElement and EmbeddedCheckout from react-stripe-js", () => {
    expect(src).toContain("PaymentElement");
    expect(src).toContain("EmbeddedCheckoutProvider");
    expect(src).toContain('loadStripe');
    expect(src).toContain('"@stripe/stripe-js/pure"');
  });
  it("confirms on-page (redirect only if a payment method requires it)", () => {
    expect(src).toContain('redirect: "if_required"');
    expect(src).toContain("stripe.confirmPayment");
  });
  it("themes BOTH light and dark via the Stripe appearance API", () => {
    expect(src).toContain('theme: "stripe"');
    expect(src).toContain('theme: "night"');
    expect(src).toContain("useIsLightTheme");
  });
});

describe("the three flows no longer redirect to hosted checkout", () => {
  it("pricing credit packs use the embedded intent + verify endpoints", () => {
    const src = read("../../pages/pricing.tsx");
    expect(src).toContain('fetch("/api/embedded-checkout/credit-pack/intent"');
    expect(src).toContain('fetch("/api/embedded-checkout/credit-pack/verify"');
    expect(src).toContain("<EmbeddedPaymentForm");
    expect(src).not.toContain("window.location.href = data.url");
  });
  it("creator-pricing plans use the embedded subscription endpoints", () => {
    const src = read("../../pages/creator-pricing.tsx");
    expect(src).toContain('fetch("/api/embedded-checkout/subscription/intent"');
    expect(src).toContain('fetch("/api/embedded-checkout/subscription/verify"');
    expect(src).toContain("<EmbeddedPaymentForm");
    expect(src).not.toContain("window.location.href = data.url");
  });
  it("store-buy mounts the embedded session on the page", () => {
    const src = read("../../pages/store-buy.tsx");
    expect(src).toContain('uiMode: "embedded"');
    expect(src).toContain("<EmbeddedSessionCheckout");
    expect(src).not.toContain("window.location.href = body.url");
  });
});
