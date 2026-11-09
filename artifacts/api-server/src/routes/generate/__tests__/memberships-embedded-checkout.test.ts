/**
 * Membership EMBEDDED checkout (stack1200, Gate #5 defect): the join
 * used to answer only a Stripe-hosted URL, so the profile "Join —
 * $5 / month" button navigated the fan AWAY to checkout.stripe.com.
 * Owner law 2026-10-26: customer-facing checkout happens ON the site.
 *
 * These pins prove, at the lib/stripe-checkout boundary (the fake
 * mirrors the real helper's overloads: embedded → {sessionId,
 * clientSecret} with NO url; hosted → {sessionId, url}):
 *  - POST /memberships/checkout with uiMode "embedded" creates the
 *    session in embedded presentation and answers a clientSecret and
 *    NO hosted URL — and the paid session still verifies + activates
 *    through the unchanged /memberships/verify path;
 *  - the default (no uiMode) and explicit "hosted" keep the legacy
 *    hosted shape exactly;
 *  - EMBEDDED_CHECKOUT=off forces the hosted shape even when the
 *    caller asks for embedded (kill switch);
 *  - the past-due update-payment door (payment collection on the
 *    memberships surface) takes the same embedded presentation;
 *  - the money never moves: a $5.00 tier charges 500¢ and the split
 *    stays platform $0.50 (10%) / creator $4.50 via netAfterFee.
 *
 * Harness mirrors memberships-payments.test.ts: the REAL router with
 * REAL table objects against a fake db; Stripe faked at the
 * lib/stripe-checkout boundary.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const dialect = new PgDialect();
function renderParams(cond: unknown): unknown[] {
  return dialect.sqlToQuery(cond as never).params as unknown[];
}
function renderSql(cond: unknown): string {
  return dialect.sqlToQuery(cond as never).sql;
}

const h = vi.hoisted(() => ({
  userId: "",
  userEmail: "fan@example.com",
  stores: new Map<string, Array<Record<string, any>>>(),
  checkoutCalls: [] as Array<Record<string, any>>,
  session: null as any,
}));

function storeFor(table: unknown): Array<Record<string, any>> {
  const name = getTableName(table as never);
  if (!h.stores.has(name)) h.stores.set(name, []);
  return h.stores.get(name)!;
}

function matchRows(table: unknown, cond: unknown): Array<Record<string, any>> {
  const rows = storeFor(table);
  if (!cond) return [...rows];
  const sqlText = renderSql(cond);
  const params = renderParams(cond);
  const pairs: Array<[string, unknown]> = [];
  const re = /"(\w+)"\s*=\s*\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sqlText)) !== null) {
    pairs.push([m[1]!, params[Number(m[2]) - 1]]);
  }
  if (pairs.length === 0) return [...rows];
  return rows.filter((r) => pairs.every(([col, val]) => r[col] === val));
}

function selectChain(table: unknown, fields?: Record<string, any>) {
  let cond: unknown;
  const chain: any = {
    where: (c: unknown) => {
      cond = c;
      return chain;
    },
    orderBy: (..._a: unknown[]) => chain,
    limit: async (n: number) => project(matchRows(table, cond).slice(0, n)),
    then: (resolve: (v: unknown) => void) => resolve(project(matchRows(table, cond))),
  };
  function project(rows: Array<Record<string, any>>) {
    if (!fields) return rows.map((r) => ({ ...r }));
    return rows.map((r) => {
      const out: Record<string, any> = {};
      for (const [key, col] of Object.entries(fields)) {
        out[key] = r[(col as any).name];
      }
      return out;
    });
  }
  return chain;
}

function buildFakeDb() {
  return {
    select: (fields?: Record<string, any>) => ({
      from: (table: unknown) => selectChain(table, fields),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, any>) => {
        let inserted: Record<string, any> | null = null;
        const doInsert = () => {
          if (inserted) return inserted;
          inserted = {
            id: randomUUID(),
            created_at: new Date(),
            updated_at: new Date(),
            joined_at: new Date(),
            canceled_at: null,
            current_period_start: null,
            current_period_end: null,
            trial_ends_at: null,
            stripe_session_id: null,
            external_ref: null,
            fan_user_id: null,
            is_gift: false,
            gifted_by_user_id: null,
            member_id: null,
            ...v,
          };
          storeFor(table).push(inserted);
          return inserted;
        };
        return {
          returning: async () => [{ ...doInsert() }],
          then: (resolve: (v: unknown) => void) => resolve([doInsert()]),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (v: Record<string, any>) => ({
        where: (cond: unknown) => {
          let done: Array<Record<string, any>> | null = null;
          const apply = () => {
            if (done) return done;
            done = matchRows(table, cond);
            for (const r of done) Object.assign(r, v);
            return done;
          };
          return {
            returning: async () => apply().map((r) => ({ ...r })),
            then: (resolve: (v: unknown) => void) => resolve(apply()),
          };
        },
      }),
    }),
    delete: (_table: unknown) => ({
      where: async () => [],
    }),
  };
}

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
    const ck = typeof clientKey === "string" && clientKey.trim().length >= 8 ? clientKey.trim() : null;
    return ck ? `${scope}:${userId}:client:${ck}` : `${scope}:${userId}:${JSON.stringify(intent ?? {})}`;
  },
  voidChargeIdempotencyKey: async () => {},
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-test"),
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

/* The fake mirrors lib/stripe-checkout's REAL overloads: an embedded
   request returns a clientSecret and NO url; a hosted request returns
   a url and NO clientSecret. If the route ever asks Stripe for a
   hosted session on the embedded path, checkoutCalls shows it. */
