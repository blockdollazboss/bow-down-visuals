/**
 * shop-look-starters-wiring.test.ts — the LOOK shelf is wired into My
 * Shop with the same discipline as the color shelf (migration 0320).
 *
 * shop-starters-wiring.test.ts pins the color shelf; this file is its
 * sibling for the layout + font axis:
 *  - the shelf renders SHOP_LOOK_STARTERS data in the same Shop
 *    settings card (no standalone surface);
 *  - applying a look PATCHes /api/shops/:id with shopLookPatch ONLY,
 *    flips the pickers optimistically, and REVERTS them on failure —
 *    the PATCH-never-fails-silently discipline;
 *  - the manual pickers seed from the selected shop and ride the
 *    normal Save (layout_style + font_style in saveShop's body), so
 *    manual settings and starters are the same rail.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const myShop = readFileSync(new URL("../pages/my-shop.tsx", import.meta.url), "utf8");

function slice(from: string, to: string): string {
  const a = myShop.indexOf(from);
  const b = myShop.indexOf(to, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return myShop.slice(a, b);
}

describe("My Shop look shelf wiring", () => {
  it("renders the registry in the Shop settings card", () => {
    expect(myShop).toContain("SHOP_LOOK_STARTERS");
    expect(myShop).toContain('from "@/lib/shop-starters"');
    expect(myShop).toContain("SHOP_LOOK_STARTERS.map((look)");
    expect(myShop).toContain('data-testid="myshop-look-starters"');
    expect(myShop).toContain("data-testid={`shop-look-${look.id}`}");
    expect(myShop).toContain("isLookStarterApplied(");
  });

  it("apply PATCHes exactly shopLookPatch through the shops rail", () => {
    const applyBody = slice("async function applyLookStarter(", "async function deleteShop()");
    expect(applyBody).toContain("method: \"PATCH\"");
    expect(applyBody).toContain("body: JSON.stringify(shopLookPatch(starter))");
    expect(applyBody).toContain("/api/shops/${activeShop.id}");
    /* a look never touches colors or copy */
    expect(applyBody).not.toContain("banner_color");
    expect(applyBody).not.toContain("accent_color");
  });

  it("guards + optimistic flip + revert-on-failure, mirroring the color starters", () => {
    const applyBody = slice("async function applyLookStarter(", "async function deleteShop()");
    expect(applyBody).toContain("if (!activeShop || applyingLookId) return;");
    expect(applyBody).toContain("if (isLookStarterApplied(activeShop, starter)) return;");
    expect(applyBody).toContain("const prevLayout = editLayout;");
    expect(applyBody).toContain("const prevFont = editFont;");
    expect(applyBody).toContain("setEditLayout(starter.settings.layout_style);");
    expect(applyBody).toContain("setEditFont(starter.settings.font_style);");
    expect(applyBody).toContain("setEditLayout(prevLayout);");
    expect(applyBody).toContain("setEditFont(prevFont);");
    const throwAt = applyBody.indexOf("throw new Error");
    const adoptAt = applyBody.indexOf("setActiveShop(data.shop);");
    expect(throwAt).toBeGreaterThan(-1);
    expect(adoptAt).toBeGreaterThan(throwAt);
    expect(applyBody).toContain("setApplyingLookId(null);");
  });

  it("selectShop seeds the pickers from the shop's presented design", () => {
    expect(myShop).toContain("setEditLayout(normalizeShopLayoutId(shop.layout_style));");
    expect(myShop).toContain("setEditFont(normalizeShopFontId(shop.font_style));");
  });

  it("the manual pickers exist and Save carries both settings", () => {
    expect(myShop).toContain('id="myshop-layout-style"');
    expect(myShop).toContain('id="myshop-font-style"');
    expect(myShop).toContain("SHOP_LAYOUT_SPECS.map((s)");
    expect(myShop).toContain("SHOP_FONT_SPECS.map((s)");
    const saveBody = slice("async function saveShop()", "/* Design starters:");
    expect(saveBody).toContain("layout_style: editLayout,");
    expect(saveBody).toContain("font_style: editFont,");
  });
});
