/**
 * Route tests for POST /embedded-checkout/subscription/intent
 * (Stack400 lane 1 — the "Network hiccup" checkout death).
 *
 * What this pins:
 *  - The happy path returns the invoice confirmation_secret +
 *    subscription id the PaymentElement mounts with, creating the
 *    subscription at the configured STRIPE_PRICE_TIER_* price with
 *    payment_behavior "default_incomplete".
 *  - The idempotency key is STABLE across a retry with unchanged
 *    durable state — that stability is what makes a client-side
 *    retry of this POST safe (same key -> Stripe replays the same
 *    subscription; no second subscription, no double charge).
 *  - Every failure mode answers JSON (never HTML, never a hang):
 *    missing price env -> 500 naming the var; Stripe throwing ->
 *    502 with Stripe's message; already subscribed -> 409.
 *    (The live "Network hiccup" could therefore only come from a
 *    transport failure — the response never arriving as JSON —
 *    which is why the frontend fix retries this POST.)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const USER = "00000000-0000-4000-8000-0000000000dd";
const PROFILE = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  state: {
    subscriptionRow: null as Record<string, unknown> | null,
    stripeBehavior: "ok" as "ok" | "throw",
    customerCreateCalls: [] as { params: any; options: any }[],
    subscriptionCreateCalls: [] as { params: any; options: any }[],
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

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

vi.mock("stripe", () => {
  class FakeStripe {
    customers = {
      create: async (params: any, options: any) => {
        h.state.customerCreateCalls.push({ params, options });
        return { id: "cus_new" };
      },
    };
    subscriptions = {
      create: async (params: any, options: any) => {
        h.state.subscriptionCreateCalls.push({ params, options });
        if (h.state.stripeBehavior === "throw") {
          throw new Error("Stripe API is unavailable (test double)");
        }
        /* Basil-shaped invoice: the PaymentElement secret is the
           invoice confirmation_secret; the PI hangs off the default
           invoice payment — the exact shape the route reads. */
        return {
          id: "sub_new",
          latest_invoice: {
            id: "in_new",
            amount_due: 1200,
            confirmation_secret: { client_secret: "pi_new_secret_abc" },
            payments: {
              data: [
                { is_default: true, payment: { payment_intent: "pi_new" } },
              ],
            },
          },
        };
      },
    };
  }
  return { default: FakeStripe };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, creatorSubscriptionsTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { params } = render(cond);
    if (table === creatorProfilesTable) {
      return String(params[0]) === USER ? [{ id: PROFILE, userId: USER, slug: "buyer-d" }] : [];
    }
    if (table === creatorSubscriptionsTable) {
      return state.subscriptionRow && String(params[0]) === PROFILE ? [state.subscriptionRow] : [];
    }
    return [];
  }

  function chain(table: unknown, cond: unknown): any {
    const self: any = {
      limit: (_n: number) => self,
      orderBy: (..._a: unknown[]) => self,
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return self;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({ where: (cond: unknown) => chain(table, cond) }),
    }),
    insert: (_table: unknown) => ({
      values: (_v: unknown) => ({
        onConflictDoNothing: async () => [],
        returning: async () => [{ id: PROFILE }],
      }),
    }),
    update: (_table: unknown) => ({
      set: (_v: unknown) => ({ where: async () => [] }),
    }),
    execute: async () => ({ rows: [] }),
  };
  return { ...actual, db: fakeDb };
});

import router from "../embedded-checkout";

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
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_TIER_PRO", "STRIPE_PRICE_TIER_ELITE"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env["STRIPE_SECRET_KEY"] = "sk_test_example";
  process.env["STRIPE_PRICE_TIER_PRO"] = "price_pro_test";
  process.env["STRIPE_PRICE_TIER_ELITE"] = "price_elite_test";
  h.state.subscriptionRow = null;
  h.state.stripeBehavior = "ok";
  h.state.customerCreateCalls = [];
  h.state.subscriptionCreateCalls = [];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function call(path: string, opts: { user?: string; body?: unknown } = {}) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("POST /embedded-checkout/subscription/intent", () => {
  it("happy path: creates a default_incomplete subscription at the configured Pro price and returns the PaymentElement secret", async () => {
    const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.clientSecret).toBe("pi_new_secret_abc");
    expect(json.subscriptionId).toBe("sub_new");
    expect(json.paymentIntentId).toBe("pi_new");
    expect(json.amount).toBe(1200);

    expect(h.state.subscriptionCreateCalls).toHaveLength(1);
    const { params, options } = h.state.subscriptionCreateCalls[0]!;
    expect(params.items).toEqual([{ price: "price_pro_test" }]);
    expect(params.payment_behavior).toBe("default_incomplete");
    expect(params.metadata).toMatchObject({ kind: "creator_tier", tier: "pro", user_id: USER, profile_id: PROFILE });
    expect(typeof options?.idempotencyKey).toBe("string");
    expect(options.idempotencyKey.length).toBeGreaterThan(0);
  });

  it("retry safety: a second identical attempt derives the SAME Stripe idempotency key", async () => {
    await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    expect(h.state.subscriptionCreateCalls).toHaveLength(2);
    const [first, second] = h.state.subscriptionCreateCalls;
    expect(second!.options.idempotencyKey).toBe(first!.options.idempotencyKey);
  });

  it("missing price env answers 500 JSON naming the variable — never a hang or HTML", async () => {
    delete process.env["STRIPE_PRICE_TIER_PRO"];
    const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    expect(status).toBe(500);
    expect(json.error).toContain("STRIPE_PRICE_TIER_PRO");
    expect(h.state.subscriptionCreateCalls).toHaveLength(0);
  });

  it("a Stripe failure answers 502 JSON with the cause — the client can show it and retry", async () => {
    h.state.stripeBehavior = "throw";
    const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    expect(status).toBe(502);
    expect(json.error).toContain("Stripe couldn't start checkout");
    expect(json.error).toContain("Stripe API is unavailable");
  });

  it("an already-subscribed member gets 409 ALREADY_SUBSCRIBED and nothing is created", async () => {
    h.state.subscriptionRow = {
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date("2026-11-26T00:00:00Z"),
      stripeSubscriptionId: "sub_existing",
      stripeCustomerId: "cus_existing",
    };
    const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "elite" } });
    expect(status).toBe(409);
    expect(json.error).toBe("ALREADY_SUBSCRIBED");
    expect(h.state.subscriptionCreateCalls).toHaveLength(0);
    expect(h.state.customerCreateCalls).toHaveLength(0);
  });

  it("requires auth", async () => {
    const { status } = await call("/embedded-checkout/subscription/intent", { body: { tier: "pro" } });
    expect(status).toBe(401);
  });
});
