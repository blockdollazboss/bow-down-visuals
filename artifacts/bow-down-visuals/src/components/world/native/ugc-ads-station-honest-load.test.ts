/**
 * UgcAdsStation (World native) — honest load standard
 * (deep-pins tranche 5). Three independent lists (shop
 * products, my ads, the briefs board), each with its own
 * ListState machine — loading / ready / failed — so one
 * list's failure never poisons another's board. Every
 * loader sets its list ONLY from a resolved seam fetch and
 * flips to ready after; any throw lands on failed. Each
 * list renders in the house order: NativeLoadingState →
 * NativeErrorState (with a retry that re-runs that list's
 * own loader) → the honest empty copy → the grid. A failed
 * list can therefore never render as "you have nothing
 * here" on any of the three boards.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./UgcAdsStation.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the three loaders — one law each, independently", () => {
  it("products / ads / briefs: the list lands before ready; any throw is failed", () => {
    expect(src).toContain('type ListState = "loading" | "ready" | "failed";');
    const products = slice(src, "const loadProducts = useCallback(async () => {", "const loadAds = useCallback");
    expect(products).toContain('setProductsState("loading");');
    expect(products).toContain("setProducts(await fetchMyShopProducts(await token()));");
    expect(products).toContain('setProductsState("ready");');
    expect(products.indexOf("setProducts(await fetchMyShopProducts(await token()));")).toBeLessThan(
      products.indexOf('setProductsState("ready");'),
    );
    const pCatch = slice(products, "} catch {", "}, [token]);");
    expect(pCatch).toContain('setProductsState("failed");');
    expect(pCatch).not.toContain("setProducts(");
    const ads = slice(src, "const loadAds = useCallback(async () => {", "const loadBriefs = useCallback");
    expect(ads).toContain("setAds(await fetchMyUgcAds(await token()));");
    expect(ads).toContain('setAdsState("failed");');
    const briefs = slice(src, "const loadBriefs = useCallback(async () => {", "useEffect(() => { void loadProducts(); }, [loadProducts]);");
    expect(briefs).toContain("setBriefs(page.briefs);");
    expect(briefs).toContain('setBriefsState("failed");');
    const bCatch = slice(briefs, "} catch {", "}, [token, boardScope]);");
    expect(bCatch).not.toContain("setBriefs(");
  });

  it("the products board renders loading → failed + retry → empty → grid", () => {
    const body = slice(src, 'productsState === "loading" ? (', ') : (');
    expect(body).toContain('<NativeLoadingState isLight={isLight} message={t("worldLivePromo.ugcProductsLoading")} />');
    expect(body).toContain(') : productsState === "failed" ? (');
    expect(body).toContain('<NativeErrorState isLight={isLight} message={t("worldLivePromo.ugcProductsFailed")} onRetry={() => void loadProducts()} />');
    expect(body).toContain(") : products.length === 0 ? (");
    expect(body).toContain('{t("worldLivePromo.ugcNoProducts")}');
    expect(body.indexOf('productsState === "loading" ? (')).toBeLessThan(body.indexOf(') : productsState === "failed" ? ('));
    expect(body.indexOf(') : productsState === "failed" ? (')).toBeLessThan(body.indexOf(") : products.length === 0 ? ("));
  });

  it("the ads and briefs boards carry the same failed branch with their own retries", () => {
    expect(src).toContain('adsState === "failed"');
    expect(src).toContain('briefsState === "failed"');
    expect(src).toContain("onRetry={() => void loadAds()}");
    expect(src).toContain("onRetry={() => void loadBriefs()}");
  });
});
