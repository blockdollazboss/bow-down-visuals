/**
 * Quantity bounds for the /storefront/product/:id page (DE-13's new
 * public product page): the picker can never ask for more than the
 * seller has, and never less than one. The server re-validates at
 * checkout — this keeps the UI honest.
 */
import { describe, it, expect } from "vitest";
import { clampQuantity, maxQuantity, MAX_QUANTITY } from "./storefront-product";

describe("storefront product quantity bounds", () => {
  it("caps at tracked inventory on hand", () => {
    expect(maxQuantity(3, false)).toBe(3);
    expect(clampQuantity(10, 3, false)).toBe(3);
    expect(clampQuantity(2, 3, false)).toBe(2);
  });

  it("unlimited stock uses the house cap", () => {
    expect(maxQuantity(-1, true)).toBe(MAX_QUANTITY);
    expect(clampQuantity(500, -1, true)).toBe(MAX_QUANTITY);
  });

  it("untracked stock (inventory 0, not sold out) uses the house cap", () => {
    expect(maxQuantity(0, false)).toBe(MAX_QUANTITY);
    expect(clampQuantity(12, 0, false)).toBe(12);
  });

  it("never goes below one and floors fractions", () => {
    expect(clampQuantity(0, 5, false)).toBe(1);
    expect(clampQuantity(-4, 5, false)).toBe(1);
    expect(clampQuantity(2.9, 5, false)).toBe(2);
    expect(clampQuantity(Number.NaN, 5, false)).toBe(1);
  });
});
