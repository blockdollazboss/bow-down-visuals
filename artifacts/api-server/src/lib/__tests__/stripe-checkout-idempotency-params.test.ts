/**
 * STACK1300 — the idempotency key must identify the REQUEST, not just
 * the purchase intent.
 *
 * Live evidence (staging, Nov 2): every membership Join answered 500
 * with Stripe's "Keys for idempotent requests can only be used with
 * the same parameters they were first used with" — the intent-only
 * key was first used by the HOSTED session shape (stack1100), and
 * stack1200's EMBEDDED shape (ui_mode + return_url instead of
 * success/cancel URLs) reused the same key with different parameters.
 * Stripe refuses that pairing permanently (until key expiry), and
 * the intent never advances because no purchase can complete — the
 * buyer is locked out of that tier.
 *
 * These pins fake Stripe WITH its real idempotency semantics: a key
 * replayed with identical parameters returns the original response;
 * a key replayed with different parameters is refused with a
 * StripeIdempotencyError. Against that boundary they prove:
 *   (a) the OLD derivation (intent only) produces exactly the live
 *       refusal when the presentation changes under one intent;
 *   (b) identical duplicate submissions still dedupe to ONE session;
 *   (c) the NEW derivation (intent + parameter fingerprint) makes
 *       the membership hosted→embedded sequence succeed, in either
 *       order, and any parameter change mints a fresh key instead
 *       of a refusal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /* Stripe's idempotency ledger: key -> { fingerprint, session }. */
  ledger: new Map<string, { fingerprint: string; session: unknown }>(),
  minted: 0,
  createCalls: [] as Array<{ params: any; options: any }>,
  /* The real canonical fingerprint, injected by the test body (the
     mock factory cannot close over test-file imports). */
  fingerprint: null as null | ((params: unknown) => string),
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: any, options: any) => {
          h.createCalls.push({ params, options });
          const key = options?.idempotencyKey as string | undefined;
          if (key) {
            const fingerprint = h.fingerprint!(params);
            const prior = h.ledger.get(key);
            if (prior) {
              if (prior.fingerprint !== fingerprint) {
                throw Object.assign(
                  new Error(
                    `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${key}' for this request.`,
                  ),
                  { type: "StripeIdempotencyError", code: "idempotency_error" },
                );
              }
              return prior.session;
            }
            h.minted += 1;
            const session = {
              id: `cs_test_${h.minted}`,
              url: "https://checkout.example.com/pay",
              client_secret: `cs_test_${h.minted}_secret_abc`,
            };
            h.ledger.set(key, { fingerprint, session });
            return session;
          }
          h.minted += 1;
          return {
            id: `cs_test_${h.minted}`,
            url: "https://checkout.example.com/pay",
            client_secret: `cs_test_${h.minted}_secret_abc`,
          };
        },
      },
    };
  },
}));

import Stripe from "stripe";
import { createPaymentCheckout } from "../stripe-checkout";
import {
  buildCheckoutSessionIdempotencyKey,
  fingerprintStripeRequestParams,
} from "../stripe-client";
import { buildTipCheckoutKey } from "../../routes/generate/tip-jar";
import { buildSponsorEscrowCheckoutKey } from "../../routes/generate/sponsors";

const ORIGINAL = process.env["STRIPE_SECRET_KEY"];

beforeEach(() => {
  h.ledger.clear();
  h.minted = 0;
  h.createCalls = [];
  h.fingerprint = fingerprintStripeRequestParams;
  process.env["STRIPE_SECRET_KEY"] = "sk_" + "test_" + "0".repeat(24);
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env["STRIPE_SECRET_KEY"];
  else process.env["STRIPE_SECRET_KEY"] = ORIGINAL;
});

/* The membership join's intent, verbatim in shape: a fresh join (no
   existing member row) for a $5 tier — the intent stack1200's route
   builds. It does NOT change between the hosted and embedded asks,
   which is the whole problem. */
function membershipInput(extra: Record<string, unknown> = {}) {
  return {
    amountCents: 500,
    productName: "TEST Membership — monthly",
    description: "Fan membership",
    successUrl: "https://staging.example.com/memberships?creator=creator-1&session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://staging.example.com/memberships?creator=creator-1",
    metadata: {
      purchase_kind: "membership",
      tier_id: "tier-1",
      creator_user_id: "creator-1",
      fan_user_id: "fan-1",
      purchaser_user_id: "fan-1",
      billing_period: "monthly",
      amount_cents: "500",
      is_gift: "false",
    },
    idempotency: {
      memberId: "fan-1",
      rail: "membership",
      purchaseIntent: {
        tierId: "tier-1",
        creatorUserId: "creator-1",
        recipientUserId: "fan-1",
        billingPeriod: "monthly",
        amountCents: 500,
        isGift: false,
        existingMember: null,
      },
    },
    ...extra,
  } as Parameters<typeof createPaymentCheckout>[0];
}

