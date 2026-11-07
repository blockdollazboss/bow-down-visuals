/**
 * Branding Shop checkout stays ON the site (stack1600 w8; owner law
 * 2026-10-26: the buyer never leaves bowdownvisuals.com).
 *
 * The Nov 5 sibling audit (lane L3) proved from code that the 2D
 * Branding Shop had the same defect the beats page had: the API rail
 * already honored uiMode "embedded" and answered a clientSecret, but
 * BrandingShop.tsx posted { orderId } only — never asked for the
 * embedded presentation — and full-page-redirected on checkoutUrl in
 * BOTH pay paths (the cart drawer's placeOrder and My Orders'
 * payForOrder).
 *
 * The fix is FE-only and reuses the proven doors' exact pattern (the
 * beats fix; the World branding stand's paySecret discipline): ask
 * uiMode "embedded" gated on the publishable key in both pay paths,
 * mount the shared <EmbeddedSessionCheckout> in the flow on the
 * clientSecret answer (cart drawer / the order's own card — origin
 * state keeps exactly one mount live), and NEVER navigate to a
 * hosted URL. Settlement is untouched: the Stripe webhook marks the
 * order paid and confirms fulfillment from the payment record, and
 * completion returns to /branding-shop?order=…&paid=1, landing on
 * My Orders exactly as before.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const count = (src: string, needle: string) => src.split(needle).length - 1;

describe("branding shop — checkout embedded on-site", () => {
  const src = read("../branding/BrandingShop.tsx");
  const payForOrder = src.slice(
    src.indexOf("async function payForOrder"),
    src.indexOf("async function placeOrder"),
  );
  const placeOrder = src.slice(
    src.indexOf("async function placeOrder"),
    src.indexOf("async function loadOrders"),
  );
  const addToCart = src.slice(
    src.indexOf("function addToCart"),
    src.indexOf("/* Upload logo for custom rug"),
  );

  it("uses the shared embedded checkout panel, gated on the publishable key", () => {
    expect(src).toContain(
      'import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout"',
    );
  });

  it("BOTH pay paths ask the rail for the embedded presentation", () => {
    expect(count(src, 'uiMode: hasStripePublishableKey() ? "embedded" : undefined')).toBe(2);
    expect(payForOrder).toContain('body: JSON.stringify({\n          orderId,');
    expect(placeOrder).toContain('body: JSON.stringify({\n          orderId,');
  });

  it("mounts the payment form in each flow on the clientSecret answer", () => {
    expect(count(src, 'data-testid="branding-embedded-checkout"')).toBe(2);
    expect(count(src, "<EmbeddedSessionCheckout clientSecret={paySecret} />")).toBe(2);
    expect(payForOrder).toContain("if (data.clientSecret) {");
    expect(payForOrder).toContain("setPaySecret(data.clientSecret);");
    expect(payForOrder).toContain('setPaySecretFrom("orders");');
    expect(placeOrder).toContain("if (coData.clientSecret) {");
    expect(placeOrder).toContain("setPaySecret(coData.clientSecret);");
    expect(placeOrder).toContain('setPaySecretFrom("cart");');
  });

  it("keeps exactly one mount live — origin + order gate each panel", () => {
    /* The cart drawer and the orders list are both in the tree; one
       session must never mount twice. */
    expect(src).toContain('paySecretFrom === "cart"');
    expect(src).toContain('paySecretFrom === "orders" && paySecretOrderId === o.id');
  });

  it("never navigates the buyer to a hosted checkout URL", () => {
    expect(src).not.toContain("checkoutUrl");
    expect(src).not.toMatch(/window\.location\.href\s*=/);
  });

  it("a fresh attempt, a different order, or a new cart clears the minted form", () => {
    /* The form is bound to one order + total: both pay paths clear
       before posting, and starting a new cart supersedes it. */
    expect(payForOrder).toContain("setPaySecret(null);");
    expect(payForOrder).toContain("setPaySecretOrderId(null);");
    expect(placeOrder).toContain("setPaySecret(null);");
    expect(placeOrder).toContain("setPaySecretOrderId(null);");
    expect(addToCart).toContain("setPaySecret(null);");
    /* Both panels carry the beats close copy: closing charges nothing. */
    expect(count(src, "Close — nothing is charged until you finish paying")).toBe(2);
  });

  it("the checkout posts never send a total — the server recomputes it", () => {
    expect(payForOrder).not.toContain("totalCents");
    expect(placeOrder.slice(placeOrder.indexOf("/api/branding-shop/checkout"))).not.toContain("totalCents");
  });

  it("settlement still runs from the payment record (return landing + demo path untouched)", () => {
    /* Completion returns to ?paid=1 and lands on My Orders; the order
       is marked paid by the Stripe webhook, not by anything here. */
    expect(src).toContain('if (q.get("paid") === "1") {');
    expect(src).toContain('setOrderSuccess(t("brandingShop.paymentReceived"))');
    /* Demo mode (no Stripe key server-side) still completes in place. */
    expect(payForOrder).toContain("if (data.mock) {");
    expect(placeOrder).toContain("if (!coData.mock && !coData.demo) {");
  });

  it("the paid return's query survives the /branding-shop alias (w200-D4 item 23)", () => {
    /* The server sends Stripe's return/success to
       /branding-shop?order=…&paid=1. That URL only reaches the
       `paid` read above if the /branding-shop alias preserves the
       incoming query — wouter's <Redirect> drops it, which silently
       killed the buyer's payment-received landing on every full-page
       Stripe return. The alias must ride QueryPreservingRedirect. */
    const appSrc = read("../../App.tsx");
    expect(appSrc).toContain(
      '<Route path="/branding-shop"><QueryPreservingRedirect to="/branding-kit?tab=shop" /></Route>',
    );
    expect(appSrc).not.toContain(
      '<Route path="/branding-shop"><Redirect to="/branding-kit?tab=shop" /></Route>',
    );
    /* …and the server still names the paid return this alias serves. */
    const serverSrc = read("../../../../api-server/src/routes/generate/branding-shop.ts");
    expect(serverSrc).toContain("/branding-shop?order=${order.id}&paid=1");
  });
});
