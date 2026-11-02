/**
 * qcproof-webhook-sweep.test.ts — QC-200 Q156 residual pins.
 *
 * The webhook family's behavioural suites prove each grant path is
 * claim/ledger-idempotent (packs, branding, sponsors, express PI,
 * reversals, and the webhook-settle surfaces). What no suite pinned
 * is the sweep's OUTER shell — the legs Pass 7 replays by hand:
 *
 *   - a forged signature is refused 400 and nothing is processed;
 *   - a missing signature header is refused 400;
 *   - a missing STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET answers
 *     200 with a warning and processes NOTHING (Stripe must not
 *     retry-loop a misconfiguration, and no state may change);
 *   - an unknown / foreign event type answers 200 {received:true}
 *     with no grant attempt;
 *   - a foreign checkout session (paid, but no user_id in metadata —
 *     not one of ours) answers 200 with a warning and grants nothing;
 *   - a foreign payment_intent.succeeded (not express_pay, not an
 *     embedded credit pack) answers 200 and grants nothing.
 *
 * The handler is the REAL stripeWebhookHandler; the Stripe client is
 * mocked at lib/stripe-client (the house pattern — the mock's
 * constructEvent either returns the staged event or throws the SDK's
 * signature-verification error, exactly what a forged payload makes
 * the real SDK do). Referral awards are counted via the routes/
 * referrals mock; the grant funnel (payment-record) is real and no
 * leg here may reach it — if one did, it would hit the real (dummy)
 * DATABASE_URL pool and fail loudly rather than silently pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  event: null as unknown,
  constructThrows: false,
  constructCalls: 0,
  referralCalls: 0,
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));

vi.mock("../stripe-client", () => ({
  createGuardedStripeClient: vi.fn(() => ({
    webhooks: {
      constructEvent: () => {
        h.constructCalls++;
        if (h.constructThrows) {
          throw new Error(
            "No signatures found matching the expected signature for payload. " +
              "Are you passing the raw request body you received from Stripe?",
          );
        }
        return h.event;
      },
    },
  })),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => {
    h.referralCalls++;
    return 0;
  }),
}));

import { stripeWebhookHandler } from "../stripe-webhook";

const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      res.body = body;
      return res;
    },
  };
  return res;
}

async function deliver(opts: { signature?: string } = {}) {
  const res = makeRes();
  const headers: Record<string, string> = {};
  if (opts.signature !== undefined) headers["stripe-signature"] = opts.signature;
  await stripeWebhookHandler(
    { headers, body: Buffer.from("{}") } as never,
    res as never,
  );
  return res;
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  h.event = null;
  h.constructThrows = false;
  h.constructCalls = 0;
  h.referralCalls = 0;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("Q156 — webhook outer shell: signatures and configuration", () => {
  it("a forged signature → 400, and the event is never processed", async () => {
    h.constructThrows = true;
    const res = await deliver({ signature: "t=1,v1=forged" });
    expect(res.statusCode).toBe(400);
    expect(String(res.body?.["error"])).toContain("signature verification failed");
    expect(h.constructCalls).toBe(1);
    expect(h.referralCalls).toBe(0);
  });

  it("a missing stripe-signature header → 400 before any verification", async () => {
    const res = await deliver({});
    expect(res.statusCode).toBe(400);
    expect(String(res.body?.["error"])).toContain("Missing stripe-signature");
    expect(h.constructCalls).toBe(0);
    expect(h.referralCalls).toBe(0);
  });

  it("missing STRIPE_SECRET_KEY → warning 200, nothing processed", async () => {
    delete process.env["STRIPE_SECRET_KEY"];
    const res = await deliver({ signature: "t=1,v1=whatever" });
    expect(res.statusCode).toBe(200);
    expect(res.body?.["received"]).toBe(true);
    expect(String(res.body?.["warning"])).toContain("STRIPE_SECRET_KEY not configured");
    expect(h.constructCalls).toBe(0);
    expect(h.referralCalls).toBe(0);
  });

  it("missing STRIPE_WEBHOOK_SECRET → warning 200, nothing processed", async () => {
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    const res = await deliver({ signature: "t=1,v1=whatever" });
    expect(res.statusCode).toBe(200);
    expect(res.body?.["received"]).toBe(true);
    expect(String(res.body?.["warning"])).toContain("STRIPE_WEBHOOK_SECRET not configured");
    expect(h.constructCalls).toBe(0);
    expect(h.referralCalls).toBe(0);
  });
});

describe("Q156 — webhook outer shell: foreign / unknown objects change no state", () => {
  it("an unknown event type → 200 {received:true}, no grant attempt", async () => {
    h.event = {
      id: "evt_unknown",
      type: "customer.created",
      data: { object: { id: "cus_foreign", object: "customer" } },
    };
    const res = await deliver({ signature: "t=1,v1=valid" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(h.referralCalls).toBe(0);
  });

  it("a paid checkout session with no user_id (not ours) → warning 200, no grant", async () => {
    h.event = {
      id: "evt_foreign_session",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_foreign",
          payment_status: "paid",
          payment_intent: "pi_foreign",
          amount_total: 500,
          currency: "usd",
          metadata: {},
        },
      },
    };
    const res = await deliver({ signature: "t=1,v1=valid" });
    expect(res.statusCode).toBe(200);
    expect(res.body?.["received"]).toBe(true);
    expect(String(res.body?.["warning"])).toContain("Missing user_id in metadata");
    expect(h.referralCalls).toBe(0);
  });

  it("a foreign payment_intent.succeeded (not express, not embedded pack) → 200, no grant", async () => {
    h.event = {
      id: "evt_foreign_pi",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_foreign",
          amount: 500,
          currency: "usd",
          metadata: { source: "someone_elses_app" },
        },
      },
    };
    const res = await deliver({ signature: "t=1,v1=valid" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(h.referralCalls).toBe(0);
  });

  it("a won dispute (not lost) reverses nothing → 200 with the dispute status", async () => {
    h.event = {
      id: "evt_dispute_won",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_won", status: "won", charge: "ch_foreign" } },
    };
    const res = await deliver({ signature: "t=1,v1=valid" });
    expect(res.statusCode).toBe(200);
    expect(res.body?.["received"]).toBe(true);
    expect(res.body?.["dispute"]).toBe("won");
    expect(h.referralCalls).toBe(0);
  });
});
