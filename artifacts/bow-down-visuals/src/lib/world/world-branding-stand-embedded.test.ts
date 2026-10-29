/**
 * world-branding-stand-embedded — source-contract pins for the
 * Branding stand desk side of the World money-parity work (the
 * parity-server lane's leftover, wired at the stack800 join's
 * rung 0). Once the branding-shop rail learned to answer an
 * embedded clientSecret, the Branding stand in ShopStands.tsx
 * must, exactly like BeatsDesk / PortraitTip:
 * - ask for the embedded presentation whenever a publishable key
 *   is present (the device can mount the form) — at BOTH of its
 *   checkout call sites (cart checkout + an order's Pay button);
 * - branch on the clientSecret BEFORE the hosted-tab fallback,
 *   and mount the shared EmbeddedSessionCheckout in-panel;
 * - keep the hosted new tab strictly as the fallback (no-key /
 *   hosted answer / kill switch), never a same-tab walk-out.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const stands = read("../../components/world/native/ShopStands.tsx");

/* Scope every assertion to the Branding stand itself — the same
   file's Marketplace stand was embedded-first already (JOIN2). */
const brandStart = stands.indexOf("function BrandingShopStand");
const brandEnd = stands.indexOf("/* ═══ 3a.", brandStart);
const branding = stands.slice(brandStart, brandEnd === -1 ? undefined : brandEnd);

describe("Branding stand embedded checkout (parity-server leftover, join rung 0)", () => {
  it("slices the Branding stand out of ShopStands", () => {
    expect(brandStart).toBeGreaterThan(-1);
    expect(branding).toContain('data-testid="world-shop-branding"');
    expect(branding).toContain('fetch("/api/branding-shop/checkout"');
  });

  it("mounts the shared embedded checkout and asks for it when a key is present — at both call sites", () => {
    expect(branding).toContain("EmbeddedSessionCheckout");
    expect(branding).toContain("hasStripePublishableKey");
    const asks = branding.split('uiMode: hasStripePublishableKey() ? "embedded" : undefined').length - 1;
    expect(asks).toBe(2);
    expect(branding).toContain('data-testid="world-branding-embedded-checkout"');
    expect(branding).toContain("<EmbeddedSessionCheckout clientSecret={paySecret} />");
  });

  it("branches on the clientSecret before the hosted-tab fallback, at both call sites", () => {
    const cartSecret = branding.indexOf("coData.clientSecret");
    const paySecretBranch = branding.indexOf("data.clientSecret");
    const tabFallback = branding.indexOf("openCheckoutTab(url)");
    expect(cartSecret).toBeGreaterThan(-1);
    expect(paySecretBranch).toBeGreaterThan(-1);
    expect(tabFallback).toBeGreaterThan(-1);
    expect(cartSecret).toBeLessThan(tabFallback);
    /* The fallback survives, and there is still no same-tab walk-out. */
    expect(branding).not.toContain("window.location.href = ");
  });

  it("keeps the demo / completed-in-world answer intact", () => {
    expect(branding).toContain("checkoutCompletedInWorld(coData)");
  });
});
