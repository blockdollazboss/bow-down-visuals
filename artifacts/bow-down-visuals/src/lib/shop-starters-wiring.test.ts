/**
 * shop-starters-wiring.test.ts — the My Shop starter shelf and the
 * storefront-builder branding step, pinned to the shared registry
 * (lib/shop-starters) and to the existing shop save rail.
 *
 * The frontend suite runs in a node environment (no DOM rendering), so
 * — following the house wiring-pin pattern (my-shop-management-wiring)
 * — these tests pin the page sources to the exact requests and UI the
 * starter flow performs:
 *  - My Shop renders the shelf FROM the registry (data, not literals);
 *  - Apply PATCHes /api/shops/:id with shopStarterPatch(starter) ONLY;
 *  - failure discipline: the editor colors revert and setError fires —
 *    a failed apply never reads as applied;
 *  - the live banner preview mirrors the storefront's own gradient;
 *  - the builder wizard reads its presets from the same registry (one
 *    registry per library — the duplicated JSX copy is gone).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const myShop = readFileSync(new URL("../pages/my-shop.tsx", import.meta.url), "utf8");
const builder = readFileSync(new URL("../pages/storefront-builder.tsx", import.meta.url), "utf8");

const slice = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
};

const applyBody = slice(myShop, "async function applyStarter(", "/* Commerce pixels");

describe("My Shop — starter shelf renders from the registry", () => {
  it("imports the registry and maps it into cards (no JSX color literals)", () => {
    expect(myShop).toContain('from "@/lib/shop-starters"');
    expect(myShop).toContain("SHOP_DESIGN_STARTERS.map((starter)");
    expect(myShop).toContain('data-testid="myshop-design-starters"');
    expect(myShop).toContain("data-testid={`shop-starter-${starter.id}`}");
  });

  it("marks the matching starter Applied via isStarterApplied and disables re-apply", () => {
    expect(myShop).toContain("isStarterApplied(");
    expect(myShop).toContain("disabled={applied || applyingStarterId !== null}");
  });

  it("the live preview mirrors the storefront banner: gradient from the editor's banner color, accent ink", () => {
    expect(myShop).toContain('data-testid="myshop-banner-preview"');
    expect(myShop).toContain("linear-gradient(135deg, ${editBannerColor}, #000)");
    expect(myShop).toContain("style={{ color: editAccentColor }}");
  });
});

describe("apply — writes through the existing PATCH rail, starter fields only", () => {
  it("PATCHes the shop rail with exactly shopStarterPatch(starter)", () => {
    expect(applyBody).toContain("await authed(`/api/shops/${activeShop.id}`, {");
    expect(applyBody).toContain('method: "PATCH"');
    expect(applyBody).toContain("body: JSON.stringify(shopStarterPatch(starter))");
  });

  it("flips the editor colors first so the preview re-skins instantly", () => {
    expect(applyBody).toContain("setEditBannerColor(starter.settings.banner_color)");
    expect(applyBody).toContain("setEditAccentColor(starter.settings.accent_color)");
  });

  it("on success adopts the server's returned shop row (never a local guess)", () => {
    expect(applyBody).toContain("setActiveShop(data.shop)");
    expect(applyBody).toContain("setEditBannerColor(data.shop.banner_color)");
    expect(applyBody).toContain("setEditAccentColor(data.shop.accent_color)");
  });

  it("failure discipline: a refused apply reverts both colors and surfaces the error", () => {
    expect(applyBody).toContain("setEditBannerColor(prevBanner)");
    expect(applyBody).toContain("setEditAccentColor(prevAccent)");
    expect(applyBody).toContain("setError(plainErrorText(err, t(\"myShop.saveShopFailed\")))");
    /* The throw happens before any success mutation. */
    const throwAt = applyBody.indexOf("if (!res.ok || !data.shop) throw");
    const adoptAt = applyBody.indexOf("setActiveShop(data.shop)");
    expect(throwAt).toBeGreaterThanOrEqual(0);
    expect(throwAt).toBeLessThan(adoptAt);
  });

  it("an already-applied starter is a no-op, and a second apply cannot race the first", () => {
    expect(applyBody).toContain("if (isStarterApplied(activeShop, starter)) return;");
    expect(applyBody).toContain("if (!activeShop || applyingStarterId) return;");
  });
});

describe("storefront-builder — one registry, no duplicated preset copy", () => {
  it("derives COLOR_PRESETS from SHOP_DESIGN_STARTERS", () => {
    expect(builder).toContain('import { SHOP_DESIGN_STARTERS } from "@/lib/shop-starters";');
    expect(builder).toContain("SHOP_DESIGN_STARTERS");
    expect(builder).toContain("banner: s.settings.banner_color");
    expect(builder).toContain("accent: s.settings.accent_color");
  });

  it("no longer carries its own hex literals for the presets", () => {
    const presetsBlock = slice(builder, "const BUILDER_STARTER_LABEL_KEYS", "const inputClass");
    expect(presetsBlock).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
