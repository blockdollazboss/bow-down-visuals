/**
 * live-shop-viewer.ts — the pure seam for the viewer-side Live
 * Shopping panel on the watch page (components/live/LiveShopPanel,
 * docked on pages/live-watch).
 *
 * The gap this closes: every live-shopping read was owner-scoped, so
 * a viewer watching a stream could never see — let alone buy — the
 * items pinned in it. The read rail is new and additive:
 *
 *   GET /api/live-streams/:id/shop → { shop | null }
 *
 * (broadcast stream → its creator → that creator's selling session —
 * the live one when there is one, else the most recent — → the pinned
 * product + the seller's active catalog, serialized server-side).
 *
 * Buying rides the EXISTING rail, verbatim (the same paths and
 * outcome helpers as the seller page and the World desk seam,
 * lib/world/live-shopping-desk):
 *  - POST /api/live-shopping/checkout (embedded first, hosted URL in
 *    a new tab as the fallback) — the rail re-validates everything:
 *    seller match, live session (409 STREAM_NOT_LIVE before any
 *    Stripe session exists), self-buy refusal.
 *  - POST /api/live-shopping/verify on return / focus — a purchase is
 *    a sale only when verify says success. Q150: a paid session whose
 *    stream ended before verify settles is REFUSED and auto-refunded
 *    (409 + code STREAM_NOT_LIVE + refunded) — the outcome mapping
 *    below surfaces exactly that, never a fake "purchase complete".
 *
 * Prices are NEVER invented here: product prices ride the read's
 * server-formatted `price` strings and `price_cents`; the fee is the
 * read's fee_bps.
 */

import { formatPrice } from "./live-shopping";
import {
  LIVE_SHOP_CHECKOUT_PATH,
  LIVE_SHOP_VERIFY_PATH,
  liveShopPendingKey,
  liveShopEmbeddedSecret,
  liveShopHostedUrl,
  liveShopSessionId,
  liveShopVerifyConfirmed,
} from "./world/live-shopping-desk";

export {
  LIVE_SHOP_CHECKOUT_PATH,
  LIVE_SHOP_VERIFY_PATH,
  liveShopPendingKey,
  liveShopEmbeddedSecret,
  liveShopHostedUrl,
  liveShopSessionId,
  liveShopVerifyConfirmed,
};

/** The viewer read for the shop attached to a broadcast stream. */
export const LIVE_STREAM_SHOP_PATH = (streamId: string) =>
  `/api/live-streams/${encodeURIComponent(streamId)}/shop`;

/* ── views + normalizers (server DTOs → panel rows) ───────────────── */

export interface LiveShopViewerProduct {
  id: string;
  name: string;
  priceCents: number;
  /** The server's own formatted price ("$24.99") — display verbatim. */
  price: string;
  imageUrl: string | null;
  description: string | null;
}

export interface LiveShopViewerSession {
  id: string;
  title: string;
  status: string;
  pinnedProductId: string | null;
}

export interface LiveShopViewerShop {
  session: LiveShopViewerSession;
  pinnedProduct: LiveShopViewerProduct | null;
  /** The seller's active catalog (includes the pinned product). */
  products: LiveShopViewerProduct[];
  sellerProfileId: string | null;
  sellerSlug: string | null;
  sellerName: string | null;
  /** Server-decided: the signed-in caller IS this stream's seller. */
  viewerIsSeller: boolean;
  feeBps: number | null;
  testMode: boolean;
}

function normalizeViewerProduct(raw: unknown): LiveShopViewerProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p["id"] !== "string" || typeof p["name"] !== "string") return null;
  const priceCents = typeof p["price_cents"] === "number" ? p["price_cents"] : 0;
  return {
    id: p["id"],
    name: p["name"],
    priceCents,
    price: typeof p["price"] === "string" ? p["price"] : formatPrice(priceCents),
    imageUrl: typeof p["image_url"] === "string" ? p["image_url"] : null,
    description: typeof p["description"] === "string" ? p["description"] : null,
  };
}

