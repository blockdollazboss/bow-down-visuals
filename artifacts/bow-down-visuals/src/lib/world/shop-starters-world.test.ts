/**
 * shop-starters-world — org wave #4: the Look starters shelf at the
 * owner's Shop Stand (the carried gap from org wave #3: the My Shop
 * page got design starters; the in-World stand's settings form
 * covered name/tagline/description only and never carried the shop's
 * two persisted design colors at all).
 *
 * Pins:
 *  - the stand's mine DTO now keeps the design colors as a PROVEN
 *    pair (both valid hex) from /api/shops/mine and from a settings
 *    save's returned row — a lone or malformed color is never kept,
 *    so the shelf can never mark a look Applied off half a pair;
 *  - shopDesignColors resolves the pair the shelf works from, with
 *    the schema defaults (the Gold Noir pairing) only where a row
 *    carries no proven pair;
 *  - the component renders the shelf FROM the ONE registry
 *    (lib/shop-starters — the same module the My Shop page reads),
 *    and applying a starter PATCHes the shop rail with
 *    shopStarterPatch(starter) ONLY, adopting the server's row on
 *    success and changing nothing on failure.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseMineShops,
  savedShopDto,
  shopDesignColors,
  SHOP_DEFAULT_ACCENT_COLOR,
  SHOP_DEFAULT_BANNER_COLOR,
} from "./shop-stands";
import {
  SHOP_DESIGN_STARTERS,
  isStarterApplied,
  shopStarterById,
  shopStarterPatch,
} from "../shop-starters";

const standsSrc = readFileSync(
  new URL("../../components/world/native/ShopStands.tsx", import.meta.url),
  "utf8",
);

const ROYAL = shopStarterById("royal-purple")!;

describe("the mine DTO keeps the design colors as a proven pair", () => {
  it("keeps both colors when the /shops/mine row carries valid hex", () => {
    const [shop] = parseMineShops({
      shops: [
        { id: "s1", name: "Royal", handle: "royal", banner_color: ROYAL.settings.banner_color, accent_color: ROYAL.settings.accent_color },
      ],
    });
    expect(shop.banner_color).toBe(ROYAL.settings.banner_color);
    expect(shop.accent_color).toBe(ROYAL.settings.accent_color);
  });

  it("keeps NEITHER on a lone or malformed color — no half-pairs", () => {
    const [lone] = parseMineShops({
      shops: [{ id: "s1", name: "Lone", handle: "lone", banner_color: "#000000" }],
    });
    expect(lone.banner_color).toBeUndefined();
    expect(lone.accent_color).toBeUndefined();
    const [short] = parseMineShops({
      shops: [{ id: "s2", name: "Short", handle: "short", banner_color: "#000", accent_color: "#d4af37" }],
    });
    expect(short.banner_color).toBeUndefined();
    expect(short.accent_color).toBeUndefined();
  });

  it("a settings save's returned row carries the pair into the saved DTO", () => {
    const saved = savedShopDto({
      shop: {
        id: "s1", name: "Royal", handle: "royal", tagline: null, description: null,
        banner_color: ROYAL.settings.banner_color, accent_color: ROYAL.settings.accent_color,
      },
    });
    expect(saved?.mine.banner_color).toBe(ROYAL.settings.banner_color);
    expect(saved?.mine.accent_color).toBe(ROYAL.settings.accent_color);
  });
});

describe("shopDesignColors — the pair the shelf works from", () => {
  it("passes a proven pair through untouched", () => {
    expect(shopDesignColors({ banner_color: ROYAL.settings.banner_color, accent_color: ROYAL.settings.accent_color }))
      .toEqual(ROYAL.settings);
  });

  it("falls back to the schema defaults — which ARE the registry's Gold Noir pairing", () => {
    expect(shopDesignColors({})).toEqual({
      banner_color: SHOP_DEFAULT_BANNER_COLOR,
      accent_color: SHOP_DEFAULT_ACCENT_COLOR,
    });
    expect(shopDesignColors({})).toEqual(shopStarterById("gold-noir")!.settings);
  });

  it("round-trips Applied: a shop wearing Royal Purple reads Applied for Royal Purple only", () => {
    const colors = shopDesignColors({ banner_color: ROYAL.settings.banner_color, accent_color: ROYAL.settings.accent_color });
    expect(isStarterApplied(colors, ROYAL)).toBe(true);
    for (const other of SHOP_DESIGN_STARTERS.filter((s) => s.id !== ROYAL.id)) {
      expect(isStarterApplied(colors, other)).toBe(false);
    }
    /* And a default shop reads Applied for Gold Noir — its true look. */
    expect(isStarterApplied(shopDesignColors({}), shopStarterById("gold-noir")!)).toBe(true);
  });

  it("a starter patch is exactly the two persisted fields — nothing else can move", () => {
    for (const starter of SHOP_DESIGN_STARTERS) {
      expect(Object.keys(shopStarterPatch(starter)).sort()).toEqual(["accent_color", "banner_color"]);
    }
  });
});

describe("ShopStands wiring — the shelf renders FROM the registry and rides the settings rail", () => {
  it("imports the shared registry and maps it into cards (no copied list)", () => {
    expect(standsSrc).toContain('from "@/lib/shop-starters"');
    expect(standsSrc).toContain("SHOP_DESIGN_STARTERS.map((starter)");
    expect(standsSrc).toContain('data-testid="world-shop-starters"');
    expect(standsSrc).toContain("data-testid={`world-shop-starter-${starter.id}`}");
    expect(standsSrc).toContain("isStarterApplied(designColors, starter)");
    /* A copied second list would carry the registry's literal colors. */
    expect(standsSrc).not.toContain("#150a24");
    expect(standsSrc).not.toContain("#fb7185");
  });

  it("the preview mirrors the storefront banner: gradient from the banner color, accent eyebrow", () => {
    expect(standsSrc).toContain('data-testid="world-shop-banner-preview"');
    expect(standsSrc).toContain("linear-gradient(135deg, ${designColors.banner_color}, #000)");
    expect(standsSrc).toContain("style={{ color: designColors.accent_color }}");
  });

  it("apply PATCHes the shop rail with exactly shopStarterPatch(starter) and adopts the server row", () => {
    const a = standsSrc.indexOf("const applyStarter = async (starter: ShopDesignStarter)");
    const b = standsSrc.indexOf("/* AI shop description", a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    const body = standsSrc.slice(a, b);
    expect(body).toContain("await fetch(`/api/shops/${shop.id}`, {");
    expect(body).toContain('method: "PATCH"');
    expect(body).toContain("body: JSON.stringify(shopStarterPatch(starter))");
    /* Failure discipline: the refusal throws BEFORE any adoption, the
       catch surfaces the settings error, and nothing else mutates. */
    const throwAt = body.indexOf("if (!res.ok) throw");
    const adoptAt = body.indexOf("onShopSaved(saved.pub");
    expect(throwAt).toBeGreaterThanOrEqual(0);
    expect(throwAt).toBeLessThan(adoptAt);
    expect(body).toContain("setSettingsError(plainErrorText(e, ");
    expect(body).toContain("product_count: mineShop.product_count");
  });
});
