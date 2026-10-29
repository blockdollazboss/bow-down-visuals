/**
 * Route tests for the in-place tier change (stack600 plan-tier-change).
 *
 * THE DEFECT (Gate Pass 1, live Oct 28 on stack500): an existing
 * subscriber could not change tiers ANYWHERE. The embedded intent
 * answered 409 ALREADY_SUBSCRIBED, Settings → Billing offered only
 * Cancel + Manage payment method, and the Stripe portal showed no
 * plan-change control. Sibling defect, same run: the sidebar badge
 * flipped free/pro across pages and Settings → Billing failed with
 * "Couldn't load your billing. Try again." — including on retry.
 *
 * These tests drive the REAL creator-tiers router over an ephemeral
 * server against a cond-aware fake db + a stored-subscription Stripe
 * double, and pin:
 *  - POST /creator-tiers/change/preview returns Stripe's proration
 *    numbers for the swap on the member's EXISTING subscription and
 *    writes nothing (upgrade: prorated difference due today;
 *    downgrade: $0 due, net credit shown);
 *  - POST /creator-tiers/change performs exactly ONE
 *    subscriptions.update on the SAME subscription + SAME customer
 *    (never a create — the Oct 26 two-subscriptions disaster stays
 *    impossible), at the SAME proration_date the preview used, with
 *    proration_behavior "always_invoice";
 *  - a sequential repeat of an applied change answers alreadyApplied
 *    with NO further Stripe write; parallel double-submits all carry
 *    the ONE idempotency key derived from the pre-change state, so
 *    Stripe replays instead of double-charging;
 *  - changing tiers clears a pending cancel (changing = staying);
 *  - after a change, GET /me and GET /creator-tiers/billing agree —
 *    both read the same creator_subscriptions row;
 *  - the billing read fails HONESTLY: when the row read blips after
 *    the tier resolution succeeded, /billing answers a clean JSON
 *    500 (and succeeds once the blip passes) while /me degrades to
 *    the resolved tier instead of 500ing the badge's source.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const USER_PRO = "10101010-1010-4101-8101-101010101010";
const USER_ELITE = "20202020-2020-4202-8202-202020202020";
const USER_CANCELING = "30303030-3030-4303-8303-303030303030";
const USER_FREE = "40404040-4040-4404-8404-404040404040";
const PROFILE_PRO = "a1010101-a101-4a10-8a10-a10101010101";
const PROFILE_ELITE = "b2020202-b202-4b20-8b20-b20202020202";
const PROFILE_CANCELING = "c3030303-c303-4c30-8c30-c30303030303";
const PROFILE_FREE = "d4040404-d404-4d40-8d40-d40404040404";
const PERIOD_END = new Date("2026-11-25T12:00:00.000Z");
const PERIOD_END_EPOCH = Math.floor(PERIOD_END.getTime() / 1000);

const h = vi.hoisted(() => ({
  state: {
    profilesByUserId: new Map<string, Record<string, unknown>>(),
    subsByProfileId: new Map<string, Record<string, unknown>>(),
    /* Subscription-row select counter + failure gate: the live
       billing failure was INTERMITTENT — the tier resolution read
       succeeded and the billing read right behind it blipped. */
    subsSelects: 0,
    failSubsAfter: null as number | null,
    storedSubs: new Map<string, any>(),
    updateCalls: [] as Array<{ id: string; params: any; options: any }>,
    previewCalls: [] as any[],
    retrieveCalls: [] as string[],
    subCreateCalls: 0,
    customerCreateCalls: 0,
  },
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
    req.userId = req.headers["x-user-id"] ?? USER_PRO;
    req.userEmail = "change@example.test";
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/kings-welcome", () => ({
  ensureKingsWelcome: async () => undefined,
}));

