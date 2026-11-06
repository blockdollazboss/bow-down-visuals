/**
 * shop-look-starters.test.ts — the LOOK starter registry: curated
 * layout + font pairings (migration 0320, store-starters lane).
 *
 * The color starters (shop-starters.test.ts) stay pinned to their two
 * persisted fields; this suite pins the parallel axis:
 *  - every look names a REAL layout + font from lib/shop-design, and
 *    the shelf can reach every layout and every font;
 *  - shopLookPatch writes ONLY layout_style + font_style, so applying
 *    a look can never restyle colors (and vice versa);
 *  - the untouched look (House Classic) IS the persisted defaults —
 *    it matches shops whose settings are absent entirely;
 *  - the storefront actually renders from the settings (shop.tsx
 *    resolves the specs and binds grid/image/title to them) while the
 *    load-bearing pre-0320 markup literals stay untouched.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SHOP_LOOK_STARTERS,
  shopLookStarterById,
  shopLookPatch,
  isLookStarterApplied,
} from "./shop-starters";
import { SHOP_LAYOUT_IDS, SHOP_FONT_IDS } from "./shop-design";

const storefrontPage = readFileSync(new URL("../pages/shop.tsx", import.meta.url), "utf8");

describe("the look registry", () => {
  it("ships a designed set with unique ids and unique pairings", () => {
    expect(SHOP_LOOK_STARTERS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(SHOP_LOOK_STARTERS.map((s) => s.id)).size).toBe(SHOP_LOOK_STARTERS.length);
    const pairings = SHOP_LOOK_STARTERS.map(
      (s) => `${s.settings.layout_style}+${s.settings.font_style}`,
    );
    expect(new Set(pairings).size).toBe(pairings.length);
    for (const look of SHOP_LOOK_STARTERS) {
      expect(look.name.length).toBeGreaterThan(0);
      expect(look.blurb.length).toBeGreaterThan(0);
      expect(look.bestFor.length).toBeGreaterThan(0);
      expect(shopLookStarterById(look.id)).toBe(look);
    }
    expect(shopLookStarterById("nope")).toBeUndefined();
  });

  it("every look names a real layout + font, and the shelf reaches every axis value", () => {
    for (const look of SHOP_LOOK_STARTERS) {
      expect(SHOP_LAYOUT_IDS).toContain(look.settings.layout_style);
      expect(SHOP_FONT_IDS).toContain(look.settings.font_style);
    }
    for (const layout of SHOP_LAYOUT_IDS) {
      expect(SHOP_LOOK_STARTERS.some((s) => s.settings.layout_style === layout)).toBe(true);
    }
    for (const font of SHOP_FONT_IDS) {
      expect(SHOP_LOOK_STARTERS.some((s) => s.settings.font_style === font)).toBe(true);
    }
  });

  it("names no provider font — the pairings speak our layout/type vocabulary only", () => {
    const allCopy = SHOP_LOOK_STARTERS.map((s) => `${s.name} ${s.blurb} ${s.bestFor}`).join(" ");
    expect(allCopy).not.toMatch(/manrope|cinzel|georgia/i);
  });
});

describe("shopLookPatch — the rail body", () => {
  it("carries ONLY the two persisted design fields", () => {
    for (const look of SHOP_LOOK_STARTERS) {
      const patch = shopLookPatch(look);
      expect(Object.keys(patch).sort()).toEqual(["font_style", "layout_style"]);
      expect(patch).toEqual(look.settings);
      expect(patch).not.toBe(look.settings);
    }
  });
});

describe("isLookStarterApplied", () => {
  const houseClassic = shopLookStarterById("house-classic")!;
  const royalGallery = shopLookStarterById("royal-gallery")!;

  it("the untouched look IS the defaults — absent settings match it", () => {
    expect(houseClassic.settings).toEqual({ layout_style: "showcase", font_style: "house" });
    expect(isLookStarterApplied({}, houseClassic)).toBe(true);
    expect(isLookStarterApplied({ layout_style: null, font_style: null }, houseClassic)).toBe(true);
    expect(isLookStarterApplied({ layout_style: "showcase", font_style: "house" }, houseClassic)).toBe(true);
  });

  it("matches exactly, normalizing bent values to the defaults first", () => {
    expect(isLookStarterApplied({ layout_style: "gallery", font_style: "royal" }, royalGallery)).toBe(true);
    expect(isLookStarterApplied({ layout_style: "gallery", font_style: "house" }, royalGallery)).toBe(false);
    expect(isLookStarterApplied({ layout_style: "bent", font_style: "house" }, houseClassic)).toBe(true);
    expect(isLookStarterApplied({ layout_style: "gallery", font_style: "royal" }, houseClassic)).toBe(false);
  });
});

describe("the storefront renders from the settings", () => {
  it("shop.tsx resolves the shop's design through the registry", () => {
    expect(storefrontPage).toContain("normalizeShopLayoutId(shop?.layout_style)");
    expect(storefrontPage).toContain("normalizeShopFontId(shop?.font_style)");
    expect(storefrontPage).toContain("layoutSpec.contentClass");
    expect(storefrontPage).toContain("layoutSpec.gridClass");
    expect(storefrontPage).toContain("layoutSpec.imageClass");
    expect(storefrontPage).toContain("layoutSpec.placeholderClass");
    expect(storefrontPage).toContain("fontSpec.displayClass");
    expect(storefrontPage).toContain("fontSpec.bodyFontFamily");
  });

  it("the pre-0320 load-bearing markup survives untouched", () => {
    expect(storefrontPage).toContain("linear-gradient(135deg, ${shop.banner_color}, #000)");
    expect(storefrontPage).toContain('const accent = shop?.accent_color ?? "#d4af37";');
    expect(storefrontPage).toContain('className="p-4 flex flex-1 flex-col"');
  });

  it("the list layout — and only it — puts the product's story on the card", () => {
    expect(storefrontPage).toContain('layoutSpec.id === "list" && p.description');
  });

  it("the hero layout features the first product full-bleed and rails the rest (stack200 U3)", () => {
    expect(storefrontPage).toContain('layoutSpec.id === "hero"');
    expect(storefrontPage).toContain("heroCard(products[0]!)");
    expect(storefrontPage).toContain("products.slice(1).map((p) => productCard(p))");
    /* The non-hero path still renders the whole catalog in the
       spec's grid — untouched shops render exactly as before. */
    expect(storefrontPage).toContain("products.map((p) => productCard(p))");
  });
});

describe("single-drop-hero — the hero look starter (stack200 U3)", () => {
  it("pairs the hero layout with the royal voice, and only those two fields move", () => {
    const hero = shopLookStarterById("single-drop-hero");
    expect(hero).toBeDefined();
    expect(hero!.settings).toEqual({ layout_style: "hero", font_style: "royal" });
    expect(shopLookPatch(hero!)).toEqual({ layout_style: "hero", font_style: "royal" });
    expect(isLookStarterApplied({ layout_style: "hero", font_style: "royal" }, hero!)).toBe(true);
    expect(isLookStarterApplied({ layout_style: "hero", font_style: "house" }, hero!)).toBe(false);
  });
});
