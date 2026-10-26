/**
 * Make-an-offer wiring pins (Wave 4 #43) — the FE suite runs in node
 * (no DOM), so these pins tie the docked surfaces to the real rails:
 *  - the buyer panel is docked on BOTH product surfaces (storefront
 *    product page + shop product modal), never a standalone page;
 *  - both pages hand the accepted offer's id to their EXISTING
 *    checkout endpoints (offerId only — no client-named price);
 *  - the seller inbox is docked in BOTH seller surfaces (Store
 *    Dashboard + My Shop);
 *  - the panel buys through the parent callback, and the inbox acts
 *    only through the offers lib.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const storefrontProduct = read("../../pages/storefront-product.tsx");
const shop = read("../../pages/shop.tsx");
const storeDashboard = read("../../pages/store-dashboard.tsx");
const myShop = read("../../pages/my-shop.tsx");
const panel = read("./ProductOfferPanel.tsx");
const inbox = read("./SellerOffersInbox.tsx");
const lib = read("../../lib/product-offers.ts");

describe("buyer docking", () => {
  it("the panel rides both product surfaces with the right item kinds", () => {
    expect(storefrontProduct).toContain("<ProductOfferPanel");
    expect(storefrontProduct).toContain('itemKind="store_product"');
    expect(shop).toContain("<ProductOfferPanel");
    expect(shop).toContain('itemKind="shop_product"');
  });

  it("checkout is the existing rail, handed the offer id and no price", () => {
    expect(storefrontProduct).toContain('fetch("/api/storefront/checkout"');
    expect(storefrontProduct).toContain("offerId: offer.id");
    expect(shop).toContain('fetch("/api/storefronts/checkout"');
    expect(shop).toContain("offerId: offer.id");
    expect(panel).not.toContain("priceCents:");
    expect(panel).not.toContain("amountCents: offer");
  });

  it("the storefront page keeps free + gift-card products out of negotiation", () => {
    expect(storefrontProduct).toContain("!isFree && !isGiftCard");
  });
});

describe("seller docking", () => {
  it("the inbox rides both seller surfaces with the right item kinds", () => {
    expect(storeDashboard).toContain("<SellerOffersInbox");
    expect(storeDashboard).toContain('itemKind="store_product"');
    expect(myShop).toContain("<SellerOffersInbox");
    expect(myShop).toContain('itemKind="shop_product"');
  });

  it("the inbox acts only through the offers lib and renders nothing when empty", () => {
    expect(inbox).toContain("fetchReceivedOffers");
    expect(inbox).toContain("actOnOffer");
    expect(inbox).toContain("if (!offers || offers.length === 0) return null;");
  });
});

describe("client lib", () => {
  it("talks to the offers router only", () => {
    expect(lib).toContain("/api/product-offers/mine");
    expect(lib).toContain("/api/product-offers/received");
    expect(lib).toContain("/api/product-offers/for-item");
    expect(lib).toContain("`/api/product-offers/${offerId}/act`");
  });
});
