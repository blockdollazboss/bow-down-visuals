/**
 * stripe-client.ts — the ONE construction point for Stripe clients in
 * the API server.
 *
 * Test-mode fail-closed rule (generalized from the clients that already
 * guarded themselves — stripe-checkout, stripe-connect, and store):
 *   1. a missing STRIPE_SECRET_KEY is a configuration error; and
 *   2. any configured key that does not start with `sk_test_` is refused
 *      with the house test-mode error.
 *
 * Live mode is therefore never enabled for any rail by an env swap in
 * this stack. Every other module obtains its client here, directly or
 * through a domain wrapper (`getCheckoutStripe`, `getConnectStripe`).
 */
import { createHash } from "node:crypto";
import Stripe from "stripe";

function assertStripeTestModeKey(key: string | undefined): string {
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  if (!key.startsWith("sk_test_")) {
    throw new Error("Live payment keys are not enabled — test mode only.");
  }
  return key;
}

export function createGuardedStripeClient(key?: string, config?: Stripe.StripeConfig): Stripe {
  return new Stripe(assertStripeTestModeKey(key ?? process.env["STRIPE_SECRET_KEY"]), config);
}

export function isStripeTestModeKey(key?: string): boolean {
  return (key ?? process.env["STRIPE_SECRET_KEY"] ?? "").startsWith("sk_test_");
}

export interface CheckoutSessionIdempotencyScope {
  /** The authenticated member who owns this purchase attempt. */
  memberId: string;
  /** Stable rail name, e.g. "credit-pack" or "beat-license". */
  rail: string;
  /**
   * The purchase intent this attempt belongs to. Callers use a durable
   * domain intent (such as a pending license id) or canonical purchase
   * fields plus a completed-purchase sequence. The sequence is what
   * separates a retry of an unfinished purchase from a genuinely new
   * purchase after the previous one completed.
   */
  purchaseIntent: unknown;
  /**
   * Fingerprint of the EXACT Stripe request parameters this key will
   * guard (see fingerprintStripeRequestParams). Stripe refuses a key
   * reused with different parameters ("Keys for idempotent requests
   * can only be used with the same parameters they were first used
   * with"), so a key that can survive a parameter change is a poisoned
   * key: the first parameter shape wins and every later shape fails
   * until the key expires. Folding the fingerprint into the
   * derivation makes same-key/different-parameters impossible by
   * construction — any parameter change (amount, ui_mode, return
   * paths, metadata, customer…) mints a fresh key, while a genuine
   * duplicate submission of the identical request keeps the same key
   * and dedupes to the original response. Callers whose parameters
   * are fully determined by the purchase intent may omit it and keep
   * the legacy derivation byte-for-byte.
   */
  requestFingerprint?: string;
}

/**
 * Canonical fingerprint of a Stripe request's parameters: sha256 over
 * the canonical (key-sorted) JSON, so property order never matters
 * and any value change — however small — changes the fingerprint.
 */
export function fingerprintStripeRequestParams(params: unknown): string {
  const json = JSON.stringify(canonicalizeIntent(params)) ?? "null";
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Combine a precomputed base idempotency key with the fingerprint of
 * the exact request it guards — for call sites whose base key is
 * derived elsewhere (e.g. lib/creator-tier-upgrade's subscription
 * update). Same contract as the scope fold: identical request →
 * identical key; any parameter change → a different key.
 */
export function withCheckoutRequestFingerprint(baseKey: string, params: unknown): string {
  return `${baseKey}:${fingerprintStripeRequestParams(params).slice(0, 32)}`;
}

function canonicalizeIntent(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalizeIntent);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalizeIntent((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic Stripe idempotency key for Checkout Session creation.
 * The same member + rail + purchase intent always produces the same
 * key, regardless of object property order; changing any one of the
 * three produces a different key. When the scope carries a request
 * fingerprint, the fingerprint is folded into the same hash, so the
 * key identifies the full request (intent + exact parameters), not
 * just the intent.
 */
export function buildCheckoutSessionIdempotencyKey(
  scope: CheckoutSessionIdempotencyScope,
): string {
  const memberId = scope.memberId.trim();
  const rail = scope.rail.trim();
  if (!memberId) throw new Error("Checkout idempotency memberId is required");
  if (!rail) throw new Error("Checkout idempotency rail is required");
  const hashInput = scope.requestFingerprint
    ? { purchaseIntent: scope.purchaseIntent, requestFingerprint: scope.requestFingerprint }
    : scope.purchaseIntent;
  const intentJson = JSON.stringify(canonicalizeIntent(hashInput)) ?? "null";
  const hash = createHash("sha256").update(intentJson).digest("hex").slice(0, 32);
  return `checkout:${rail}:${memberId}:${hash}`;
}
