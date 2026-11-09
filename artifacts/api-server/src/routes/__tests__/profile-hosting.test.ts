/**
 * Route tests for the Hosting plan (Stack 3, item 8 —
 * routes/profile-hosting.ts on the creator-tiers chassis):
 *   GET  /creator-hosting/plan      public, honest availability
 *   GET  /creator-hosting/me        caller's entitlement (auth)
 *   POST /creator-hosting/checkout  Stripe TEST subscription (auth)
 *
 * PRICE LAW pinned here (owner ruling by delegation, 2026-10-27): the
 * standalone price is RULED at $9/mo in code and always displayed;
 * Hosting is INCLUDED with Creator Elite — an Elite caller reads as
 * entitled (source "elite") and checkout refuses to sell them the plan
 * (409 HOSTING_INCLUDED_WITH_ELITE, no session, no second charge).
 * Checkout charges through the configured Stripe TEST price id; until
 * that id exists, checkout refuses with 503
 * HOSTING_CHECKOUT_UNAVAILABLE rather than faking a charge. With the
 * id set, checkout creates a TEST-mode subscription session with kind
 * "creator_hosting" metadata the webhook sync keys on.
 *
 * EMBEDDED (Stack-200 wave, money census item 5): the session is an
 * embedded Checkout Session (ui_mode "embedded_page") — the route
 * answers a clientSecret and NEVER a hosted URL (owner law: the
 * buyer never leaves bowdownvisuals.com), and completion returns to
 * /creator-pricing?hosting=return&session_id=… The webhook sync is
 * untouched: the embedded session completes with the same metadata.
 *
 * ACCEPTANCE-FAITHFUL DOUBLE (Stack 400, item C-39): until this
 * wave the Stripe double below accepted ANY session params and
 * always succeeded — so the suite stayed green while every live
 * checkout died in the session create: the route sent ui_mode
 * "embedded", a value Stripe has retired (staging deploy log,
 * Nov 8: StripeInvalidRequestError, param ui_mode — "The ui_mode
 * value 'embedded' is no longer supported. Use 'embedded_page'
 * instead."). The double now VALIDATES the params the real API
 * validates, with every rule written from Stripe's CURRENT API
 * documentation (docs.stripe.com/api/checkout/sessions/create),
 * never from the route's behavior:
 *   - ui_mode must be a currently documented value ("hosted" or
 *     "embedded_page"); the retired "embedded" is rejected exactly
 *     as the live API rejects it;
 *   - an embedded_page session requires the fake account to have
 *     embedded Checkout enabled (the account-level gate Stripe
 *     applies before any session exists);
 *   - every line_items price id must exist in the fake account's
 *     configured price set (an unknown price is a live 400);
 *   - with automatic_tax on, a price whose product carries no tax
 *     code is rejected (Stripe Tax cannot calculate without one —
 *     the Dashboard setup a brand-new product has not had yet).
 * A client_secret is returned ONLY for accepted params, mirroring
 * the expansion-faithful double in
 * embedded-subscription-intent.test.ts. The fake account models the
 * live-shaped condition that failed: a price created the same day,
 * its product's Dashboard setup incomplete until the test completes
 * it. The db fake stays in-memory Maps (the seam this suite guards
 * is the Stripe boundary), extended with the user_stripe_customers
 * mapping so the customer helper's real write/read cycle runs.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER_USER = "00000000-0000-4000-8000-0000000000aa";
const HOSTED_USER = "00000000-0000-4000-8000-0000000000bb";
const ELITE_USER = "00000000-0000-4000-8000-0000000000cc";
const FRESH_USER = "00000000-0000-4000-8000-0000000000dd";
const OWNER_PROFILE = "11111111-1111-4111-8111-111111111111";
const HOSTED_PROFILE = "22222222-2222-4222-8222-222222222222";
const ELITE_PROFILE = "33333333-3333-4333-8333-333333333333";
const FRESH_PROFILE = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    hostingByProfile: new Map<string, Record<string, unknown>>(),
    subscriptionsByProfile: new Map<string, Record<string, unknown>>(),
    /* user_stripe_customers mapping (userId → stripeCustomerId):
       the customer helper's real write/read cycle runs against it. */
    stripeCustomersByUser: new Map<string, string>(),
    stripeCreateParams: null as any,
    /* The fake Stripe ACCOUNT (C-39 acceptance-faithful double):
       which prices exist, which product each price belongs to, the
       Dashboard-side tax setup per product, and whether embedded
       Checkout is enabled on the account. Tests configure the
       account; the double enforces Stripe's documented rules. */
    stripeAccount: {
      prices: new Map<string, { productId: string; active: boolean }>(),
      productTaxCode: new Map<string, string | null>(),
      embeddedEnabled: true,
    },
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
    /* The real middleware also sets req.userEmail (require-auth.ts)
       and the checkout route passes it to the customer helper;
       model it so that seam runs as it does live. */
    req.userEmail = "buyer@example.com";
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("stripe", () => {
  /* ACCEPTANCE-FAITHFUL Stripe double (C-39). sessions.create
     VALIDATES the params Stripe's API validates and rejects with
     Stripe-shaped errors (type/code/param, like the real
     StripeInvalidRequestError the staging log recorded); a
     client_secret comes back ONLY for accepted params. Every rule
     is from Stripe's current API documentation — NOT from what the
     route happens to send: a double that accepts whatever the
     route sends is the defect this suite used to carry. */
  function stripeError(message: string, param: string, code = "parameter_invalid"): Error {
    const err: any = new Error(message);
    err.type = "StripeInvalidRequestError";
    err.code = code;
    err.param = param;
    err.statusCode = 400;
    return err;
  }

  function validateSessionParams(params: any): void {
    const account = h.state.stripeAccount;
    /* ui_mode — docs.stripe.com/api/checkout/sessions/create:
       the current values are "hosted" (the default) and
       "embedded_page". "embedded" was retired by Stripe and the
       live API rejects it — the exact rejection in the Nov 8
       staging log. */
    if (params.ui_mode !== undefined && params.ui_mode !== "hosted" && params.ui_mode !== "embedded_page") {
      throw stripeError(
        `The ui_mode value '${params.ui_mode}' is no longer supported. Use 'embedded_page' instead.`,
        "ui_mode",
      );
    }
    /* Embedded Checkout is an account-level capability: when it
       isn't enabled on the account, an embedded_page session
       cannot be created at all. */
    if (params.ui_mode === "embedded_page" && !account.embeddedEnabled) {
      throw stripeError(
        "Embedded checkout is not enabled for this account.",
        "ui_mode",
        "checkout_not_enabled",
      );
    }
    for (const item of params.line_items ?? []) {
      /* A price id must resolve to a price ON THIS ACCOUNT; an
         unknown (or archived/inactive) price is a live 400. */
      const price = item.price ? account.prices.get(item.price) : undefined;
      if (item.price && (!price || !price.active)) {
        throw stripeError(`No such price: '${item.price}'`, "line_items[0][price]", "resource_missing");
      }
      /* Stripe Tax: with automatic_tax on, tax is calculated from
         the PRODUCT's Dashboard tax code; a product without one
         cannot be taxed, and the session create is refused. */
      if (params.automatic_tax?.enabled && price) {
        if (!account.productTaxCode.get(price.productId)) {
          throw stripeError(
            "Automatic tax requires a tax code on the product for every price in the session.",
            "automatic_tax[enabled]",
            "tax_code_missing",
          );
        }
      }
    }
  }

  class FakeStripe {
    /* The composed checkout resolves a Stripe customer first
       (lib/creator-stripe-customer) — the fake carries that surface. */
    customers = {
      create: async () => ({ id: "cus_test_hosting" }),
      retrieve: async (id: string) => ({ id }),
    };
    checkout = {
      sessions: {
        create: async (params: any) => {
          h.state.stripeCreateParams = params;
          validateSessionParams(params);
          /* The fake still carries a hosted `url` field on purpose:
             the pin below proves the route never forwards it — an
             embedded session's answer is its client_secret only. */
          return {
            id: "cs_test_hosting",
            url: "https://checkout.example.com/cs_test_hosting",
            client_secret: "cs_test_hosting_secret_123",
          };
        },
      },
    };
  }
  return { default: FakeStripe };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, creatorSubscriptionsTable, creatorHostingTable, userStripeCustomersTable } = actual;

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
    if (table === userStripeCustomersTable) {
      const customerId = state.stripeCustomersByUser.get(String(params[0]));
      return customerId ? [{ userId: String(params[0]), stripeCustomerId: customerId }] : [];
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
    /* Customer-id persistence (creator-stripe-customer): the mapping
       write now LANDS in stripeCustomersByUser, so the helper's real
       persist → re-select cycle runs and later calls resolve the
       stored customer (the C-39 fresh-buyer flow), instead of the
       old no-op that always read empty. */
    insert: (_table: unknown) => ({
      values: (v: any) => ({
        onConflictDoNothing: async () => {
          if (v?.userId && v?.stripeCustomerId) {
            state.stripeCustomersByUser.set(String(v.userId), String(v.stripeCustomerId));
          }
          return [];
        },
        returning: async () => [],
      }),
    }),
    update: (_table: unknown) => ({
      set: (v: any) => ({
        where: async (cond: unknown) => {
          /* The helper's deleted-customer replacement updates the
             mapping row by userId — apply it to the Map too. */
          const { params } = render(cond);
          const userId = String(params[params.length - 1]);
          if (v?.stripeCustomerId && state.stripeCustomersByUser.has(userId)) {
            state.stripeCustomersByUser.set(userId, String(v.stripeCustomerId));
          }
          return [];
        },
      }),
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

const ENV_KEYS = ["HOSTING_PRICE_USD_PER_MONTH", "STRIPE_PRICE_HOSTING", "STRIPE_SECRET_KEY", "STRIPE_TAX_ENABLED"];
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
    [ELITE_PROFILE, { id: ELITE_PROFILE, userId: ELITE_USER, slug: "elite-creator" }],
  ]);
  h.state.hostingByProfile = new Map([
    [HOSTED_PROFILE, { profileId: HOSTED_PROFILE, status: "active", currentPeriodEnd: null }],
  ]);
  h.state.subscriptionsByProfile = new Map([
    [ELITE_PROFILE, { profileId: ELITE_PROFILE, tier: "elite", status: "active", currentPeriodEnd: null }],
  ]);
  h.state.stripeCustomersByUser = new Map();
  h.state.stripeCreateParams = null;
  /* The fake account starts FULLY set up — the established state
     the older prices live in: the hosting price exists and is
     active on its product (whose Dashboard tax setup is complete),
     and embedded Checkout is enabled. Tests that model the
     live-shaped Nov 8 condition remove pieces of this setup. */
  h.state.stripeAccount = {
    prices: new Map([["price_test_hosting", { productId: "prod_test_hosting", active: true }]]),
    productTaxCode: new Map<string, string | null>([["prod_test_hosting", "txcd_10000000"]]),
    embeddedEnabled: true,
  };
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
  it("shows the ruled $9/mo price and the Elite inclusion, even before checkout is switched on", async () => {
    const { status, json } = await call("GET", "/creator-hosting/plan");
    expect(status).toBe(200);
    expect(json.plan.name).toBe("Hosting");
    expect(json.plan.priceUsdPerMonth).toBe(9);
    expect(json.plan.includedWithTier).toBe("elite");
    expect(json.plan.priceConfigured).toBe(false);
    expect(json.plan.available).toBe(false);
    const labels = json.plan.features.map((f: any) => f.label).join(" ");
    expect(labels).toMatch(/custom domain/i);
    expect(labels).toMatch(/Included with Creator Elite/i);
  });

  it("with the owner's env override + Stripe price id set, the override is the displayed price", async () => {
    process.env["HOSTING_PRICE_USD_PER_MONTH"] = "15";
    process.env["STRIPE_PRICE_HOSTING"] = "price_test_hosting";
    const { json } = await call("GET", "/creator-hosting/plan");
    expect(json.plan.priceUsdPerMonth).toBe(15);
    expect(json.plan.available).toBe(true);
  });
});