vi.mock("../../lib/stripe-client", () => {
  const state = h.state;
  function renderStored(stored: any): any {
    return {
      id: stored.id,
      status: stored.status,
      customer: stored.customer,
      metadata: stored.metadata,
      cancel_at_period_end: stored.cancel_at_period_end,
      items: {
        data: stored.items.data.map((it: any) => ({
          id: it.id,
          price: { id: it.price.id },
          current_period_end: it.current_period_end,
        })),
      },
    };
  }
  return {
    /* Deterministic like the real helper: same member + rail +
       intent → same key; any difference → different key. */
    buildCheckoutSessionIdempotencyKey: (args: any) =>
      `idem|${args.memberId}|${args.rail}|${JSON.stringify(args.purchaseIntent)}`,
    createGuardedStripeClient: () => ({
      subscriptions: {
        retrieve: async (id: string) => {
          state.retrieveCalls.push(id);
          const stored = state.storedSubs.get(id);
          if (!stored) throw new Error(`No such subscription: ${id}`);
          return renderStored(stored);
        },
        update: async (id: string, params: any, options: any) => {
          state.updateCalls.push({ id, params, options });
          const stored = state.storedSubs.get(id);
          if (!stored) throw new Error(`No such subscription: ${id}`);
          if (params.items?.[0]?.price) stored.items.data[0].price.id = params.items[0].price;
          if (params.cancel_at_period_end === false) stored.cancel_at_period_end = false;
          if (params.metadata) stored.metadata = params.metadata;
          return renderStored(stored);
        },
        create: async () => {
          state.subCreateCalls += 1;
          throw new Error("subscriptions.create must never run for a tier change");
        },
      },
      customers: {
        create: async () => {
          state.customerCreateCalls += 1;
          throw new Error("customers.create must never run for a tier change");
        },
      },
      invoices: {
        /* Proration double: Pro→Elite mid-cycle nets +850 due today;
           Elite→Pro nets a 700 credit (negative amount_due). */
        createPreview: async (params: any) => {
          state.previewCalls.push(params);
          const price = params.subscription_details?.items?.[0]?.price;
          const amount_due = price === "price_elite_test" ? 850 : price === "price_pro_test" ? -700 : 0;
          return { amount_due, currency: "usd" };
        },
      },
      billingPortal: {
        sessions: { create: async () => ({ url: "https://billing.stripe.test/session" }) },
      },
      checkout: { sessions: { create: async () => ({ id: "cs_test", url: "https://checkout.stripe.test/x" }) } },
    }),
  };
});

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
      state.subsSelects += 1;
      if (state.failSubsAfter !== null && state.subsSelects > state.failSubsAfter) {
        throw new Error("connection reset by peer (test double)");
      }
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

function storedSub(id: string, customer: string, itemId: string, priceId: string, cancelAtPeriodEnd: boolean) {
  return {
    id,
    status: "active",
    customer,
    metadata: { kind: "creator_tier" },
    cancel_at_period_end: cancelAtPeriodEnd,
    items: { data: [{ id: itemId, price: { id: priceId }, current_period_end: PERIOD_END_EPOCH }] },
  };
}

function seed() {
  const s = h.state;
  s.profilesByUserId.clear();
  s.subsByProfileId.clear();
  s.storedSubs.clear();
  s.updateCalls = [];
  s.previewCalls = [];
  s.retrieveCalls = [];
  s.subCreateCalls = 0;
  s.customerCreateCalls = 0;
  s.subsSelects = 0;
  s.failSubsAfter = null;

  s.profilesByUserId.set(USER_PRO, { id: PROFILE_PRO, userId: USER_PRO, slug: "pro-creator" });
  s.profilesByUserId.set(USER_ELITE, { id: PROFILE_ELITE, userId: USER_ELITE, slug: "elite-creator" });
  s.profilesByUserId.set(USER_CANCELING, { id: PROFILE_CANCELING, userId: USER_CANCELING, slug: "leaving-creator" });
  s.profilesByUserId.set(USER_FREE, { id: PROFILE_FREE, userId: USER_FREE, slug: "free-creator" });

  s.subsByProfileId.set(PROFILE_PRO, {
    id: "sub-row-pro", profileId: PROFILE_PRO, tier: "pro", status: "active",
    stripeSubscriptionId: "sub_pro", stripeCustomerId: "cus_pro",
    currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: null,
  });
  s.subsByProfileId.set(PROFILE_ELITE, {
    id: "sub-row-elite", profileId: PROFILE_ELITE, tier: "elite", status: "active",
    stripeSubscriptionId: "sub_elite", stripeCustomerId: "cus_elite",
    currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: null,
  });
  s.subsByProfileId.set(PROFILE_CANCELING, {
    id: "sub-row-canceling", profileId: PROFILE_CANCELING, tier: "pro", status: "active",
    stripeSubscriptionId: "sub_canceling", stripeCustomerId: "cus_canceling",
    currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: PERIOD_END,
  });

  s.storedSubs.set("sub_pro", storedSub("sub_pro", "cus_pro", "si_pro", "price_pro_test", false));
  s.storedSubs.set("sub_elite", storedSub("sub_elite", "cus_elite", "si_elite", "price_elite_test", false));
  s.storedSubs.set("sub_canceling", storedSub("sub_canceling", "cus_canceling", "si_canceling", "price_pro_test", true));
}

