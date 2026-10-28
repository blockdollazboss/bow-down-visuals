/**
 * shop-embedded-checkout.test.ts — stack400 lane 2.
 *
 * Oct 28 payments gate, Pass 2: a $5 shop purchase left the site for
 * the Stripe-HOSTED checkout page (owner law 2026-10-26: "we should
 * never have to leave my site") and the buyer found no delivery
 * anywhere — /library had no Purchases surface at all. Source-contract
 * pins for the frontend half of the fix:
 *  - the shop page asks for the embedded presentation (uiMode +
 *    returnPath back to this shop page) whenever the device can mount
 *    it, and mounts EmbeddedSessionCheckout on the clientSecret;
 *  - the hosted redirect remains ONLY as the fallback when no
 *    clientSecret comes back;
 *  - the signed-in buyer's session token rides along so the server
 *    can stamp the order + delivery to their account;
 *  - /library?tab=purchases resolves, the Purchases tab is docked in
 *    the Library, and its panel reads /api/shops/my-purchases.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { libraryTabFromParams } from "../lib/library-tab";

const shopSrc = readFileSync(join(__dirname, "shop.tsx"), "utf8");
const librarySrc = readFileSync(join(__dirname, "library.tsx"), "utf8");
const panelSrc = readFileSync(join(__dirname, "../components/library/PurchasesPanel.tsx"), "utf8");

describe("shop page — embedded-first checkout", () => {
  it("asks for the embedded presentation with a return to this shop page", () => {
    expect(shopSrc).toContain('uiMode: "embedded", returnPath: `/shop/${handle}`');
    expect(shopSrc).toContain("hasStripePublishableKey()");
  });

  it("mounts the embedded checkout in the cart drawer on a clientSecret", () => {
    expect(shopSrc).toContain("<EmbeddedSessionCheckout clientSecret={embeddedSecret} />");
    expect(shopSrc).toContain('data-testid="shop-embedded-checkout"');
  });

  it("keeps the hosted redirect only as the fallback after the embedded branch", () => {
    const embeddedBranch = shopSrc.indexOf("setEmbeddedSecret(data.clientSecret)");
    const hostedBranch = shopSrc.indexOf("window.location.href = url");
    expect(embeddedBranch).toBeGreaterThan(-1);
    expect(hostedBranch).toBeGreaterThan(embeddedBranch);
  });

  it("sends the signed-in buyer's session token with checkout", () => {
    expect(shopSrc).toContain("Authorization: `Bearer ${token}`");
    expect(shopSrc).toContain("headers: await checkoutHeaders()");
  });

  it("the make-an-offer buy follows the same embedded-first discipline", () => {
    const offerFn = shopSrc.slice(shopSrc.indexOf("async function buyWithOffer"));
    expect(offerFn).toContain('uiMode: "embedded"');
    expect(offerFn).toContain("setEmbeddedSecret(data.clientSecret)");
  });
});

describe("library — Purchases tab", () => {
  it("?tab=purchases resolves to the purchases tab", () => {
    expect(libraryTabFromParams(new URLSearchParams("tab=purchases"))).toBe("purchases");
  });

  it("the tab is docked in the Library tab list and renders the panel", () => {
    expect(librarySrc).toContain('key: "purchases"');
    expect(librarySrc).toContain('tab === "purchases"');
    expect(librarySrc).toContain("<PurchasesPanel");
  });

  it("the panel reads the buyer's deliveries endpoint with their session", () => {
    expect(panelSrc).toContain('fetch("/api/shops/my-purchases"');
    expect(panelSrc).toContain("Authorization: `Bearer ${token}`");
    expect(panelSrc).toContain("p.downloadUrl");
  });

  it("the panel keys rows by the saleId the API actually sends (stack500 small-fixes)", () => {
    // GET /api/shops/my-purchases maps each delivery to
    // `saleId: d.sale_event_id` — the name the whole shops module
    // uses. The panel's interface once declared `saleEventId`
    // instead, so `key={p.saleEventId}` was undefined on every row
    // and React fell back to index keys (vault-guards diagnosis §2).
    expect(panelSrc).toContain("saleId: string;");
    expect(panelSrc).toContain("key={p.saleId}");
    expect(panelSrc).not.toContain("saleEventId");
  });
});
