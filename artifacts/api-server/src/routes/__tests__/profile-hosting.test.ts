/**
 * Route tests for the Hosting plan (Stack 3, item 8 —
 * routes/profile-hosting.ts on the creator-tiers chassis):
 *   GET  /creator-hosting/plan      public, honest availability
 *   GET  /creator-hosting/me        caller's entitlement (auth)
 *   POST /creator-hosting/checkout  Stripe TEST subscription (auth)
 *
 * PRICE LAW pinned here: with no price configured (the shipped default)
 * the plan reports priceUsdPerMonth: null + available: false and
 * checkout refuses with 503 HOSTING_NOT_PRICED — no invented price is
 * ever displayed or charged. With the owner's config set, checkout
 * creates a TEST-mode subscription session whose price is the
 * configured Stripe price id, with kind "creator_hosting" metadata the
 * webhook sync keys on.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER_USER = "00000000-0000-4000-8000-0000000000aa";
const HOSTED_USER = "00000000-0000-4000-8000-0000000000bb";
const OWNER_PROFILE = "11111111-1111-4111-8111-111111111111";
const HOSTED_PROFILE = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    hostingByProfile: new Map<string, Record<string, unknown>>(),
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
    if (table === creatorSubscriptionsTable) return [];
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
    delete process.env[k];
  }
  h.state.profilesById = new Map([
    [OWNER_PROFILE, { id: OWNER_PROFILE, userId: OWNER_USER, slug: "owner-creator" }],
    [HOSTED_PROFILE, { id: HOSTED_PROFILE, userId: HOSTED_USER, slug: "hosted-creator" }],
  ]);
  h.state.hostingByProfile = new Map([
    [HOSTED_PROFILE, { profileId: HOSTED_PROFILE, status: "active", currentPeriodEnd: null }],
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
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /creator-hosting/plan", () => {
  it("with no price configured, the plan is honestly unavailable — no invented price", async () => {
    const { status, json } = await call("GET", "/creator-hosting/plan");
    expect(status).toBe(200);
    expect(json.plan.name).toBe("Hosting");
    expect(json.plan.priceUsdPerMonth).toBeNull();
    expect(json.plan.priceConfigured).toBe(false);
    expect(json.plan.available).toBe(false);
    expect(json.plan.features.map((f: any) => f.label).join(" ")).toMatch(/custom domain/i);
  });

  it("with the owner's config set, the configured price is the displayed price", async () => {
    process.env["HOSTING_PRICE_USD_PER_MONTH"] = "15";
    process.env["STRIPE_PRICE_HOSTING"] = "price_test_hosting";
    const { json } = await call("GET", "/creator-hosting/plan");
    expect(json.plan.priceUsdPerMonth).toBe(15);
    expect(json.plan.available).toBe(true);
  });
});

describe("POST /creator-hosting/checkout", () => {
  it("refuses with 503 when the price is unset — nothing is charged", async () => {
    const { status, json } = await call("POST", "/creator-hosting/checkout", { user: OWNER_USER, body: {} });
    expect(status).toBe(503);
    expect(json.error).toBe("HOSTING_NOT_PRICED");
    expect(h.state.stripeCreateParams).toBeNull();
  });

  it("creates a TEST subscription session at the configured price when priced", async () => {
    process.env["HOSTING_PRICE_USD_PER_MONTH"] = "15";
    process.env["STRIPE_PRICE_HOSTING"] = "price_test_hosting";
    process.env["STRIPE_SECRET_KEY"] = "sk_test_example";
    const { status, json } = await call("POST", "/creator-hosting/checkout", { user: OWNER_USER, body: {} });
    expect(status).toBe(200);
    expect(json.url).toContain("cs_test_hosting");
    const params = h.state.stripeCreateParams;
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([{ price: "price_test_hosting", quantity: 1 }]);
    expect(params.metadata.kind).toBe("creator_hosting");
    expect(params.subscription_data.metadata.kind).toBe("creator_hosting");
  });

  it("an already-hosted creator isn't sold the plan twice", async () => {
    process.env["HOSTING_PRICE_USD_PER_MONTH"] = "15";
    process.env["STRIPE_PRICE_HOSTING"] = "price_test_hosting";
    process.env["STRIPE_SECRET_KEY"] = "sk_test_example";
    const { status, json } = await call("POST", "/creator-hosting/checkout", { user: HOSTED_USER, body: {} });
    expect(status).toBe(409);
    expect(json.error).toBe("ALREADY_HOSTED");
    expect(h.state.stripeCreateParams).toBeNull();
  });

  it("requires auth", async () => {
    expect((await call("POST", "/creator-hosting/checkout", { body: {} })).status).toBe(401);
  });
});

describe("GET /creator-hosting/me", () => {
  it("reports entitlement + clean branding state", async () => {
    const hosted = await call("GET", "/creator-hosting/me", { user: HOSTED_USER });
    expect(hosted.status).toBe(200);
    expect(hosted.json.hostingEntitled).toBe(true);
    expect(hosted.json.cleanBranding).toBe(true);

    const plain = await call("GET", "/creator-hosting/me", { user: OWNER_USER });
    expect(plain.json.hostingEntitled).toBe(false);
    expect(plain.json.cleanBranding).toBe(false);
  });
});
