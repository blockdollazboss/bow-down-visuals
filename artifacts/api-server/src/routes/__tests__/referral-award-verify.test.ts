/**
 * referral-award-verify.test.ts — the 25% referral award must fire on
 * EVERY purchase-fulfillment path, not just the Stripe webhook.
 *
 * Live failure (payments Pass 0, Oct 24 2026): awardReferralPayout was
 * called only from lib/stripe-webhook.ts, and only when the webhook
 * itself won the fulfillment claim. A purchase fulfilled by the buyer's
 * browser return — POST /checkout/verify or /payments/express/verify —
 * never awarded at all; and when verify won, the webhook's duplicate
 * branch returned before its award call. The award itself is
 * exactly-once (referral_payouts UNIQUE stripe_session_id), so these
 * suites pin that both verify routes call it once the purchase is known
 * complete (granted, duplicate, or reconciled-completed), and never
 * while the grant is still in flight or genuinely unlanded.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";

const USER_ID = "1596b9a1-bbd0-4bda-8bf2-a22443e6ace8";
const SESSION_ID = "cs_test_verify_award";
const PI_ID = "pi_verify_award";

const h = vi.hoisted(() => {
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-role";
  return {
  fulfillBehavior: { kind: "granted" } as
    | { kind: "granted" }
    | { kind: "duplicate" }
    | { kind: "inflight" }
    | { kind: "throws" },
  paymentStatus: null as string | null,
  awardCalls: [] as Array<{ userId: string; credits: number; key: string }>,
  };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    next();
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/stripe-client", () => ({
  createGuardedStripeClient: vi.fn(() => ({
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({
          id,
          payment_status: "paid",
          payment_intent: PI_ID,
          amount_total: 900,
          currency: "usd",
          metadata: { user_id: USER_ID, credits_amount: "1000", credit_pack: "1,000 Visual Bucs" },
        }),
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => ({
        id,
        status: "succeeded",
        amount: 900,
        currency: "usd",
        metadata: { user_id: USER_ID, credits_amount: "1000", credit_pack: "1,000 Visual Bucs" },
      }),
    },
  })),
  buildCheckoutSessionIdempotencyKey: vi.fn(() => "k"),
}));

vi.mock("../../lib/payment-record", () => ({
  fulfillCreditPurchase: vi.fn(async () => {
    switch (h.fulfillBehavior.kind) {
      case "granted":
        return { outcome: "granted", newCredits: 2300 };
      case "duplicate":
        return { outcome: "duplicate" };
      case "inflight":
        return { outcome: "inflight" };
      case "throws":
        throw new Error("grant exploded (test)");
    }
  }),
  getStripePaymentStatus: vi.fn(async () => h.paymentStatus),
  countCompletedCreditPurchases: vi.fn(async () => 0),
  getPaymentHistory: vi.fn(async () => []),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async (userId: string, credits: number, key: string) => {
    h.awardCalls.push({ userId, credits, key });
    return 250;
  }),
}));

import stripePaymentsRouter from "../stripe-payments";
import expressPayRouter from "../express-pay";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", stripePaymentsRouter);
  app.use("/api", expressPayRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.fulfillBehavior = { kind: "granted" };
  h.paymentStatus = null;
  h.awardCalls = [];
});

async function verifyCheckout() {
  const res = await fetch(`${base}/api/checkout/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": USER_ID },
    body: JSON.stringify({ sessionId: SESSION_ID }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function verifyExpress() {
  const res = await fetch(`${base}/api/payments/express/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": USER_ID },
    body: JSON.stringify({ paymentIntentId: PI_ID }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("POST /checkout/verify — referral award coverage", () => {
  it("granted → award called once with the session key", async () => {
    const { status, body } = await verifyCheckout();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(h.awardCalls).toEqual([{ userId: USER_ID, credits: 1000, key: SESSION_ID }]);
  });

  it("duplicate (webhook granted first) → award still called (no-op if already paid)", async () => {
    h.fulfillBehavior = { kind: "duplicate" };
    const { status, body } = await verifyCheckout();
    expect(status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(h.awardCalls).toEqual([{ userId: USER_ID, credits: 1000, key: SESSION_ID }]);
  });

  it("inflight → 409 and NO award (the purchase grant has not landed yet)", async () => {
    h.fulfillBehavior = { kind: "inflight" };
    const { status } = await verifyCheckout();
    expect(status).toBe(409);
    expect(h.awardCalls).toEqual([]);
  });

  it("grant throws but the row completed elsewhere → reconciled 200 + award called", async () => {
    h.fulfillBehavior = { kind: "throws" };
    h.paymentStatus = "completed";
    const { status, body } = await verifyCheckout();
    expect(status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(h.awardCalls).toEqual([{ userId: USER_ID, credits: 1000, key: SESSION_ID }]);
  });

  it("grant throws and nothing completed → truthful 500 and NO award", async () => {
    h.fulfillBehavior = { kind: "throws" };
    h.paymentStatus = null;
    const { status } = await verifyCheckout();
    expect(status).toBe(500);
    expect(h.awardCalls).toEqual([]);
  });
});

describe("POST /payments/express/verify — referral award coverage", () => {
  it("granted → award called once with the payment-intent key", async () => {
    const { status, body } = await verifyExpress();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(h.awardCalls).toEqual([{ userId: USER_ID, credits: 1000, key: PI_ID }]);
  });

  it("duplicate → award still called", async () => {
    h.fulfillBehavior = { kind: "duplicate" };
    const { status, body } = await verifyExpress();
    expect(status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(h.awardCalls).toEqual([{ userId: USER_ID, credits: 1000, key: PI_ID }]);
  });

  it("inflight → 409 and NO award", async () => {
    h.fulfillBehavior = { kind: "inflight" };
    const { status } = await verifyExpress();
    expect(status).toBe(409);
    expect(h.awardCalls).toEqual([]);
  });

  it("grant throws but the row completed elsewhere → reconciled 200 + award called", async () => {
    h.fulfillBehavior = { kind: "throws" };
    h.paymentStatus = "completed";
    const { status, body } = await verifyExpress();
    expect(status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(h.awardCalls).toEqual([{ userId: USER_ID, credits: 1000, key: PI_ID }]);
  });
});
