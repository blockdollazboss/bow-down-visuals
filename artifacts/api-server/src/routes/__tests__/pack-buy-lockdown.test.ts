/**
 * pack-buy-lockdown.test.ts — stack1400 ruling #26 (H-4): while the
 * credit lockdown (CREDITS_ADMIN_ONLY) is on, a member who could not
 * SPEND must not BUY a credit pack either.
 *
 * The predicate itself (lib/credits canBuyCreditPack — lockdown off →
 * everyone; lockdown on → admins + admin-grant holders only) is pinned
 * against the real code in lib/__tests__/admin-unrestricted.test.ts.
 * This suite pins the ENFORCEMENT at purchase creation on both rails,
 * with the predicate mocked at the module boundary:
 *  - embedded POST /embedded-checkout/credit-pack/intent: gate closed
 *    -> 403 with the honest paused copy and NO PaymentIntent created;
 *    gate open -> the intent is created as before;
 *  - hosted POST /create-checkout-session (whose only product is a
 *    credit pack): gate closed -> 403, NO Checkout Session created;
 *    gate open -> the session is created as before;
 *  - NOT gated: credit-pack verify (an already-created purchase must
 *    still deliver), the embedded subscription intent (not a pack),
 *    and payment history.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "00000000-0000-4000-8000-0000000000ee";

const h = vi.hoisted(() => ({
  canBuy: true,
  piCreateCalls: [] as any[],
  sessionCreateCalls: [] as any[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userEmail = "buyer@example.com";
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

/* The gate predicate, controlled per test. The real predicate's
   flag/admin/grant matrix is pinned in admin-unrestricted.test.ts. */
vi.mock("../../lib/credits", () => ({
  canBuyCreditPack: async () => h.canBuy,
  CREDIT_PACK_SALES_PAUSED_MESSAGE: "Credit pack sales are paused right now.",
}));

vi.mock("../../lib/payment-record", () => ({
  countCompletedCreditPurchases: async () => 0,
  fulfillCreditPurchase: async () => ({ outcome: "completed", newCredits: 1000 }),
  getStripePaymentStatus: async () => null,
  getPaymentHistory: async () => [],
}));

