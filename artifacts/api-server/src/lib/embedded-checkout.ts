/**
 * embedded-checkout.ts — shared helpers for EMBEDDED checkout
 * (owner law, 2026-10-26: "we should never have to leave my site").
 *
 * Customer-facing checkout renders ON bowdownvisuals.com pages via
 * Stripe Elements (PaymentElement for one-time packs + plan
 * subscriptions; Embedded Checkout for the store session rail). The
 * hosted Checkout Session endpoints remain in the codebase as the
 * legacy/fallback rail only — they are no longer the default
 * user-facing path for the three flows wired to this module.
 *
 * TEST MODE ONLY: every Stripe client still comes from
 * createGuardedStripeClient(), which refuses non-test keys.
 *
 * Kill switch: EMBEDDED_CHECKOUT=off (or "hosted"/"false"/"0")
 * disables the embedded routes and the store's embedded ui_mode;
 * callers then fall back to the legacy hosted flow. Default: on.
 */
import { buildCheckoutSessionIdempotencyKey } from "./stripe-client";

/** Metadata `source` stamped on embedded PaymentIntents. The webhook's
 *  payment_intent.succeeded branch fulfills these exactly like the
 *  proven express_pay PIs (same metadata field names, same PI-id
 *  idempotency key into fulfillCreditPurchase). */
export const EMBEDDED_CHECKOUT_SOURCE = "embedded_checkout";

export function isEmbeddedCheckoutEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = (env["EMBEDDED_CHECKOUT"] ?? "").trim().toLowerCase();
  return raw !== "off" && raw !== "hosted" && raw !== "false" && raw !== "0";
}

/**
 * Deterministic Stripe idempotency key for an embedded PaymentIntent /
 * subscription creation. Reuses the house canonicalizer so the same
 * member + rail + purchase intent always produces the same key, and a
 * genuinely new purchase (whose intent includes a completed-purchase
 * sequence / durable subscription state) produces a fresh one.
 */
export function buildEmbeddedIntentIdempotencyKey(args: {
  memberId: string;
  rail: "credit-pack-embedded" | "creator-tier-embedded";
  purchaseIntent: unknown;
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.memberId,
    rail: args.rail,
    purchaseIntent: args.purchaseIntent,
  });
}
