/**
 * live-shopping-desk — World parity wave 1, item 1 seam + sources.
 *
 * Pins:
 * - every rail is the 2D Live Shopping page's verbatim door
 *   (catalog / products / streams / pin PATCH / alerts / test sales /
 *   checkout / verify / dashboard), and the page itself rides the
 *   same doors — no endpoint is invented for the World;
 * - normalizers read the server DTOs the page reads: catalog rows
 *   keep the server's formatted price string, the active session is
 *   the live one, the pinned lookup is the page's, dashboard totals
 *   and per-stream rows ride the dashboard's own formatted strings
 *   with paid/test kept apart;
 * - draft gates mirror the server schemas (stream title 1–160,
 *   product name 1–120 + whole-cent price in range);
 * - law: the desk docks in the members-only Screen panel via
 *   LiveDesksPanel (palace guests gain no voice); buying is
 *   ShopStands' money moment — embedded first, hosted NEW TAB only
 *   as fallback, session kept under the pending key and VERIFIED on
 *   focus/reopen, never assumed paid; nothing completes by linking
 *   to /live-shopping, and the charged AI-description rail is NOT
 *   ridden (no credit machinery in the desk);
 * - the named rail gaps stay named in the seam (owner-scoped reads —
 *   no cross-user pinned-product rail exists).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  LIVE_SHOP_CATALOG_PATH, LIVE_SHOP_PRODUCTS_PATH, LIVE_SHOP_STREAMS_PATH,
  LIVE_SHOP_STREAM_PATH, LIVE_SHOP_STREAM_ALERTS_PATH, LIVE_SHOP_SALES_PATH,
  LIVE_SHOP_CHECKOUT_PATH, LIVE_SHOP_VERIFY_PATH, LIVE_SHOP_DASHBOARD_PATH,
  liveShopPendingKey,
  normalizeLiveShopCatalog, normalizeLiveShopStreams, normalizeLiveShopAlerts,
  normalizeLiveShopDashboard, activeLiveShopStream, pinnedLiveShopProduct,
  liveShopStreamTitleReady, liveShopProductDraftReady,
  liveShopEmbeddedSecret, liveShopHostedUrl, liveShopSessionId, liveShopVerifyConfirmed,
  LIVE_SHOPPING_PROMOTION, LIVE_SHOPPING_FOLLOW_ONS,
} from "./live-shopping-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/LiveShoppingDesk.tsx");
const seamSrc = read("./live-shopping-desk.ts");
const livePanelSrc = read("../../components/world/native/LiveDesksPanel.tsx");
const worldSrc = read("../../pages/world.tsx");
const pageSrc = read("../../pages/live-shopping.tsx");

describe("rails — the 2D page's verbatim doors", () => {
  it("pins every live-shopping path verbatim", () => {
    expect(LIVE_SHOP_CATALOG_PATH).toBe("/api/live-shopping/catalog");
    expect(LIVE_SHOP_PRODUCTS_PATH).toBe("/api/live-shopping/products");
    expect(LIVE_SHOP_STREAMS_PATH).toBe("/api/live-shopping/streams");
    expect(LIVE_SHOP_STREAM_PATH("s 1")).toBe("/api/live-shopping/streams/s%201");
    expect(LIVE_SHOP_STREAM_ALERTS_PATH("s1")).toBe("/api/live-shopping/streams/s1/alerts");
    expect(LIVE_SHOP_SALES_PATH).toBe("/api/live-shopping/sales");
    expect(LIVE_SHOP_CHECKOUT_PATH).toBe("/api/live-shopping/checkout");
    expect(LIVE_SHOP_VERIFY_PATH).toBe("/api/live-shopping/verify");
    expect(LIVE_SHOP_DASHBOARD_PATH).toBe("/api/live-shopping/dashboard");
  });

  it("the 2D page rides the same doors (no World-only endpoint was invented)", () => {
    for (const door of [
      "/api/live-shopping/catalog", "/api/live-shopping/streams",
      "/api/live-shopping/dashboard", "/api/live-shopping/checkout",
      "/api/live-shopping/verify", "/api/live-shopping/sales",
      "/alerts", "/api/live-shopping/products",
    ]) {
      expect(pageSrc).toContain(door);
    }
  });

  it("the desk rides every rail through the seam's constants", () => {
    for (const name of [
      "LIVE_SHOP_CATALOG_PATH", "LIVE_SHOP_PRODUCTS_PATH", "LIVE_SHOP_STREAMS_PATH",
      "LIVE_SHOP_STREAM_PATH", "LIVE_SHOP_STREAM_ALERTS_PATH", "LIVE_SHOP_SALES_PATH",
      "LIVE_SHOP_CHECKOUT_PATH", "LIVE_SHOP_VERIFY_PATH", "LIVE_SHOP_DASHBOARD_PATH",
    ]) {
      expect(deskSrc).toContain(name);
    }
    /* pin / unpin / end are the one PATCH door with the page's bodies */
    expect(deskSrc).toContain('body: JSON.stringify({ pinned_product_id: next })');
    expect(deskSrc).toContain('body: JSON.stringify({ status: "ended", pinned_product_id: null })');
    /* the test alert fires the page's alert+sale pair */
    expect(deskSrc).toContain("LIVE_SHOP_SALES_PATH");
    expect(deskSrc).toContain("stream_id: activeStream.id, quantity: 1");
  });
});

