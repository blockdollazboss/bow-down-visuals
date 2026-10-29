/**
 * Route tests for POST /embedded-checkout/subscription/intent
 * (Stack400 lane 1 — the "Network hiccup" checkout death;
 *  Stack500 lane S — the missing confirmation_secret 502).
 *
 * What this pins:
 *  - The happy path returns the invoice confirmation_secret +
 *    subscription id the PaymentElement mounts with, creating the
 *    subscription at the configured STRIPE_PRICE_TIER_* price with
 *    payment_behavior "default_incomplete".
 *  - EXPANSION GATING (lane S): the Stripe double below only returns
 *    invoice.confirmation_secret / invoice.payments when the request
 *    expanded them — the real API's behavior, which the previous
 *    double did NOT model (it handed the secret over
 *    unconditionally, so the route stayed green in tests while every
 *    live intent 502'd "no invoice confirmation secret"). The create
 *    must expand latest_invoice.confirmation_secret; if a create
 *    response still arrives without the secret, one retrieve with
 *    the expand must recover it before any 502.
 *  - Repeat-click hygiene (lane S): a second identical attempt
 *    ADOPTS the first attempt's dangling incomplete subscription
 *    (no second create); older duplicates, wrong-price leftovers
 *    and unreadable dangling subs are canceled. When the hygiene
 *    scan itself fails, the route falls through to create with the
 *    SAME stable idempotency key — that stability is what makes a
 *    client-side retry of this POST safe.
 *  - Every failure mode answers JSON (never HTML, never a hang):
 *    missing price env -> 500 naming the var; Stripe throwing ->
 *    502 with Stripe's message.
 *  - Already subscribed (stack600 plan-tier-change): same tier ->
 *    409 ALREADY_ON_TIER; a DIFFERENT tier -> 200 mode:"change" with
 *    Stripe's proration preview for the member's existing
 *    subscription (nothing created, nothing charged — the old 409
 *    dead end Gate Pass 1 hit); a live row with no Stripe
 *    subscription id keeps the honest 409 ALREADY_SUBSCRIBED.
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
    listBehavior: "ok" as "ok" | "throw",
    /* "expand": faithful Stripe — expansion-gated invoice fields
       appear only when the request expanded them.
       "never": the create response omits confirmation_secret even
       when it was expanded (the shape the Oct 28 live failure
       produced); retrieve still honors the expand. */
    createSecretMode: "expand" as "expand" | "never",
    customerCreateCalls: [] as { params: any; options: any }[],
    subscriptionCreateCalls: [] as { params: any; options: any }[],
    subscriptionListCalls: [] as any[],
    subscriptionRetrieveCalls: [] as { id: string; params: any }[],
    subscriptionCancelCalls: [] as string[],
    invoicePreviewCalls: [] as any[],
    storedSubs: [] as any[],
    subSeq: 0,
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
  /* Faithful-enough Stripe double. Crucially it models EXPANSION
     GATING, which the previous double did not (it returned
     confirmation_secret unconditionally — why these tests stayed
     green while the live route 502'd): invoice.confirmation_secret
     and invoice.payments appear in a response ONLY when the request
     expanded them. Subscriptions persist in a store so list /
     retrieve / cancel behave like the real API across calls. */
  function renderInvoice(stored: any, expand: string[], forCreate: boolean): any {
    const inv = stored.latest_invoice;
    const out: any = { id: inv.id, amount_due: inv.amount_due };
    const secretOmitted = forCreate && h.state.createSecretMode === "never";
    if (!secretOmitted && inv.confirmation_secret && expand.includes("latest_invoice.confirmation_secret")) {
      out.confirmation_secret = inv.confirmation_secret;
    }
    if (inv.payments && expand.includes("latest_invoice.payments")) {
      out.payments = inv.payments;
    }
    return out;
  }
  function renderSub(stored: any, expand: string[] = [], forCreate = false): any {
    const wantsInvoice = expand.some((e) => e === "latest_invoice" || e.startsWith("latest_invoice."));
    return {
      id: stored.id,
      created: stored.created,
      status: stored.status,
      customer: stored.customer,
      metadata: stored.metadata,
      items: stored.items,
      latest_invoice: wantsInvoice ? renderInvoice(stored, expand, forCreate) : stored.latest_invoice.id,
    };
  }

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
        const seq = ++h.state.subSeq;
        const stored: any = {
          id: seq === 1 ? "sub_new" : `sub_new_${seq}`,
          created: 1_700_000_000 + seq,
          status: "incomplete",
          customer: params.customer,
          metadata: params.metadata,
          items: { data: (params.items as any[]).map((it: any) => ({ price: { id: it.price } })) },
          /* Basil-shaped invoice: the PaymentElement secret is the
             invoice confirmation_secret; the PI hangs off the
             default invoice payment — the exact shape the route
             reads (when the fields are expanded). */
          latest_invoice: {
            id: seq === 1 ? "in_new" : `in_new_${seq}`,
            amount_due: 1200,
            confirmation_secret: { client_secret: seq === 1 ? "pi_new_secret_abc" : `pi_new_${seq}_secret` },
            payments: {
              data: [
                { is_default: true, payment: { payment_intent: seq === 1 ? "pi_new" : `pi_new_${seq}` } },
              ],
            },
          },
        };
        h.state.storedSubs.push(stored);
        return renderSub(stored, params.expand ?? [], true);
      },
      list: async (params: any) => {
        h.state.subscriptionListCalls.push(params);
        if (h.state.listBehavior === "throw") {
          throw new Error("Stripe list unavailable (test double)");
        }
        const data = h.state.storedSubs
          .filter((s: any) => s.customer === params.customer && s.status === params.status)
          .map((s: any) => renderSub(s));
        return { data, has_more: false };
      },
      retrieve: async (id: string, params: any) => {
        h.state.subscriptionRetrieveCalls.push({ id, params });
        const stored = h.state.storedSubs.find((s: any) => s.id === id);
        if (!stored) throw new Error(`No such subscription: ${id}`);
        return renderSub(stored, params?.expand ?? []);
      },
      cancel: async (id: string) => {
        h.state.subscriptionCancelCalls.push(id);
        const stored = h.state.storedSubs.find((s: any) => s.id === id);
        if (stored) stored.status = "canceled";
        return { id, status: "canceled" };
      },
    };
    invoices = {
      /* Proration preview double (stack600 plan-tier-change): moving
         to Elite mid-cycle nets +850 due today; moving to Pro nets a
         700 credit (negative amount_due). Records every call so tests
         can prove a preview priced the EXISTING subscription. */
      createPreview: async (params: any) => {
        h.state.invoicePreviewCalls.push(params);
        const price = params.subscription_details?.items?.[0]?.price;
        const amount_due = price === "price_elite_test" ? 850 : price === "price_pro_test" ? -700 : 0;
        return { amount_due, currency: "usd" };
      },
    };
  }
  return { default: FakeStripe };
});

