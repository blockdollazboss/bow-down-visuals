/**
 * Route tests for POST /creator-tiers/portal — the Hosting buyer fix
 * (Stack 300 A3 / manifest item 88).
 *
 * THE GAP: the portal read the Stripe customer ONLY from
 * creator_subscriptions and 404'd ("No billing record yet") for a
 * standalone Profile Hosting buyer — their subscription lives on
 * creator_hosting, on the SAME Stripe customer (the shared
 * one-customer mapping in lib/creator-stripe-customer) — while the
 * Hosting purchase copy (profileHosting.renewsNote, all 10 catalogs)
 * sends exactly that buyer to Settings → Billing to manage or
 * cancel. The portal now resolves the customer read-only through the
 * shared mapping: durable user mapping → legacy subscription row →
 * legacy hosting row, and never mints a customer.
 *
 * Driven over an ephemeral server against a cond-aware fake db + a
 * fake guarded Stripe client, in the creator-tiers-billing.test.ts
 * harness pattern:
 *  - a hosting-only buyer (customer id ONLY on the hosting row)
 *    reaches the portal, on the hosting customer;
 *  - a buyer whose id lives ONLY in the durable mapping reaches it
 *    too (mapping is the first source, as in the checkout rail);
 *  - a tier subscriber's portal is unchanged (subscription customer);
 *  - a member with no customer anywhere still gets the honest 404
 *    and NO portal session is created;
 *  - a guest gets a 401.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const USER_TIER = "22222222-2222-4222-8222-222222222222";
const USER_HOSTING = "44444444-4444-4444-8444-444444444444";
const USER_MAPPED = "55555555-5555-4555-8555-555555555555";
const USER_FREE = "11111111-1111-4111-8111-111111111111";
const PROFILE_TIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFILE_HOSTING = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROFILE_MAPPED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PROFILE_FREE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const h = vi.hoisted(() => ({
  state: {
    profilesByUserId: new Map<string, Record<string, unknown>>(),
    subsByProfileId: new Map<string, Record<string, unknown>>(),
    hostingByProfileId: new Map<string, Record<string, unknown>>(),
    customersByUserId: new Map<string, Record<string, unknown>>(),
  },
  portalCalls: [] as Array<Record<string, unknown>>,
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.headers["x-anon"]) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = req.headers["x-user-id"] ?? USER_TIER;
    req.userEmail = "portal@example.test";
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/kings-welcome", () => ({
  ensureKingsWelcome: async () => undefined,
}));

vi.mock("../../lib/stripe-client", () => ({
  createGuardedStripeClient: () => ({
    subscriptions: {
      update: async (id: string, params: Record<string, unknown>) => ({
        id,
        status: "active",
        cancel_at_period_end: params["cancel_at_period_end"] === true,
        cancel_at: null,
        items: { data: [{ current_period_end: 1795737600 }] },
      }),
    },
    /* The portal verifies the stored customer before creating a
       session (Stack 400 C-10); every customer seeded here is alive. */
    customers: {
      retrieve: async (id: string) => ({ id }),
    },
    billingPortal: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          h.portalCalls.push(params);
          return { url: "https://billing.stripe.test/session" };
        },
      },
    },
    checkout: { sessions: { create: async () => ({ id: "cs_test", url: "https://checkout.stripe.test/x" }) } },
  }),
  buildCheckoutSessionIdempotencyKey: () => "test-idempotency-key",
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    creatorSubscriptionsTable,
    creatorHostingTable,
    userStripeCustomersTable,
  } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { params } = render(cond);
    const key = String(params[0] ?? "");
    if (table === creatorProfilesTable) {
      const row = state.profilesByUserId.get(key);
      return row ? [row] : [];
    }
    if (table === creatorSubscriptionsTable) {
      const row = state.subsByProfileId.get(key);
      return row ? [row] : [];
    }
    if (table === creatorHostingTable) {
      const row = state.hostingByProfileId.get(key);
      return row ? [row] : [];
    }
    if (table === userStripeCustomersTable) {
      const row = state.customersByUserId.get(key);
      return row ? [row] : [];
    }
    return [];
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const chain: any = {
            limit: async (_n: number) => rowsFor(table, cond),
            orderBy: (..._a: unknown[]) => ({
              limit: async (_n: number) => rowsFor(table, cond),
              then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
            }),
            then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (_patch: Record<string, unknown>) => ({
        where: (_cond: unknown) => ({
          returning: async () => [],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        }),
      }),
    }),
    execute: async () => ({ rows: [{ n: 0, gross: 0, fee: 0, net: 0 }] }),
  };

  return { ...actual, db: fakeDb };
});

import creatorTiersRouter from "../creator-tiers";

let base = "";
let server: ReturnType<typeof express.application.listen>;

