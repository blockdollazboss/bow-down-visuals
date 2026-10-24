/**
 * post-purchase-upsell.ts — One-click post-purchase upsell for the
 * Sell Everything storefront (Stack-100 #3, Wave 3). Pure domain
 * logic: no DB, no Stripe.
 *
 * The designation REUSES the order-bump attachment (feature #13): the
 * seller attaches ONE add-on to a product (seller-set price, optional
 * seller-set % off). At checkout the buyer may tick it; if they
 * didn't, the SAME add-on is offered once after the purchase
 * completes, and one click charges it off-session to the payment
 * method the just-completed checkout saved. This module owns the
 * pieces that must never drift:
 *
 *  - the price/fee SNAPSHOT (taken when the offer is made; the accept
 *    charges exactly what the buyer was shown);
 *  - the deterministic Stripe idempotency key — a pure function of
 *    the parent order id, so a double-click, a duplicate accept call
 *    and a retry after a client timeout all derive the SAME key and
 *    Stripe can only ever create ONE PaymentIntent for the upsell;
 *  - offer eligibility (never re-offer what the buyer already bought
 *    in the same order; the target rules are the bump rail's own);
 *  - the offer state machine (pending → accepted | declined | failed;
 *    every decided state is terminal — a decided offer never nags
 *    again and a failed one-click attempt is never silently retried:
 *    exactly-once beats eventually-charged).
 *
 * Money law: the price is the seller-set product price or the
 * seller-set % off it (lib/order-bumps `bumpUnitCents`); the fee is
 * the flat 5% from lib/platform-fees (`feeSplit`). Nothing here
 * invents a price or a fee.
 *
 * Persistence (migration reported by the lane, applied separately):
 * `store_upsell_offers` holds one row per parent order (UNIQUE
 * parent_order_id); an accepted upsell records as its own
 * `store_orders` row carrying `parent_order_id` +
 * `stripe_payment_intent_id` (UNIQUE). Readers are defensive — absent
 * table/columns simply mean "no offer", so the rail behaves exactly
 * as before until migration 0206 lands.
 */
import { feeSplit, PLATFORM_FEE_BPS } from "./platform-fees";
import {
  bumpUnitCents,
  readBumpConfig,
  validateBumpTarget,
  type BumpConfig,
  type BumpProductFacts,
} from "./order-bumps";

export { readBumpConfig };
export type { BumpConfig };

export type UpsellStatus = "pending" | "accepted" | "declined" | "failed";

/** States after which an offer must never be shown or charged again. */
export const UPSELL_TERMINAL_STATUSES: readonly UpsellStatus[] = [
  "accepted",
  "declined",
  "failed",
];

export function isUpsellTerminal(status: string | null | undefined): boolean {
  return status === "accepted" || status === "declined" || status === "failed";
}

/**
 * May the offer move `from` → `to`? Only a pending offer can be
 * decided, and only into a terminal state. Everything else (accept
 * after decline, decline after accept, a second failure overwriting
 * the first) is refused by construction.
 */
export function canTransitionUpsell(from: string, to: UpsellStatus): boolean {
  return from === "pending" && isUpsellTerminal(to);
}

/**
 * THE exactly-once key. Pure in the parent order id: every accept
 * attempt for the same order — double-click, duplicate request,
 * retry after a timeout, a second tab — derives this identical key,
 * so Stripe dedupes to a single PaymentIntent. A different order is
 * a different purchase and gets a different key.
 */
export function upsellIdempotencyKey(parentOrderId: string): string {
  const id = String(parentOrderId ?? "").trim();
  if (!id) throw new Error("upsellIdempotencyKey: parentOrderId is required");
  return `storefront-upsell:${id}`;
}

export interface UpsellSnapshot {
  upsellProductId: string;
  title: string;
  kind: string;
  listPriceCents: number;
  percentOff: number;
  /** What the buyer pays — and exactly what accept charges. */
  grossCents: number;
  feeCents: number;
  creatorCents: number;
  feeBps: number;
}