async function call(method: string, path: string, opts: { user?: string; body?: unknown; anon?: boolean } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.user) headers["x-user-id"] = opts.user;
  if (opts.anon) headers["x-anon"] = "1";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body };
}

const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_TIER_PRO", "STRIPE_PRICE_TIER_ELITE"];
let savedEnv: Record<string, string | undefined> = {};

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

beforeEach(() => {
  seed();
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env["STRIPE_SECRET_KEY"] = "sk_test_example";
  process.env["STRIPE_PRICE_TIER_PRO"] = "price_pro_test";
  process.env["STRIPE_PRICE_TIER_ELITE"] = "price_elite_test";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("POST /creator-tiers/change/preview — honest proration numbers, no writes", () => {
  it("Pro → Elite: the prorated difference is due today, effective immediately, renewal date unchanged", async () => {
    const { status, body } = await call("POST", "/creator-tiers/change/preview", { user: USER_PRO, body: { tier: "elite" } });
    expect(status).toBe(200);
    expect(body.preview.fromTier).toBe("pro");
    expect(body.preview.fromPlanName).toBe("Pro");
    expect(body.preview.toTier).toBe("elite");
    expect(body.preview.toPlanName).toBe("Elite");
    expect(body.preview.toPriceUsdPerMonth).toBe(29);
    expect(body.preview.amountDueTodayCents).toBe(850);
    expect(body.preview.creditCents).toBe(0);
    expect(body.preview.currency).toBe("usd");
    expect(body.preview.effective).toBe("immediate");
    expect(body.preview.renewalDate).toBe(PERIOD_END.toISOString());
    expect(body.preview.clearsPendingCancel).toBe(false);
    /* The preview priced the member's EXISTING subscription and
       wrote nothing anywhere. */
    expect(h.state.previewCalls).toHaveLength(1);
    expect(h.state.previewCalls[0].subscription).toBe("sub_pro");
    expect(h.state.previewCalls[0].customer).toBe("cus_pro");
    expect(h.state.updateCalls).toHaveLength(0);
    const row = h.state.subsByProfileId.get(PROFILE_PRO) as any;
    expect(row.tier).toBe("pro");
  });

  it("Elite → Pro: $0 due today, the net credit is shown instead", async () => {
    const { status, body } = await call("POST", "/creator-tiers/change/preview", { user: USER_ELITE, body: { tier: "pro" } });
    expect(status).toBe(200);
    expect(body.preview.amountDueTodayCents).toBe(0);
    expect(body.preview.creditCents).toBe(700);
    expect(body.preview.toPlanName).toBe("Pro");
    expect(body.preview.toPriceUsdPerMonth).toBe(12);
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("a member with a pending cancel sees that changing plans clears it", async () => {
    const { status, body } = await call("POST", "/creator-tiers/change/preview", { user: USER_CANCELING, body: { tier: "elite" } });
    expect(status).toBe(200);
    expect(body.preview.clearsPendingCancel).toBe(true);
  });

  it("same tier is a 409 ALREADY_ON_TIER and Stripe is never priced", async () => {
    const { status, body } = await call("POST", "/creator-tiers/change/preview", { user: USER_PRO, body: { tier: "pro" } });
    expect(status).toBe(409);
    expect(body.code).toBe("ALREADY_ON_TIER");
    expect(h.state.previewCalls).toHaveLength(0);
  });

  it("free user gets a 404 — nothing to change, zero Stripe calls", async () => {
    const { status } = await call("POST", "/creator-tiers/change/preview", { user: USER_FREE, body: { tier: "elite" } });
    expect(status).toBe(404);
    expect(h.state.previewCalls).toHaveLength(0);
    expect(h.state.retrieveCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("missing price env answers 500 naming the variable", async () => {
    delete process.env["STRIPE_PRICE_TIER_ELITE"];
    const { status, body } = await call("POST", "/creator-tiers/change/preview", { user: USER_PRO, body: { tier: "elite" } });
    expect(status).toBe(500);
    expect(body.error).toContain("STRIPE_PRICE_TIER_ELITE");
    expect(h.state.previewCalls).toHaveLength(0);
  });

  it("guest gets 401", async () => {
    const { status } = await call("POST", "/creator-tiers/change/preview", { anon: true, body: { tier: "elite" } });
    expect(status).toBe(401);
  });
});

describe("POST /creator-tiers/change — the in-place swap", () => {
  it("Pro → Elite: exactly ONE update on the SAME subscription/customer, preview-pinned proration, row synced", async () => {
    const { status, body } = await call("POST", "/creator-tiers/change", { user: USER_PRO, body: { tier: "elite" } });
    expect(status).toBe(200);
    expect(body.changed).toBe(true);
    expect(body.tier).toBe("elite");
    expect(body.subscriptionId).toBe("sub_pro");
    expect(body.amountDueTodayCents).toBe(850);
    expect(body.creditCents).toBe(0);
    expect(body.billing.plan).toBe("elite");
    expect(body.billing.canChangePlan).toBe(true);

    /* One subscription, one customer: an update, never a create. */
    expect(h.state.updateCalls).toHaveLength(1);
    const upd = h.state.updateCalls[0]!;
    expect(upd.id).toBe("sub_pro");
    expect(upd.params.items).toEqual([{ id: "si_pro", price: "price_elite_test" }]);
    expect(upd.params.proration_behavior).toBe("always_invoice");
    /* The apply used the SAME proration instant the preview priced —
       the confirmed numbers are the charged numbers. */
    expect(typeof upd.params.proration_date).toBe("number");
    expect(upd.params.proration_date).toBe(h.state.previewCalls[0].subscription_details.proration_date);
    expect(typeof upd.options?.idempotencyKey).toBe("string");
    expect(upd.options.idempotencyKey.length).toBeGreaterThan(0);
    expect(h.state.subCreateCalls).toBe(0);
    expect(h.state.customerCreateCalls).toBe(0);

    const row = h.state.subsByProfileId.get(PROFILE_PRO) as any;
    expect(row.tier).toBe("elite");
    expect(row.cancelAtPeriodEnd).toBeNull();
    const stored = h.state.storedSubs.get("sub_pro");
    expect(stored.items.data[0].price.id).toBe("price_elite_test");
    expect(stored.customer).toBe("cus_pro");
  });

  it("after the change, /me and /billing read the SAME truth from the same row", async () => {
    await call("POST", "/creator-tiers/change", { user: USER_PRO, body: { tier: "elite" } });
    const me = await call("GET", "/creator-tiers/me", { user: USER_PRO });
    expect(me.status).toBe(200);
    expect(me.body.tier).toBe("elite");
    const billing = await call("GET", "/creator-tiers/billing", { user: USER_PRO });
    expect(billing.status).toBe(200);
    expect(billing.body.billing.plan).toBe("elite");
    expect(billing.body.billing.planName).toBe("Elite");
  });

  it("Elite → Pro: one update, $0 charged today, 700 credit reported", async () => {
    const { status, body } = await call("POST", "/creator-tiers/change", { user: USER_ELITE, body: { tier: "pro" } });
    expect(status).toBe(200);
    expect(body.amountDueTodayCents).toBe(0);
    expect(body.creditCents).toBe(700);
    expect(h.state.updateCalls).toHaveLength(1);
    expect(h.state.updateCalls[0]!.params.items).toEqual([{ id: "si_elite", price: "price_pro_test" }]);
    const row = h.state.subsByProfileId.get(PROFILE_ELITE) as any;
    expect(row.tier).toBe("pro");
  });

  it("sequential double-click: the repeat answers alreadyApplied and Stripe is written ONCE", async () => {
    const first = await call("POST", "/creator-tiers/change", { user: USER_PRO, body: { tier: "elite" } });
    expect(first.status).toBe(200);
    expect(first.body.changed).toBe(true);
    const second = await call("POST", "/creator-tiers/change", { user: USER_PRO, body: { tier: "elite" } });
    expect(second.status).toBe(200);
    expect(second.body.changed).toBe(true);
    expect(second.body.alreadyApplied).toBe(true);
    expect(h.state.updateCalls).toHaveLength(1);
    expect(h.state.subCreateCalls).toBe(0);
    expect(h.state.customerCreateCalls).toBe(0);
  });

  it("parallel double-submit: every Stripe write carries the ONE idempotency key for the pre-change state", async () => {
    const [a, b] = await Promise.all([
      call("POST", "/creator-tiers/change", { user: USER_PRO, body: { tier: "elite" } }),
      call("POST", "/creator-tiers/change", { user: USER_PRO, body: { tier: "elite" } }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.changed).toBe(true);
    expect(b.body.changed).toBe(true);
    expect(h.state.updateCalls.length).toBeGreaterThanOrEqual(1);
    const keys = new Set(h.state.updateCalls.map((u) => u.options?.idempotencyKey));
    expect(keys.size).toBe(1);
    expect(h.state.subCreateCalls).toBe(0);
    expect(h.state.customerCreateCalls).toBe(0);
    const stored = h.state.storedSubs.get("sub_pro");
    expect(stored.items.data).toHaveLength(1);
    expect(stored.items.data[0].price.id).toBe("price_elite_test");
    const row = h.state.subsByProfileId.get(PROFILE_PRO) as any;
    expect(row.tier).toBe("elite");
  });

  it("changing tiers clears a pending cancel — on Stripe and on the row", async () => {
    const { status, body } = await call("POST", "/creator-tiers/change", { user: USER_CANCELING, body: { tier: "elite" } });
    expect(status).toBe(200);
    expect(body.changed).toBe(true);
    expect(h.state.updateCalls).toHaveLength(1);
    expect(h.state.updateCalls[0]!.params.cancel_at_period_end).toBe(false);
    const row = h.state.subsByProfileId.get(PROFILE_CANCELING) as any;
    expect(row.tier).toBe("elite");
    expect(row.cancelAtPeriodEnd).toBeNull();
    const billing = await call("GET", "/creator-tiers/billing", { user: USER_CANCELING });
    expect(billing.body.billing.status).toBe("active");
  });

  it("free user gets a 404 and Stripe is never touched", async () => {
    const { status } = await call("POST", "/creator-tiers/change", { user: USER_FREE, body: { tier: "elite" } });
    expect(status).toBe(404);
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.previewCalls).toHaveLength(0);
    expect(h.state.subCreateCalls).toBe(0);
  });

  it("an invalid tier is a 400", async () => {
    const { status } = await call("POST", "/creator-tiers/change", { user: USER_PRO, body: { tier: "free" } });
    expect(status).toBe(400);
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("guest gets 401", async () => {
    const { status } = await call("POST", "/creator-tiers/change", { anon: true, body: { tier: "elite" } });
    expect(status).toBe(401);
  });
});

describe("billing read honesty — the intermittent failure answers cleanly (sibling defect)", () => {
  it("a blip on the billing-row read answers a clean JSON 500, and the same call succeeds once the blip passes", async () => {
    /* resolveCreatorTier's own subscription read is select #1 and
       succeeds; loadBillingRow's read (#2) blips — the exact
       intermittent shape from the live run. */
    h.state.failSubsAfter = 1;
    const failed = await call("GET", "/creator-tiers/billing", { user: USER_PRO });
    expect(failed.status).toBe(500);
    expect(failed.body.error).toBe("Couldn't load your billing. Try again.");

    h.state.failSubsAfter = null;
    const retried = await call("GET", "/creator-tiers/billing", { user: USER_PRO });
    expect(retried.status).toBe(200);
    expect(retried.body.billing.plan).toBe("pro");
  });

  it("the same blip never 500s /me — the badge's source degrades to the resolved tier", async () => {
    h.state.failSubsAfter = 1;
    const me = await call("GET", "/creator-tiers/me", { user: USER_PRO });
    expect(me.status).toBe(200);
    expect(me.body.tier).toBe("pro");
  });
});