function seed() {
  h.state.profilesByUserId.clear();
  h.state.subsByProfileId.clear();
  h.state.hostingByProfileId.clear();
  h.state.customersByUserId.clear();
  h.portalCalls.length = 0;
  h.state.profilesByUserId.set(USER_TIER, { id: PROFILE_TIER, userId: USER_TIER, slug: "tier-creator" });
  h.state.profilesByUserId.set(USER_HOSTING, { id: PROFILE_HOSTING, userId: USER_HOSTING, slug: "hosting-creator" });
  h.state.profilesByUserId.set(USER_MAPPED, { id: PROFILE_MAPPED, userId: USER_MAPPED, slug: "mapped-creator" });
  h.state.profilesByUserId.set(USER_FREE, { id: PROFILE_FREE, userId: USER_FREE, slug: "free-creator" });
  /* Tier subscriber: customer on the subscription row, as before. */
  h.state.subsByProfileId.set(PROFILE_TIER, {
    id: "sub-row-tier",
    profileId: PROFILE_TIER,
    tier: "pro",
    status: "active",
    stripeSubscriptionId: "sub_test_pro",
    stripeCustomerId: "cus_tier_sub",
    currentPeriodEnd: new Date("2026-11-25T12:00:00.000Z"),
    cancelAtPeriodEnd: null,
  });
  /* Hosting-only buyer: NO subscription row at all; the customer id
     lives only on the creator_hosting row — the exact population the
     old portal read 404'd. */
  h.state.hostingByProfileId.set(PROFILE_HOSTING, {
    id: "hosting-row-1",
    profileId: PROFILE_HOSTING,
    status: "active",
    stripeSubscriptionId: "sub_test_hosting",
    stripeCustomerId: "cus_hosting_only",
    currentPeriodEnd: new Date("2026-12-05T12:00:00.000Z"),
  });
  /* Mapped buyer: no subscription row, hosting row without a customer
     id (pre-mapping purchase); the durable mapping carries the id. */
  h.state.hostingByProfileId.set(PROFILE_MAPPED, {
    id: "hosting-row-2",
    profileId: PROFILE_MAPPED,
    status: "active",
    stripeSubscriptionId: "sub_test_hosting_2",
    stripeCustomerId: null,
    currentPeriodEnd: new Date("2026-12-05T12:00:00.000Z"),
  });
  h.state.customersByUserId.set(USER_MAPPED, {
    userId: USER_MAPPED,
    stripeCustomerId: "cus_durable_mapping",
  });
}

async function callPortal(userId?: string, anon = false, returnTo?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (userId) headers["x-user-id"] = userId;
  if (anon) headers["x-anon"] = "1";
  const res = await fetch(`${base}/creator-tiers/portal`, {
    method: "POST",
    headers,
    body: JSON.stringify(returnTo ? { returnTo } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(creatorTiersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(seed);

describe("POST /creator-tiers/portal — the shared customer mapping (Stack 300 A3)", () => {
  it("a hosting-only buyer reaches the portal on the hosting row's customer", async () => {
    const { status, body } = await callPortal(USER_HOSTING, false, "/settings");
    expect(status).toBe(200);
    expect(body.url).toBe("https://billing.stripe.test/session");
    expect(h.portalCalls).toHaveLength(1);
    expect(h.portalCalls[0]!["customer"]).toBe("cus_hosting_only");
    expect(String(h.portalCalls[0]!["return_url"])).toContain("/settings");
  });

  it("a buyer whose id lives only in the durable mapping reaches the portal on it", async () => {
    const { status, body } = await callPortal(USER_MAPPED);
    expect(status).toBe(200);
    expect(body.url).toBe("https://billing.stripe.test/session");
    expect(h.portalCalls).toHaveLength(1);
    expect(h.portalCalls[0]!["customer"]).toBe("cus_durable_mapping");
  });

  it("a tier subscriber's portal is unchanged — the subscription customer", async () => {
    const { status } = await callPortal(USER_TIER);
    expect(status).toBe(200);
    expect(h.portalCalls).toHaveLength(1);
    expect(h.portalCalls[0]!["customer"]).toBe("cus_tier_sub");
  });

  it("the durable mapping wins when both it and a legacy row carry an id (the checkout rail's order)", async () => {
    h.state.customersByUserId.set(USER_TIER, {
      userId: USER_TIER,
      stripeCustomerId: "cus_mapping_wins",
    });
    const { status } = await callPortal(USER_TIER);
    expect(status).toBe(200);
    expect(h.portalCalls[0]!["customer"]).toBe("cus_mapping_wins");
  });

  it("a member with no customer anywhere gets the honest 404 and NO portal session", async () => {
    const { status, body } = await callPortal(USER_FREE);
    expect(status).toBe(404);
    expect(body.error).toContain("No billing record yet");
    expect(h.portalCalls).toHaveLength(0);
  });

  it("guest gets 401", async () => {
    const { status } = await callPortal(undefined, true);
    expect(status).toBe(401);
    expect(h.portalCalls).toHaveLength(0);
  });
});
