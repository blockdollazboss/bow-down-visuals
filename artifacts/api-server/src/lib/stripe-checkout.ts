/**
 * stripe-checkout.ts — the house rail for one-time checkout payments
 * (memberships, beat licenses, live shopping). Mirrors the pattern in
 * routes/store.ts: create a Checkout Session with everything the buyer
 * needs in metadata, then VERIFY the session server-side after the
 * redirect and only then grant the entitlement — idempotently, keyed on
 * the session id.
 *
 * TEST MODE ONLY (standing owner rule for this stack): if the configured
 * key is not a test key, every call fails closed. Live mode needs its own
 * explicit approval — it is never enabled by swapping an env var here.
 */
import type { Request } from "express";
import Stripe from "stripe";
import {
  buildCheckoutSessionIdempotencyKey,
  createGuardedStripeClient,
  isStripeTestModeKey,
  type CheckoutSessionIdempotencyScope,
} from "./stripe-client";

export function getCheckoutStripe(): Stripe {
  return createGuardedStripeClient();
}

export function isCheckoutTestMode(): boolean {
  return isStripeTestModeKey();
}

/** Base URL for checkout success/cancel redirects (same logic as store.ts). */
export function checkoutBaseUrl(req?: Request): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) return `https://${domain}`;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  if (req) {
    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const host = req.headers["host"];
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost";
}

export interface PaymentCheckoutInput {
  amountCents: number;
  productName: string;
  description?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  /** Member + rail + purchase-intent scope for the Stripe create key. */
  idempotency: CheckoutSessionIdempotencyScope;
}

/** Create a one-time payment Checkout Session for an exact amount. */
export async function createPaymentCheckout(
  input: PaymentCheckoutInput,
): Promise<{ sessionId: string; url: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Checkout amount must be a positive integer of cents");
  }
  const stripe = getCheckoutStripe();
  const idempotencyKey = buildCheckoutSessionIdempotencyKey(input.idempotency);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: input.amountCents,
          product_data: {
            name: input.productName,
            description: input.description,
          },
        },
        quantity: 1,
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: input.metadata,
  }, { idempotencyKey });
  if (!session.url) throw new Error("Checkout session did not return a URL");
  return { sessionId: session.id, url: session.url };
}

/** Retrieve a session for verification. Throws if it doesn't exist. */
export async function retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
  const stripe = getCheckoutStripe();
  return stripe.checkout.sessions.retrieve(sessionId);
}

/**
 * Automatic refund for a paid checkout session (Lane V3 F3) — used
 * ONLY where fulfillment has become impossible (the purchased item
 * was deleted after payment), never for transient recording failures
 * (verify is idempotent and retry-safe there; refunding would let a
 * retry deliver the goods free). Idempotent per session via the
 * refund idempotency key, so a repeated verify can't double-refund.
 * Returns whether the refund landed; callers must phrase their
 * response from this, never claim a refund that didn't happen.
 */
export async function refundCheckoutSessionPayment(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  const pi = session.payment_intent;
  const paymentIntentId = typeof pi === "string" ? pi : (pi?.id ?? null);
  if (!paymentIntentId) return false;
  try {
    const stripe = getCheckoutStripe();
    await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `refund:${session.id}` },
    );
    return true;
  } catch {
    return false;
  }
}
