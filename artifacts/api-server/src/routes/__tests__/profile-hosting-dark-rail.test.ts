/**
 * Item 22 (stack800 Lane 1, Group D) — profile-hosting DARK-RAIL pin.
 *
 * With STRIPE_PRICE_HOSTING unset (production's state today), the
 * hosting rail must stay dark AND honest: every money entry point
 * 503s with plain copy and never leaks internals — no env var names
 * or values, no provider name, no raw provider errors, no stacks.
 *
 * Existing coverage (profile-hosting.test.ts) already pins the 503
 * status + HOSTING_CHECKOUT_UNAVAILABLE code + no-session, and that
 * the plan/me reads answer sanely. This file pins what it does not:
 * the plain-words copy itself, the no-leak property across EVERY
 * response the rail gives while dark, and the dark-rail behavior of
 * the non-money reads as a set.
 *
 * The rail has exactly three entry points (routes/profile-hosting.ts):
 *   GET  /creator-hosting/plan      public read — stays up, says dark
 *   GET  /creator-hosting/me        auth read — stays up, says dark
 *   POST /creator-hosting/checkout  THE money entry point — 503s
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER_USER = "00000000-0000-4000-8000-0000000000aa";
const ELITE_USER = "00000000-0000-4000-8000-0000000000cc";
const OWNER_PROFILE = "11111111-1111-4111-8111-111111111111";
const ELITE_PROFILE = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    hostingByProfile: new Map<string, Record<string, unknown>>(),
    subscriptionsByProfile: new Map<string, Record<string, unknown>>(),
    stripeCreateParams: null as any,
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
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("stripe", () => {
  class FakeStripe {
    customers = {
      create: async () => ({ id: "cus_test_hosting" }),
      retrieve: async (id: string) => ({ id }),
    };
    checkout = {
      sessions: {
        create: async (params: any) => {
          h.state.stripeCreateParams = params;
          return { id: "cs_test_hosting", url: "https://checkout.example.com/cs_test_hosting" };
        },
      },
    };
  }
  return { default: FakeStripe };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, creatorSubscriptionsTable, creatorHostingTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { sql, params } = render(cond);
    if (table === creatorProfilesTable) {
      if (sql.includes('"user_id"')) {
        const row = [...state.profilesById.values()].find((p) => String(p["userId"]) === String(params[0]));
        return row ? [row] : [];
      }
      if (sql.includes('"id"')) {
        const row = state.profilesById.get(String(params[0]));
        return row ? [row] : [];
      }
      return [];
    }
    if (table === creatorHostingTable) {
      const row = state.hostingByProfile.get(String(params[0]));
      return row ? [row] : [];
    }
    if (table === creatorSubscriptionsTable) {
      const row = state.subscriptionsByProfile.get(String(params[0]));
      return row ? [row] : [];
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
        returning: async () => [],
      }),
    }),
    update: (_table: unknown) => ({
      set: (_v: unknown) => ({ where: async () => [] }),
    }),
    execute: async () => ({ rows: [] }),
  };
  return { ...actual, db: fakeDb };
});

import router from "../profile-hosting";

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

const ENV_KEYS = ["HOSTING_PRICE_USD_PER_MONTH", "STRIPE_PRICE_HOSTING", "STRIPE_SECRET_KEY"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    /* THE DARK-RAIL CONDITION: STRIPE_PRICE_HOSTING deleted, exactly
       production's state today. */
    delete process.env[k];
  }
  h.state.profilesById = new Map([
    [OWNER_PROFILE, { id: OWNER_PROFILE, userId: OWNER_USER, slug: "owner-creator" }],
    [ELITE_PROFILE, { id: ELITE_PROFILE, userId: ELITE_USER, slug: "elite-creator" }],
  ]);
  h.state.hostingByProfile = new Map();
  h.state.subscriptionsByProfile = new Map([
    [ELITE_PROFILE, { profileId: ELITE_PROFILE, tier: "elite", status: "active", currentPeriodEnd: null }],
  ]);
  h.state.stripeCreateParams = null;
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
  const text = await r.text();
  return { status: r.status, text, json: JSON.parse(text) as any };
}