vi.mock("../../../lib/stripe-checkout", () => ({
  createPaymentCheckout: vi.fn(async (input: Record<string, any>) => {
    h.checkoutCalls.push(input);
    const sessionId = `cs_test_${h.checkoutCalls.length}`;
    if (input.uiMode === "embedded") {
      return { sessionId, clientSecret: `${sessionId}_secret_test` };
    }
    return { sessionId, url: "https://checkout.stripe.com/c/pay/cs_test" };
  }),
  retrieveCheckoutSession: vi.fn(async () => h.session),
  refundCheckoutSessionPayment: vi.fn(async () => true),
  checkoutBaseUrl: () => "https://example.com",
  isCheckoutTestMode: () => true,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return buildFakeDb();
    },
  };
});

import router, {
  checkoutChargeCents,
  netAfterFee,
  MEMBERSHIPS_PLATFORM_FEE_PCT,
} from "../memberships";

const CREATOR = randomUUID();
const FAN = randomUUID();
const FRIEND = randomUUID();

let server: ReturnType<typeof express.application.listen>;
let baseUrl = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function seedTier(overrides: Record<string, any> = {}): Record<string, any> {
  const tier = {
    id: randomUUID(),
    user_id: CREATOR,
    name: "Gold Club",
    price_cents: 500,
    description: "",
    perks: [],
    sort_order: 0,
    is_active: "true",
    trial_enabled: false,
    annual_discount_pct: 0,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  h.stores.get("fan_tiers")!.push(tier);
  return tier;
}

function seedMember(overrides: Record<string, any> = {}): Record<string, any> {
  const member = {
    id: randomUUID(),
    user_id: CREATOR,
    tier_id: "",
    fan_label: "fan@example.com",
    fan_user_id: FAN,
    status: "past_due",
    price_cents: 500,
    billing_period: "monthly",
    current_period_start: new Date(Date.now() - 40 * 86_400_000),
    current_period_end: new Date(Date.now() - 10 * 86_400_000),
    trial_ends_at: null,
    paused_at: null,
    paused_until: null,
    stripe_session_id: "cs_test_old",
    external_ref: null,
    is_gift: false,
    gifted_by_user_id: null,
    canceled_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  h.stores.get("fan_members")!.push(member);
  return member;
}

beforeEach(() => {
  h.stores = new Map([
    ["fan_tiers", []],
    ["fan_members", []],
    ["fan_membership_gifts", []],
  ]);
  h.checkoutCalls = [];
  h.session = null;
  h.userId = FAN;
  h.userEmail = "fan@example.com";
  delete process.env["EMBEDDED_CHECKOUT"];
});

async function call(method: string, path: string, body?: unknown) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

describe("POST /memberships/checkout — embedded presentation", () => {
  it("embedded join: answers a clientSecret and NO hosted URL, for the same $5 charge", async () => {
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id, uiMode: "embedded" });

    expect(co.status).toBe(200);
    expect(co.data.uiMode).toBe("embedded");
    expect(co.data.clientSecret).toBe(`${co.data.sessionId}_secret_test`);
    /* The defect itself: no hosted checkout URL may ride this answer. */
    expect(co.data.url).toBeNull();
    expect(co.data.amountCents).toBe(500);
    expect(co.data.amountDollars).toBe(5);

    /* The session was CREATED embedded, with the identical money +
       metadata the hosted rail carries. */
    expect(h.checkoutCalls).toHaveLength(1);
    expect(h.checkoutCalls[0]!.uiMode).toBe("embedded");
    expect(h.checkoutCalls[0]!.amountCents).toBe(500);
    expect(h.checkoutCalls[0]!.metadata.amount_cents).toBe("500");
    expect(h.checkoutCalls[0]!.metadata.fan_user_id).toBe(FAN);
    /* Same return path as hosted — verify-on-return settles the seat. */
    expect(h.checkoutCalls[0]!.successUrl).toContain("/memberships?creator=");
    expect(h.checkoutCalls[0]!.successUrl).toContain("session_id={CHECKOUT_SESSION_ID}");
  });

  it("the $5 embedded join verifies + activates, and the split is unchanged ($0.50 / $4.50)", async () => {
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id, uiMode: "embedded" });
    expect(co.status).toBe(200);

    h.session = {
      id: co.data.sessionId,
      payment_status: "paid",
      amount_total: 500,
      metadata: { ...h.checkoutCalls[0]!.metadata },
      customer_details: { email: "fan@example.com" },
    };
    const v = await call("POST", "/memberships/verify", { sessionId: co.data.sessionId });
    expect(v.status).toBe(200);
    expect(v.data.success).toBe(true);
    expect(v.data.membership.status).toBe("active");
    const rows = h.stores.get("fan_members")!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("active");
    expect(rows[0]!.price_cents).toBe(500);
    expect(rows[0]!.stripe_session_id).toBe(co.data.sessionId);

    /* Membership math unchanged: 10% platform fee — $5.00 gross →
       $0.50 fee / $4.50 creator net, to the cent. */
    expect(MEMBERSHIPS_PLATFORM_FEE_PCT).toBe(10);
    expect(checkoutChargeCents(tier, "monthly")).toBe(500);
    expect(netAfterFee(500)).toBe(450);
    expect(500 - netAfterFee(500)).toBe(50);
  });

  it("default join (no uiMode) keeps the legacy hosted shape exactly", async () => {
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });

    expect(co.status).toBe(200);
    expect(co.data.uiMode).toBe("hosted");
    expect(co.data.url).toBe("https://checkout.stripe.com/c/pay/cs_test");
    expect(co.data.clientSecret).toBeNull();
    expect(h.checkoutCalls[0]!.uiMode).toBeUndefined();
  });

  it("explicit uiMode \"hosted\" keeps the hosted shape", async () => {
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id, uiMode: "hosted" });

    expect(co.status).toBe(200);
    expect(co.data.uiMode).toBe("hosted");
    expect(co.data.url).toContain("checkout.stripe.com");
    expect(co.data.clientSecret).toBeNull();
    expect(h.checkoutCalls[0]!.uiMode).toBeUndefined();
  });

  it("kill switch: EMBEDDED_CHECKOUT=off forces hosted even when embedded is asked", async () => {
    process.env["EMBEDDED_CHECKOUT"] = "off";
    try {
      const tier = seedTier();
      const co = await call("POST", "/memberships/checkout", { tierId: tier.id, uiMode: "embedded" });

      expect(co.status).toBe(200);
      expect(co.data.uiMode).toBe("hosted");
      expect(co.data.url).toContain("checkout.stripe.com");
      expect(co.data.clientSecret).toBeNull();
      expect(h.checkoutCalls[0]!.uiMode).toBeUndefined();
    } finally {
      delete process.env["EMBEDDED_CHECKOUT"];
    }
  });

  it("an unknown uiMode value is refused, never silently honored", async () => {
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id, uiMode: "popup" });
    expect(co.status).toBe(400);
    expect(h.checkoutCalls).toHaveLength(0);
  });

  it("embedded GIFT join: the gift row binds the embedded session id", async () => {
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", {
      tierId: tier.id,
      recipientUserId: FRIEND,
      uiMode: "embedded",
    });

    expect(co.status).toBe(200);
    expect(co.data.isGift).toBe(true);
    expect(co.data.uiMode).toBe("embedded");
    expect(co.data.url).toBeNull();
    expect(co.data.clientSecret).toBe(`${co.data.sessionId}_secret_test`);
    const gifts = h.stores.get("fan_membership_gifts")!;
    expect(gifts).toHaveLength(1);
    expect(gifts[0]!.stripe_session_id).toBe(co.data.sessionId);
    expect(gifts[0]!.status).toBe("pending_payment");
    expect(gifts[0]!.amount_cents).toBe(500);
  });
});

