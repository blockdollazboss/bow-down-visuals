/**
 * shop-stands — the Shop Stand pattern's pure logic (NATIVE-PLAN
 * §3.3 + §3.9). Pins:
 * (a) the checkout transfer is ONE uniform label on every stand,
 *     and the hosted URL is read off a checkout payload only when
 *     it is a real http(s) URL (branding's `checkoutUrl`,
 *     memberships' `url`) — free/demo/recorded completions carry
 *     none and stay in-world;
 * (b) the Marketplace cart joins lines to products honestly
 *     (vanished products and zero-qty lines drop out) and totals
 *     from the products' own server prices;
 * (c) recorded Marketplace sales sum into one receipt (gross /
 *     platform fee / seller net) exactly as the shop page totals
 *     its per-line checkouts;
 * (d) the Branding cart never carts a quote-only good, merges
 *     identical variants capped at 99, and the order payload is
 *     the page's exact shape (rug logo rides as designUrl);
 * (e) Crown cards show only active tiers, price labels read the
 *     server DTO's own amounts per period, trials exist only on
 *     paid trial-enabled tiers, and a creator id parses from a
 *     bare id or a pasted join link — never from anything else.
 *
 * Source pins (contract style): the stands wire the exact server
 * endpoints §3.3 names, the checkout opens its hosted page in a
 * NEW TAB only, and the dispatch replaces the placeholder for the
 * three shop stations — and no other pattern.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CHECKOUT_TRANSFER_LABEL,
  CONTACT_FOR_QUOTE_LABEL,
  detailedMarketCart,
  marketCartTotalCents,
  marketCartCount,
  sumMarketReceipts,
  hostedCheckoutUrl,
  checkoutCompletedInWorld,
  isQuoteOnly,
  addBrandingCartLine,
  setBrandingCartQty,
  brandingCartTotalCents,
  brandingOrderPayload,
  brandingShippingComplete,
  brandingOrderStatusLabel,
  brandingDesignComplete,
  activeMembershipTiers,
  tierPriceLabel,
  tierAnnualSavingLabel,
  tierOffersTrial,
  parseCreatorUserId,
  type BrandingCartLine,
  type MembershipTierDto,
  type PublicProductDto,
} from "./shop-stands";
import { BRANDING_PRODUCTS, BRANDING_DESIGN_COST } from "@/lib/branding-shop";

const standsSrc = readFileSync(
  fileURLToPath(new URL("../../components/world/native/ShopStands.tsx", import.meta.url)),
  "utf8",
);
const panelSrc = readFileSync(
  fileURLToPath(new URL("../../components/world/StationPanel.tsx", import.meta.url)),
  "utf8",
);

describe("the checkout transfer seam (§3.9)", () => {
  it("is one uniform label, naming the website as the destination", () => {
    expect(CHECKOUT_TRANSFER_LABEL).toBe("Continue to checkout on the website");
    expect(CONTACT_FOR_QUOTE_LABEL).toBe("Contact for quote");
  });

  it("reads the hosted URL off either checkout payload shape", () => {
    expect(hostedCheckoutUrl({ checkoutUrl: "https://checkout.stripe.com/c/pay_1" })).toBe(
      "https://checkout.stripe.com/c/pay_1",
    );
    expect(hostedCheckoutUrl({ url: "https://checkout.stripe.com/c/pay_2" })).toBe(
      "https://checkout.stripe.com/c/pay_2",
    );
  });

  it("never invents a URL from a receipt, a flag, or junk", () => {
    expect(hostedCheckoutUrl({ saleId: "s1", gross_cents: 100 })).toBeNull();
    expect(hostedCheckoutUrl({ free: true })).toBeNull();
    expect(hostedCheckoutUrl({ mock: true, demo: true })).toBeNull();
    expect(hostedCheckoutUrl({ url: "javascript:alert(1)" })).toBeNull();
    expect(hostedCheckoutUrl({ checkoutUrl: "" })).toBeNull();
    expect(hostedCheckoutUrl(null)).toBeNull();
    expect(hostedCheckoutUrl("https://checkout.stripe.com/x")).toBeNull();
  });

  it("recognizes the completions that finish in-world (free tier, demo mode)", () => {
    expect(checkoutCompletedInWorld({ free: true })).toBe(true);
    expect(checkoutCompletedInWorld({ mock: true })).toBe(true);
    expect(checkoutCompletedInWorld({ demo: true })).toBe(true);
    expect(checkoutCompletedInWorld({ url: "https://x.test" })).toBe(false);
    expect(checkoutCompletedInWorld({})).toBe(false);
    expect(checkoutCompletedInWorld(null)).toBe(false);
  });
});

const PRODUCTS: PublicProductDto[] = [
  { id: "p1", name: "Hoodie", price_cents: 4999, description: null, image_url: null },
  { id: "p2", name: "Cap", price_cents: 2799, description: "Snapback", image_url: null },
];

describe("the Marketplace cart", () => {
  it("joins lines to products and drops vanished/zero lines", () => {
    const detailed = detailedMarketCart(
      [
        { productId: "p1", qty: 2 },
        { productId: "gone", qty: 1 },
        { productId: "p2", qty: 0 },
      ],
      PRODUCTS,
    );
    expect(detailed.map((l) => l.productId)).toEqual(["p1"]);
    expect(detailed[0]!.product.name).toBe("Hoodie");
  });

  it("totals and counts from the products' own prices", () => {
    const detailed = detailedMarketCart(
      [
        { productId: "p1", qty: 2 },
        { productId: "p2", qty: 1 },
      ],
      PRODUCTS,
    );
    expect(marketCartTotalCents(detailed)).toBe(2 * 4999 + 2799);
    expect(marketCartCount(detailed)).toBe(3);
  });

  it("sums per-line sale receipts into one honest receipt", () => {
    const total = sumMarketReceipts([
      { gross_cents: 9998, platform_fee_cents: 1000, seller_net_cents: 8998, platform_fee_pct: 10 },
      { gross_cents: 2799, platform_fee_cents: 280, seller_net_cents: 2519, platform_fee_pct: 10 },
    ]);
    expect(total).toEqual({
      gross_cents: 12797,
      platform_fee_cents: 1280,
      seller_net_cents: 11517,
      platform_fee_pct: 10,
    });
    expect(sumMarketReceipts([]).gross_cents).toBe(0);
  });
});

const TEE: BrandingCartLine = { product: "tshirt", color: "black", size: "M", qty: 1 };

describe("the Branding cart", () => {
  it("quote-only goods are never carted — the premium rug stays quote-only", () => {
    expect(isQuoteOnly("rug-premium")).toBe(true);
    expect(BRANDING_PRODUCTS.filter((p) => p.quoteOnly).map((p) => p.key)).toEqual(["rug-premium"]);
    const cart = addBrandingCartLine([], { product: "rug-premium", color: "gold", size: "Custom shape", qty: 1 });
    expect(cart).toEqual([]);
  });

  it("merges identical variants and caps qty at 99", () => {
    let cart = addBrandingCartLine([], TEE);
    cart = addBrandingCartLine(cart, { ...TEE, qty: 2 });
    expect(cart).toHaveLength(1);
    expect(cart[0]!.qty).toBe(3);
    cart = addBrandingCartLine(cart, { ...TEE, size: "L" });
    expect(cart).toHaveLength(2);
    cart = addBrandingCartLine(cart, { ...TEE, qty: 500 });
    expect(cart[0]!.qty).toBe(99);
  });

  it("qty zero removes the line; totals use the catalog's real prices", () => {
    let cart = addBrandingCartLine([], { ...TEE, qty: 2 });
    cart = addBrandingCartLine(cart, { product: "mug", color: "gold", size: "11oz", qty: 1 });
    expect(brandingCartTotalCents(cart)).toBe(2 * 2499 + 1699);
    cart = setBrandingCartQty(cart, 0, 0);
    expect(cart.map((l) => l.product)).toEqual(["mug"]);
    expect(setBrandingCartQty(cart, 9, 3)).toBe(cart);
  });

  it("builds the page's exact order payload — rug logo rides as designUrl", () => {
    const payload = brandingOrderPayload(
      [{ product: "rug", color: "black", size: "2x3 ft", qty: 1, logoUrl: "https://cdn.test/logo.png" }, TEE],
      { name: " A ", email: "a@b.co", address: "1 St", city: " NYC ", state: "NY", zip: "10001" },
    );
    expect(payload.items).toEqual([
      { product: "rug", color: "black", size: "2x3 ft", qty: 1, designUrl: "https://cdn.test/logo.png" },
      { product: "tshirt", color: "black", size: "M", qty: 1 },
    ]);
    expect(payload.name).toBe("A");
    expect(payload.city).toBe("NYC");
  });

  it("shipping is complete only when every field is filled", () => {
    const full = { name: "A", email: "a@b.co", address: "1", city: "C", state: "S", zip: "Z" };
    expect(brandingShippingComplete(full)).toBe(true);
    expect(brandingShippingComplete({ ...full, zip: "  " })).toBe(false);
  });

  it("order statuses read in plain words; the design form needs name, niche, products", () => {
    expect(brandingOrderStatusLabel("in_production")).toBe("In production");
    expect(brandingOrderStatusLabel("received")).toBe("Received");
    expect(brandingOrderStatusLabel("some_new_state")).toBe("some new state");
    expect(BRANDING_DESIGN_COST).toBe(200);
    expect(brandingDesignComplete({ brandName: "X", niche: "rap", style: "bold", products: ["mug"] })).toBe(true);
    expect(brandingDesignComplete({ brandName: " ", niche: "rap", style: "bold", products: ["mug"] })).toBe(false);
    expect(brandingDesignComplete({ brandName: "X", niche: "rap", style: "bold", products: [] })).toBe(false);
  });
});

const TIER: MembershipTierDto = {
  id: "t1",
  creatorUserId: "11111111-1111-4111-8111-111111111111",
  name: "Front Row",
  priceDollars: 10,
  priceCents: 1000,
  description: "",
  perks: [],
  isActive: true,
  trialEnabled: true,
  annualDiscountPct: 20,
  annualPriceCents: 9600,
  annualPriceDollars: 96,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("Crowns & Memberships", () => {
  it("only active tiers become crown cards", () => {
    expect(activeMembershipTiers([TIER, { ...TIER, id: "t2", isActive: false }]).map((t) => t.id)).toEqual(["t1"]);
  });

  it("price labels read the server DTO's own amounts, per period, in the page's format", () => {
    expect(tierPriceLabel(TIER, "monthly")).toBe("$10 / month");
    expect(tierPriceLabel(TIER, "annual")).toBe("$96 / year");
    expect(tierPriceLabel({ ...TIER, priceDollars: 9.5 }, "monthly")).toBe("$9.50 / month");
    expect(tierPriceLabel({ ...TIER, priceCents: 0 }, "monthly")).toBe("Free");
    expect(tierAnnualSavingLabel(TIER)).toBe("Save 20% vs monthly");
    expect(tierAnnualSavingLabel({ ...TIER, annualDiscountPct: 0 })).toBeNull();
  });

  it("trials exist only on paid, trial-enabled tiers", () => {
    expect(tierOffersTrial(TIER)).toBe(true);
    expect(tierOffersTrial({ ...TIER, trialEnabled: false })).toBe(false);
    expect(tierOffersTrial({ ...TIER, priceCents: 0 })).toBe(false);
  });

  it("a creator id parses from a bare id or a pasted join link — never from junk", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseCreatorUserId(id)).toBe(id);
    expect(parseCreatorUserId(`https://bowdownvisuals.com/memberships?creator=${id}`)).toBe(id);
    expect(parseCreatorUserId("not-an-id")).toBeNull();
    expect(parseCreatorUserId("/memberships?creator=nope")).toBeNull();
    expect(parseCreatorUserId("")).toBeNull();
  });
});

describe("source pins — the stands' wiring (§3.3 endpoints, §3.9 new tab)", () => {
  it("marketplace stand rides the storefront endpoints and the per-shop cart storage", () => {
    expect(standsSrc).toContain("/api/storefronts?");
    expect(standsSrc).toContain("/api/storefronts/slug/");
    expect(standsSrc).toContain("/api/storefronts/checkout");
    expect(standsSrc).toContain("cartKey(");
    // The deeper /shop/:slug page route is never linked from the stand.
    expect(standsSrc).not.toContain("/shop/");
  });

  it("branding stand rides the branding-shop endpoints and the client catalog", () => {
    expect(standsSrc).toContain("BRANDING_PRODUCTS");
    expect(standsSrc).toContain("/api/branding-shop/upload-logo");
    expect(standsSrc).toContain("/api/branding-shop/design");
    expect(standsSrc).toContain("/api/branding-shop/orders");
    expect(standsSrc).toContain("/api/branding-shop/checkout");
    expect(standsSrc).toContain("CONTACT_FOR_QUOTE_LABEL");
  });

  it("crowns stand rides the memberships endpoints", () => {
    expect(standsSrc).toContain("/api/memberships/public/");
    expect(standsSrc).toContain("/api/memberships/join-trial");
    expect(standsSrc).toContain("/api/memberships/checkout");
    expect(standsSrc).toContain("/api/memberships/mine");
  });

  it("checkout opens its hosted page in a NEW TAB only — never a same-tab jump", () => {
    expect(standsSrc).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(standsSrc).not.toContain("window.location.href");
    expect(standsSrc).toContain("CHECKOUT_TRANSFER_LABEL");
  });

  it("the host dispatches the three shop stations to the stands, other patterns keep the placeholder", () => {
    expect(panelSrc).toContain('resolution.pattern === "shop"');
    expect(panelSrc).toContain("ShopStand");
    expect(panelSrc).toContain("NativePlaceholder");
  });
});
