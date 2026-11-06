/**
 * branding-shop-copy.test.ts — Lane L8 (stack1600/w8) copy-truth pin.
 *
 * The Branding Shop cart drawer used to print, directly under the
 * "Place Order" button: "No payment taken today — dropship partner
 * integration coming soon." That line is FALSE: placeOrder() creates
 * the order and immediately runs POST /api/branding-shop/checkout,
 * which opens a real Stripe Checkout session, and the Stripe webhook
 * settles the order via markBrandingOrderPaid. Same false-copy family
 * as the shoutout "No money moves yet" line (fixed in lane L2).
 *
 * The replacement follows the memberships.paymentsNotice pattern and,
 * per the money-copy law, is English verbatim in ALL 10 catalogs
 * (never agent-translated) — which is why every locale-waves W1
 * legit-identical allowlist names brandingShop.noPaymentNote.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TRUTHFUL_NOTE =
  "Payments are live (test mode) — you pay through secure checkout when you place your order, and your order is confirmed the moment your payment confirms. No fake transactions, ever.";

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"] as const;

function loadRaw(locale: string): string {
  return readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
}

type Catalog = { brandingShop?: Record<string, unknown> };
function load(locale: string): Catalog {
  return JSON.parse(loadRaw(locale)) as Catalog;
}

const component = readFileSync(
  new URL(`../components/branding/BrandingShop.tsx`, import.meta.url),
  "utf8",
);

/** The block of `src` starting at `marker` — proves the note still sits
 *  in the cart footer it describes, not somewhere else on the page. */
function blockAfter(src: string, marker: string, span = 1600): string {
  const i = src.indexOf(marker);
  expect(i, `marker not found: ${marker}`).toBeGreaterThanOrEqual(0);
  return src.slice(i, i + span);
}

describe("Branding Shop — the note under Place Order tells the truth", () => {
  it("the false line is gone from every catalog", () => {
    for (const locale of LOCALES) {
      const raw = loadRaw(locale);
      expect(raw, `${locale} still carries the false copy`).not.toContain("No payment taken today");
      expect(raw, `${locale} still carries the false copy`).not.toContain(
        "dropship partner integration coming soon",
      );
    }
  });

  it("every catalog carries the truthful note, English verbatim (money-copy law)", () => {
    for (const locale of LOCALES) {
      expect(load(locale).brandingShop?.["noPaymentNote"], `${locale} note drifted`).toBe(TRUTHFUL_NOTE);
    }
  });

  it("the note still renders directly under the Place Order button", () => {
    const block = blockAfter(component, "onClick={placeOrder}");
    expect(block).toContain('t("brandingShop.noPaymentNote")');
  });

  it("the flow the note describes is the real one: placeOrder pays via the checkout route", () => {
    const block = blockAfter(component, "async function placeOrder()", 3200);
    expect(block).toContain('"/api/branding-shop/orders"');
    expect(block).toContain('"/api/branding-shop/checkout"');
  });
});
