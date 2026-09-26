import { describe, it, expect } from "vitest";
import {
  BRANDING_PRODUCTS,
  BRANDING_COLORS,
  BRANDING_STYLES,
  BRANDING_DESIGN_COST,
  MAX_DESIGN_PRODUCTS,
  formatMoney,
  productByKey,
  cartTotal,
} from "./branding-shop";

describe("branding shop catalog", () => {
  it("has seven products with positive cent prices and sizes", () => {
    expect(BRANDING_PRODUCTS).toHaveLength(7);
    for (const p of BRANDING_PRODUCTS) {
      expect(Number.isInteger(p.priceCents)).toBe(true);
      expect(p.priceCents).toBeGreaterThan(0);
      expect(p.sizes.length).toBeGreaterThan(0);
    }
  });

  it("covers the full POD lineup", () => {
    expect(BRANDING_PRODUCTS.map((p) => p.key).sort()).toEqual(
      ["hoodie", "mug", "phonecase", "poster", "snapback", "tote", "tshirt"]
    );
  });

  it("has three color options", () => {
    expect(BRANDING_COLORS.map((c) => c.key).sort()).toEqual(["black", "gold", "white"]);
  });

  it("has four brand styles", () => {
    expect(BRANDING_STYLES.map((s) => s.key).sort()).toEqual(
      ["bold", "luxury-gold", "minimal", "streetwear"]
    );
  });

  it("charges 2 credits per AI design set, max 3 mockup products", () => {
    expect(BRANDING_DESIGN_COST).toBe(2);
    expect(MAX_DESIGN_PRODUCTS).toBe(3);
  });
});

describe("formatMoney", () => {
  it("formats cents as dollars", () => {
    expect(formatMoney(2499)).toBe("$24.99");
    expect(formatMoney(100)).toBe("$1.00");
    expect(formatMoney(0)).toBe("$0.00");
  });
});

describe("productByKey", () => {
  it("resolves the hoodie", () => {
    expect(productByKey("hoodie").label).toBe("Luxury Hoodie");
    expect(productByKey("hoodie").priceCents).toBe(4999);
  });

  it("throws on an unknown key", () => {
    expect(() => productByKey("yacht" as never)).toThrow();
  });
});

describe("cartTotal", () => {
  it("sums price x qty from the catalog", () => {
    expect(
      cartTotal([
        { product: "tshirt", qty: 2 },
        { product: "mug", qty: 1 },
      ])
    ).toBe(2499 * 2 + 1699);
  });

  it("is zero for an empty cart", () => {
    expect(cartTotal([])).toBe(0);
  });
});
