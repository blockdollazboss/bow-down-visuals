/**
 * BrandingShop (+ its MerchTab) — honest load states (Stack-400
 * C-28 components residual, deep-pins tranche 2). The file carries
 * two collection loads, both already the family shape; this pin
 * records them so they cannot regress:
 *
 * - MY ORDERS (loadOrders): loading → error → empty → list. A
 *   non-ok response throws into ordersError; the error panel says
 *   the orders are safe and offers a retry wired to the real
 *   loader (btn-retry-orders); the "no orders" panel is reachable
 *   only after a successful empty load. The loader's own comment
 *   records the pre-fix lie (a 500 body silently became an empty
 *   list through the parse fallback).
 * - MERCH STORE DESIGNS (MerchTab loadStore): the same machine —
 *   storeLoading spinner, then the designsError panel with its
 *   retry (btn-retry-designs), and the "no designs" panel gated
 *   on !storeLoading && !designsError.
 *
 * The product catalog itself renders from in-file constants — no
 * load can dress up there. The writes are pinned too: the rug
 * logo upload throws on a non-ok or URL-less answer; the order
 * refresh throws the server's message on non-ok before touching
 * the list; payForOrder throws on non-ok AND on a secret-less
 * answer (nothing claims paid); the merch save/update/delete
 * actions check res.ok and surface the server's message, and the
 * generate action separates 402 from failure.
 *
 * NO FIX in this lane — both loads already meet the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const shop = read("./BrandingShop.tsx");

const loadOrders = shop.slice(shop.indexOf("async function loadOrders()"), shop.indexOf("const [refreshing, setRefreshing]"));
const loadStore = shop.slice(shop.indexOf("async function loadStore()"), shop.indexOf('if (innerTab === "store" && user)'));

describe("my orders: a failed load is an error panel, never an empty order book", () => {
  it("a non-ok response throws before any body is trusted; success records + clears the flag", () => {
    expect(loadOrders).toContain('const res = await authed("/api/branding-shop/orders");');
    expect(loadOrders).toContain("if (!res.ok) throw new Error();");
    expect(loadOrders.indexOf("if (!res.ok) throw new Error();")).toBeLessThan(loadOrders.indexOf("setOrders("));
    expect(loadOrders).toContain("setOrdersError(false);");
    expect(loadOrders).toContain("setOrdersError(true);");
    expect(loadOrders).toContain("A failed load is NOT an empty order book");
  });

  it("render order: sign-in prompt, loading, error + retry, genuine empty, list", () => {
    const signInIdx = shop.indexOf('t("brandingShop.signInToSeeOrders")');
    const loadIdx = shop.indexOf('t("brandingShop.loadingOrders")');
    const errIdx = shop.indexOf('data-testid="btn-retry-orders"');
    const emptyIdx = shop.indexOf('t("brandingShop.noOrdersTitle")');
    expect(signInIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(signInIdx);
    expect(errIdx).toBeGreaterThan(loadIdx);
    expect(emptyIdx).toBeGreaterThan(errIdx);
  });

  it("the error panel says the orders are safe and retries the real loader", () => {
    expect(shop).toContain("Your orders are safe — this page just couldn't reach them.");
    expect(shop).toContain("onClick={() => void loadOrders()}");
  });
});

describe("merch designs: the same machine in the store tab", () => {
  it("a non-ok response throws into designsError; success records + clears it", () => {
    expect(loadStore).toContain('const res = await fetch("/api/merch/designs");');
    expect(loadStore).toContain("if (!res.ok) throw new Error();");
    expect(loadStore).toContain("setDesigns(data.designs ?? []);");
    expect(loadStore).toContain("setDesignsError(false);");
    expect(loadStore).toContain("setDesignsError(true);");
    expect(loadStore).toContain("A failed load is NOT an empty store");
  });

  it("render order: loading spinner, error panel + retry, gated empty, grid", () => {
    expect(shop).toContain("{storeLoading && (");
    expect(shop).toContain("{!storeLoading && designsError && (");
    expect(shop).toContain('data-testid="btn-retry-designs"');
    expect(shop).toContain("{!storeLoading && !designsError && designs.length === 0 && (");
    expect(shop.indexOf("{!storeLoading && designsError && (")).toBeLessThan(
      shop.indexOf("{!storeLoading && !designsError && designs.length === 0 && ("),
    );
  });
});

describe("the writes check their answers — unchanged", () => {
  it("the rug logo upload throws on a non-ok or URL-less answer", () => {
    expect(shop).toContain("if (!res.ok || !data.url) {");
    expect(shop).toContain('throw new Error(apiErrorMessage(data, "Upload failed"));');
  });

  it("the order refresh throws the server's message before touching the list", () => {
    const refresh = shop.slice(shop.indexOf("async function refreshOrder("), shop.indexOf('if (tab === "orders" && user) loadOrders();'));
    expect(refresh).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("brandingShop.errorRefreshFailed")));');
    expect(refresh.indexOf("if (!res.ok) throw")).toBeLessThan(refresh.indexOf("setOrders((prev) =>"));
  });

  it("payForOrder claims nothing on a non-ok or secret-less answer", () => {
    const pay = shop.slice(shop.indexOf("async function payForOrder("), shop.indexOf("async function placeOrder()"));
    expect(pay).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("brandingShop.errorCheckoutFailed")));');
    expect(pay).toContain("if (data.clientSecret) {");
    expect(pay).toContain('throw new Error(t("brandingShop.errorCheckoutFailed"));');
  });

  it("merch save/update/delete surface the server's message on failure", () => {
    expect(shop).toContain('setDesignMsg(apiErrorMessage(data, t("merch.errorSaveDesignFailed")));');
    expect(shop).toContain('setDesignMsg(apiErrorMessage(data, t("merch.errorUpdateDesignFailed")));');
    expect(shop).toContain('setDesignMsg(apiErrorMessage(data, t("merch.errorDeleteDesignFailed")));');
  });

  it("generate separates the 402 from a failed generation", () => {
    expect(shop).toContain("if (res.status === 402) {");
    expect(shop).toContain('if (!res.ok || data.status !== "succeeded" || !data.mockups?.length) {');
  });
});
