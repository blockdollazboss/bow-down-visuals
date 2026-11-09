/**
 * My Shop — honest load states (Stack 400 C-28: the honest-load pin
 * layer completing the "empty lie" audit).
 *
 * Both list loads on this page already carry the honest machine.
 * loadShops() throws on a non-ok answer and its catch sets the
 * scoped shopsLoadError; the render reaches "No shops yet" only
 * after the loading and shops-error branches, and the error
 * branch's retry bumps shopsRetryNonce, which re-runs the effect
 * that calls the real loader. loadProducts() mirrors it with
 * productsLoadError, its retry calling loadProducts(activeShop)
 * directly, and the empty copy after the error branch. The
 * discount-codes sub-list is pinned too: codes === null is its
 * loading state, loadFailed renders before the empty copy.
 *
 * This file pins that shape in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM). The
 * shops/products error copy is hardcoded English in the page, so
 * the literals are pinned; the empty copy goes through myShop.*
 * keys, pinned for all 10 catalogs below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./my-shop.tsx");
const shopsAt = page.indexOf("async function loadShops() {");
const shopsLoader = page.slice(shopsAt, page.indexOf("function selectShop", shopsAt));
const productsAt = page.indexOf("async function loadProducts(shop: Shop) {");
const productsLoader = page.slice(productsAt, page.indexOf("useEffect(() => {", productsAt));
const discountsAt = page.indexOf("const load = useCallback(async () => {");
const discountsLoader = page.slice(discountsAt, page.indexOf("useEffect(() => {", discountsAt));

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("shops — failure path: a failed shops load never reads as no shops", () => {
  it("the loader throws on a non-ok response and records the scoped error state in its catch", () => {
    expect(shopsLoader).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("myShop.loadShopsFailed")));');
    expect(shopsLoader).toContain("setShopsLoadError(true);");
  });

  it("a successful load records the shops, clears the error, and always clears loading", () => {
    expect(shopsLoader).toContain("setShops(data.shops ?? []);");
    expect(shopsLoader).toContain("setShopsLoadError(false);");
    expect(shopsLoader).toContain("setLoading(false);");
  });

  it("the state machine starts at loading", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true);");
    expect(page).toContain("const [shopsLoadError, setShopsLoadError] = useState(false);");
  });

  it("failure renders the error panel with a retry wired to the real load via the retry nonce", () => {
    expect(page).toContain("Couldn't load your shops.");
    expect(page).toContain("Something went wrong on our end — your shops are safe, this page just couldn't load them.");
    expect(page).toContain("onClick={() => setShopsRetryNonce((n) => n + 1)}");
    expect(page).toContain("}, [user, shopsRetryNonce]);");
  });

  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : shopsLoadError ? (");
    const emptyAt = page.indexOf(") : shops.length === 0 && !showCreate ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("myShop.noShops")');
  });
});

describe("products — failure path: a failed products load never reads as no products", () => {
  it("the loader throws on a non-ok response and records the scoped error state in its catch", () => {
    expect(productsLoader).toContain('if (!pub.ok) throw new Error("products load failed");');
    expect(productsLoader).toContain("setProductsLoadError(true);");
  });

  it("a successful load records the products and clears the error first", () => {
    expect(productsLoader).toContain("setProducts(data.products ?? []);");
    expect(productsLoader).toContain("setProductsLoadError(false);");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain("Couldn't load your products.");
    expect(page).toContain("Something went wrong on our end — your products are safe, this shop just couldn't load them.");
    expect(page).toContain("onClick={() => { if (activeShop) loadProducts(activeShop); }}");
  });

  it("the empty copy renders only after the products error branch", () => {
    const errorAt = page.indexOf("{productsLoadError ? (");
    const emptyAt = page.indexOf(") : products.length === 0 && !showProductForm ? (");
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("myShop.noProducts")');
  });
});

describe("discount codes — failure path stays distinct from empty", () => {
  it("the loader throws on a non-ok or malformed response and records the failure in its catch", () => {
    expect(discountsLoader).toContain('if (!res.ok || !Array.isArray(body.codes)) throw new Error("load");');
    expect(discountsLoader).toContain("setCodes(body.codes);");
    expect(discountsLoader).toContain("setLoadFailed(true);");
  });

  it("the failure copy renders before the loading (codes === null) and empty branches", () => {
    const failedAt = page.indexOf("{loadFailed ? (");
    const loadingAt = page.indexOf(") : codes === null ? (");
    const emptyAt = page.indexOf(") : codes.length === 0 ? (");
    expect(failedAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failedAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(page).toContain('t("myShop.discountLoadFailed")');
    expect(page).toContain('t("myShop.discountNone")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the myShop honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["myShop.noShops", "myShop.noProducts", "myShop.loadShopsFailed", "myShop.discountLoadFailed", "myShop.discountNone"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
