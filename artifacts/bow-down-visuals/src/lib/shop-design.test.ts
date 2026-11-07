/**
 * shop-design.test.ts — the storefront layout/font vocabulary
 * (migration 0320, store-starters lane).
 *
 * Pins:
 *  - normalize falls back to the defaults on anything unknown, so an
 *    old payload or a bent value can never break the render;
 *  - DEFAULT-PRESERVES-CURRENT-LOOK: the Showcase spec's class strings
 *    are the pre-0320 shop.tsx literals, character for character, and
 *    the House font applies NO overrides — an untouched shop renders
 *    byte-identical markup;
 *  - the FE vocabulary matches the server's (lib/shop-design lists,
 *    the PATCH schema's enums, the schema columns + defaults, and
 *    migration 0320 itself) — the two sides can never drift apart.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SHOP_LAYOUT_IDS,
  SHOP_FONT_IDS,
  SHOP_LAYOUT_SPECS,
  SHOP_FONT_SPECS,
  DEFAULT_SHOP_LAYOUT_ID,
  DEFAULT_SHOP_FONT_ID,
  normalizeShopLayoutId,
  normalizeShopFontId,
  shopLayoutSpec,
  shopFontSpec,
} from "./shop-design";

const apiDesignLib = readFileSync(
  new URL("../../../api-server/src/lib/shop-design.ts", import.meta.url),
  "utf8",
);
const serverShops = readFileSync(
  new URL("../../../api-server/src/routes/generate/shops.ts", import.meta.url),
  "utf8",
);
const shopSchema = readFileSync(
  new URL("../../../../lib/db/src/schema/customer-shops.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../../../../lib/db/migrations/0320_shop_layout_font.sql", import.meta.url),
  "utf8",
);

describe("normalize — bent input renders the defaults", () => {
  it("passes valid ids through and falls back on everything else", () => {
    for (const id of SHOP_LAYOUT_IDS) expect(normalizeShopLayoutId(id)).toBe(id);
    for (const id of SHOP_FONT_IDS) expect(normalizeShopFontId(id)).toBe(id);
    for (const bent of [undefined, null, "", "banana", "SHOWCASE", 42]) {
      expect(normalizeShopLayoutId(bent as never)).toBe("showcase");
      expect(normalizeShopFontId(bent as never)).toBe("house");
    }
    expect(DEFAULT_SHOP_LAYOUT_ID).toBe("showcase");
    expect(DEFAULT_SHOP_FONT_ID).toBe("house");
  });
});

describe("default-preserves-current-look", () => {
  it("the Showcase spec carries the pre-0320 storefront class strings verbatim", () => {
    const showcase = shopLayoutSpec("showcase");
    expect(showcase.contentClass).toBe("max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14");
    expect(showcase.gridClass).toBe("grid gap-5 sm:grid-cols-2 lg:grid-cols-3");
    expect(showcase.imageClass).toBe(
      "h-56 w-full shrink-0 object-cover group-hover:scale-[1.02] transition",
    );
    expect(showcase.placeholderClass).toBe(
      "h-56 w-full shrink-0 bg-gradient-to-br from-white/[0.06] to-transparent flex items-center justify-center",
    );
  });

  it("the House font applies no overrides at all", () => {
    const house = shopFontSpec("house");
    expect(house.displayClass).toBe("");
    expect(house.bodyFontFamily).toBeUndefined();
  });

  it("every layout is a real, distinct arrangement — not a rename", () => {
    const grids = SHOP_LAYOUT_SPECS.map((s) => s.gridClass);
    expect(new Set(grids).size).toBe(SHOP_LAYOUT_SPECS.length);
    expect(shopLayoutSpec("gallery").gridClass).toContain("lg:grid-cols-4");
    expect(shopLayoutSpec("list").gridClass).toContain("grid-cols-1");
    /* Hero's spec dresses its supporting rail — a four-across row at
       the gallery's width but its own rhythm (stack200 U3). */
    expect(shopLayoutSpec("hero").gridClass).toBe("grid gap-5 sm:grid-cols-2 lg:grid-cols-4");
    expect(shopLayoutSpec("hero").name).toBe("Hero");
    for (const spec of SHOP_LAYOUT_SPECS) {
      expect(spec.contentClass.length).toBeGreaterThan(0);
      expect(spec.imageClass.length).toBeGreaterThan(0);
      expect(spec.placeholderClass.length).toBeGreaterThan(0);
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.blurb.length).toBeGreaterThan(0);
    }
  });

  it("royal + classic set display type in Cinzel; classic adds the serif read", () => {
    expect(shopFontSpec("royal").displayClass).toBe("font-display");
    expect(shopFontSpec("royal").bodyFontFamily).toBeUndefined();
    expect(shopFontSpec("classic").displayClass).toBe("font-display");
    expect(shopFontSpec("classic").bodyFontFamily).toContain("Georgia");
  });

  it("spec lookup of an unknown id yields the defaults", () => {
    expect(shopLayoutSpec("banana" as never).id).toBe("showcase");
    expect(shopFontSpec("banana" as never).id).toBe("house");
  });
});

describe("the FE vocabulary matches the server's — no drift", () => {
  it("the API lib carries the same closed lists", () => {
    expect(apiDesignLib).toContain('"showcase", "gallery", "list", "hero"');
    expect(apiDesignLib).toContain('"house", "royal", "classic"');
    expect(SHOP_LAYOUT_IDS).toEqual(["showcase", "gallery", "list", "hero"]);
    expect(SHOP_FONT_IDS).toEqual(["house", "royal", "classic"]);
  });

  it("the PATCH schema accepts exactly these two settings", () => {
    const schemaStart = serverShops.indexOf("const updateShopSchema");
    const schemaBlock = serverShops.slice(schemaStart, schemaStart + 3000);
    expect(schemaBlock).toContain("layout_style:");
    expect(schemaBlock).toContain("font_style:");
    expect(schemaBlock).toContain("SHOP_LAYOUT_STYLES");
    expect(schemaBlock).toContain("SHOP_FONT_STYLES");
  });

  it("the schema columns and migration 0320 agree on names + defaults", () => {
    expect(shopSchema).toContain('layout_style: text("layout_style").notNull().default("showcase")');
    expect(shopSchema).toContain('font_style: text("font_style").notNull().default("house")');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS layout_style TEXT NOT NULL DEFAULT 'showcase'");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS font_style TEXT NOT NULL DEFAULT 'house'");
  });
});
