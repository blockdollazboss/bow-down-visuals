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
 * (f) Stand management (Stack-4 #7): ownership is proven ONLY by
 *     the caller's own /api/shops/mine list carrying the open
 *     shop's id (an unlanded read proves nothing); the product
 *     payload builders are the My Shop page's exact bodies; the
 *     list changes only from server-confirmed rows; and the AI
 *     helpers' displayed prices agree with the shared credit-cost
 *     registry and the server constants they mirror.
 * (g) Stand settings + sales (Stack-4 wave-2 #6): the settings and
 *     create forms ride the page's exact PATCH/POST bodies under
 *     gates mirroring the rails' own schemas; the sales view
 *     parses the owner-scoped analytics payload honestly (junk
 *     rows drop, a totals-less payload is no view at all, pending
 *     checkouts never fold into sales); shop deletion is the same
 *     two-step discipline as product deletion; custom domains stay
 *     website-side and the stand says so.
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
  marketOrderFromPayload,
  marketPendingKey,
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
  parseMineShops,
  isOwnStand,
  SHOP_AI_DESCRIPTION_COST_VB,
  SHOP_AI_IMAGE_STANDARD_COST_VB,
  SHOP_AI_IMAGE_PREMIUM_COST_VB,
  emptyProductForm,
  productFormFromDto,
  productFormProblem,
  buildProductPayload,
  buildProductDescriptionPayload,
  buildProductImagePayload,
  parseAiDescription,
  parseAiImageUrl,
  aiOutOfCredits,
  savedProductDto,
  applyProductSave,
  removeProduct,
  SHOP_AI_SHOP_DESCRIPTION_COST_VB,
  SHOP_NAME_MAX,
  SHOP_TAGLINE_MAX,
  SHOP_DESCRIPTION_MAX,
  SHOP_HANDLE_MIN,
  SHOP_HANDLE_MAX,
  emptyShopSettingsForm,
  shopSettingsFormFromShop,
  shopSettingsProblem,
  buildShopSettingsPayload,
  savedShopDto,
  emptyShopCreateForm,
  shopCreateProblem,
  buildShopCreatePayload,
  buildShopDescriptionPayload,
  parseShopAnalytics,
  recentShopSales,
  recentShopPending,
  maxDailyViews,
  SHOP_SALES_SHOWN,
  type BrandingCartLine,
  type MembershipTierDto,
  type MineShopDto,
  type PublicProductDto,
  type ShopAnalytics,
} from "./shop-stands";
import { BRANDING_PRODUCTS, BRANDING_DESIGN_COST } from "@/lib/branding-shop";
import { getCreditCost } from "@/lib/credit-costs";

const standsSrc = readFileSync(
  fileURLToPath(new URL("../../components/world/native/ShopStands.tsx", import.meta.url)),
  "utf8",
);
const shopPageSrc = readFileSync(
  fileURLToPath(new URL("../../pages/shop.tsx", import.meta.url)),
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

describe("Marketplace order truth (0144 — real card checkout)", () => {
  const paidPayload = {
    status: "paid", paid: true, gross_cents: 4500, platform_fee_cents: 450, seller_net_cents: 4050,
    lines: [
      { saleId: "s1", productId: "p1", productName: "Hoodie", quantity: 2, gross_cents: 4000, platform_fee_cents: 400, seller_net_cents: 3600 },
      { saleId: "s2", productId: "p2", productName: "Cap", quantity: 1, gross_cents: 500, platform_fee_cents: 50, seller_net_cents: 450 },
    ],
  };

  it("a confirmed order parses with its acquired items named (the reward moment's material)", () => {
    const order = marketOrderFromPayload(paidPayload);
    expect(order?.paid).toBe(true);
    expect(order?.status).toBe("paid");
    expect(order?.lines.map((l) => l.productName)).toEqual(["Hoodie", "Cap"]);
    expect(order?.gross_cents).toBe(4500);
  });

  it("a pending order NEVER parses as paid — status and flag must agree", () => {
    expect(marketOrderFromPayload({ status: "pending_payment", paid: false })?.paid).toBe(false);
    expect(marketOrderFromPayload({ status: "pending_payment", paid: true })?.paid).toBe(false);
    expect(marketOrderFromPayload({ status: "paid", paid: false })?.paid).toBe(false);
    expect(marketOrderFromPayload({ status: "expired", paid: false })?.status).toBe("expired");
    expect(marketOrderFromPayload({ nonsense: 1 })?.status).toBe("pending_payment");
    expect(marketOrderFromPayload(null)).toBeNull();
    expect(marketOrderFromPayload("paid")).toBeNull();
  });

  it("the pending-checkout marker is per shop handle", () => {
    expect(marketPendingKey("gold-shop")).toBe("bdv-market-pending-gold-shop");
  });

  it("the stand wires the verify door, the pending marker and the paid confirmation — and drops the old record-at-click receipt", () => {
    expect(standsSrc).toContain("/api/storefronts/checkout/verify");
    expect(standsSrc).toContain("marketPendingKey(");
    expect(standsSrc).toContain('data-testid="world-shop-paid-confirmation"');
    expect(standsSrc).toContain('data-testid="world-shop-pending-order"');
    expect(standsSrc).toContain('data-testid="world-shop-refresh-order"');
    expect(standsSrc).not.toContain("Order recorded at this stand");
    expect(standsSrc).not.toContain("follows up to complete payment");
  });

  it("the shop page verifies on return instead of trusting the redirect, and goes to the hosted page to pay", () => {
    expect(shopPageSrc).toContain("/api/storefronts/checkout/verify");
    expect(shopPageSrc).toContain("session_id");
    expect(shopPageSrc).toContain("window.location.href = url");
    expect(shopPageSrc).not.toContain("Card processing (Stripe Connect) is next");
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

describe("stand management — ownership (the /api/shops/mine proof)", () => {
  const MINE: MineShopDto[] = [
    { id: "shop-1", name: "Gold Standard", handle: "gold-standard", tagline: null, description: null, product_count: 2 },
    { id: "shop-2", name: "Second Stand", handle: "second-stand", tagline: null, description: null, product_count: 0 },
  ];

  it("parses the mine payload tolerantly — fuller server rows are fine, junk rows drop", () => {
    expect(
      parseMineShops({
        shops: [
          { id: "shop-1", name: "Gold Standard", handle: "gold-standard", tagline: "Only gold", description: "The story", product_count: 2, user_id: "u1", banner_color: "#000000" },
          { id: "shop-2", name: "Second Stand", handle: "second-stand" },
          { name: "No id", handle: "no-id" },
          { id: 42, name: "Numeric id", handle: "numeric" },
          "junk",
          null,
        ],
      }),
    ).toEqual([
      { id: "shop-1", name: "Gold Standard", handle: "gold-standard", tagline: "Only gold", description: "The story", product_count: 2 },
      { id: "shop-2", name: "Second Stand", handle: "second-stand", tagline: null, description: null, product_count: 0 },
    ]);
    expect(parseMineShops(null)).toEqual([]);
    expect(parseMineShops({})).toEqual([]);
    expect(parseMineShops({ shops: "nope" })).toEqual([]);
  });

  it("ownership holds ONLY when the landed mine list carries the open shop's id", () => {
    expect(isOwnStand(MINE, "shop-1")).toBe(true);
    expect(isOwnStand(MINE, "shop-2")).toBe(true);
    expect(isOwnStand(MINE, "someone-elses-shop")).toBe(false);
    expect(isOwnStand([], "shop-1")).toBe(false);
  });

  it("an unlanded mine read proves NOTHING — the gate fails closed", () => {
    expect(isOwnStand(null, "shop-1")).toBe(false);
    expect(isOwnStand(MINE, null)).toBe(false);
    expect(isOwnStand(MINE, undefined)).toBe(false);
    expect(isOwnStand(null, null)).toBe(false);
  });
});

describe("stand management — the product form rides the page's exact payloads", () => {
  const FORM = {
    name: "  Gold Hoodie  ",
    price: "49.99",
    description: "  Heavyweight fleece.  ",
    imageUrl: "  https://img.test/hoodie.png  ",
    styleHint: "  studio light  ",
  };

  it("the save body is the My Shop page's exact shape (trimmed, price in cents)", () => {
    expect(buildProductPayload(FORM)).toEqual({
      name: "Gold Hoodie",
      price_cents: 4999,
      description: "Heavyweight fleece.",
      image_url: "https://img.test/hoodie.png",
    });
  });

  it("the page's two save gates run in its order — name, then a sane price", () => {
    expect(productFormProblem({ ...FORM, name: "   " })).toBe("Give the product a name first.");
    expect(productFormProblem({ ...FORM, price: "" })).toBe("Enter a valid price — dollars and cents, like 19.99.");
    expect(productFormProblem({ ...FORM, price: "-5" })).toBe("Enter a valid price — dollars and cents, like 19.99.");
    expect(productFormProblem({ ...FORM, price: "abc" })).toBe("Enter a valid price — dollars and cents, like 19.99.");
    expect(productFormProblem(FORM)).toBeNull();
    expect(buildProductPayload({ ...FORM, name: "" })).toBeNull();
    expect(buildProductPayload({ ...FORM, price: "1.2.3" })).toBeNull();
  });

  it("a free product is a real price, not a gate failure (the page allows 0)", () => {
    expect(buildProductPayload({ ...FORM, price: "0" })?.price_cents).toBe(0);
    expect(buildProductPayload({ ...FORM, price: "$19.99" })?.price_cents).toBe(1999);
  });

  it("edit prefill is the page's derivation — dollars with two decimals, rest verbatim", () => {
    expect(productFormFromDto(PRODUCTS[0]!)).toEqual({
      name: "Hoodie",
      price: "49.99",
      description: "",
      imageUrl: "",
      styleHint: "",
    });
    expect(productFormFromDto(PRODUCTS[1]!)).toEqual({
      name: "Cap",
      price: "27.99",
      description: "Snapback",
      imageUrl: "",
      styleHint: "",
    });
    expect(emptyProductForm()).toEqual({ name: "", price: "", description: "", imageUrl: "", styleHint: "" });
  });

  it("the AI bodies are the page's exact shapes — description always writes luxury", () => {
    expect(buildProductDescriptionPayload(FORM)).toEqual({
      productName: "Gold Hoodie",
      details: "Heavyweight fleece.",
      price: "49.99",
      tone: "luxury",
    });
    expect(buildProductImagePayload(FORM, "standard")).toEqual({
      productName: "Gold Hoodie",
      styleHint: "studio light",
      tier: "standard",
    });
    expect(buildProductImagePayload(FORM, "premium")).toEqual({
      productName: "Gold Hoodie",
      styleHint: "studio light",
      tier: "premium",
    });
  });

  it("AI answers parse honestly — a payload without the goods is a failure, never a fill", () => {
    expect(parseAiDescription({ description: "Shines bright." })).toBe("Shines bright.");
    expect(parseAiDescription({ description: "   " })).toBeNull();
    expect(parseAiDescription({ error: "nope" })).toBeNull();
    expect(parseAiDescription(null)).toBeNull();
    expect(parseAiImageUrl({ url: "https://img.test/x.png" })).toBe("https://img.test/x.png");
    expect(parseAiImageUrl({ url: "" })).toBeNull();
    expect(parseAiImageUrl({})).toBeNull();
    expect(parseAiImageUrl(null)).toBeNull();
  });

  it("out-of-credits is the page's test: HTTP 402 or the payload's own flag", () => {
    expect(aiOutOfCredits(402, {})).toBe(true);
    expect(aiOutOfCredits(200, { error: "out_of_credits" })).toBe(true);
    expect(aiOutOfCredits(402, null)).toBe(true);
    expect(aiOutOfCredits(200, { description: "ok" })).toBe(false);
    expect(aiOutOfCredits(502, { error: "The studio hiccupped" })).toBe(false);
    expect(aiOutOfCredits(200, null)).toBe(false);
  });

  it("the displayed AI prices agree with the shared credit-cost registry", () => {
    expect(getCreditCost("/api/shops/ai/product-description")?.cost).toBe(SHOP_AI_DESCRIPTION_COST_VB);
    expect(getCreditCost("/api/shops/ai/product-image")?.cost).toBe(SHOP_AI_IMAGE_STANDARD_COST_VB);
    /* Premium is the registry's standard price doubled — the server
       constant's own relation (100 standard / 200 premium). */
    expect(SHOP_AI_IMAGE_PREMIUM_COST_VB).toBe(SHOP_AI_IMAGE_STANDARD_COST_VB * 2);
  });
});

describe("stand management — the list changes only from server-confirmed rows", () => {
  const SAVED: PublicProductDto = { id: "p3", name: "Tee", price_cents: 2500, description: null, image_url: null };

  it("a confirmed save parses into the stand's DTO — junk answers are not rows", () => {
    expect(
      savedProductDto({ product: { id: "p3", shop_id: "s1", user_id: "u1", name: "Tee", price_cents: 2500, description: null, image_url: null, created_at: "t" } }),
    ).toEqual(SAVED);
    expect(savedProductDto({ product: { id: "p3", name: "Tee" } })).toBeNull();
    expect(savedProductDto({ product: { name: "Tee", price_cents: 2500 } })).toBeNull();
    expect(savedProductDto({})).toBeNull();
    expect(savedProductDto(null)).toBeNull();
  });

  it("create appends the server's row; edit replaces the EDITED row only", () => {
    expect(applyProductSave(PRODUCTS, SAVED, null)).toEqual([...PRODUCTS, SAVED]);
    const edited: PublicProductDto = { ...PRODUCTS[0]!, name: "Hoodie V2", price_cents: 5999 };
    expect(applyProductSave(PRODUCTS, edited, "p1")).toEqual([edited, PRODUCTS[1]!]);
    /* An edit that matches nothing changes nothing — no phantom append. */
    expect(applyProductSave(PRODUCTS, edited, "missing-id")).toEqual(PRODUCTS);
  });

  it("remove drops exactly the confirmed row", () => {
    expect(removeProduct(PRODUCTS, "p1")).toEqual([PRODUCTS[1]!]);
    expect(removeProduct(PRODUCTS, "missing")).toEqual(PRODUCTS);
  });
});

describe("source pins — stand management wiring (Stack-4 #7)", () => {
  it("management is gated on the mine-list ownership proof — never rendered for guests", () => {
    expect(standsSrc).toContain('"/api/shops/mine"');
    expect(standsSrc).toContain("isOwnStand(mineShops, shop?.id)");
    expect(standsSrc).toContain("parseMineShops(");
    expect(standsSrc).toContain('data-testid="world-shop-manage"');
  });

  it("product writes ride the website's own shop rails — no parallel API", () => {
    expect(standsSrc).toContain("/api/shops/${shop.id}/products");
    expect(standsSrc).toContain("buildProductPayload(");
    expect(standsSrc).toContain('method: editingProduct ? "PATCH" : "POST"');
    expect(standsSrc).toContain('method: "DELETE"');
    expect(standsSrc).toContain("applyProductSave(");
    expect(standsSrc).toContain("savedProductDto(");
  });

  it("deletion is two-step in-world — the DELETE never fires on a first click", () => {
    expect(standsSrc).toContain("confirmingDeleteId");
    expect(standsSrc).toContain('data-testid="world-shop-manage-delete-confirm"');
  });

  it("the AI helpers ride the confirmed-spend seam with their prices shown up front", () => {
    expect(standsSrc).toContain('"/api/shops/ai/product-description"');
    expect(standsSrc).toContain('"/api/shops/ai/product-image"');
    expect(standsSrc).toContain("confirmedFetch(");
    expect(standsSrc).toContain("SHOP_AI_DESCRIPTION_COST_VB");
    expect(standsSrc).toContain("SHOP_AI_IMAGE_PREMIUM_COST_VB");
    expect(standsSrc).toContain("aiOutOfCredits(");
  });
});

describe("stand settings — the form rides the page's PATCH body (Stack-4 wave-2 #6)", () => {
  const SHOP_FORM = { name: "  Gold Standard  ", tagline: "  Only gold  ", description: "  The story.  " };

  it("prefill is the page's derivation — name verbatim, nulls read as empty", () => {
    expect(shopSettingsFormFromShop({ name: "Gold Standard", tagline: "Only gold", description: "The story" })).toEqual({
      name: "Gold Standard", tagline: "Only gold", description: "The story",
    });
    expect(shopSettingsFormFromShop({ name: "Bare", tagline: null, description: null })).toEqual({
      name: "Bare", tagline: "", description: "",
    });
    expect(emptyShopSettingsForm()).toEqual({ name: "", tagline: "", description: "" });
  });

  it("the save body is the My Shop page's exact shape (trimmed name/tagline/description)", () => {
    expect(buildShopSettingsPayload(SHOP_FORM)).toEqual({
      name: "Gold Standard", tagline: "Only gold", description: "The story.",
    });
  });

  it("the gates mirror the rail's own schema limits — a doomed save never rides", () => {
    expect(shopSettingsProblem({ ...SHOP_FORM, name: "   " })).toBe("Give your shop a name first.");
    expect(shopSettingsProblem({ ...SHOP_FORM, name: "x".repeat(SHOP_NAME_MAX + 1) })).toContain(String(SHOP_NAME_MAX));
    expect(shopSettingsProblem({ ...SHOP_FORM, tagline: "x".repeat(SHOP_TAGLINE_MAX + 1) })).toContain(String(SHOP_TAGLINE_MAX));
    expect(shopSettingsProblem({ ...SHOP_FORM, description: "x".repeat(SHOP_DESCRIPTION_MAX + 1) })).toContain(String(SHOP_DESCRIPTION_MAX));
    expect(shopSettingsProblem({ name: "x".repeat(SHOP_NAME_MAX), tagline: "x".repeat(SHOP_TAGLINE_MAX), description: "x".repeat(SHOP_DESCRIPTION_MAX) })).toBeNull();
    expect(shopSettingsProblem(SHOP_FORM)).toBeNull();
    expect(buildShopSettingsPayload({ ...SHOP_FORM, name: "" })).toBeNull();
  });

  it("a confirmed save parses into BOTH stand DTOs — junk answers are not rows", () => {
    expect(
      savedShopDto({ shop: { id: "s1", user_id: "u1", name: "Gold Standard", handle: "gold-standard", tagline: "Only gold", description: "The story", banner_color: "#000" } }),
    ).toEqual({
      mine: { id: "s1", name: "Gold Standard", handle: "gold-standard", tagline: "Only gold", description: "The story", product_count: 0 },
      pub: { id: "s1", name: "Gold Standard", handle: "gold-standard", tagline: "Only gold", description: "The story" },
    });
    expect(savedShopDto({ shop: { id: "s1", name: "No handle" } })).toBeNull();
    expect(savedShopDto({ shop: { name: "No id", handle: "x" } })).toBeNull();
    expect(savedShopDto({})).toBeNull();
    expect(savedShopDto(null)).toBeNull();
  });

  it("the shop-description writer's body is the page's exact shape — products joined its way", () => {
    expect(buildShopDescriptionPayload({ shopName: " Gold Standard ", tagline: " Only gold ", niche: " streetwear ", productNames: ["Hoodie", "Cap"] })).toEqual({
      shopName: "Gold Standard", tagline: "Only gold", niche: "streetwear", products: "Hoodie, Cap",
    });
    expect(buildShopDescriptionPayload({ shopName: "Bare", tagline: "", niche: "", productNames: [] })).toEqual({
      shopName: "Bare", tagline: "", niche: "", products: "",
    });
  });

  it("the writer's displayed price agrees with the shared credit-cost registry", () => {
    expect(getCreditCost("/api/shops/ai/shop-description")?.cost).toBe(SHOP_AI_SHOP_DESCRIPTION_COST_VB);
  });
});

describe("stand create — the form rides the page's POST body (Stack-4 wave-2 #6)", () => {
  const CREATE_FORM = { name: "  Gold Standard  ", handle: " gold-standard ", tagline: "  Only gold  " };

  it("the create body is the My Shop page's exact shape", () => {
    expect(buildShopCreatePayload(CREATE_FORM)).toEqual({
      name: "Gold Standard", handle: "gold-standard", tagline: "Only gold",
    });
    expect(emptyShopCreateForm()).toEqual({ name: "", handle: "", tagline: "" });
  });

  it("the handle gate takes the shapes the server's normalizer accepts — and no others", () => {
    expect(shopCreateProblem(CREATE_FORM)).toBeNull();
    expect(shopCreateProblem({ ...CREATE_FORM, handle: "Gold-Standard" })).toBeNull();
    expect(shopCreateProblem({ ...CREATE_FORM, handle: "ab" })).toContain(String(SHOP_HANDLE_MIN));
    expect(shopCreateProblem({ ...CREATE_FORM, handle: "x".repeat(SHOP_HANDLE_MAX + 1) })).toContain(String(SHOP_HANDLE_MAX));
    expect(shopCreateProblem({ ...CREATE_FORM, handle: "gold_standard" })).not.toBeNull();
    expect(shopCreateProblem({ ...CREATE_FORM, handle: "gold--standard" })).not.toBeNull();
    expect(shopCreateProblem({ ...CREATE_FORM, handle: "-gold" })).not.toBeNull();
    expect(shopCreateProblem({ ...CREATE_FORM, handle: "gold-" })).not.toBeNull();
    expect(shopCreateProblem({ ...CREATE_FORM, handle: "gold standard" })).not.toBeNull();
    expect(buildShopCreatePayload({ ...CREATE_FORM, handle: "no way" })).toBeNull();
  });

  it("the name gate runs before the handle gate — the page's order", () => {
    expect(shopCreateProblem({ name: " ", handle: "!!", tagline: "" })).toBe("Give your shop a name first.");
  });
});

describe("stand sales — the ledger parses honestly (Stack-4 wave-2 #6)", () => {
  const ANALYTICS_PAYLOAD = {
    totals: { views: 128, sales: 3, gross_cents: 12497, platform_fee_cents: 625, seller_net_cents: 11872, pending_orders: 1 },
    dailyViews: [
      { day: "2026-10-19", views: 9 },
      { day: "2026-10-20", views: 14 },
    ],
    sales: [
      { id: "e1", product_id: "p1", product_name: "Hoodie", amount_cents: 4999, platform_fee_cents: 250, seller_net_cents: 4749, buyer_email: "fan@test.dev", created_at: "2026-10-20T10:00:00Z", quantity: 1, payment_status: "paid", paid_at: "2026-10-20T10:01:00Z" },
      { id: "e2", product_id: "p2", product_name: null, amount_cents: 0, platform_fee_cents: 0, seller_net_cents: 0, buyer_email: null, created_at: "2026-10-19T09:00:00Z", quantity: 1, payment_status: "no_payment_required", paid_at: null },
      { product_name: "No id — dropped", amount_cents: 100 },
      "junk",
    ],
    pendingSales: [
      { id: "e3", product_id: "p1", product_name: "Hoodie", amount_cents: 4999, platform_fee_cents: 250, seller_net_cents: 4749, buyer_email: "slow@test.dev", created_at: "2026-10-20T11:00:00Z", quantity: 1, payment_status: "pending" },
    ],
    platformFeePct: 5,
  };

  it("parses the analytics rail's payload — totals verbatim, junk rows dropped, never repaired", () => {
    const a = parseShopAnalytics(ANALYTICS_PAYLOAD);
    expect(a).not.toBeNull();
    expect(a!.totals).toEqual({ views: 128, sales: 3, gross_cents: 12497, platform_fee_cents: 625, seller_net_cents: 11872, pending_orders: 1 });
    expect(a!.sales).toHaveLength(2);
    expect(a!.sales[0]).toEqual({
      id: "e1", product_name: "Hoodie", amount_cents: 4999, seller_net_cents: 4749,
      buyer_email: "fan@test.dev", created_at: "2026-10-20T10:00:00Z", payment_status: "paid", paid_at: "2026-10-20T10:01:00Z",
    });
    expect(a!.pendingSales).toHaveLength(1);
    expect(a!.pendingSales[0]!.payment_status).toBe("pending");
    expect(a!.platformFeePct).toBe(5);
    expect(a!.dailyViews).toEqual([
      { day: "2026-10-19", views: 9 },
      { day: "2026-10-20", views: 14 },
    ]);
  });

  it("a payload without honest totals is NOT a sales view — zeros are never invented", () => {
    expect(parseShopAnalytics(null)).toBeNull();
    expect(parseShopAnalytics({})).toBeNull();
    expect(parseShopAnalytics({ totals: { views: "many", sales: 3, gross_cents: 1, seller_net_cents: 1 } })).toBeNull();
    expect(parseShopAnalytics({ totals: { views: 1, sales: 1 } })).toBeNull();
    expect(parseShopAnalytics({ error: "Shop not found." })).toBeNull();
  });

  it("pending stays apart from sales, and the view caps both at the page's ten", () => {
    const many: ShopAnalytics = {
      totals: { views: 0, sales: 0, gross_cents: 0, platform_fee_cents: 0, seller_net_cents: 0, pending_orders: 0 },
      dailyViews: [],
      sales: Array.from({ length: 15 }, (_, i) => ({
        id: `s${i}`, product_name: "P", amount_cents: 1, seller_net_cents: 1, buyer_email: null,
        created_at: "2026-10-20T00:00:00Z", payment_status: "paid", paid_at: null,
      })),
      pendingSales: Array.from({ length: 12 }, (_, i) => ({
        id: `q${i}`, product_name: "P", amount_cents: 1, seller_net_cents: 1,
        created_at: "2026-10-20T00:00:00Z", payment_status: "pending",
      })),
      platformFeePct: 5,
    };
    expect(recentShopSales(many)).toHaveLength(SHOP_SALES_SHOWN);
    expect(recentShopPending(many)).toHaveLength(SHOP_SALES_SHOWN);
    expect(SHOP_SALES_SHOWN).toBe(10);
  });

  it("the views strip scales off the tallest day, and never below 1", () => {
    const a = parseShopAnalytics(ANALYTICS_PAYLOAD)!;
    expect(maxDailyViews(a)).toBe(14);
    expect(maxDailyViews({ ...a, dailyViews: [] })).toBe(1);
    expect(maxDailyViews({ ...a, dailyViews: [{ day: "2026-10-20", views: 0 }] })).toBe(1);
  });
});

describe("source pins — stand settings + sales wiring (Stack-4 wave-2 #6)", () => {
  it("settings ride the website's own shop rails — PATCH/POST/DELETE /api/shops, no parallel API", () => {
    expect(standsSrc).toContain("`/api/shops/${shop.id}`");
    expect(standsSrc).toContain('method: "PATCH"');
    expect(standsSrc).toContain('fetch("/api/shops"');
    expect(standsSrc).toContain("buildShopSettingsPayload(");
    expect(standsSrc).toContain("buildShopCreatePayload(");
    expect(standsSrc).toContain("savedShopDto(");
  });

  it("the whole desk stays behind the ownership gate — settings and sales render only for the proven owner", () => {
    expect(standsSrc).toContain('data-testid="world-shop-settings"');
    expect(standsSrc).toContain('data-testid="world-shop-sales"');
    /* Both benches live inside StandManager, which MarketplaceStand
       renders only under ownsStand — the gate line itself is pinned
       by the #7 block above; here the benches' home is pinned. */
    const managerAt = standsSrc.indexOf("function StandManager");
    expect(standsSrc.indexOf('data-testid="world-shop-settings"')).toBeGreaterThan(managerAt);
    expect(standsSrc.indexOf('data-testid="world-shop-sales"')).toBeGreaterThan(managerAt);
    expect(standsSrc.indexOf("function StandCreateShop")).toBeGreaterThan(-1);
  });

  it("sales read the owner-scoped analytics rail the My Shop page reads", () => {
    expect(standsSrc).toContain("/api/storefronts/${shop.id}/analytics");
    expect(standsSrc).toContain("parseShopAnalytics(");
    expect(standsSrc).toContain("recentShopSales(");
    expect(standsSrc).toContain("recentShopPending(");
  });

  it("shop deletion is two-step in-world, exactly like product deletion", () => {
    expect(standsSrc).toContain("confirmingDeleteShop");
    expect(standsSrc).toContain('data-testid="world-shop-settings-delete-confirm"');
  });

  it("the shop writer rides the confirmed-spend seam with its price shown up front", () => {
    expect(standsSrc).toContain('"/api/shops/ai/shop-description"');
    expect(standsSrc).toContain("buildShopDescriptionPayload(");
    expect(standsSrc).toContain("SHOP_AI_SHOP_DESCRIPTION_COST_VB");
  });

  it("custom domains are named as website-side — the stand never fakes a domain rail", () => {
    expect(standsSrc).toContain("Custom domains live on your shop&rsquo;s page on the website");
    expect(standsSrc).not.toContain("/domain");
  });
});