/** The read's answer → the panel's shop, or null when this stream's
 *  creator has no selling session at all (the panel then renders
 *  nothing — no shop is attached to this stream). A malformed payload
 *  also lands on null ONLY when it carries no session; a payload with
 *  a session but broken rows keeps the session and drops the rows. */
export function normalizeLiveStreamShop(raw: unknown): LiveShopViewerShop | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  const shop = (d["shop"] ?? null) as Record<string, unknown> | null;
  if (!shop || typeof shop !== "object") return null;
  const sessionRaw = (shop["session"] ?? null) as Record<string, unknown> | null;
  if (!sessionRaw || typeof sessionRaw["id"] !== "string") return null;
  const rows = Array.isArray(shop["products"]) ? shop["products"] : [];
  const products: LiveShopViewerProduct[] = [];
  for (const r of rows) {
    const p = normalizeViewerProduct(r);
    if (p) products.push(p);
  }
  const seller = (shop["seller"] ?? null) as Record<string, unknown> | null;
  return {
    session: {
      id: sessionRaw["id"],
      title: typeof sessionRaw["title"] === "string" ? sessionRaw["title"] : "Live shopping",
      status: typeof sessionRaw["status"] === "string" ? sessionRaw["status"] : "",
      pinnedProductId:
        typeof sessionRaw["pinned_product_id"] === "string" ? sessionRaw["pinned_product_id"] : null,
    },
    pinnedProduct: normalizeViewerProduct(shop["pinned_product"]),
    products,
    sellerProfileId: typeof seller?.["profile_id"] === "string" ? seller["profile_id"] : null,
    sellerSlug: typeof seller?.["slug"] === "string" ? seller["slug"] : null,
    sellerName: typeof seller?.["display_name"] === "string" ? seller["display_name"] : null,
    viewerIsSeller: shop["viewer_is_seller"] === true,
    feeBps: typeof shop["fee_bps"] === "number" ? shop["fee_bps"] : null,
    testMode: shop["testMode"] === true,
  };
}

/** The catalog rows besides the pinned one (the pin leads the panel;
 *  the rest of the seller's active items ride under it). */
export function otherShopProducts(shop: LiveShopViewerShop): LiveShopViewerProduct[] {
  if (!shop.pinnedProduct) return shop.products;
  return shop.products.filter((p) => p.id !== shop.pinnedProduct!.id);
}

/* ── the panel's state story ──────────────────────────────────────── */

/**
 * What the panel may do, decided from server truth + the caller's
 * standing — one derivation for every render branch:
 * - "manage": the seller watching their own stream. NEVER a buy
 *   control (the rail refuses self-purchase) — the pinned list is a
 *   manage view that hands off to the Live Shopping page.
 * - "ended": the broadcast is not live OR the selling session is not
 *   live. Items may show (what was pinned) but with NO buy control —
 *   the rail 409s STREAM_NOT_LIVE, so the UI never offers it.
 * - "signin": a signed-out viewer on a live shop. Items browse
 *   (public-browse); the buy moment asks for sign-in.
 * - "buy": a signed-in viewer on a live shop — the real Buy controls.
 */
export type LiveShopPanelMode = "manage" | "ended" | "signin" | "buy";

export function liveShopPanelMode(
  shop: LiveShopViewerShop,
  opts: { broadcastLive: boolean; signedIn: boolean },
): LiveShopPanelMode {
  if (shop.viewerIsSeller) return "manage";
  if (!opts.broadcastLive || shop.session.status !== "live") return "ended";
  return opts.signedIn ? "buy" : "signin";
}

/** Plain copy for the ended state — the exact situation, no spin. */
export const LIVE_SHOP_ENDED_COPY =
  "This stream has ended — shopping is closed. Items that were pinned during the show are shown for reference.";

/* ── checkout / verify outcomes (Q150 money truth) ────────────────── */

export type LiveShopCheckoutOutcome =
  | { kind: "embedded"; clientSecret: string; sessionId: string | null }
  | { kind: "hosted"; url: string; sessionId: string | null }
  | { kind: "stream-ended"; message: string }
  | { kind: "failed"; message: string };

