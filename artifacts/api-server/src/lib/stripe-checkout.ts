/**
 * stripe-checkout.ts — the house rail for one-time checkout payments
 * (memberships, beat licenses, live shopping). Mirrors the pattern in
 * routes/store.ts: create a Checkout Session with everything the buyer
 * needs in metadata, then VERIFY the session server-side after the
 * redirect and only then grant the entitlement — idempotently, keyed on
 * the session id.
 *
 * PRESENTATION (owner law 2026-10-26: "we should never have to leave
 * my site"): hosted is the default and stays byte-identical for
 * existing callers. A caller that passes uiMode: "embedded" (gated on
 * lib/embedded-checkout's kill switch, like every other rail) gets
 * the SAME session in embedded_page ui_mode and its clientSecret
 * back, for the on-page/in-World <EmbeddedSessionCheckout> mount.
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
import {
  applyStripeTaxToPriceData,
  stripeTaxSessionFields,
  type StripeTaxKind,
} from "./stripe-tax";

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
  /**
   * Presentation mode. "embedded" creates the SAME session in
   * embedded_page ui_mode and answers its clientSecret instead of a
   * hosted URL — same amount, metadata and idempotency key; only the
   * presentation differs. Absent/"hosted" keeps the legacy hosted
   * shape exactly. Callers gate "embedded" on the
   * lib/embedded-checkout kill switch and their own key presence.
   */
  uiMode?: "embedded" | "hosted";
  /**
   * Where Stripe sends the buyer when an embedded session completes.
   * Embedded mode only; defaults to successUrl (the rails' success
   * pages already verify the session on landing).
   */
  returnUrl?: string;
  /**
   * Stripe Tax kind for this rail's line item (lib/stripe-tax.ts).
   * Only takes effect when STRIPE_TAX_ENABLED is on; defaults to the
   * generic electronically-supplied-services code.
   */
  taxKind?: StripeTaxKind;
}

/** Create a one-time payment Checkout Session for an exact amount. */
export async function createPaymentCheckout(
  input: PaymentCheckoutInput & { uiMode: "embedded" },
): Promise<{ sessionId: string; clientSecret: string }>;
export async function createPaymentCheckout(
  input: PaymentCheckoutInput,
): Promise<{ sessionId: string; url: string }>;
export async function createPaymentCheckout(
  input: PaymentCheckoutInput,
): Promise<{ sessionId: string; url: string } | { sessionId: string; clientSecret: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Checkout amount must be a positive integer of cents");
  }
  const stripe = getCheckoutStripe();
  const idempotencyKey = buildCheckoutSessionIdempotencyKey(input.idempotency);
  const embedded = input.uiMode === "embedded";
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    ...stripeTaxSessionFields(),
    line_items: [
      {
        price_data: applyStripeTaxToPriceData(
          {
            currency: "usd",
            unit_amount: input.amountCents,
            product_data: {
              name: input.productName,
              description: input.description,
            },
          },
          input.taxKind ?? "electronically-supplied-services",
        ),
        quantity: 1,
      },
    ],
    /* Embedded ui_mode: an embedded session takes a return_url
       instead of success/cancel URLs and never carries a hosted URL
       to demand — its client_secret is the mount key. The return
       path is fixed server-side by the caller (no client input
       reaches it), so there is no open-redirect surface. */
    ...(embedded
      ? {
          ui_mode: "embedded_page" as const,
          return_url: input.returnUrl ?? input.successUrl,
        }
      : {
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        }),
    metadata: input.metadata,
  }, { idempotencyKey });
  if (embedded) {
    /* An embedded session without a client secret cannot be mounted
       anywhere — treat it exactly like a failed creation so callers
       run their no-session cleanup instead of stranding a buyer. */
    if (!session.client_secret) {
      throw new Error("Checkout session did not return a client secret");
    }
    return { sessionId: session.id, clientSecret: session.client_secret };
  }
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