describe("normalizers — the server DTOs the page reads", () => {
  it("catalog rows keep the server's formatted price; junk rows drop", () => {
    const view = normalizeLiveShopCatalog({
      fee_bps: 500,
      products: [
        { id: "p1", name: "Hoodie", price_cents: 2499, price: "$24.99", image_url: null, description: "Warm", is_active: true },
        { id: "p2", name: "Free sticker", price_cents: 0, is_active: false },
        { name: "no id" },
        "junk",
      ],
    });
    expect(view.feeBps).toBe(500);
    expect(view.products).toHaveLength(2);
    expect(view.products[0]).toMatchObject({ id: "p1", price: "$24.99", priceCents: 2499, isActive: true });
    /* a row without the server's price string falls back to the 2D
       helpers' formatting of its own price_cents — never a new price */
    expect(view.products[1]!.price).toBe("$0.00");
    expect(normalizeLiveShopCatalog(null)).toEqual({ products: [], feeBps: null });
  });

  it("the active session is the live one; the pinned lookup is the page's", () => {
    const streams = normalizeLiveShopStreams({
      streams: [
        { id: "s1", title: "Old", status: "ended", pinned_product_id: null },
        { id: "s2", title: "Now", status: "live", pinned_product_id: "p1" },
      ],
    });
    const active = activeLiveShopStream(streams);
    expect(active?.id).toBe("s2");
    const products = normalizeLiveShopCatalog({ products: [{ id: "p1", name: "Hoodie", price_cents: 100 }] }).products;
    expect(pinnedLiveShopProduct(products, active)?.name).toBe("Hoodie");
    expect(pinnedLiveShopProduct(products, streams[0]!)).toBeNull();
    expect(pinnedLiveShopProduct(products, null)).toBeNull();
    expect(activeLiveShopStream([])).toBeNull();
  });

  it("alerts keep buyer/quantity/total from the feed payload", () => {
    expect(normalizeLiveShopAlerts({
      alerts: [{ id: "a1", buyer_name: "Ana", quantity: 2, total_cents: 4998, total: "$49.98" }, { noId: true }],
    })).toEqual([{ id: "a1", buyerName: "Ana", quantity: 2, totalCents: 4998, total: "$49.98" }]);
    expect(normalizeLiveShopAlerts(null)).toEqual([]);
  });

  it("dashboard totals + per-stream rows ride the server's strings, paid/test apart", () => {
    const dash = normalizeLiveShopDashboard({
      test_data: true,
      totals: { revenue: "$30.00", paid_sales: 1, test_sales: 2, platform_fees: "$1.50", creator_payout: "$28.50" },
      per_stream: [{ stream_id: "s2", title: "Now", sales: 3, revenue: "$30.00", fees: "$1.50" }],
    });
    expect(dash).toMatchObject({ revenue: "$30.00", paidSales: 1, testSales: 2, testData: true });
    expect(dash?.perStream[0]).toMatchObject({ streamId: "s2", sales: 3, revenue: "$30.00" });
    expect(normalizeLiveShopDashboard(null)).toBeNull();
    expect(normalizeLiveShopDashboard({})).toBeNull();
  });
});

