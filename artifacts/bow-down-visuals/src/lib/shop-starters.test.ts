/**
 * shop-starters.test.ts — Store design starters (stack1400 org/design
 * wave #3, item 3; Nov 2 audit §2c: store/shop setup had NO design
 * starters).
 *
 * Pins:
 *  (a) every starter field maps to a REAL persisted shop setting —
 *      the patch keys are exactly the design fields of the server's
 *      updateShopSchema (read from the api-server source, not from a
 *      copy of the list), every color satisfies the server's hex rule,
 *      and the default starter equals the DB column defaults;
 *  (b) the patch a starter applies carries ONLY those fields with the
 *      starter's exact values (the rail COALESCE-keeps the rest);
 *  (c) the settings actually RENDER — the live storefront source uses
 *      banner_color for its banner gradient and accent_color for its
 *      price/cart/CTA accent, so an applied starter is visible, never
 *      a save-that-renders-nowhere;
 *  (d) starter hygiene: unique ids + pairings, ≥6 starters, and dark
 *      banners only (the storefront banner is a dark-locked band with
 *      white ink — a light banner would bury the shop name).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  SHOP_DESIGN_STARTERS,
  SHOP_HEX_COLOR_RE,
  shopStarterById,
  shopStarterPatch,
  isStarterApplied,
} from "./shop-starters";

const serverShops = readFileSync(
  new URL("../../../api-server/src/routes/generate/shops.ts", import.meta.url),
  "utf8",
);
const shopSchema = readFileSync(
  new URL("../../../../lib/db/src/schema/customer-shops.ts", import.meta.url),
  "utf8",
);
const storefrontPage = readFileSync(new URL("../pages/shop.tsx", import.meta.url), "utf8");

function updateShopSchemaBlock(): string {
  const a = serverShops.indexOf("const updateShopSchema");
  expect(a).toBeGreaterThanOrEqual(0);
  const b = serverShops.indexOf("});", a);
  return serverShops.slice(a, b);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

describe("registry shape", () => {
  it("ships at least six starters with unique ids and unique color pairings", () => {
    expect(SHOP_DESIGN_STARTERS.length).toBeGreaterThanOrEqual(6);
    const ids = SHOP_DESIGN_STARTERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pairs = SHOP_DESIGN_STARTERS.map(
      (s) => `${s.settings.banner_color.toLowerCase()}|${s.settings.accent_color.toLowerCase()}`,
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("every starter carries a name, a blurb, and best-for guidance", () => {
    for (const s of SHOP_DESIGN_STARTERS) {
      expect(s.name.trim().length).toBeGreaterThan(0);
      expect(s.blurb.trim().length).toBeGreaterThan(0);
      expect(s.bestFor.trim().length).toBeGreaterThan(0);
      expect(shopStarterById(s.id)).toBe(s);
    }
    expect(shopStarterById("no-such-starter")).toBeUndefined();
  });
});

describe("(a) every starter field maps to a real persisted shop setting", () => {
  it("the patch keys are exactly banner_color + accent_color — no invented settings", () => {
    for (const s of SHOP_DESIGN_STARTERS) {
      expect(Object.keys(shopStarterPatch(s)).sort()).toEqual(["accent_color", "banner_color"]);
    }
  });

  it("both fields exist on the server's updateShopSchema (the PATCH rail that persists them)", () => {
    const block = updateShopSchemaBlock();
    expect(block).toContain("banner_color:");
    expect(block).toContain("accent_color:");
  });

  it("both fields are real shops-table columns", () => {
    expect(shopSchema).toContain('banner_color: text("banner_color")');
    expect(shopSchema).toContain('accent_color: text("accent_color")');
  });

  it("every starter color satisfies the server's hex rule, so the PATCH can never refuse it", () => {
    /* The server validates with HEX_COLOR = /^#[0-9a-fA-F]{6}$/ — the
       registry's exported mirror must be that same rule. */
    expect(serverShops).toContain("const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;");
    for (const s of SHOP_DESIGN_STARTERS) {
      expect(s.settings.banner_color).toMatch(SHOP_HEX_COLOR_RE);
      expect(s.settings.accent_color).toMatch(SHOP_HEX_COLOR_RE);
    }
  });

  it("the gold-noir starter equals the DB column defaults (the untouched shop look)", () => {
    expect(shopSchema).toContain('banner_color: text("banner_color").notNull().default("#0a0a0a")');
    expect(shopSchema).toContain('accent_color: text("accent_color").notNull().default("#d4af37")');
    const gold = shopStarterById("gold-noir")!;
    expect(gold.settings).toEqual({ banner_color: "#0a0a0a", accent_color: "#d4af37" });
  });
});

describe("(b) the starter patch carries exactly the starter's values and nothing else", () => {
  it("shopStarterPatch returns the starter's two settings verbatim, as a fresh object", () => {
    for (const s of SHOP_DESIGN_STARTERS) {
      const patch = shopStarterPatch(s);
      expect(patch).toEqual(s.settings);
      expect(patch).not.toBe(s.settings);
    }
  });

  it("isStarterApplied matches case-insensitively and only on BOTH colors", () => {
    const s = SHOP_DESIGN_STARTERS[0]!;
    expect(isStarterApplied({ banner_color: s.settings.banner_color.toUpperCase(), accent_color: s.settings.accent_color }, s)).toBe(true);
    expect(isStarterApplied({ banner_color: s.settings.banner_color, accent_color: "#000000" }, s)).toBe(false);
    expect(isStarterApplied({ banner_color: "#000000", accent_color: s.settings.accent_color }, s)).toBe(false);
  });
});

describe("(c) the settings render on the live storefront — applying is visible", () => {
  it("shop.tsx builds its banner gradient from banner_color", () => {
    expect(storefrontPage).toContain("linear-gradient(135deg, ${shop.banner_color}, #000)");
  });

  it("shop.tsx drives prices and the CTA from accent_color", () => {
    expect(storefrontPage).toContain('const accent = shop?.accent_color ?? "#d4af37";');
    expect(storefrontPage).toContain("style={{ color: accent }}");
    expect(storefrontPage).toContain("${accent}, ${accent}cc");
  });
});

describe("porcelain-light — the design shelf's light entry (stack200 U3)", () => {
  it("exists, and its light identity rides the ivory accent over the shelf's lightest lawful banner", () => {
    const porcelain = shopStarterById("porcelain-light");
    expect(porcelain).toBeDefined();
    expect(porcelain!.settings).toEqual({ banner_color: "#3a2e22", accent_color: "#efe3c2" });
    /* The banner still obeys the family darkness law (white ink) —
       but it is the LIGHTEST banner on the shelf, and the accent is
       a pale ivory, lighter than every jewel accent before it. */
    for (const s of SHOP_DESIGN_STARTERS) {
      if (s.id === "porcelain-light") continue;
      expect(luminance(porcelain!.settings.banner_color)).toBeGreaterThan(luminance(s.settings.banner_color));
    }
    expect(luminance(porcelain!.settings.accent_color)).toBeGreaterThan(0.85);
  });
});

describe("(d) banner darkness — white shop-name ink stays readable on every starter", () => {
  it("every banner color is dark (relative luminance < 0.2)", () => {
    for (const s of SHOP_DESIGN_STARTERS) {
      expect(luminance(s.settings.banner_color), s.id).toBeLessThan(0.2);
    }
  });

  it("every accent reads on its own banner (accent is lighter than the banner)", () => {
    for (const s of SHOP_DESIGN_STARTERS) {
      expect(luminance(s.settings.accent_color), s.id).toBeGreaterThan(luminance(s.settings.banner_color));
    }
  });
});
