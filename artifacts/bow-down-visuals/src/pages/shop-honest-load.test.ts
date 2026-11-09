/**
 * Shop (public storefront) — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit). Residual
 * pin verified against both shapes: this page was wrapped by
 * resilience-money (stack1600/s400-resilience-money @ 88b08a20b) with
 * SectionBoundary wrappers only — every string asserted here is
 * present verbatim in BOTH the join14 page and the banked branch
 * version (loader logic identical; only wrapping/indentation moved).
 *
 * The storefront load separates three truths that used to collapse:
 * a genuine 404 sets notFound ("Shop not found"), any other non-ok
 * answer throws and the catch sets loadFailed (the error panel, with
 * a retry wired to retryNonce re-running the real load), and success
 * records the shop + products. The render order is loading, then
 * loadFailed, then notFound, and the "no products" empty panel lives
 * inside the loaded branch only — so a failed load can never read as
 * a missing shop or an empty shop. Copy rides i18n keys, pinned in
 * all 10 catalogs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./shop.tsx");
const loadAt = page.indexOf("async function load() {");
const loader = page.slice(loadAt, page.indexOf("if (handle) load();", loadAt));

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

describe("failure path — a failed shop load never reads as a missing or empty shop", () => {
  it("a genuine 404 records not-found, and any other non-ok answer throws into the failure state", () => {
    expect(loader).toContain("if (res.status === 404) {");
    expect(loader).toContain("if (!cancelled) setNotFound(true);");
    expect(loader).toContain("if (!res.ok) throw new Error(String(res.status));");
    expect(loader).toContain("if (!cancelled) setLoadFailed(true);");
  });

  it("a successful load records the shop and its products, and loading always clears", () => {
    expect(loader).toContain("setShop(data.shop);");
    expect(loader).toContain("setProducts(data.products ?? []);");
    expect(loader).toContain("if (!cancelled) setLoading(false);");
    expect(page).toContain("const [loadFailed, setLoadFailed] = useState(false);");
    expect(page).toContain("const [loading, setLoading] = useState(true);");
  });

  it("failure renders the error panel with its copy and a retry wired to the real load", () => {
    expect(page).toContain('t("shop.loadErrorTitle", { defaultValue: "We couldn\'t load this shop" })');
    expect(page).toContain('data-testid="btn-retry-shop"');
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });
});

describe("loading, not-found and genuine-empty paths stay distinct from failure", () => {
  it("the empty panel renders only after the loading, failure and not-found branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const failedAt = page.indexOf(") : loadFailed ? (");
    const notFoundAt = page.indexOf(") : notFound || !shop ? (");
    const emptyAt = page.indexOf('t("shop.noProducts")');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(failedAt).toBeGreaterThan(loadingAt);
    expect(notFoundAt).toBeGreaterThan(failedAt);
    expect(emptyAt).toBeGreaterThan(notFoundAt);
    expect(page).toContain("products.length === 0 ? (");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the shop honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["shop.loadErrorTitle", "shop.loadErrorDesc", "shop.retryLoad", "shop.noProducts", "shop.notFoundTitle"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