describe("POST /memberships/mine/:id/update-payment — embedded presentation", () => {
  it("embedded card update: answers a clientSecret and NO hosted URL, same $5 charge", async () => {
    const tier = seedTier();
    const member = seedMember({ tier_id: tier.id });

    const r = await call("POST", `/memberships/mine/${member.id}/update-payment`, { uiMode: "embedded" });

    expect(r.status).toBe(200);
    expect(r.data.uiMode).toBe("embedded");
    expect(r.data.clientSecret).toBe(`${r.data.sessionId}_secret_test`);
    expect(r.data.url).toBeNull();
    expect(r.data.amountCents).toBe(500);
    expect(h.checkoutCalls).toHaveLength(1);
    expect(h.checkoutCalls[0]!.uiMode).toBe("embedded");
    expect(h.checkoutCalls[0]!.amountCents).toBe(500);
    expect(h.checkoutCalls[0]!.metadata.fan_user_id).toBe(FAN);
    /* Nothing is marked paid by starting the update. */
    expect(h.stores.get("fan_members")![0]!.status).toBe("past_due");
  });

  it("card update with no body keeps the legacy hosted shape", async () => {
    const tier = seedTier();
    const member = seedMember({ tier_id: tier.id });

    const r = await call("POST", `/memberships/mine/${member.id}/update-payment`);

    expect(r.status).toBe(200);
    expect(r.data.uiMode).toBe("hosted");
    expect(r.data.url).toContain("checkout.stripe.com");
    expect(r.data.clientSecret).toBeNull();
    expect(h.checkoutCalls[0]!.uiMode).toBeUndefined();
  });
});
