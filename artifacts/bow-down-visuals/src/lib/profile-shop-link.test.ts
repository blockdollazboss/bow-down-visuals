/**
 * DE-13 — the profile Merch shelf's shop link. Public viewers must land
 * on the creator's PUBLIC shop page (/shop/<handle>) or the public
 * storefronts hub — never /my-shop, the signed-in owner's shop manager
 * (it ignores ?artist= and shows the visitor their own shop).
 */
import { describe, it, expect } from "vitest";
import { merchShopHref } from "./profile-shop-link";

describe("merchShopHref (DE-13)", () => {
  it("points at the creator's public shop page when they have a shop", () => {
    expect(merchShopHref({ shop_handle: "kings-corner" })).toBe("/shop/kings-corner");
  });

  it("falls back to the public storefronts hub when there is no shop", () => {
    expect(merchShopHref({ shop_handle: null })).toBe("/storefronts");
    expect(merchShopHref({ shop_handle: undefined })).toBe("/storefronts");
    expect(merchShopHref({})).toBe("/storefronts");
    expect(merchShopHref({ shop_handle: "   " })).toBe("/storefronts");
  });

  it("never points at the owner's shop manager", () => {
    for (const profile of [{ shop_handle: "x" }, { shop_handle: null }, {}]) {
      expect(merchShopHref(profile)).not.toContain("/my-shop");
    }
  });
});
