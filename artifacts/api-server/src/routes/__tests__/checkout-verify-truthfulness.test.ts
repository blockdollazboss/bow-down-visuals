/**
 * checkout-verify-truthfulness.test.ts — D6: the dashboard return-verify
 * endpoint must never tell the member their credits failed when they
 * landed, and must never leak internal errors.
 *
 * Live failure (Oct 21 2026, payments Phase B): after three successful
 * test purchases the dashboard banner read "Credits verified but could
 * not be applied: Failed query: insert into stripe_payments (…)" —
 * raw internal SQL text — while the credits HAD been granted by the
 * webhook. The mechanism is pinned at the claim layer in
 * payment-claim-error-shape.test.ts; this suite pins the ROUTE's
 * contract with fulfill mocked:
 *
 *   - granted   → 200 success;
 *   - duplicate → 200 success (already granted elsewhere);
 *   - inflight  → 409 "being processed";
 *   - grant throws BUT the payment row is completed (the other path
 *     finished it in the meantime) → reconciled to 200 duplicate —
 *     the truth, not a failure banner;
 *   - grant throws and no completed row → 500 with the truthful
 *     pending message ("payment went through … still being applied"),
 *     containing NO internal error text and NO "could not be applied".
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";

const USER_ID = "1596b9a1-bbd0-4bda-8bf2-a22443e6ace8";
const SESSION_ID = "cs_test_truthful";

const h = vi.hoisted(() => {
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-role";
  return {
    fulfillBehavior: { kind: "granted" } as
      | { kind: "granted" }
      | { kind: "duplicate" }
      | { kind: "inflight" }
      | { kind: "throws" },
    paymentStatus: null as string | null,
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

vi.mock("../../lib/stripe-client", () => ({
  createGuardedStripeClient: vi.fn(() => ({
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({
          id,
          payment_status: "paid",
          payment_intent: "pi_truthful",
          amount_total: 900,
          currency: "usd",
          metadata: {
            user_id: USER_ID,
            credits_amount: "1000",
            credit_pack: "1,000 Visual Bucs",
          },
        }),
      },
    },
  })),
  buildCheckoutSessionIdempotencyKey: vi.fn(() => "k"),
}));

vi.mock("../../lib/payment-record", () => ({
  fulfillCreditPurchase: vi.fn(async () => {
    switch (h.fulfillBehavior.kind) {
      case "granted":
        return { outcome: "granted", newCredits: 5000 };
      case "duplicate":
        return { outcome: "duplicate" };
      case "inflight":
        return { outcome: "inflight" };
      case "throws":
        // The D6 production shape: a wrapped drizzle error whose
        // message is raw SQL — the route must not forward it.
        throw new Error(
          'Failed query: insert into "stripe_payments" (...) values (...)\nparams: cs_test_truthful',
        );
    }
  }),
  getStripePaymentStatus: vi.fn(async () => h.paymentStatus),
  countCompletedCreditPurchases: vi.fn(async () => 0),
  getPaymentHistory: vi.fn(async () => []),
}));

vi.mock("stripe", () => ({ default: class FakeStripe {} }));

import stripePaymentsRouter from "../stripe-payments";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", stripePaymentsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.fulfillBehavior = { kind: "granted" };
  h.paymentStatus = null;
});

async function verify() {
  const res = await fetch(`${base}/api/checkout/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": USER_ID },
    body: JSON.stringify({ sessionId: SESSION_ID }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe("POST /api/checkout/verify — truthful outcomes (D6)", () => {
  it("granted → 200 success with the new balance", async () => {
    const { status, body } = await verify();
    expect(status).toBe(200);
    expect(body["success"]).toBe(true);
    expect(body["added"]).toBe(1000);
  });

  it("duplicate (webhook granted first) → 200 success, not an error", async () => {
    h.fulfillBehavior = { kind: "duplicate" };
    const { status, body } = await verify();
    expect(status).toBe(200);
    expect(body["success"]).toBe(true);
    expect(body["duplicate"]).toBe(true);
  });

  it("inflight → 409 processing message", async () => {
    h.fulfillBehavior = { kind: "inflight" };
    const { status, body } = await verify();
    expect(status).toBe(409);
    expect(String(body["error"])).toContain("being processed");
  });

  it("grant throws but the row completed elsewhere → reconciled 200 duplicate (the D6 banner case)", async () => {
    h.fulfillBehavior = { kind: "throws" };
    h.paymentStatus = "completed";
    const { status, body } = await verify();
    expect(status).toBe(200);
    expect(body["success"]).toBe(true);
    expect(body["duplicate"]).toBe(true);
  });

  it("grant throws with no completed row → 500 truthful pending message, no internal text", async () => {
    h.fulfillBehavior = { kind: "throws" };
    h.paymentStatus = "failed";
    const { status, body } = await verify();
    expect(status).toBe(500);
    const msg = String(body["error"]);
    expect(msg).toContain("Your payment went through");
    expect(msg).toContain("still being applied");
    expect(msg).not.toContain("could not be applied");
    expect(msg).not.toContain("Failed query");
    expect(msg).not.toContain("insert into");
    expect(msg).not.toContain("stripe_payments");
  });
});