describe("(a) the OLD intent-only derivation is refused at the Stripe boundary", () => {
  it("one intent key + hosted params, then embedded params -> StripeIdempotencyError", async () => {
    const stripe = new (Stripe as unknown as new (key: string) => {
      checkout: { sessions: { create: (p: unknown, o: unknown) => Promise<unknown> } };
    })("sk_" + "test_" + "0".repeat(24));
    /* The pre-fix derivation: member + rail + intent, nothing else. */
    const legacyKey = buildCheckoutSessionIdempotencyKey(
      membershipInput().idempotency as never,
    );
    const lineItems = [
      {
        price_data: {
          currency: "usd",
          unit_amount: 500,
          product_data: { name: "TEST Membership — monthly", description: "Fan membership" },
        },
        quantity: 1,
      },
    ];
    const metadata = membershipInput().metadata;
    /* First use: the hosted shape (the stack1100-era request). */
    await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: lineItems,
        success_url: "https://staging.example.com/memberships?creator=creator-1&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://staging.example.com/memberships?creator=creator-1",
        metadata,
      },
      { idempotencyKey: legacyKey },
    );
    /* Second use: the embedded shape (stack1200) under the SAME key —
       exactly the staging failure, reproduced at the boundary. */
    await expect(
      stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: lineItems,
          ui_mode: "embedded_page",
          return_url: "https://staging.example.com/memberships?creator=creator-1&session_id={CHECKOUT_SESSION_ID}",
          metadata,
        },
        { idempotencyKey: legacyKey },
      ),
    ).rejects.toMatchObject({ type: "StripeIdempotencyError" });
  });
});

describe("(c) the NEW derivation: the membership sequence succeeds", () => {
  it("hosted first, then embedded under the same intent — both create, different sessions", async () => {
    const hosted = await createPaymentCheckout(membershipInput());
    expect(hosted).toEqual({ sessionId: "cs_test_1", url: "https://checkout.example.com/pay" });

    const embedded = await createPaymentCheckout(membershipInput({ uiMode: "embedded" }));
    expect(embedded).toEqual({ sessionId: "cs_test_2", clientSecret: "cs_test_2_secret_abc" });

    const [hostedCall, embeddedCall] = h.createCalls;
    expect(embeddedCall!.options.idempotencyKey).not.toBe(hostedCall!.options.idempotencyKey);
    expect(embeddedCall!.options.idempotencyKey).toMatch(/^checkout:membership:fan-1:[0-9a-f]{32}$/);
  });

  it("embedded first, then hosted under the same intent — both create (order-independent)", async () => {
    const embedded = await createPaymentCheckout(membershipInput({ uiMode: "embedded" }));
    expect(embedded).toEqual({ sessionId: "cs_test_1", clientSecret: "cs_test_1_secret_abc" });
    const hosted = await createPaymentCheckout(membershipInput());
    expect(hosted).toEqual({ sessionId: "cs_test_2", url: "https://checkout.example.com/pay" });
  });

  it("an amount change under the same intent mints a fresh key, never a refusal", async () => {
    await createPaymentCheckout(membershipInput());
    const repriced = membershipInput();
    (repriced as { amountCents: number }).amountCents = 600;
    repriced.metadata = { ...repriced.metadata, amount_cents: "600" };
    const out = await createPaymentCheckout(repriced);
    expect(out.sessionId).toBe("cs_test_2");
    const [first, second] = h.createCalls;
    expect(second!.options.idempotencyKey).not.toBe(first!.options.idempotencyKey);
  });

  it("a returnUrl change under the same intent mints a fresh key", async () => {
    await createPaymentCheckout(membershipInput({ uiMode: "embedded" }));
    const out = await createPaymentCheckout(
      membershipInput({ uiMode: "embedded", returnUrl: "https://staging.example.com/world/return" }),
    );
    expect(out.sessionId).toBe("cs_test_2");
  });
});