describe("draft gates — the server schemas, mirrored", () => {
  it("stream title is streamSchema's 1–160 trimmed", () => {
    expect(liveShopStreamTitleReady(" Drop ")).toBe(true);
    expect(liveShopStreamTitleReady("   ")).toBe(false);
    expect(liveShopStreamTitleReady("x".repeat(161))).toBe(false);
  });

  it("product draft is productSchema's name + whole-cent price range", () => {
    expect(liveShopProductDraftReady("Hoodie", 2499)).toBe(true);
    expect(liveShopProductDraftReady("  ", 2499)).toBe(false);
    expect(liveShopProductDraftReady("x".repeat(121), 100)).toBe(false);
    expect(liveShopProductDraftReady("Hoodie", -1)).toBe(false);
    expect(liveShopProductDraftReady("Hoodie", 24.5)).toBe(false);
    expect(liveShopProductDraftReady("Hoodie", Number.NaN)).toBe(false);
  });
});

describe("checkout — ShopStands' money moment on this rail", () => {
  it("the outcome branches read the checkout answer's own fields", () => {
    expect(liveShopEmbeddedSecret({ clientSecret: "cs_1" })).toBe("cs_1");
    expect(liveShopEmbeddedSecret({ url: "https://pay.example" })).toBeNull();
    expect(liveShopHostedUrl({ url: "https://pay.example" })).toBe("https://pay.example");
    expect(liveShopHostedUrl({ clientSecret: "cs_1" })).toBeNull();
    expect(liveShopSessionId({ sessionId: "sess_1" })).toBe("sess_1");
    expect(liveShopVerifyConfirmed({ success: true })).toBe(true);
    expect(liveShopVerifyConfirmed({ success: false })).toBe(false);
    expect(liveShopVerifyConfirmed({})).toBe(false);
  });

  it("the desk asks embedded first, falls back to a NEW TAB, and verifies the pending session on focus", () => {
    expect(deskSrc).toContain('uiMode: hasStripePublishableKey() ? "embedded" : undefined');
    expect(deskSrc).toContain("<EmbeddedSessionCheckout clientSecret={buySecret} />");
    expect(deskSrc).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(deskSrc).toContain("localStorage.setItem(liveShopPendingKey(), sessionId)");
    expect(deskSrc).toContain("LIVE_SHOP_VERIFY_PATH");
    expect(deskSrc).toContain('window.addEventListener("focus", onFocus)');
    expect(deskSrc).toContain("liveShopVerifyConfirmed(data)");
    expect(liveShopPendingKey()).toBe("bdv-world-live-shop-pending");
  });

  it("the alert feed polls on the 2D page's 4-second rhythm", () => {
    expect(deskSrc).toContain(", 4000)");
    expect(pageSrc).toContain(", 4000)");
  });
});

describe("law — members only, no link-out completion, named gaps", () => {
  it("the desk docks inside the members-only Screen panel via LiveDesksPanel", () => {
    expect(livePanelSrc).toContain("<LiveShoppingDesk");
    expect(livePanelSrc).toContain('data-testid="world-live-desks"');
    expect(worldSrc).toContain("<LiveDesksPanel");
    expect(worldSrc).toContain("screenPanelOpen && inHall && !isGuest");
    expect(deskSrc).toContain('data-testid="world-live-shopping"');
    expect(deskSrc).toContain('data-testid="world-live-shop-pinned-card"');
    expect(deskSrc).toContain('testId="world-live-shop-revenue"');
  });

  it("no flow completes by linking out to the 2D page, and the charged AI rail is not ridden", () => {
    expect(deskSrc).not.toContain('href="/live-shopping"');
    expect(deskSrc).not.toContain('"/live-shopping"');
    expect(deskSrc).not.toContain("ai-description");
    expect(deskSrc).not.toContain("ConfirmCharge");
    expect(seamSrc).not.toContain("/api/live-shopping/ai-description\",");
  });

  it("the board records the promotion and the named follow-on gaps stay named", () => {
    expect(LIVE_SHOPPING_PROMOTION).toContain("Live Shopping");
    expect(LIVE_SHOPPING_FOLLOW_ONS.join(" ")).toContain("owner-scoped");
    expect(LIVE_SHOPPING_FOLLOW_ONS.join(" ")).toContain("AI product-description");
    expect(seamSrc).toContain("Known rail gaps");
  });
});
