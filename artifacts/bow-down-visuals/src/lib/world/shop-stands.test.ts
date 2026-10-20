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
  type BrandingCartLine,
  type MembershipTierDto,
  type MineShopDto,
  type PublicProductDto,
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
    { id: "shop-1", name: "Gold Standard", handle: "gold-standard", product_count: 2 },
    { id: "shop-2", name: "Second Stand", handle: "second-stand", product_count: 0 },
  ];

  it("parses the mine payload tolerantly — fuller server rows are fine, junk rows drop", () => {
    expect(
      parseMineShops({
        shops: [
          { id: "shop-1", name: "Gold Standard", handle: "gold-standard", product_count: 2, user_id: "u1", banner_color: "#000000" },
          { id: "shop-2", name: "Second Stand", handle: "second-stand" },
          { name: "No id", handle: "no-id" },
          { id: 42, name: "Numeric id", handle: "numeric" },
          "junk",
          null,
        ],
      }),
    ).toEqual([
      { id: "shop-1", name: "Gold Standard", handle: "gold-standard", product_count: 2 },
      { id: "shop-2", name: "Second Stand", handle: "second-stand", product_count: 0 },
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
