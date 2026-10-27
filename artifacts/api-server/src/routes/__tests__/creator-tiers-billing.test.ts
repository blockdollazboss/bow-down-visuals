/**
 * Route tests for Settings → Billing (payfix lane: billing-cancel).
 *
 * THE GAP (Oct 26 test gate, PASS 1): the site had NO cancel control
 * anywhere and no billing surface — Settings had no billing section,
 * GET /creator-tiers/me carried no cancel state, and the only manage
 * door was a Stripe portal endpoint no page linked. The FAQ promised
 * "keep your tier until period end" with no way to do it.
 *
 * These tests drive the REAL creator-tiers router over an ephemeral
 * server against a cond-aware fake db + a fake guarded Stripe client:
 *  - GET /creator-tiers/billing renders the true state for a free user
 *    (no profile / profile without a subscription) and for a paid user
 *    (plan, price, renewal date);
 *  - POST /creator-tiers/cancel calls Stripe with
 *    cancel_at_period_end: true, persists the cancel date on the row,
 *    and the state reads back "canceling" with endsAt = period end —
 *    while the tier itself stays paid until that date (period-end
 *    behavior: resolveCreatorTier still grants the tier, because the
 *    row's status is still "active");
 *  - cancel is idempotent-honest: a second cancel is a 409, a free
 *    user gets a 404, a guest gets a 401;
 *  - POST /creator-tiers/resume undoes a pending cancel;
 *  - a canceled row reads "canceled" and cannot be canceled again;
 *  - GET /creator-tiers/me now carries billingStatus + cancelAtPeriodEnd
 *    so every surface reading /me sees the same truth.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const USER_FREE = "11111111-1111-4111-8111-111111111111";
const USER_PAID = "22222222-2222-4222-8222-222222222222";
const USER_CANCELED = "33333333-3333-4333-8333-333333333333";
const PROFILE_FREE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_PAID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFILE_CANCELED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PERIOD_END = new Date("2026-11-25T12:00:00.000Z");
const PERIOD_END_EPOCH = Math.floor(PERIOD_END.getTime() / 1000);

const h = vi.hoisted(() => ({
  state: {
    profilesByUserId: new Map<string, Record<string, unknown>>(),
    subsByProfileId: new Map<string, Record<string, unknown>>(),
  },
  stripeCalls: [] as Array<{ id: string; params: Record<string, unknown> }>,
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
    req.userId = req.headers["x-user-id"] ?? USER_PAID;
    req.userEmail = "billing@example.test";
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
      update: async (id: string, params: Record<string, unknown>) => {
        h.stripeCalls.push({ id, params });
        if (params["cancel_at_period_end"] === true) {
          return {
            id,
            status: "active",
            cancel_at_period_end: true,
            cancel_at: PERIOD_END_EPOCH,
            items: { data: [{ current_period_end: PERIOD_END_EPOCH }] },
          };
        }
        return {
          id,
          status: "active",
          cancel_at_period_end: false,
          cancel_at: null,
          items: { data: [{ current_period_end: PERIOD_END_EPOCH }] },
        };
      },
    },
    billingPortal: {
      sessions: { create: async () => ({ url: "https://billing.stripe.test/session" }) },
    },
    checkout: { sessions: { create: async () => ({ id: "cs_test", url: "https://checkout.stripe.test/x" }) } },
  }),
  buildCheckoutSessionIdempotencyKey: () => "test-idempotency-key",
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, creatorSubscriptionsTable } = actual;

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
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const apply = async () => {
            if (table === creatorSubscriptionsTable) {
              const { params } = render(cond);
              const key = String(params[0] ?? "");
              const row = state.subsByProfileId.get(key);
              if (row) state.subsByProfileId.set(key, { ...row, ...patch });
              return row ? [{ ...row, ...patch }] : [];
            }
            return [];
          };
          return {
            returning: apply,
            then: (res: any, rej: any) => apply().then(res, rej),
          };
        },
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
  h.stripeCalls.length = 0;
  h.state.profilesByUserId.set(USER_FREE, { id: PROFILE_FREE, userId: USER_FREE, slug: "free-creator" });
  h.state.profilesByUserId.set(USER_PAID, { id: PROFILE_PAID, userId: USER_PAID, slug: "paid-creator" });
  h.state.profilesByUserId.set(USER_CANCELED, { id: PROFILE_CANCELED, userId: USER_CANCELED, slug: "gone-creator" });
  h.state.subsByProfileId.set(PROFILE_PAID, {
    id: "sub-row-paid",
    profileId: PROFILE_PAID,
    tier: "pro",
    status: "active",
    stripeSubscriptionId: "sub_test_pro",
    stripeCustomerId: "cus_test_pro",
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: null,
  });
  h.state.subsByProfileId.set(PROFILE_CANCELED, {
    id: "sub-row-canceled",
    profileId: PROFILE_CANCELED,
    tier: "elite",
    status: "canceled",
    stripeSubscriptionId: "sub_test_elite",
    stripeCustomerId: "cus_test_elite",
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: PERIOD_END,
  });
}

async function call(method: string, path: string, userId?: string, anon = false) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (userId) headers["x-user-id"] = userId;
  if (anon) headers["x-anon"] = "1";
  const res = await fetch(`${base}${path}`, { method, headers });
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

describe("GET /creator-tiers/billing — real state", () => {
  it("free user WITH a profile but no subscription reads Free", async () => {
    const { status, body } = await call("GET", "/creator-tiers/billing", USER_FREE);
    expect(status).toBe(200);
    expect(body.billing.status).toBe("free");
    expect(body.billing.plan).toBe("free");
    expect(body.billing.canCancel).toBe(false);
    expect(body.billing.renewalDate).toBeNull();
  });

  it("user with NO profile at all still reads Free (never an error)", async () => {
    const { status, body } = await call("GET", "/creator-tiers/billing", "99999999-9999-4999-8999-999999999999");
    expect(status).toBe(200);
    expect(body.billing.status).toBe("free");
    expect(body.profileId).toBeNull();
  });

  it("paid Pro user reads plan, $12 price, and the renewal date", async () => {
    const { status, body } = await call("GET", "/creator-tiers/billing", USER_PAID);
    expect(status).toBe(200);
    expect(body.billing.status).toBe("active");
    expect(body.billing.plan).toBe("pro");
    expect(body.billing.planName).toBe("Pro");
    expect(body.billing.priceUsdPerMonth).toBe(12);
    expect(body.billing.renewalDate).toBe(PERIOD_END.toISOString());
    expect(body.billing.canCancel).toBe(true);
    expect(body.billing.endsAt).toBeNull();
  });

  it("canceled user reads canceled with the end date, no cancel offered", async () => {
    const { status, body } = await call("GET", "/creator-tiers/billing", USER_CANCELED);
    expect(status).toBe(200);
    expect(body.billing.status).toBe("canceled");
    expect(body.billing.canCancel).toBe(false);
    expect(body.billing.endsAt).toBe(PERIOD_END.toISOString());
  });

  it("guest gets 401", async () => {
    const { status } = await call("GET", "/creator-tiers/billing", undefined, true);
    expect(status).toBe(401);
  });
});

describe("POST /creator-tiers/cancel — period-end cancel", () => {
  it("sets cancel_at_period_end on Stripe and lands in canceling state", async () => {
    const { status, body } = await call("POST", "/creator-tiers/cancel", USER_PAID);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(h.stripeCalls).toEqual([
      { id: "sub_test_pro", params: { cancel_at_period_end: true } },
    ]);
    expect(body.billing.status).toBe("canceling");
    expect(body.billing.endsAt).toBe(PERIOD_END.toISOString());
    expect(body.billing.renewalDate).toBeNull();
    expect(body.billing.canResume).toBe(true);
    // Persisted on the row, not just in the response:
    const row = h.state.subsByProfileId.get(PROFILE_PAID) as any;
    expect(row.cancelAtPeriodEnd).toEqual(PERIOD_END);
    expect(row.status).toBe("active");
  });

  it("after cancel, billing reads canceling and the tier is STILL paid until period end", async () => {
    await call("POST", "/creator-tiers/cancel", USER_PAID);
    const billing = await call("GET", "/creator-tiers/billing", USER_PAID);
    expect(billing.body.billing.status).toBe("canceling");
    expect(billing.body.billing.plan).toBe("pro");
    // Period-end behavior: /me still grants Pro — the tier ends AT the
    // period end (webhook flips status to canceled then), never early.
    const me = await call("GET", "/creator-tiers/me", USER_PAID);
    expect(me.body.tier).toBe("pro");
    expect(me.body.billingStatus).toBe("canceling");
    expect(me.body.cancelAtPeriodEnd).toBe(PERIOD_END.toISOString());
  });

  it("a second cancel is a 409 and does not call Stripe again", async () => {
    await call("POST", "/creator-tiers/cancel", USER_PAID);
    const { status, body } = await call("POST", "/creator-tiers/cancel", USER_PAID);
    expect(status).toBe(409);
    expect(body.billing.status).toBe("canceling");
    expect(h.stripeCalls).toHaveLength(1);
  });

  it("free user gets a 404 — nothing to cancel", async () => {
    const { status } = await call("POST", "/creator-tiers/cancel", USER_FREE);
    expect(status).toBe(404);
    expect(h.stripeCalls).toHaveLength(0);
  });

  it("an already-canceled subscription gets a 409", async () => {
    const { status } = await call("POST", "/creator-tiers/cancel", USER_CANCELED);
    expect(status).toBe(409);
    expect(h.stripeCalls).toHaveLength(0);
  });

  it("guest gets 401", async () => {
    const { status } = await call("POST", "/creator-tiers/cancel", undefined, true);
    expect(status).toBe(401);
  });
});

describe("POST /creator-tiers/resume — undo before period end", () => {
  it("clears the pending cancel on Stripe and on the row", async () => {
    await call("POST", "/creator-tiers/cancel", USER_PAID);
    const { status, body } = await call("POST", "/creator-tiers/resume", USER_PAID);
    expect(status).toBe(200);
    expect(h.stripeCalls[1]).toEqual({
      id: "sub_test_pro",
      params: { cancel_at_period_end: false },
    });
    expect(body.billing.status).toBe("active");
    expect(body.billing.renewalDate).toBe(PERIOD_END.toISOString());
    const row = h.state.subsByProfileId.get(PROFILE_PAID) as any;
    expect(row.cancelAtPeriodEnd).toBeNull();
  });

  it("resuming a subscription that isn't canceling is a 409", async () => {
    const { status } = await call("POST", "/creator-tiers/resume", USER_PAID);
    expect(status).toBe(409);
    expect(h.stripeCalls).toHaveLength(0);
  });
});