/**
 * Freeze the offer's money at offer time: the add-on's seller-set
 * price with the seller-set % off (bumpUnitCents), split once at the
 * flat platform fee. The accept path charges `grossCents` from THIS
 * snapshot — never a re-read price — so the displayed total and the
 * charged total cannot drift apart.
 */
export function buildUpsellSnapshot(
  cfg: BumpConfig,
  target: { id: string; title: string; kind: string; priceCents: number },
  feeBps: number = PLATFORM_FEE_BPS,
): UpsellSnapshot {
  const listPriceCents = Math.max(0, Math.round(target.priceCents));
  const gross = bumpUnitCents(listPriceCents, cfg.percentOff);
  const split = feeSplit(gross, feeBps);
  return {
    upsellProductId: target.id,
    title: target.title,
    kind: target.kind,
    listPriceCents,
    percentOff: cfg.percentOff,
    grossCents: split.gross,
    feeCents: split.fee,
    creatorCents: split.net,
    feeBps: split.feeBps,
  };
}

export type UpsellEligibility =
  | { ok: true }
  | {
      ok: false;
      code:
        | "UPSELL_NONE_DESIGNATED"
        | "UPSELL_ALREADY_BOUGHT"
        | "UPSELL_TARGET_GONE"
        | "BUMP_SELF"
        | "BUMP_OTHER_SELLER"
        | "BUMP_INACTIVE"
        | "BUMP_FREE"
        | "BUMP_SOLD_OUT";
      reason: string;
    };

/**
 * May this completed order be offered the post-purchase upsell?
 *  - the main product must carry a designation (the bump attachment);
 *  - the buyer must not have already bought that add-on IN this order
 *    (as its checkout bump or as the main product itself);
 *  - the target must pass the bump rail's own live-offer rules
 *    (same seller, active, priced, in stock).
 * A "no" here is silent by design — the buyer simply sees no offer;
 * the main purchase is never affected.
 */
export function upsellEligibility(args: {
  cfg: BumpConfig | null;
  main: { id: string; profileId: string };
  /** The order's recorded bump product id, when it bought one. */
  boughtBumpProductId: string | null;
  target: (BumpProductFacts & { id: string }) | null;
}): UpsellEligibility {
  const { cfg, main, boughtBumpProductId, target } = args;
  if (!cfg) {
    return { ok: false, code: "UPSELL_NONE_DESIGNATED", reason: "This product has no post-purchase add-on designated." };
  }
  if (boughtBumpProductId === cfg.bumpProductId || main.id === cfg.bumpProductId) {
    return { ok: false, code: "UPSELL_ALREADY_BOUGHT", reason: "The buyer already has this add-on from this order." };
  }
  if (!target) {
    return { ok: false, code: "UPSELL_TARGET_GONE", reason: "The add-on is no longer available." };
  }
  const verdict = validateBumpTarget(main, target);
  if (!verdict.ok) return { ok: false, code: verdict.code, reason: verdict.reason };
  return { ok: true };
}

/**
 * Accept-time revalidation of the add-on itself (the snapshot's money
 * is NOT re-derived — only "can this still be sold and delivered" is
 * re-asked): the product must still exist, be active and have a unit.
 * Returns null when the sale can proceed.
 */
export function upsellAcceptBlocker(target: {
  isActive: boolean;
  inventory: number;
} | null): { code: "UPSELL_TARGET_GONE" | "UPSELL_INACTIVE" | "UPSELL_SOLD_OUT"; reason: string } | null {
  if (!target) {
    return { code: "UPSELL_TARGET_GONE", reason: "That add-on is no longer available — no charge was made." };
  }
  if (!target.isActive) {
    return { code: "UPSELL_INACTIVE", reason: "That add-on isn't for sale right now — no charge was made." };
  }
  if (Number(target.inventory) === 0) {
    return { code: "UPSELL_SOLD_OUT", reason: "That add-on just sold out — no charge was made." };
  }
  return null;
}