/** A checkout POST answer → what the panel does next. A 409 with the
 *  rail's STREAM_NOT_LIVE code is its own branch (the session ended
 *  between page load and the tap) — never a generic failure, and
 *  never a charge: the rail refuses before any Stripe session. */
export function liveShopCheckoutOutcome(
  resOk: boolean,
  status: number,
  data: unknown,
  fallbackMessage: string,
): LiveShopCheckoutOutcome {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!resOk) {
    if (status === 409 && d["code"] === "STREAM_NOT_LIVE") {
      return {
        kind: "stream-ended",
        message: typeof d["error"] === "string" ? d["error"] : fallbackMessage,
      };
    }
    return {
      kind: "failed",
      message: typeof d["error"] === "string" ? d["error"] : fallbackMessage,
    };
  }
  const secret = liveShopEmbeddedSecret(data);
  if (secret) {
    return { kind: "embedded", clientSecret: secret, sessionId: liveShopSessionId(data) };
  }
  const url = liveShopHostedUrl(data);
  if (url) {
    return { kind: "hosted", url, sessionId: liveShopSessionId(data) };
  }
  return { kind: "failed", message: fallbackMessage };
}

export type LiveShopVerifyOutcome =
  | { kind: "confirmed" }
  | { kind: "refunded"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "pending"; message: string }
  | { kind: "failed"; message: string };

/**
 * A verify answer → the buyer's truth, Q150 first:
 * - success → confirmed (the ONLY branch allowed to say a purchase
 *   completed — the webhook may also have settled it; verify's
 *   duplicate answer carries success too).
 * - 409 STREAM_NOT_LIVE → the stream ended before the paid session
 *   settled. With `refunded: true` the money is back — say so in
 *   full. Without it, the server's copy already explains; never
 *   dress either branch up as a completed purchase.
 * - 400 "not completed" → the checkout simply isn't finished
 *   (pending) — the pending marker stays for the next focus.
 * - anything else → failed, server copy when present.
 */
export function liveShopVerifyOutcome(
  resOk: boolean,
  status: number,
  data: unknown,
): LiveShopVerifyOutcome {
  const d = (data ?? {}) as Record<string, unknown>;
  const serverError = typeof d["error"] === "string" ? d["error"] : null;
  if (resOk && liveShopVerifyConfirmed(data)) return { kind: "confirmed" };
  if (status === 409 && d["code"] === "STREAM_NOT_LIVE") {
    if (d["refunded"] === true) {
      return {
        kind: "refunded",
        message:
          "The stream ended before your purchase could be recorded — your payment has been refunded in full.",
      };
    }
    return {
      kind: "refunded",
      message:
        serverError ??
        "The stream ended before your purchase could be recorded, so the sale didn't go through.",
    };
  }
  if (status === 400 && serverError === "Payment has not been completed.") {
    return { kind: "pending", message: "Your checkout isn't finished yet — complete it and this will confirm." };
  }
  if (resOk) {
    /* A 200 without success isn't a confirmation — treat it as
       still settling rather than inventing an outcome. */
    return { kind: "pending", message: "Your payment is still settling — this will confirm when it lands." };
  }
  if (status >= 500) {
    /* The rail itself failed (its own copy for this case is
       "Payment confirmed but the sale couldn't be recorded") — the
       outcome is genuinely unknown, so the marker stays and the
       next focus re-checks (verify is idempotent; the webhook may
       settle it meanwhile). */
    return {
      kind: "failed",
      message: serverError ?? "We couldn't confirm that payment. If you were charged, contact support.",
    };
  }
  return {
    kind: "refused",
    message: serverError ?? "We couldn't confirm that payment. If you were charged, contact support.",
  };
}

/** Terminal verify outcomes clear the pending marker (the purchase
 *  is settled one way or another); pending/failed keep it so the
 *  next focus re-checks instead of losing the buyer's session. */
export function liveShopVerifyIsTerminal(outcome: LiveShopVerifyOutcome): boolean {
  return outcome.kind === "confirmed" || outcome.kind === "refunded" || outcome.kind === "refused";
}
