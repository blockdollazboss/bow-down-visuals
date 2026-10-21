/**
 * D4 — createPaymentCheckout must pass a deterministic Stripe
 * idempotency key as the create call's request options. Stripe is
 * faked at the module boundary; the captured options are the contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createCalls: [] as Array<{ params: unknown; options: unknown }>,
  seq: 0,
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: unknown, options: unknown) => {
          h.createCalls.push({ params, options });
          h.seq += 1;
          return { id: `cs_test_${h.seq}`, url: "https://checkout.example.com/pay" };
        },
      },
    };
  },
}));

import { createPaymentCheckout } from "../stripe-checkout";

const ORIGINAL = process.env["STRIPE_SECRET_KEY"];

beforeEach(() => {
  h.createCalls = [];
  h.seq = 0;
  process.env["STRIPE_SECRET_KEY"] = "sk_" + "test_" + "0".repeat(24);
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env["STRIPE_SECRET_KEY"];
  else process.env["STRIPE_SECRET_KEY"] = ORIGINAL;
});

function input(completedPurchaseCount: number) {
  return {
    amountCents: 2500,
    productName: "Test purchase",
    successUrl: "https://example.com/success",
    cancelUrl: "https://example.com/cancel",
    metadata: { purchase_kind: "test" },
    idempotency: {
      memberId: "member-1",
      rail: "test-rail",
      purchaseIntent: { itemId: "item-1", completedPurchaseCount },
    },
  };
}

describe("createPaymentCheckout Stripe idempotency (D4)", () => {
  it("sends a deterministic key for the same member + rail + intent", async () => {
    await createPaymentCheckout(input(0));
    await createPaymentCheckout(input(0));

    expect(h.createCalls).toHaveLength(2);
    const first = h.createCalls[0]!.options as { idempotencyKey: string };
    const second = h.createCalls[1]!.options as { idempotencyKey: string };
    expect(first.idempotencyKey).toMatch(/^checkout:test-rail:member-1:[0-9a-f]{32}$/);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("sends a fresh key after the completed-purchase sequence advances", async () => {
    await createPaymentCheckout(input(0));
    await createPaymentCheckout(input(1));

    const first = h.createCalls[0]!.options as { idempotencyKey: string };
    const second = h.createCalls[1]!.options as { idempotencyKey: string };
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
