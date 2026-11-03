/**
 * live-shopping-desk.ts — World parity wave 1, item 1: the pure seam
 * for the in-World Live Shopping desk (LiveShoppingDesk, docked in
 * the hall Screen panel's LiveDesksPanel alongside the LiveDesk
 * family).
 *
 * Every rail here is the 2D Live Shopping page's own, verbatim
 * (pages/live-shopping.tsx + routes/live-shopping.ts):
 *  - catalog:    GET /api/live-shopping/catalog → { products, fee_bps }
 *                POST /api/live-shopping/products (create, free)
 *  - sessions:   GET /api/live-shopping/streams (own, newest first)
 *                POST /api/live-shopping/streams (start — the server
 *                starts it "live" with started_at set)
 *                PATCH /api/live-shopping/streams/:id
 *                { status?, pinned_product_id? } — pin / unpin / end
 *  - alerts:     GET  /api/live-shopping/streams/:id/alerts (feed)
 *                POST /api/live-shopping/streams/:id/alerts (TEST
 *                alert) + POST /api/live-shopping/sales (the TEST
 *                sale the 2D page records alongside it, so the
 *                dashboard reflects it — labelled test forever)
 *  - buy:        POST /api/live-shopping/checkout → embedded first
 *                (uiMode "embedded" when this device can mount the
 *                payment form, exactly like ShopStands), hosted URL
 *                in a NEW TAB only as the fallback (the §3.9
 *                by-design money moment); the sale exists only when
 *                POST /api/live-shopping/verify confirms the payment
 *                — or the webhook settles it if the buyer never
 *                returns. Displayed = charged: the amount is the
 *                product's listed price_cents × quantity, server-side.
 *  - revenue:    GET /api/live-shopping/dashboard → totals +
 *                per-stream rows (paid and test kept apart).
 *
 * Prices are NEVER invented here: product prices ride the catalog
 * rows' server-formatted `price` strings (and price_cents for the
 * checkout body the server re-prices itself), the fee is the
 * catalog's fee_bps, and dashboard figures ride the dashboard's own
 * formatted strings.
 *
 * Known rail gaps (named, not worked around):
 *  - The catalog / streams / alerts / dashboard rails are
 *    OWNER-scoped on the server (every read is `user_id = caller`).
 *    There is NO public rail that lets a different viewer read
 *    another creator's pinned product or alert feed — so the desk's
 *    pinned card, alert feed and revenue are the streamer's own
 *    overlay surface, exactly as the 2D page (also owner-scoped)
 *    presents them. The checkout rail IS cross-user (it refuses
 *    buying your OWN product and validates the stream against the
 *    seller), so a buy fired from the pinned card for someone else's
 *    product would settle — but no read rail exists to surface
 *    another creator's pin to a viewer in-World yet.
 *  - The AI product-description rail (POST
 *    /api/live-shopping/ai-description, 100 VB) is NOT ridden here:
 *    it is a charged AI extra, not part of pin / buy / alerts /
 *    revenue parity, and this desk carries no credit machinery.
 */

import { formatPrice } from "../live-shopping";

/* ── paths — the 2D page's doors, verbatim ────────────────────────── */

export const LIVE_SHOP_CATALOG_PATH = "/api/live-shopping/catalog";
export const LIVE_SHOP_PRODUCTS_PATH = "/api/live-shopping/products";
export const LIVE_SHOP_STREAMS_PATH = "/api/live-shopping/streams";
export const LIVE_SHOP_STREAM_PATH = (id: string) => `/api/live-shopping/streams/${encodeURIComponent(id)}`;
export const LIVE_SHOP_STREAM_ALERTS_PATH = (id: string) => `/api/live-shopping/streams/${encodeURIComponent(id)}/alerts`;
export const LIVE_SHOP_SALES_PATH = "/api/live-shopping/sales";
export const LIVE_SHOP_CHECKOUT_PATH = "/api/live-shopping/checkout";
export const LIVE_SHOP_VERIFY_PATH = "/api/live-shopping/verify";
export const LIVE_SHOP_DASHBOARD_PATH = "/api/live-shopping/dashboard";

