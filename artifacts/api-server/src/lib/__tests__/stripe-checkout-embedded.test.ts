/**
 * createPaymentCheckout embedded mode (World money-parity server
 * lane): uiMode: "embedded" must create the SAME session in
 * embedded_page ui_mode — same amount, metadata and idempotency key —
 * and answer its clientSecret instead of demanding a hosted URL.
 * Hosted stays the default and byte-identical for existing callers
 * (memberships, beat licenses, live shopping). Stripe is faked at the
 * module boundary; the captured create params are the contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createCalls: [] as Array<{ params: any; options: any }>,
  seq: 0,
  omitUrl: false,
  omitSecret: false,
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: any, options: unknown) => {
          h.createCalls.push({ params, options });
          h.seq += 1;
          if (params.ui_mode === "embedded_page") {
            /* A real embedded session carries a client_secret and
               no hosted URL. */
            return {
              id: `cs_test_${h.seq}`,
              url: null,
              client_secret: h.omitSecret ? null : `cs_test_${h.seq}_secret_abc`,
            };
          }
          return {
            id: `cs_test_${h.seq}`,
            url: h.omitUrl ? null : "https://checkout.example.com/pay",
            client_secret: `cs_test_${h.seq}_secret_abc`,
          };
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
  h.omitUrl = false;
  h.omitSecret = false;
  process.env["STRIPE_SECRET_KEY"] = "sk_" + "test_" + "0".repeat(24);
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env["STRIPE_SECRET_KEY"];
  else process.env["STRIPE_SECRET_KEY"] = ORIGINAL;
});

function input(extra: Record<string, unknown> = {}) {
  return {
    amountCents: 4999,
    productName: "Test license",
    description: "Beat license (Premium)",
    successUrl: "https://example.com/beats?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://example.com/beats",
    metadata: { purchase_kind: "beat_license", license_id: "lic-1" },
    idempotency: {
      memberId: "member-1",
      rail: "beat-license",
      purchaseIntent: "lic-1",
    },
    ...extra,
  } as Parameters<typeof createPaymentCheckout>[0];
}

describe("createPaymentCheckout hosted mode (default, unchanged)", () => {
  it("sends success/cancel URLs, no ui_mode, and answers the hosted URL", async () => {
    const out = await createPaymentCheckout(input());
    expect(out).toEqual({ sessionId: "cs_test_1", url: "https://checkout.example.com/pay" });

    const params = h.createCalls[0]!.params;
    expect(params.mode).toBe("payment");
    expect(params.success_url).toBe("https://example.com/beats?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toBe("https://example.com/beats");
    expect(params.ui_mode).toBeUndefined();
    expect(params.return_url).toBeUndefined();
    expect(params.metadata).toEqual({ purchase_kind: "beat_license", license_id: "lic-1" });
    expect(params.line_items[0].price_data.unit_amount).toBe(4999);
  });

  it("explicit uiMode: 'hosted' is the same hosted shape", async () => {
    const out = await createPaymentCheckout(input({ uiMode: "hosted" }));
    expect(out).toEqual({ sessionId: "cs_test_1", url: "https://checkout.example.com/pay" });
    expect(h.createCalls[0]!.params.ui_mode).toBeUndefined();
    expect(h.createCalls[0]!.params.success_url).toBeDefined();
  });

  it("still throws when a hosted session returns no URL", async () => {
    h.omitUrl = true;
    await expect(createPaymentCheckout(input())).rejects.toThrow(
      "Checkout session did not return a URL",
    );
  });
});

describe("createPaymentCheckout embedded mode", () => {
  it("sends embedded_page ui_mode + return_url and answers the clientSecret", async () => {
    const out = await createPaymentCheckout(input({ uiMode: "embedded" }));
    expect(out).toEqual({ sessionId: "cs_test_1", clientSecret: "cs_test_1_secret_abc" });

    const params = h.createCalls[0]!.params;
    expect(params.ui_mode).toBe("embedded_page");
    /* No explicit returnUrl → the rail's success URL is the return
       target (it already verifies the session on landing). */
    expect(params.return_url).toBe("https://example.com/beats?session_id={CHECKOUT_SESSION_ID}");
    expect(params.success_url).toBeUndefined();
    expect(params.cancel_url).toBeUndefined();
    expect(params.metadata).toEqual({ purchase_kind: "beat_license", license_id: "lic-1" });
    expect(params.line_items[0].price_data.unit_amount).toBe(4999);
  });

  it("honours an explicit returnUrl over the successUrl default", async () => {
    await createPaymentCheckout(
      input({ uiMode: "embedded", returnUrl: "https://example.com/world/return" }),
    );
    expect(h.createCalls[0]!.params.return_url).toBe("https://example.com/world/return");
  });

  it("throws when an embedded session returns no client secret", async () => {
    h.omitSecret = true;
    await expect(createPaymentCheckout(input({ uiMode: "embedded" }))).rejects.toThrow(
      "Checkout session did not return a client secret",
    );
  });

  it("carries the identical idempotency key and metadata across modes", async () => {
    await createPaymentCheckout(input());
    await createPaymentCheckout(input({ uiMode: "embedded" }));
    const [hostedCall, embeddedCall] = h.createCalls;
    expect(embeddedCall!.options.idempotencyKey).toBe(hostedCall!.options.idempotencyKey);
    expect(embeddedCall!.params.metadata).toEqual(hostedCall!.params.metadata);
    expect(embeddedCall!.params.line_items).toEqual(hostedCall!.params.line_items);
  });
});