/** Nothing internal ever reaches the customer: no env var names, no
 *  provider name, no key material, no stack frames, no raw errors. */
function expectNoLeaks(serializedBody: string) {
  expect(serializedBody).not.toContain("STRIPE_PRICE_HOSTING");
  expect(serializedBody).not.toContain("STRIPE_SECRET_KEY");
  expect(serializedBody).not.toContain("HOSTING_PRICE_USD_PER_MONTH");
  expect(serializedBody).not.toContain("process.env");
  expect(serializedBody).not.toMatch(/stripe/i);
  expect(serializedBody).not.toMatch(/sk_(test|live)_/);
  expect(serializedBody).not.toMatch(/price_[A-Za-z0-9]/);
  expect(serializedBody).not.toMatch(/\n\s+at\s+\S+\s*\(/); // stack frames
  expect(serializedBody).not.toContain("Error:");
}

describe("item 22 — with STRIPE_PRICE_HOSTING unset, the money door 503s honestly", () => {
  it("POST /creator-hosting/checkout → 503, plain copy, nothing charged, no leaks", async () => {
    const { status, text, json } = await call("POST", "/creator-hosting/checkout", {
      user: OWNER_USER,
      body: {},
    });
    expect(status).toBe(503);
    expect(json.error).toBe("HOSTING_CHECKOUT_UNAVAILABLE");
    /* Plain words a creator understands, stating nothing was charged. */
    expect(json.message).toMatch(/isn't switched on yet/i);
    expect(json.message).toMatch(/nothing was charged/i);
    expectNoLeaks(text);
    /* Dark means dark: no Stripe session was even attempted. */
    expect(h.state.stripeCreateParams).toBeNull();
  });

  it("the 503 holds even when a returnTo is supplied (no alternate money door)", async () => {
    const { status, text } = await call("POST", "/creator-hosting/checkout", {
      user: OWNER_USER,
      body: { returnTo: "/creator-pricing" },
    });
    expect(status).toBe(503);
    expectNoLeaks(text);
    expect(h.state.stripeCreateParams).toBeNull();
  });

  it("auth still gates the money door while dark — anonymous gets 401, not the 503", async () => {
    const { status } = await call("POST", "/creator-hosting/checkout", { body: {} });
    expect(status).toBe(401);
    expect(h.state.stripeCreateParams).toBeNull();
  });

  it("an Elite member still gets the honest 409 (Hosting is included) — never sold, never 503-confused", async () => {
    const { status, text, json } = await call("POST", "/creator-hosting/checkout", {
      user: ELITE_USER,
      body: {},
    });
    expect(status).toBe(409);
    expect(json.error).toBe("HOSTING_INCLUDED_WITH_ELITE");
    expect(json.message).toMatch(/included with your Creator Elite plan/i);
    expectNoLeaks(text);
    expect(h.state.stripeCreateParams).toBeNull();
  });
});

describe("item 22 — the non-money reads stay sane while the rail is dark", () => {
  it("GET /creator-hosting/plan → 200, ruled $9 shown, availability honestly false, no leaks", async () => {
    const { status, text, json } = await call("GET", "/creator-hosting/plan");
    expect(status).toBe(200);
    expect(json.plan.priceUsdPerMonth).toBe(9);
    expect(json.plan.priceConfigured).toBe(false);
    expect(json.plan.available).toBe(false);
    expect(json.note).toMatch(/isn't switched on yet/i);
    expectNoLeaks(text);
  });

  it("GET /creator-hosting/me → 200 with the dark plan state embedded, no leaks", async () => {
    const { status, text, json } = await call("GET", "/creator-hosting/me", { user: OWNER_USER });
    expect(status).toBe(200);
    expect(json.hostingEntitled).toBe(false);
    expect(json.plan.available).toBe(false);
    expect(json.plan.priceConfigured).toBe(false);
    expectNoLeaks(text);
  });

  it("GET /creator-hosting/me for an Elite member still reads entitled-through-Elite while dark", async () => {
    const { status, json } = await call("GET", "/creator-hosting/me", { user: ELITE_USER });
    expect(status).toBe(200);
    expect(json.hostingEntitled).toBe(true);
    expect(json.hostingSource).toBe("elite");
  });
});