/* Seed a dangling incomplete creator-tier subscription directly
   into the fake's store (an earlier click's leftover). */
function seedDangling(over: Record<string, any> = {}): any {
  const stored: any = {
    id: over["id"] ?? "sub_dangling",
    created: over["created"] ?? 1_600_000_000,
    status: "incomplete",
    customer: over["customer"] ?? "cus_existing",
    metadata: {
      kind: "creator_tier",
      user_id: USER,
      profile_id: PROFILE,
      tier: over["tier"] ?? "pro",
    },
    items: { data: [{ price: { id: over["priceId"] ?? "price_pro_test" } }] },
    latest_invoice: {
      id: over["invoiceId"] ?? "in_dangling",
      amount_due: 1200,
      confirmation_secret:
        over["secret"] === null ? null : { client_secret: over["secret"] ?? "pi_dangling_secret" },
      payments: {
        data: [{ is_default: true, payment: { payment_intent: over["pi"] ?? "pi_dangling" } }],
      },
    },
  };
  h.state.storedSubs.push(stored);
  return stored;
}

/* Seed a LIVE subscription (the member's existing paid plan) into the
   fake's store, with the item id + period end the tier-change preview
   reads off the retrieved subscription. */
function seedActiveSub(over: Record<string, any> = {}): any {
  const stored: any = {
    id: over["id"] ?? "sub_existing",
    created: 1_650_000_000,
    status: over["status"] ?? "active",
    customer: over["customer"] ?? "cus_existing",
    metadata: {
      kind: "creator_tier",
      user_id: USER,
      profile_id: PROFILE,
      tier: over["tier"] ?? "pro",
    },
    items: {
      data: [
        {
          id: over["itemId"] ?? "si_existing",
          price: { id: over["priceId"] ?? "price_pro_test" },
          current_period_end: over["cpe"] ?? Math.floor(Date.parse("2026-11-26T00:00:00Z") / 1000),
        },
      ],
    },
    latest_invoice: {
      id: over["invoiceId"] ?? "in_existing",
      amount_due: 1200,
      confirmation_secret: { client_secret: "pi_existing_secret" },
      payments: { data: [{ is_default: true, payment: { payment_intent: "pi_existing" } }] },
    },
  };
  h.state.storedSubs.push(stored);
  return stored;
}

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
  h.state.listBehavior = "ok";
  h.state.createSecretMode = "expand";
  h.state.customerCreateCalls = [];
  h.state.subscriptionCreateCalls = [];
  h.state.subscriptionListCalls = [];
  h.state.subscriptionRetrieveCalls = [];
  h.state.subscriptionCancelCalls = [];
  h.state.invoicePreviewCalls = [];
  h.state.storedSubs = [];
  h.state.subSeq = 0;
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
    /* THE lane-S pin: confirmation_secret is expansion-gated in the
       real API — the create MUST ask for it (and for the payments
       the PI id is read from), or the response cannot contain the
       secret and the route 502s after creating the subscription. */
    expect(params.expand).toContain("latest_invoice.confirmation_secret");
    expect(params.expand).toContain("latest_invoice.payments");
    /* The secret came straight off the create response — no
       fallback retrieve was needed. */
    expect(h.state.subscriptionRetrieveCalls).toHaveLength(0);
  });

  it("recovers via retrieve when the create response still arrives without the secret (the Oct 28 failing shape)", async () => {
    h.state.createSecretMode = "never";
    const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    expect(status).toBe(200);
    expect(json.clientSecret).toBe("pi_new_secret_abc");
    expect(json.subscriptionId).toBe("sub_new");
    expect(h.state.subscriptionCreateCalls).toHaveLength(1);
    expect(h.state.subscriptionRetrieveCalls.length).toBeGreaterThanOrEqual(1);
    const retrieveExpand = h.state.subscriptionRetrieveCalls[0]!.params?.expand ?? [];
    expect(retrieveExpand).toContain("latest_invoice.confirmation_secret");
  });

  it("repeat clicks converge: a second identical attempt ADOPTS the first attempt's subscription instead of creating a second", async () => {
    const first = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    const second = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.json.subscriptionId).toBe("sub_new");
    expect(second.json.clientSecret).toBe("pi_new_secret_abc");
    /* One create across both clicks — the second click adopted the
       dangling incomplete subscription the first click left. */
    expect(h.state.subscriptionCreateCalls).toHaveLength(1);
    expect(h.state.subscriptionListCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("idempotency key stays stable when the hygiene scan fails and both attempts fall through to create", async () => {
    h.state.listBehavior = "throw";
    await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    expect(h.state.subscriptionCreateCalls).toHaveLength(2);
    const [first, second] = h.state.subscriptionCreateCalls;
    expect(second!.options.idempotencyKey).toBe(first!.options.idempotencyKey);
  });

  describe("dangling-subscription hygiene (existing Stripe customer)", () => {
    function canceledRowWithCustomer() {
      h.state.subscriptionRow = {
        tier: "pro",
        status: "canceled",
        currentPeriodEnd: new Date("2026-10-26T00:00:00Z"),
        stripeSubscriptionId: "sub_old_dead",
        stripeCustomerId: "cus_existing",
      };
    }

    it("adopts the member's dangling incomplete subscription for the tier — no new create, no new customer", async () => {
      canceledRowWithCustomer();
      seedDangling({ id: "sub_dangling" });
      const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
      expect(status).toBe(200);
      expect(json.subscriptionId).toBe("sub_dangling");
      expect(json.clientSecret).toBe("pi_dangling_secret");
      expect(json.paymentIntentId).toBe("pi_dangling");
      expect(h.state.subscriptionCreateCalls).toHaveLength(0);
      expect(h.state.customerCreateCalls).toHaveLength(0);
      expect(h.state.subscriptionCancelCalls).toHaveLength(0);
    });

    it("cancels older duplicates and wrong-price leftovers, adopting the newest usable same-tier subscription", async () => {
      canceledRowWithCustomer();
      seedDangling({ id: "sub_old_dup", created: 1_600_000_100 });
      seedDangling({ id: "sub_keep", created: 1_600_000_200, secret: "pi_keep_secret", pi: "pi_keep" });
      seedDangling({ id: "sub_wrong_price", created: 1_600_000_300, priceId: "price_retired" });
      const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
      expect(status).toBe(200);
      expect(json.subscriptionId).toBe("sub_keep");
      expect(json.clientSecret).toBe("pi_keep_secret");
      expect(h.state.subscriptionCreateCalls).toHaveLength(0);
      expect(h.state.subscriptionCancelCalls).toEqual(
        expect.arrayContaining(["sub_wrong_price", "sub_old_dup"]),
      );
      expect(h.state.subscriptionCancelCalls).toHaveLength(2);
    });

    it("cancels a dangling subscription whose secret can no longer be read and creates fresh", async () => {
      canceledRowWithCustomer();
      seedDangling({ id: "sub_unreadable", secret: null });
      const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
      expect(status).toBe(200);
      expect(json.subscriptionId).toBe("sub_new");
      expect(json.clientSecret).toBe("pi_new_secret_abc");
      expect(h.state.subscriptionCancelCalls).toEqual(["sub_unreadable"]);
      expect(h.state.subscriptionCreateCalls).toHaveLength(1);
    });

    it("ignores dangling subscriptions of the OTHER tier (left for their own intent) and creates fresh", async () => {
      canceledRowWithCustomer();
      seedDangling({ id: "sub_elite_dangling", tier: "elite", priceId: "price_elite_test" });
      const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
      expect(status).toBe(200);
      expect(json.subscriptionId).toBe("sub_new");
      expect(h.state.subscriptionCreateCalls).toHaveLength(1);
      expect(h.state.subscriptionCancelCalls).toHaveLength(0);
    });
  });

  it("customer creation is idempotency-keyed per member — a retry replays the same customer instead of minting a duplicate", async () => {
    await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
    expect(h.state.customerCreateCalls).toHaveLength(2);
    const [first, second] = h.state.customerCreateCalls;
    expect(typeof first!.options?.idempotencyKey).toBe("string");
    expect(first!.options.idempotencyKey.length).toBeGreaterThan(0);
    expect(second!.options.idempotencyKey).toBe(first!.options.idempotencyKey);
    expect(first!.params.metadata).toMatchObject({ kind: "creator_tier", user_id: USER, profile_id: PROFILE });
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

  describe("already subscribed — a different tier is a CHANGE, not a dead end (stack600 plan-tier-change)", () => {
    function proRow(over: Record<string, unknown> = {}) {
      h.state.subscriptionRow = {
        tier: "pro",
        status: "active",
        currentPeriodEnd: new Date("2026-11-26T00:00:00Z"),
        cancelAtPeriodEnd: null,
        stripeSubscriptionId: "sub_existing",
        stripeCustomerId: "cus_existing",
        ...over,
      };
    }

    it("Pro member asking for Elite gets mode:'change' with Stripe's proration preview — nothing created, nothing charged", async () => {
      proRow();
      seedActiveSub({ id: "sub_existing", priceId: "price_pro_test" });
      const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "elite" } });
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("change");
      expect(json.tier).toBe("elite");
      expect(json.fromTier).toBe("pro");
      expect(json.subscriptionId).toBe("sub_existing");
      expect(json.changePreview.fromTier).toBe("pro");
      expect(json.changePreview.toTier).toBe("elite");
      expect(json.changePreview.toPlanName).toBe("Elite");
      expect(json.changePreview.amountDueTodayCents).toBe(850);
      expect(json.changePreview.creditCents).toBe(0);
      expect(json.changePreview.effective).toBe("immediate");
      expect(json.changePreview.renewalDate).toBe("2026-11-26T00:00:00.000Z");
      /* The preview priced the member's EXISTING subscription — no
         create, no new customer: this response moves no money. The
         charge happens only when the member confirms via
         POST /creator-tiers/change. */
      expect(h.state.invoicePreviewCalls).toHaveLength(1);
      expect(h.state.invoicePreviewCalls[0].subscription).toBe("sub_existing");
      expect(h.state.invoicePreviewCalls[0].customer).toBe("cus_existing");
      expect(h.state.subscriptionCreateCalls).toHaveLength(0);
      expect(h.state.customerCreateCalls).toHaveLength(0);
    });

    it("Elite member asking for Pro gets the downgrade preview: $0 due today, the net credit shown", async () => {
      proRow({ tier: "elite" });
      seedActiveSub({ id: "sub_existing", tier: "elite", priceId: "price_elite_test" });
      const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
      expect(status).toBe(200);
      expect(json.mode).toBe("change");
      expect(json.changePreview.amountDueTodayCents).toBe(0);
      expect(json.changePreview.creditCents).toBe(700);
      expect(h.state.subscriptionCreateCalls).toHaveLength(0);
      expect(h.state.customerCreateCalls).toHaveLength(0);
    });

    it("asking for the tier you're already on is a 409 ALREADY_ON_TIER — no preview, no create", async () => {
      proRow();
      seedActiveSub({ id: "sub_existing", priceId: "price_pro_test" });
      const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "pro" } });
      expect(status).toBe(409);
      expect(json.error).toBe("ALREADY_ON_TIER");
      expect(h.state.invoicePreviewCalls).toHaveLength(0);
      expect(h.state.subscriptionCreateCalls).toHaveLength(0);
      expect(h.state.customerCreateCalls).toHaveLength(0);
    });

    it("a live row Stripe can't identify (no subscription id) keeps the honest 409 ALREADY_SUBSCRIBED manage path", async () => {
      proRow({ stripeSubscriptionId: null });
      const { status, json } = await call("/embedded-checkout/subscription/intent", { user: USER, body: { tier: "elite" } });
      expect(status).toBe(409);
      expect(json.error).toBe("ALREADY_SUBSCRIBED");
      expect(h.state.invoicePreviewCalls).toHaveLength(0);
      expect(h.state.subscriptionCreateCalls).toHaveLength(0);
      expect(h.state.customerCreateCalls).toHaveLength(0);
    });
  });

  it("requires auth", async () => {
    const { status } = await call("/embedded-checkout/subscription/intent", { body: { tier: "pro" } });
    expect(status).toBe(401);
  });
});