/** The pending-checkout marker (ShopStands' marketPendingKey pattern):
 *  a hosted checkout opened in a new tab leaves its session id here so
 *  the desk can VERIFY it — never just assume it paid — when the
 *  palace tab takes focus again or the desk reopens. */
export function liveShopPendingKey(): string {
  return "bdv-world-live-shop-pending";
}

/* ── views + normalizers (server DTOs → desk rows) ────────────────── */

export interface LiveShopProductView {
  id: string;
  name: string;
  priceCents: number;
  /** The server's own formatted price ("$24.99") — display verbatim. */
  price: string;
  imageUrl: string | null;
  description: string | null;
  isActive: boolean;
}

export interface LiveShopCatalogView {
  products: LiveShopProductView[];
  /** The server's fee for this catalog (bps) — display, never math we invent. */
  feeBps: number | null;
}

export function normalizeLiveShopCatalog(raw: unknown): LiveShopCatalogView {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d["products"]) ? d["products"] : [];
  const products: LiveShopProductView[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const p = r as Record<string, unknown>;
    if (typeof p["id"] !== "string" || typeof p["name"] !== "string") continue;
    const priceCents = typeof p["price_cents"] === "number" ? p["price_cents"] : 0;
    products.push({
      id: p["id"],
      name: p["name"],
      priceCents,
      price: typeof p["price"] === "string" ? p["price"] : formatPrice(priceCents),
      imageUrl: typeof p["image_url"] === "string" ? p["image_url"] : null,
      description: typeof p["description"] === "string" ? p["description"] : null,
      isActive: p["is_active"] !== false,
    });
  }
  return { products, feeBps: typeof d["fee_bps"] === "number" ? d["fee_bps"] : null };
}

export interface LiveShopStreamView {
  id: string;
  title: string;
  status: string;
  pinnedProductId: string | null;
}

export function normalizeLiveShopStreams(raw: unknown): LiveShopStreamView[] {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d["streams"]) ? d["streams"] : [];
  const out: LiveShopStreamView[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const s = r as Record<string, unknown>;
    if (typeof s["id"] !== "string") continue;
    out.push({
      id: s["id"],
      title: typeof s["title"] === "string" ? s["title"] : "Live stream",
      status: typeof s["status"] === "string" ? s["status"] : "",
      pinnedProductId: typeof s["pinned_product_id"] === "string" ? s["pinned_product_id"] : null,
    });
  }
  return out;
}

/** The active selling session is the live one — the 2D page's rule
 *  (`streams.find(x => x.status === "live")`). */
export function activeLiveShopStream(streams: LiveShopStreamView[]): LiveShopStreamView | null {
  return streams.find((s) => s.status === "live") ?? null;
}

/** The pinned product the overlay shows — the 2D page's lookup. */
export function pinnedLiveShopProduct(
  products: LiveShopProductView[],
  stream: LiveShopStreamView | null,
): LiveShopProductView | null {
  if (!stream?.pinnedProductId) return null;
  return products.find((p) => p.id === stream.pinnedProductId) ?? null;
}

export interface LiveShopAlertView {
  id: string;
  buyerName: string;
  quantity: number;
  totalCents: number;
  total: string;
}

export function normalizeLiveShopAlerts(raw: unknown): LiveShopAlertView[] {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d["alerts"]) ? d["alerts"] : [];
  const out: LiveShopAlertView[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const a = r as Record<string, unknown>;
    if (typeof a["id"] !== "string") continue;
    const totalCents = typeof a["total_cents"] === "number" ? a["total_cents"] : 0;
    out.push({
      id: a["id"],
      buyerName: typeof a["buyer_name"] === "string" ? a["buyer_name"] : "A viewer",
      quantity: typeof a["quantity"] === "number" ? a["quantity"] : 1,
      totalCents,
      total: typeof a["total"] === "string" ? a["total"] : formatPrice(totalCents),
    });
  }
  return out;
}

export interface LiveShopStreamRevenue {
  streamId: string;
  title: string;
  sales: number;
  revenue: string;
  fees: string;
}

export interface LiveShopDashboardView {
  revenue: string;
  paidSales: number;
  testSales: number;
  platformFees: string;
  creatorPayout: string;
  testData: boolean;
  perStream: LiveShopStreamRevenue[];
}

