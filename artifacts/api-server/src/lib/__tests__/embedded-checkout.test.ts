/**
 * Embedded checkout (owner law 2026-10-26: checkout never leaves
 * bowdownvisuals.com) — contract tests:
 *  - the kill switch defaults ON and only explicit off-values disable it;
 *  - intent idempotency keys are deterministic per member+rail+intent
 *    and differ across any of the three;
 *  - the routes create PaymentIntents / default-incomplete
 *    subscriptions (never hosted Checkout Sessions) and fulfill credit
 *    packs through fulfillCreditPurchase keyed on the PI id;
 *  - the webhook's PI-succeeded branch fulfills the embedded source
 *    through the same exactly-once rail as express_pay;
 *  - the store rail keeps its ONE session creation, gaining only the
 *    embedded ui_mode + clientSecret answer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EMBEDDED_CHECKOUT_SOURCE,
  buildEmbeddedIntentIdempotencyKey,
  isEmbeddedCheckoutEnabled,
} from "../embedded-checkout";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("isEmbeddedCheckoutEnabled", () => {
  it("defaults on when unset or empty", () => {
    expect(isEmbeddedCheckoutEnabled({})).toBe(true);
    expect(isEmbeddedCheckoutEnabled({ EMBEDDED_CHECKOUT: "" })).toBe(true);
    expect(isEmbeddedCheckoutEnabled({ EMBEDDED_CHECKOUT: "on" })).toBe(true);
  });
  it("turns off only on explicit off values", () => {
    for (const v of ["off", "OFF", "hosted", "false", "0"]) {
      expect(isEmbeddedCheckoutEnabled({ EMBEDDED_CHECKOUT: v })).toBe(false);
    }
  });
});

describe("buildEmbeddedIntentIdempotencyKey", () => {
  const base = {
    memberId: "member-1",
    rail: "credit-pack-embedded" as const,
    purchaseIntent: { priceId: "price_123", credits: 5000, completedPurchaseCount: 2 },
  };
  it("is deterministic regardless of intent property order", () => {
    const a = buildEmbeddedIntentIdempotencyKey(base);
    const b = buildEmbeddedIntentIdempotencyKey({
      ...base,
      purchaseIntent: { completedPurchaseCount: 2, credits: 5000, priceId: "price_123" },
    });
    expect(a).toBe(b);
    expect(a.startsWith("checkout:credit-pack-embedded:member-1:")).toBe(true);
  });
  it("differs when member, rail, or intent changes", () => {
    const a = buildEmbeddedIntentIdempotencyKey(base);
    expect(buildEmbeddedIntentIdempotencyKey({ ...base, memberId: "member-2" })).not.toBe(a);
    expect(buildEmbeddedIntentIdempotencyKey({ ...base, rail: "creator-tier-embedded" })).not.toBe(a);
    expect(
      buildEmbeddedIntentIdempotencyKey({
        ...base,
        purchaseIntent: { priceId: "price_123", credits: 5000, completedPurchaseCount: 3 },
      }),
    ).not.toBe(a);
  });
});

describe("embedded checkout routes (source contract)", () => {
  const src = read("../../routes/embedded-checkout.ts");

  it("credit packs ride a PaymentIntent, never a Checkout Session", () => {
    expect(src).toContain("stripe.paymentIntents.create");
    expect(src).not.toContain("checkout.sessions.create");
    expect(src).toContain(`source: EMBEDDED_CHECKOUT_SOURCE`);
    expect(EMBEDDED_CHECKOUT_SOURCE).toBe("embedded_checkout");
    expect(src).toContain('kind: "credit_pack"');
  });

  it("amounts resolve server-side from the Stripe Price, never the client", () => {
    expect(src).toContain("stripe.prices.retrieve(priceId)");
    expect(src).toContain("amount: price.unit_amount");
  });

  it("credit-pack verify fulfills keyed on the PI id (webhook shares the key)", () => {
    expect(src).toContain("fulfillCreditPurchase({");
    expect(src).toContain("idempotencyKey: pi.id");
    expect(src).toContain("awardReferralShare(req.userId!, creditsToAdd, pi.id)");
  });

  it("subscriptions are default_incomplete with the invoice confirmation secret", () => {
    expect(src).toContain("stripe.subscriptions.create");
    expect(src).toContain('payment_behavior: "default_incomplete"');
    expect(src).toContain('kind: "creator_tier"');
    expect(src).toContain("confirmation_secret");
    expect(src).toContain('save_default_payment_method: "on_subscription"');
  });

  it("subscription verify syncs through the existing tier-sync upsert", () => {
    expect(src).toContain("handleTierSubscriptionEvent");
    expect(src).toContain('sub.status !== "active" && sub.status !== "trialing"');
  });

  it("every route respects the kill switch and requires auth", () => {
    expect(src).toContain("isEmbeddedCheckoutEnabled()");
    expect(src.match(/requireAuth/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("is registered in the route index", () => {
    const index = read("../../routes/index.ts");
    expect(index).toContain('from "./embedded-checkout"');
    expect(index).toContain("router.use(embeddedCheckoutRouter)");
  });
});

describe("webhook embedded fulfillment (source contract)", () => {
  const src = read("../stripe-webhook.ts");
  it("payment_intent.succeeded fulfills the embedded credit-pack source", () => {
    expect(src).toContain('pi.metadata?.source === "embedded_checkout"');
    expect(src).toContain('pi.metadata?.kind === "credit_pack"');
    // Same branch as express_pay: one fulfill call site for PI grants.
    const branch = src.slice(src.indexOf('event.type === "payment_intent.succeeded"'));
    expect(branch).toContain("fulfillCreditPurchase({");
    expect(branch).toContain("idempotencyKey: pi.id");
  });
});

describe("store embedded session (source contract)", () => {
  const src = read("../../routes/store.ts");
  it("uiMode=embedded creates the same session in embedded_page mode", () => {
    expect(src).toContain('ui_mode: "embedded_page" as const');
    expect(src).toContain("return_url: `${baseUrl}/store/success?session_id={CHECKOUT_SESSION_ID}`");
    expect(src).toContain("clientSecret: session.client_secret ?? null");
    expect(src).toContain("isEmbeddedCheckoutEnabled()");
    // Hosted shape remains the fallback when uiMode is absent.
    expect(src).toContain("cancel_url: `${baseUrl}/store/buy/${kind}/${id}`");
  });
});
