/* Commerce tracking pixels (wave-4 #41, migration 0240).
 *
 * The release smartlink rail proved this pattern (lib/smartlink-pixels):
 * a creator attaches THEIR OWN Meta / TikTok / Google IDs and the
 * public surface fires exactly those. Commerce surfaces — the
 * storefront (per creator profile) and customer shops — now carry the
 * same fields in their settings, and this module fires their events:
 *
 *   - View (PageView-equivalent) when a fan lands on the storefront /
 *     shop — the same injection the smartlink landing uses.
 *   - Purchase when a checkout VERIFIES as paid, at the existing
 *     checkout-success paths (store-success verify, shop verify) —
 *     never on a mere redirect or an unverified session.
 *
 * Consent honesty (the hard rule): firing follows exactly the release
 * rail's rules, never wider. Only the seller's own configured,
 * shape-valid IDs can fire — the server validates on save and
 * re-validates on every public read — and with no ID set this module
 * loads no library and fires nothing at all. There are no platform
 * pixels. Never throws: pixels must never break a fan's page or a
 * buyer's success screen.
 */
import {
  armedPixels,
  injectSmartlinkPixels,
  type PixelKind,
  type SmartlinkPixels,
} from "./smartlink-pixels";

export type CommercePixels = SmartlinkPixels;

export interface CommercePurchase {
  /** The recorded order id (or checkout session id) — the event's
   *  dedupe key: one order can fire Purchase at most once per load. */
  orderId: string;
  /** Gross paid amount in cents (the rails' own money truth). */
  valueCents: number;
  /** ISO currency the charge ran in. Commerce charges are USD. */
  currency?: string;
}

/** Fire the view event for a commerce surface. Returns the networks
 *  armed by this call (empty when the seller configured nothing). */
export function fireCommercePageView(pixels: CommercePixels | null | undefined): PixelKind[] {
  return injectSmartlinkPixels(pixels);
}

/* One page load fires Purchase at most once per order, however many
   times the success screen re-renders or re-verifies. */
const firedPurchases = new Set<string>();

/** Test hook: clears the once-per-order guard. */
export function __resetCommercePixelsForTests(): void {
  firedPurchases.clear();
}

/**
 * Fire the Purchase event for a VERIFIED paid order, on every network
 * the seller configured. Returns the networks the purchase fired on
 * (empty when nothing is configured, when this order already fired,
 * or when there's no DOM). The pixel libraries are armed first (which
 * also records the success page's own view), exactly as a landing
 * view would arm them.
 */
export function fireCommercePurchase(
  pixels: CommercePixels | null | undefined,
  purchase: CommercePurchase,
): PixelKind[] {
  try {
    const armed = armedPixels(pixels);
    if (armed.length === 0) return [];
    const orderId = String(purchase.orderId ?? "").trim();
    if (!orderId || firedPurchases.has(orderId)) return [];
    const win = typeof window !== "undefined" ? (window as unknown as Record<string, any>) : null;
    if (!win) return [];

    injectSmartlinkPixels(pixels);

    const value = Math.max(0, Math.round(purchase.valueCents) / 100);
    const currency = (purchase.currency ?? "USD").toUpperCase();
    const fired: PixelKind[] = [];
    for (const { kind } of armed) {
      if (kind === "meta" && typeof win.fbq === "function") {
        win.fbq("track", "Purchase", { value, currency });
        fired.push("meta");
      }
      if (kind === "tiktok" && win.ttq && typeof win.ttq.track === "function") {
        win.ttq.track("CompletePayment", { value, currency, content_type: "product" });
        fired.push("tiktok");
      }
      if (kind === "google" && typeof win.gtag === "function") {
        win.gtag("event", "purchase", { transaction_id: orderId, value, currency });
        fired.push("google");
      }
    }
    if (fired.length > 0) firedPurchases.add(orderId);
    return fired;
  } catch {
    return [];
  }
}