describe("(b) identical duplicates still dedupe to one session", () => {
  it("two identical embedded submissions return the original session; Stripe mints once", async () => {
    const first = await createPaymentCheckout(membershipInput({ uiMode: "embedded" }));
    const second = await createPaymentCheckout(membershipInput({ uiMode: "embedded" }));
    expect(second).toEqual(first);
    expect(h.minted).toBe(1);
    const [a, b] = h.createCalls;
    expect(b!.options.idempotencyKey).toBe(a!.options.idempotencyKey);
  });

  it("two identical hosted submissions return the original session; Stripe mints once", async () => {
    const first = await createPaymentCheckout(membershipInput());
    const second = await createPaymentCheckout(membershipInput());
    expect(second).toEqual(first);
    expect(h.minted).toBe(1);
  });

  it("the intent sequence still separates a new purchase after completion", async () => {
    await createPaymentCheckout(membershipInput({ uiMode: "embedded" }));
    /* After verify activates the member row, its state rides the
       intent — the next legitimate purchase is a different request
       even with byte-identical parameters. */
    const renewed = membershipInput({ uiMode: "embedded" });
    (renewed.idempotency as { purchaseIntent: unknown }).purchaseIntent = {
      tierId: "tier-1",
      creatorUserId: "creator-1",
      recipientUserId: "fan-1",
      billingPeriod: "monthly",
      amountCents: 500,
      isGift: false,
      existingMember: {
        id: "member-1",
        status: "active",
        billingPeriod: "monthly",
        currentPeriodStart: new Date("2026-11-02T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-12-02T00:00:00.000Z"),
        updatedAt: new Date("2026-11-02T00:00:00.000Z"),
      },
    };
    const out = await createPaymentCheckout(renewed);
    expect(out.sessionId).toBe("cs_test_2");
  });
});

describe("fingerprint + builder derivations", () => {
  it("fingerprintStripeRequestParams is order-insensitive and value-sensitive", () => {
    const a = fingerprintStripeRequestParams({ mode: "payment", ui_mode: "embedded_page", amount: 500 });
    const b = fingerprintStripeRequestParams({ amount: 500, ui_mode: "embedded_page", mode: "payment" });
    expect(b).toBe(a);
    expect(fingerprintStripeRequestParams({ mode: "payment", amount: 500 })).not.toBe(a);
    expect(fingerprintStripeRequestParams({ mode: "payment", ui_mode: "embedded_page", amount: 600 })).not.toBe(a);
  });

  it("scope without a fingerprint keeps the legacy derivation byte-for-byte", () => {
    const scope = { memberId: "fan-1", rail: "membership", purchaseIntent: { tierId: "tier-1" } };
    const legacy = buildCheckoutSessionIdempotencyKey(scope);
    expect(legacy).toMatch(/^checkout:membership:fan-1:[0-9a-f]{32}$/);
    const fingerprinted = buildCheckoutSessionIdempotencyKey({ ...scope, requestFingerprint: "f".repeat(64) });
    expect(fingerprinted).not.toBe(legacy);
    expect(fingerprinted).toMatch(/^checkout:membership:fan-1:[0-9a-f]{32}$/);
  });

  it("rail builders: same intent + different presentation params -> different keys; identical params -> same key", () => {
    const hostedParams = { mode: "payment", success_url: "https://x/tips/a", cancel_url: "https://x/tips/a" };
    const embeddedParams = { mode: "payment", ui_mode: "embedded_page", return_url: "https://x/tips/a" };
    const tipHosted = buildTipCheckoutKey({ pageOwnerId: "owner-1", tipId: "tip-1", requestParams: hostedParams });
    const tipEmbedded = buildTipCheckoutKey({ pageOwnerId: "owner-1", tipId: "tip-1", requestParams: embeddedParams });
    expect(tipEmbedded).not.toBe(tipHosted);
    expect(buildTipCheckoutKey({ pageOwnerId: "owner-1", tipId: "tip-1", requestParams: hostedParams })).toBe(tipHosted);
    /* Without requestParams the builder keeps its legacy key. */
    expect(buildTipCheckoutKey({ pageOwnerId: "owner-1", tipId: "tip-1" })).toBe(
      buildCheckoutSessionIdempotencyKey({ memberId: "owner-1", rail: "tip-jar", purchaseIntent: { tipId: "tip-1" } }),
    );

    const sponsorBase = { brandUserId: "brand-1", dealId: "deal-1", acceptedApplicationId: "app-1", amountCents: 5000 };
    expect(
      buildSponsorEscrowCheckoutKey({ ...sponsorBase, requestParams: embeddedParams }),
    ).not.toBe(buildSponsorEscrowCheckoutKey({ ...sponsorBase, requestParams: hostedParams }));
    expect(
      buildSponsorEscrowCheckoutKey({ ...sponsorBase, requestParams: hostedParams }),
    ).toBe(buildSponsorEscrowCheckoutKey({ ...sponsorBase, requestParams: hostedParams }));
  });
});
