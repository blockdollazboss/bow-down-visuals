/**
 * my-shop-management-wiring.test.ts — Stack-3 #25 (seller stand, proof-closure).
 *
 * The seller stand is managed from pages/my-shop.tsx, riding the shops rail
 * (routes/shops.ts — GET /api/shops/mine, POST/PATCH/DELETE /api/shops/:id,
 * POST/PATCH/DELETE /api/shops/:id/products/:productId; route behaviour is
 * pinned server-side by the api-server shops.test.ts). Stack-4 #6 added
 * product pause/unlist on the same rails: the list loads from the owner
 * rail GET /api/shops/:id/products (all products, pause state included)
 * and the toggle rides the product PATCH with { status }.
 *
 * The frontend suite runs in a node environment (no DOM rendering), so —
 * following the house wiring-pin pattern (scheduler-handoff-wiring,
 * sibling-dashboards) — these tests pin the page source to the exact
 * requests each management action sends, and to the failure discipline:
 * a failed request throws into setError BEFORE any local success mutation,
 * so a server failure can never read as a fake success.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../pages/my-shop.tsx", import.meta.url), "utf8");

const slice = (from: string, to: string) => {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a + from.length);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
};

const loadProductsBody = slice("async function loadProducts(", "useEffect(() => {");
const togglePauseBody = slice("async function togglePauseProduct(", "async function saveProduct()");
const saveProductBody = slice("async function saveProduct()", "async function deleteProduct");
const deleteProductBody = slice("async function deleteProduct(", "async function generateProductDescription");
const deleteShopBody = slice("async function deleteShop()", "async function generateShopDescription");

describe("product edit save — PATCHes the product rail, POSTs only for a new product", () => {
  it("builds the edit URL from the shop and the product being edited", () => {
    expect(saveProductBody).toContain("`/api/shops/${activeShop.id}/products/${editingProduct.id}`");
  });

  it("builds the create URL from the shop alone", () => {
    expect(saveProductBody).toContain("`/api/shops/${activeShop.id}/products`");
  });

  it("sends PATCH when editing and POST when creating, with the product body", () => {
    expect(saveProductBody).toContain(
      'const res = await authed(url, { method: editingProduct ? "PATCH" : "POST", body: JSON.stringify(body) });',
    );
    expect(saveProductBody).toContain("price_cents: cents");
  });
});

describe("product delete — DELETEs the product rail behind a confirm", () => {
  it("asks for confirmation before deleting", () => {
    expect(deleteProductBody).toContain('window.confirm(t("myShop.deleteProductConfirm", { name: p.name }))');
  });

  it("sends DELETE to the product URL", () => {
    expect(deleteProductBody).toContain(
      "await authed(`/api/shops/${activeShop.id}/products/${p.id}`, { method: \"DELETE\" })",
    );
  });
});

describe("shop delete — DELETEs the shop rail behind a confirm", () => {
  it("asks for confirmation before deleting", () => {
    expect(deleteShopBody).toContain('window.confirm(t("myShop.deleteShopConfirm", { name: activeShop.name }))');
  });

  it("sends DELETE to the shop URL", () => {
    expect(deleteShopBody).toContain(
      "await authed(`/api/shops/${activeShop.id}`, { method: \"DELETE\" })",
    );
  });
});

describe("failure discipline — a failed request shows an error, never a fake success", () => {
  it("product save throws on !res.ok before the form closes or the list mutates, and surfaces setError", () => {
    const throwAt = saveProductBody.indexOf("if (!res.ok) throw");
    expect(throwAt).toBeGreaterThanOrEqual(0);
    expect(saveProductBody.indexOf("setShowProductForm(false)")).toBeGreaterThan(throwAt);
    expect(saveProductBody.indexOf("setProducts(")).toBeGreaterThan(throwAt);
    expect(saveProductBody).toContain("setError(err instanceof Error ? err.message");
  });

  it("product delete throws on !res.ok before the product leaves the local list, and surfaces setError", () => {
    const throwAt = deleteProductBody.indexOf("if (!res.ok) throw");
    expect(throwAt).toBeGreaterThanOrEqual(0);
    expect(deleteProductBody.indexOf("ps.filter((x) => x.id !== p.id)")).toBeGreaterThan(throwAt);
    expect(deleteProductBody).toContain("setError(err instanceof Error ? err.message");
  });

  it("shop delete throws on !res.ok before the shop leaves the local list, and surfaces setError", () => {
    const throwAt = deleteShopBody.indexOf("if (!res.ok) throw");
    expect(throwAt).toBeGreaterThanOrEqual(0);
    expect(deleteShopBody.indexOf("s.filter((x) => x.id !== activeShop.id)")).toBeGreaterThan(throwAt);
    expect(deleteShopBody).toContain("setError(err instanceof Error ? err.message");
  });

  it("the page renders the error state where the seller can see it", () => {
    expect(source).toContain("{error && (");
  });
});

describe("product pause/unlist — Stack-4 #6 (migration 0176)", () => {
  it("the management list loads from the OWNER rail, not the public handle read", () => {
    /* The public handle read hides paused products by design; the
       seller's list must come from GET /api/shops/:id/products so
       paused stock stays visible to its owner. */
    expect(loadProductsBody).toContain("await authed(`/api/shops/${shop.id}/products`)");
    expect(loadProductsBody).not.toContain("/api/shops/handle/");
  });

  it("the toggle PATCHes the product rail with the next status", () => {
    expect(togglePauseBody).toContain("await authed(`/api/shops/${activeShop.id}/products/${p.id}`, {");
    expect(togglePauseBody).toContain('method: "PATCH"');
    expect(togglePauseBody).toContain("body: JSON.stringify({ status: next })");
    expect(togglePauseBody).toContain('const next = p.status === "paused" ? "active" : "paused";');
  });

  it("a failed toggle throws on !res.ok before the list mutates, and surfaces setError", () => {
    const throwAt = togglePauseBody.indexOf("if (!res.ok) throw");
    expect(throwAt).toBeGreaterThanOrEqual(0);
    expect(togglePauseBody.indexOf("setProducts(")).toBeGreaterThan(throwAt);
    expect(togglePauseBody).toContain("setError(err instanceof Error ? err.message");
  });

  it("paused products are marked, and the toggle offers the opposite action", () => {
    expect(source).toContain('p.status === "paused" && (');
    expect(source).toContain('t("myShop.pausedBadge")');
    expect(source).toContain('p.status === "paused" ? t("myShop.unpause") : t("myShop.pause")');
  });
});

describe("empty-shop state — honest empty, distinct from a failed load", () => {
  it("a failed shop load renders its own error card with a retry, checked before the empty branch", () => {
    const errorBranchAt = source.indexOf("shopsLoadError ? (");
    const emptyBranchAt = source.indexOf("shops.length === 0 && !showCreate ? (");
    expect(errorBranchAt).toBeGreaterThanOrEqual(0);
    expect(emptyBranchAt).toBeGreaterThan(errorBranchAt);
    expect(source).toContain("Couldn't load your shops.");
    expect(source).toContain("setShopsRetryNonce((n) => n + 1)");
  });

  it("zero shops renders the honest empty state, not the shop grid", () => {
    const emptyBranchAt = source.indexOf("shops.length === 0 && !showCreate ? (");
    expect(emptyBranchAt).toBeGreaterThanOrEqual(0);
    expect(source.slice(emptyBranchAt, emptyBranchAt + 400)).toContain('t("myShop.noShops")');
  });
});
