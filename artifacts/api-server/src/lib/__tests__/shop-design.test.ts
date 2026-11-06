/**
 * shop-design.test.ts — the layout/font vocabulary + sanitizer
 * (migration 0320, store-starters lane).
 *
 * Pins:
 *  - the vocabulary is exactly the closed pair of lists the FE
 *    registry mirrors (lib/shop-design in the web app);
 *  - the defaults ARE the pre-0320 storefront ('showcase' layout =
 *    the hardcoded grid the page always rendered; 'house' font = the
 *    inherited shell type) — an untouched shop must not change;
 *  - the sanitizer passes valid values through and falls back to the
 *    defaults on anything else (absent keys, null, bent stored
 *    values), so a presented design is always renderable.
 */
import { describe, it, expect } from "vitest";
import {
  SHOP_LAYOUT_STYLES,
  SHOP_FONT_STYLES,
  DEFAULT_SHOP_DESIGN,
  sanitizeShopLayoutStyle,
  sanitizeShopFontStyle,
  sanitizeShopDesign,
} from "../shop-design";

describe("shop design vocabulary", () => {
  it("is exactly the closed layout + font lists", () => {
    expect(SHOP_LAYOUT_STYLES).toEqual(["showcase", "gallery", "list", "hero"]);
    expect(SHOP_FONT_STYLES).toEqual(["house", "royal", "classic"]);
  });

  it("defaults are the pre-0320 storefront look", () => {
    expect(DEFAULT_SHOP_DESIGN).toEqual({ layout_style: "showcase", font_style: "house" });
  });
});

describe("sanitizers", () => {
  it("pass valid values through", () => {
    for (const v of SHOP_LAYOUT_STYLES) expect(sanitizeShopLayoutStyle(v)).toBe(v);
    for (const v of SHOP_FONT_STYLES) expect(sanitizeShopFontStyle(v)).toBe(v);
    expect(sanitizeShopDesign({ layout_style: "list", font_style: "classic" })).toEqual({
      layout_style: "list",
      font_style: "classic",
    });
  });

  it("fall back to the defaults on absent or bent values", () => {
    for (const bent of [undefined, null, "", "banana", "SHOWCASE", 42, {}, []]) {
      expect(sanitizeShopLayoutStyle(bent)).toBe("showcase");
      expect(sanitizeShopFontStyle(bent)).toBe("house");
    }
    expect(sanitizeShopDesign(null)).toEqual(DEFAULT_SHOP_DESIGN);
    expect(sanitizeShopDesign(undefined)).toEqual(DEFAULT_SHOP_DESIGN);
    expect(sanitizeShopDesign({})).toEqual(DEFAULT_SHOP_DESIGN);
    expect(sanitizeShopDesign({ layout_style: "gallery", font_style: "bent" })).toEqual({
      layout_style: "gallery",
      font_style: "house",
    });
  });
});