vi.mock("stripe", () => {
  class FakeStripe {
    prices = {
      retrieve: async (_id: string) => ({ unit_amount: 1000, currency: "usd" }),
    };
    paymentIntents = {
      create: async (params: any, options: any) => {
        h.piCreateCalls.push({ params, options });
        return { id: "pi_new", client_secret: "pi_new_secret" };
      },
      retrieve: async (_id: string) => ({
        id: "pi_other",
        status: "succeeded",
        amount: 1000,
        currency: "usd",
        metadata: { source: "some_other_source", kind: "credit_pack" },
      }),
    };
    checkout = {
      sessions: {
        create: async (params: any, options: any) => {
          h.sessionCreateCalls.push({ params, options });
          return { id: "cs_new", url: "https://checkout.example/pay" };
        },
      },
    };
    customers = { create: async () => ({ id: "cus_new" }) };
    subscriptions = {
      create: async () => ({ id: "sub_new" }),
      list: async () => ({ data: [] }),
      retrieve: async () => ({ id: "sub_new" }),
      cancel: async () => ({ id: "sub_new", status: "canceled" }),
    };
  }
  return { default: FakeStripe };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const chain: any = {
    limit: () => chain,
    orderBy: () => chain,
    then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
  };
  const fakeDb: any = {
    select: () => ({ from: () => ({ where: () => chain }) }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => [],
        returning: async () => [{ id: "profile-1" }],
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    execute: async () => ({ rows: [] }),
  };
  return { ...actual, db: fakeDb };
});

import embeddedRouter from "../embedded-checkout";
import stripePaymentsRouter from "../stripe-payments";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", embeddedRouter);
  app.use("/api", stripePaymentsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_10_CREDITS", "STRIPE_PRICE_TIER_PRO"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env["STRIPE_SECRET_KEY"] = "sk_test_example";
  process.env["STRIPE_PRICE_10_CREDITS"] = "price_10_test";
  h.canBuy = true;
  h.piCreateCalls = [];
  h.sessionCreateCalls = [];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("embedded rail — POST /embedded-checkout/credit-pack/intent", () => {
  it("gate closed (lockdown, cannot spend): 403 with the paused copy, NO PaymentIntent created", async () => {
    h.canBuy = false;
    const { status, json } = await call("POST", "/embedded-checkout/credit-pack/intent", {
      user: USER,
      body: { pack: "10" },
    });
    expect(status).toBe(403);
    expect(json).toEqual({ error: "Credit pack sales are paused right now." });
    /* The internal flag name never leaks into member-facing copy. */
    expect(JSON.stringify(json)).not.toContain("CREDITS_ADMIN_ONLY");
    expect(h.piCreateCalls).toHaveLength(0);
  });

  it("gate open (lockdown off, or admin / grant holder under it): the intent is created as before", async () => {
    h.canBuy = true;
    const { status, json } = await call("POST", "/embedded-checkout/credit-pack/intent", {
      user: USER,
      body: { pack: "10" },
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.clientSecret).toBe("pi_new_secret");
    expect(json.credits).toBe(1000);
    expect(h.piCreateCalls).toHaveLength(1);
    expect(h.piCreateCalls[0].params.metadata).toMatchObject({ kind: "credit_pack", user_id: USER });
  });
});

describe("hosted rail — POST /create-checkout-session (credit packs only)", () => {
  it("gate closed: 403 with the paused copy, NO Checkout Session created", async () => {
    h.canBuy = false;
    const { status, json } = await call("POST", "/create-checkout-session", {
      user: USER,
      body: { pack: "10" },
    });
    expect(status).toBe(403);
    expect(json).toEqual({ error: "Credit pack sales are paused right now." });
    expect(JSON.stringify(json)).not.toContain("CREDITS_ADMIN_ONLY");
    expect(h.sessionCreateCalls).toHaveLength(0);
  });

  it("gate open: the session is created as before", async () => {
    h.canBuy = true;
    const { status, json } = await call("POST", "/create-checkout-session", {
      user: USER,
      body: { pack: "10" },
    });
    expect(status).toBe(200);
    expect(json).toEqual({ url: "https://checkout.example/pay" });
    expect(h.sessionCreateCalls).toHaveLength(1);
    expect(h.sessionCreateCalls[0].params.metadata).toMatchObject({
      user_id: USER,
      credit_pack: "1,000 Visual Bucs",
    });
  });

  it("an invalid pack is still the plain 400, gate or no gate", async () => {
    h.canBuy = false;
    const { status, json } = await call("POST", "/create-checkout-session", {
      user: USER,
      body: { pack: "999" },
    });
    expect(status).toBe(400);
    expect(json.error).toContain("Invalid pack size");
    expect(h.sessionCreateCalls).toHaveLength(0);
  });
});

describe("surfaces the buy gate must NOT touch", () => {
  it("credit-pack verify stays ungated: an already-created purchase still reaches fulfillment checks", async () => {
    h.canBuy = false;
    const { status, json } = await call("POST", "/embedded-checkout/credit-pack/verify", {
      user: USER,
      body: { paymentIntentId: "pi_other" },
    });
    /* Not the paused 403: the request reached the verify rail's own
       validation (this PI is not an embedded credit-pack purchase). */
    expect(status).toBe(400);
    expect(json.error).toContain("isn't an embedded credit-pack purchase");
  });

  it("the embedded subscription intent is not a pack purchase: no paused 403", async () => {
    h.canBuy = false;
    const { status, json } = await call("POST", "/embedded-checkout/subscription/intent", {
      user: USER,
      body: { tier: "pro" },
    });
    /* STRIPE_PRICE_TIER_PRO is unset in this suite, so the untouched
       route answers its usual configuration 500 — proof the buy gate
       never intercepted a non-pack purchase. */
    expect(status).toBe(500);
    expect(json.error).toContain("STRIPE_PRICE_TIER_PRO");
  });

  it("payment history stays readable under the lockdown", async () => {
    h.canBuy = false;
    const { status, json } = await call("GET", "/payments/history", { user: USER });
    expect(status).toBe(200);
    expect(json).toEqual({ payments: [] });
  });
});
