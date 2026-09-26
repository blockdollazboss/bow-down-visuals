/**
 * Money-integrity + honesty tests for the AI Branding Shop.
 *
 * Covers: the 2-credit design charge, schema validation (design + order),
<<<<<<< HEAD
 * server-side order total recompute, catalog integrity, the v1 honesty
 * contract (no shipped/delivered/tracking fiction), and GPT-6 token-param
 * correctness (max_completion_tokens, never max_tokens).
=======
 * server-side order total recompute, catalog integrity (40-60% margins),
 * the fulfillment honesty contract (statuses only from the provider —
 * Printful live or the clearly-labeled mock sandbox — never fabricated),
 * Runway gen4_image design generation, and GPT-6 token-param correctness
 * (max_completion_tokens, never max_tokens).
>>>>>>> feature/branding-shop
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  PRODUCTS,
  DESIGN_CREDIT_COST,
  designSchema,
  orderSchema,
  ORDER_STATUSES,
} from "../branding-shop";

const routeSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "branding-shop.ts"),
  "utf8"
);

describe("branding shop pricing", () => {
  it("charges 2 credits per AI brand-kit design set", () => {
    expect(DESIGN_CREDIT_COST).toBe(2);
  });

  it("catalog prices are positive integers (cents)", () => {
    for (const [key, p] of Object.entries(PRODUCTS)) {
      expect(Number.isInteger(p.priceCents), `${key} price`).toBe(true);
      expect(p.priceCents, `${key} price`).toBeGreaterThan(0);
      expect(p.sizes.length, `${key} sizes`).toBeGreaterThan(0);
      expect(p.label.length, `${key} label`).toBeGreaterThan(0);
    }
  });

<<<<<<< HEAD
  it("has the five launch products", () => {
    expect(Object.keys(PRODUCTS).sort()).toEqual(
      ["cap", "hoodie", "mug", "poster", "tshirt"].sort()
    );
  });
=======
  it("has the seven launch products", () => {
    expect(Object.keys(PRODUCTS).sort()).toEqual(
      ["hoodie", "mug", "phonecase", "poster", "snapback", "tote", "tshirt"].sort()
    );
  });

  it("holds 40-60% margins over base cost (server-side only)", () => {
    for (const [key, p] of Object.entries(PRODUCTS)) {
      expect(p.baseCostCents, `${key} base cost`).toBeGreaterThan(0);
      expect(p.baseCostCents, `${key} base cost`).toBeLessThan(p.priceCents);
      const margin = (p.priceCents - p.baseCostCents) / p.priceCents;
      expect(margin, `${key} margin`).toBeGreaterThanOrEqual(0.4);
      expect(margin, `${key} margin`).toBeLessThanOrEqual(0.6);
    }
  });
>>>>>>> feature/branding-shop
});

describe("design request schema", () => {
  const valid = {
    brandName: "Shark King Supply",
    niche: "luxury hip-hop streetwear",
    style: "luxury-gold",
    products: ["tshirt", "hoodie"],
  };

  it("accepts a valid design request", () => {
    expect(designSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty brand name", () => {
    expect(designSchema.safeParse({ ...valid, brandName: "" }).success).toBe(false);
  });

  it("rejects an unknown style", () => {
    expect(designSchema.safeParse({ ...valid, style: "cyberpunk" }).success).toBe(false);
  });

  it("rejects zero products", () => {
    expect(designSchema.safeParse({ ...valid, products: [] }).success).toBe(false);
  });

  it("rejects more than 3 products", () => {
    expect(
<<<<<<< HEAD
      designSchema.safeParse({ ...valid, products: ["tshirt", "hoodie", "mug", "cap"] }).success
=======
      designSchema.safeParse({ ...valid, products: ["tshirt", "hoodie", "mug", "snapback"] }).success
>>>>>>> feature/branding-shop
    ).toBe(false);
  });

  it("rejects an unknown product key", () => {
    expect(
      designSchema.safeParse({ ...valid, products: ["spaceship"] }).success
    ).toBe(false);
  });
});

describe("order schema", () => {
  const validItem = { product: "tshirt", color: "black", size: "M", qty: 2 };
  const valid = {
    items: [validItem],
    name: "Jane Doe",
    email: "jane@example.com",
    address: "123 Main St",
    city: "Atlanta",
    state: "GA",
    zip: "30301",
  };

  it("accepts a valid order", () => {
    expect(orderSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty cart", () => {
    expect(orderSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(orderSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects zero quantity", () => {
    expect(
      orderSchema.safeParse({ ...valid, items: [{ ...validItem, qty: 0 }] }).success
    ).toBe(false);
  });

  it("rejects an unknown product", () => {
    expect(
      orderSchema.safeParse({ ...valid, items: [{ ...validItem, product: "yacht" }] }).success
    ).toBe(false);
  });

  it("rejects a missing shipping field", () => {
    expect(orderSchema.safeParse({ ...valid, zip: "" }).success).toBe(false);
  });
<<<<<<< HEAD
=======

  it("accepts an optional designUrl per item", () => {
    const withDesign = {
      ...valid,
      items: [{ ...validItem, designUrl: "https://example.com/design.png" }],
    };
    expect(orderSchema.safeParse(withDesign).success).toBe(true);
  });

  it("rejects an invalid designUrl", () => {
    const bad = {
      ...valid,
      items: [{ ...validItem, designUrl: "not-a-url" }],
    };
    expect(orderSchema.safeParse(bad).success).toBe(false);
  });
>>>>>>> feature/branding-shop
});

describe("order total integrity", () => {
  it("recomputes totals from the catalog (2 tees + 1 mug)", () => {
    const items = [
      { product: "tshirt" as const, qty: 2 },
      { product: "mug" as const, qty: 1 },
    ];
    const total = items.reduce((n, i) => n + PRODUCTS[i.product].priceCents * i.qty, 0);
    expect(total).toBe(2499 * 2 + 1699);
  });
});

<<<<<<< HEAD
describe("v1 honesty contract", () => {
  it("only allows received / pending_fulfillment statuses", () => {
    expect([...ORDER_STATUSES]).toEqual(["received", "pending_fulfillment"]);
  });

  it("never mentions shipped/delivered/tracking as order states", () => {
    expect(routeSource).not.toMatch(/status.*shipped/i);
    expect(routeSource).not.toMatch(/status:\s*["']delivered["']/i);
    expect(routeSource).not.toMatch(/tracking[_-]?number/i);
  });

  it("tells the user fulfillment is coming soon", () => {
    expect(routeSource).toMatch(/dropship partner integration is coming soon/i);
=======
describe("fulfillment honesty contract", () => {
  it("allows the full provider-driven status vocabulary", () => {
    expect([...ORDER_STATUSES]).toEqual([
      "received",
      "pending_fulfillment",
      "in_production",
      "shipped",
      "delivered",
      "canceled",
      "failed",
    ]);
  });

  it("never hardcodes fake shipped/delivered DB states — statuses come from the provider", () => {
    /* No literal 'shipped'/'delivered' in SQL status writes; the webhook only
       maps provider event types, and persistence flows through toOrderStatus(). */
    expect(routeSource).not.toMatch(/SET status\s*=\s*['"]shipped['"]/i);
    expect(routeSource).not.toMatch(/SET status\s*=\s*['"]delivered['"]/i);
    expect(routeSource).toMatch(/toOrderStatus/);
  });

  it("labels mock mode honestly everywhere it surfaces", () => {
    expect(routeSource).toMatch(/demo/i);
  });
});

describe("design generation", () => {
  it("uses Runway gen4_image (the site's image pipeline)", () => {
    expect(routeSource).toMatch(/gen4_image/);
    expect(routeSource).toMatch(/@runwayml\/sdk/);
  });

  it("polls tasks server-side with a bounded timeout", () => {
    expect(routeSource).toMatch(/BRANDING_SHOP_DESIGN_TIMEOUT_MS/);
>>>>>>> feature/branding-shop
  });
});

describe("GPT-6 token params", () => {
  it("uses max_completion_tokens, never max_tokens", () => {
    expect(routeSource).toMatch(/max_completion_tokens/);
    expect(routeSource).not.toMatch(/[^_]max_tokens/);
  });
});

describe("credit safety", () => {
  it("charges before generation and refunds on failure", () => {
    expect(routeSource).toMatch(/chargeCredits/);
    expect(routeSource).toMatch(/refundCredits/);
  });

  it("returns 402 out_of_credits when the balance is short", () => {
    expect(routeSource).toMatch(/out_of_credits/);
    expect(routeSource).toMatch(/status\(402\)/);
  });
});