describe("POST /creator-hosting/checkout", () => {
  it("refuses with 503 when checkout isn't switched on — nothing is charged", async () => {
    const { status, json } = await call("POST", "/creator-hosting/checkout", { user: OWNER_USER, body: {} });
    expect(status).toBe(503);
    expect(json.error).toBe("HOSTING_CHECKOUT_UNAVAILABLE");
    expect(h.state.stripeCreateParams).toBeNull();
  });

  it("never sells Hosting to an Elite member — it's included, no second charge", async () => {
    process.env["STRIPE_PRICE_HOSTING"] = "price_test_hosting";
    process.env["STRIPE_SECRET_KEY"] = "sk_test_example";
    const { status, json } = await call("POST", "/creator-hosting/checkout", { user: ELITE_USER, body: {} });
    expect(status).toBe(409);
    expect(json.error).toBe("HOSTING_INCLUDED_WITH_ELITE");
    expect(h.state.stripeCreateParams).toBeNull();
  });

  it("creates a TEST subscription session at the configured price when priced", async () => {
    process.env["HOSTING_PRICE_USD_PER_MONTH"] = "15";
    process.env["STRIPE_PRICE_HOSTING"] = "price_test_hosting";
    process.env["STRIPE_SECRET_KEY"] = "sk_test_example";
    const { status, json } = await call("POST", "/creator-hosting/checkout", { user: OWNER_USER, body: {} });
    expect(status).toBe(200);
    const params = h.state.stripeCreateParams;
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([{ price: "price_test_hosting", quantity: 1 }]);
    expect(params.metadata.kind).toBe("creator_hosting");
    expect(params.subscription_data.metadata.kind).toBe("creator_hosting");
  });

  it("the session is EMBEDDED — clientSecret out, no hosted URL path anywhere", async () => {
    process.env["STRIPE_PRICE_HOSTING"] = "price_test_hosting";
    process.env["STRIPE_SECRET_KEY"] = "sk_test_example";
    const { status, json } = await call("POST", "/creator-hosting/checkout", {
      user: OWNER_USER,
      body: { returnTo: "/creator-pricing" },
    });
    expect(status).toBe(200);
    /* The answer the door consumes: a client secret for the on-page
       EmbeddedSessionCheckout mount — never a hosted checkout URL,
       even though the (fake) provider session object carried one. */
    expect(json.clientSecret).toBe("cs_test_hosting_secret_123");
    expect(json.sessionId).toBe("cs_test_hosting");
    expect(json.uiMode).toBe("embedded_page");
    expect(json.url).toBeUndefined();
    expect(json.checkoutUrl).toBeUndefined();
    /* The session itself is created embedded: ui_mode set, a
       return_url back to the pricing page carrying the session id,
       and NO success_url/cancel_url redirect pair. */
    const params = h.state.stripeCreateParams;
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toContain("/creator-pricing?hosting=return&session_id={CHECKOUT_SESSION_ID}");
    expect(params.success_url).toBeUndefined();
    expect(params.cancel_url).toBeUndefined();
  });

  it("a second checkout for the same buyer reuses the stored customer — no second customer is minted", async () => {
    process.env["STRIPE_PRICE_HOSTING"] = "price_test_hosting";
    process.env["STRIPE_SECRET_KEY"] = "sk_test_example";
    const first = await call("POST", "/creator-hosting/checkout", { user: OWNER_USER, body: {} });
    expect(first.status).toBe(200);
    const params1 = h.state.stripeCreateParams;
    const second = await call("POST", "/creator-hosting/checkout", { user: OWNER_USER, body: {} });
    expect(second.status).toBe(200);
    const params2 = h.state.stripeCreateParams;
    /* The helper persisted the mapping on the first call, so the
       second resolves the SAME customer id from the mapping +
       retrieve — one customer per user, as designed. */
    expect(params2.customer).toBe(params1.customer);
    expect(h.state.stripeCustomersByUser.get(OWNER_USER)).toBe(params1.customer);
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

describe("C-39 — the acceptance-faithful double (the seam the old suite faked)", () => {
  /* The double is reached the only way the route reaches Stripe:
     through a checkout call. Its rejection rules are Stripe's
     documented ones; each test below breaks ONE rule and pins the
     route's honest, coded, leak-free failure. */
  function armFreshBuyer() {
    /* The LIVE-SHAPED fixture: the profile row is created by this
       test, moments before the checkout attempt — no pre-aged rows,
       no hosting row, no stored customer. */
    h.state.profilesById.set(FRESH_PROFILE, { id: FRESH_PROFILE, userId: FRESH_USER, slug: "fresh-creator" });
    process.env["STRIPE_PRICE_HOSTING"] = "price_test_hosting";
    process.env["STRIPE_SECRET_KEY"] = "sk_test_example";
  }

  it("the route's create crosses the double with the CURRENT ui_mode value — the retired one is what the double rejects (next tests)", async () => {
    armFreshBuyer();
    const ok = await call("POST", "/creator-hosting/checkout", { user: FRESH_USER, body: {} });
    expect(ok.status).toBe(200);
    /* The exact param whose retired form killed every live attempt
       on Nov 8: the route now sends "embedded_page", the value
       Stripe's current docs define for this session shape. The
       double's rejection of the retired "embedded" value is proven
       at route level by the membership-gifts acceptance suite
       (whose route sent the retired value until this wave) and by
       the source guard at the end of this block. */
    expect(h.state.stripeCreateParams.ui_mode).toBe("embedded_page");
  });

  it("fresh buyer + price whose product lacks its Dashboard tax setup → honest coded failure; setup completed → 200 + clientSecret", async () => {
    armFreshBuyer();
    /* The Nov 8 live shape: the price was created the same day and
       its product never got its Dashboard tax setup. Tax is ON for
       this account (the staging question the log could not settle
       from code) — with the product's tax code missing, Stripe
       refuses the session create. */
    process.env["STRIPE_TAX_ENABLED"] = "true";
    h.state.stripeAccount.productTaxCode.set("prod_test_hosting", null);
    const failed = await call("POST", "/creator-hosting/checkout", { user: FRESH_USER, body: {} });
    expect(failed.status).toBe(502);
    expect(failed.json.error).toBe("Checkout couldn't start — try again in a moment.");
    expect(failed.json.code).toBe("CHECKOUT_SESSION_FAILED");
    /* House-clean: no provider name, no raw error text, no codes
       from the provider leak into the body. */
    const bodyText = JSON.stringify(failed.json);
    expect(bodyText).not.toMatch(/stripe/i);
    expect(bodyText).not.toMatch(/tax/i);
    /* Complete the product's Dashboard setup (its tax code) — the
       same buyer, the same fresh profile, now succeeds end to end. */
    h.state.stripeAccount.productTaxCode.set("prod_test_hosting", "txcd_10000000");
    const ok = await call("POST", "/creator-hosting/checkout", { user: FRESH_USER, body: {} });
    expect(ok.status).toBe(200);
    expect(ok.json.clientSecret).toBe("cs_test_hosting_secret_123");
    expect(ok.json.uiMode).toBe("embedded_page");
    expect(h.state.stripeCreateParams.ui_mode).toBe("embedded_page");
    expect(h.state.stripeCreateParams.customer).toBe("cus_test_hosting");
  });

  it("embedded Checkout not enabled on the account → the session create is refused, honestly and coded", async () => {
    armFreshBuyer();
    h.state.stripeAccount.embeddedEnabled = false;
    const { status, json } = await call("POST", "/creator-hosting/checkout", { user: FRESH_USER, body: {} });
    expect(status).toBe(502);
    expect(json.code).toBe("CHECKOUT_SESSION_FAILED");
    expect(json.error).toBe("Checkout couldn't start — try again in a moment.");
  });

  it("a price id the account doesn't hold → the session create is refused, honestly and coded", async () => {
    armFreshBuyer();
    process.env["STRIPE_PRICE_HOSTING"] = "price_not_on_this_account";
    const { status, json } = await call("POST", "/creator-hosting/checkout", { user: FRESH_USER, body: {} });
    expect(status).toBe(502);
    expect(json.code).toBe("CHECKOUT_SESSION_FAILED");
  });

  it("source guard: the route sends ui_mode \"embedded_page\" and never the retired value", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(__dirname, "..", "profile-hosting.ts"), "utf8");
    expect(src).toContain('ui_mode: "embedded_page"');
    expect(src).not.toContain('ui_mode: "embedded"');
  });
});

describe("GET /creator-hosting/me", () => {
  it("reports entitlement + clean branding state", async () => {
    const hosted = await call("GET", "/creator-hosting/me", { user: HOSTED_USER });
    expect(hosted.status).toBe(200);
    expect(hosted.json.hostingEntitled).toBe(true);
    expect(hosted.json.hostingSource).toBe("hosting");
    expect(hosted.json.includedWithElite).toBe(false);
    expect(hosted.json.cleanBranding).toBe(true);

    const plain = await call("GET", "/creator-hosting/me", { user: OWNER_USER });
    expect(plain.json.hostingEntitled).toBe(false);
    expect(plain.json.hostingSource).toBeNull();
    expect(plain.json.cleanBranding).toBe(false);
  });

  it("an Elite member is hosting-entitled through Elite — no Hosting row, no extra charge", async () => {
    const elite = await call("GET", "/creator-hosting/me", { user: ELITE_USER });
    expect(elite.status).toBe(200);
    expect(elite.json.hostingEntitled).toBe(true);
    expect(elite.json.hostingSource).toBe("elite");
    expect(elite.json.includedWithElite).toBe(true);
    expect(elite.json.cleanBranding).toBe(true);
    expect(elite.json.plan.priceUsdPerMonth).toBe(9);
    expect(elite.json.plan.includedWithTier).toBe("elite");
  });
});
