import { describe, it, expect } from "vitest";
import {
  centsToDisplay,
  dollarsToCents,
  cartKey,
  isValidHandle,
  addToCartLines,
  setCartLineQty,
  cartItemCount,
  cartTotalCents,
} from "./shops";

describe("centsToDisplay", () => {
  it("formats integer cents as dollars", () => {
    expect(centsToDisplay(1999)).toBe("$19.99");
    expect(centsToDisplay(0)).toBe("$0.00");
    expect(centsToDisplay(5)).toBe("$0.05");
    expect(centsToDisplay(100000)).toBe("$1000.00");
  });
  it("never shows a negative price", () => {
    expect(centsToDisplay(-250)).toBe("$0.00");
  });
  it("rounds fractional cents", () => {
    expect(centsToDisplay(1999.6)).toBe("$20.00");
  });
});

describe("dollarsToCents", () => {
  it("parses dollar strings to integer cents", () => {
    expect(dollarsToCents("19.99")).toBe(1999);
    expect(dollarsToCents("$19.99")).toBe(1999);
    expect(dollarsToCents("20")).toBe(2000);
    expect(dollarsToCents("0.05")).toBe(5);
  });
  it("returns null for garbage", () => {
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("free")).toBeNull();
    expect(dollarsToCents("-5")).toBeNull();
  });
  it("returns null for absurd prices", () => {
    expect(dollarsToCents("99999999")).toBeNull();
  });
});

describe("cartKey", () => {
  it("namespaces carts per shop handle", () => {
    expect(cartKey("Shark-King")).toBe("bdv-cart-shark-king");
    expect(cartKey("a")).not.toBe(cartKey("b"));
  });
});

describe("isValidHandle", () => {
  it("accepts good handles", () => {
    expect(isValidHandle("shark-king")).toBe(true);
    expect(isValidHandle("shop123")).toBe(true);
  });
  it("rejects bad shapes", () => {
    expect(isValidHandle("ab")).toBe(false);
    expect(isValidHandle("-lead")).toBe(false);
    expect(isValidHandle("trail-")).toBe(false);
    expect(isValidHandle("has space")).toBe(false);
    expect(isValidHandle("under_score")).toBe(false);
  });
  it("rejects reserved words", () => {
    expect(isValidHandle("admin")).toBe(false);
    expect(isValidHandle("checkout")).toBe(false);
    expect(isValidHandle("my-shop")).toBe(false);
  });
});

describe("cart line helpers", () => {
  it("addToCartLines adds new lines and bumps existing qty", () => {
    let cart = addToCartLines([], "p1");
    expect(cart).toEqual([{ productId: "p1", qty: 1 }]);
    cart = addToCartLines(cart, "p1");
    expect(cart).toEqual([{ productId: "p1", qty: 2 }]);
    cart = addToCartLines(cart, "p2");
    expect(cart).toHaveLength(2);
  });

  it("setCartLineQty updates and removes at zero", () => {
    const cart = [{ productId: "p1", qty: 2 }];
    expect(setCartLineQty(cart, "p1", 5)).toEqual([{ productId: "p1", qty: 5 }]);
    expect(setCartLineQty(cart, "p1", 0)).toEqual([]);
    expect(setCartLineQty(cart, "p1", -1)).toEqual([]);
  });

  it("cartItemCount sums quantities", () => {
    expect(cartItemCount([{ productId: "a", qty: 2 }, { productId: "b", qty: 3 }])).toBe(5);
    expect(cartItemCount([])).toBe(0);
  });

  it("cartTotalCents multiplies qty by price, ignoring unknown products", () => {
    const prices = new Map([["a", 1999], ["b", 500]]);
    const cart = [{ productId: "a", qty: 2 }, { productId: "b", qty: 1 }, { productId: "ghost", qty: 9 }];
    expect(cartTotalCents(cart, prices)).toBe(1999 * 2 + 500);
  });
});