export function normalizeLiveShopDashboard(raw: unknown): LiveShopDashboardView | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  const totals = (d["totals"] ?? null) as Record<string, unknown> | null;
  if (!totals) return null;
  const rows = Array.isArray(d["per_stream"]) ? d["per_stream"] : [];
  const perStream: LiveShopStreamRevenue[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const s = r as Record<string, unknown>;
    if (typeof s["stream_id"] !== "string") continue;
    perStream.push({
      streamId: s["stream_id"],
      title: typeof s["title"] === "string" ? s["title"] : "Stream",
      sales: typeof s["sales"] === "number" ? s["sales"] : 0,
      revenue: typeof s["revenue"] === "string" ? s["revenue"] : "$0.00",
      fees: typeof s["fees"] === "string" ? s["fees"] : "$0.00",
    });
  }
  return {
    revenue: typeof totals["revenue"] === "string" ? totals["revenue"] : "$0.00",
    paidSales: typeof totals["paid_sales"] === "number" ? totals["paid_sales"] : 0,
    testSales: typeof totals["test_sales"] === "number" ? totals["test_sales"] : 0,
    platformFees: typeof totals["platform_fees"] === "string" ? totals["platform_fees"] : "$0.00",
    creatorPayout: typeof totals["creator_payout"] === "string" ? totals["creator_payout"] : "$0.00",
    testData: d["test_data"] === true,
    perStream,
  };
}

/* ── draft gates — the server schemas, mirrored ───────────────────── */

/** streamSchema's gate, verbatim: a title of 1–160 trimmed characters. */
export function liveShopStreamTitleReady(title: string): boolean {
  const t = title.trim();
  return t.length >= 1 && t.length <= 160;
}

/** productSchema's gates that the desk's compact add form carries:
 *  a name of 1–120 trimmed characters and a whole-cent price in the
 *  schema's 0..10,000,000 range (the desk parses the typed dollars
 *  with the 2D page's own parsePriceToCents before asking). */
export function liveShopProductDraftReady(name: string, priceCents: number): boolean {
  const n = name.trim();
  return n.length >= 1 && n.length <= 120 && Number.isInteger(priceCents) && priceCents >= 0 && priceCents <= 10_000_000;
}

/* ── checkout outcome — ShopStands' branches, on this rail's shape ── */

/** The embedded branch: a clientSecret in the answer mounts the
 *  shared EmbeddedSessionCheckout in the desk. */
export function liveShopEmbeddedSecret(data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  return typeof d["clientSecret"] === "string" && d["clientSecret"] ? d["clientSecret"] : null;
}

/** The hosted fallback: the §3.9 new-tab money moment. */
export function liveShopHostedUrl(data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  return typeof d["url"] === "string" && d["url"] ? d["url"] : null;
}

export function liveShopSessionId(data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  return typeof d["sessionId"] === "string" && d["sessionId"] ? d["sessionId"] : null;
}

/** A verify answer counts as a sale only when the server says so
 *  (`success: true`) — a pending / refused verify is never dressed
 *  up as a purchase (the webhook may still settle it later). */
export function liveShopVerifyConfirmed(data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  return d["success"] === true;
}

export const LIVE_SHOPPING_PROMOTION =
  "Live Shopping in the hall Screen panel: the 2D page's own rails in-World — catalog + add product, start/end a selling session, pin/unpin the overlay product, the pinned card viewers see, purchase alerts polling the stream's feed (+ the 2D page's test alert/sale pair), per-stream revenue from the dashboard rail, and buying the pinned product embedded-first with the §3.9 new-tab fallback and verify-on-return (the checkout rail refuses your own product and any non-live stream, server-side)";

export const LIVE_SHOPPING_FOLLOW_ONS = [
  "Viewer-side discovery of ANOTHER creator's pin has no rail: catalog/streams/alerts/dashboard reads are owner-scoped server-side, so a cross-user pinned-product read needs a new public rail (server work, not invented here)",
  "The AI product-description rail (100 VB) is not ridden by this desk — a charged extra outside pin/buy/alerts/revenue parity",
] as const;
