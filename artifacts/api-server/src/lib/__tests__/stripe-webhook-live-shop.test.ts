/**
 * stripe-webhook-live-shop.test.ts — WEBHOOK-SETTLE (stack1200).
 *
 * Live shopping was in the Gate #5 tip defect CLASS: checkout
 * sessions stamp purchase_kind "live_shop", and the webhook
 * dispatch had NO branch for them — the sale recorded ONLY if the
 * buyer's browser returned and the page called
 * /live-shopping/verify. A viewer who closed the tab after paying
 * was charged with no sale recorded: no delivery record, no
 * overlay alert.
 *
 * This suite drives the REAL webhook handler with a fabricated
 * (signature-bypassed via the mocked client) live-shop event and
 * pins:
 *   - a paid session records the sale + stream overlay alert
 *     exactly once, with NO verify call;
 *   - a replayed delivery records nothing twice;
 *   - an unpaid session records nothing;
 *   - Q150 holds on the webhook door: a paid session whose stream
 *     has ended records NO sale and is auto-refunded (the settle's
 *     own refusal), answered 200.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const SELLER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const BUYER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PRODUCT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const STREAM_ID = "12121212-1212-4212-8212-121212121212";
const SESSION_ID = "cs_liveshop_webhook_1";

const h = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  return {
    sales: [] as Array<Record<string, any>>,
    products: [] as Array<Record<string, any>>,
    streams: [] as Array<Record<string, any>>,
    alerts: [] as Array<Record<string, any>>,
    event: null as any,
    refunds: [] as Array<unknown>,
  };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(async () => 0),
}));

vi.mock("../stripe-client", () => ({
  createGuardedStripeClient: vi.fn(() => ({
    webhooks: { constructEvent: () => h.event },
  })),
  buildCheckoutSessionIdempotencyKey: vi.fn(() => "liveshop-key"),
  buildPaymentIntentIdempotencyKey: vi.fn(() => "pi-key"),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => false),
}));

vi.mock("../rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = BUYER_ID;
    next();
  },
}));

vi.mock("../credits", () => ({
  chargeCredits: vi.fn(async () => undefined),
  refundCredits: vi.fn(async () => undefined),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-test"),
}));

vi.mock("../mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async () => null),
}));

vi.mock("../objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (u: string) => u),
  isStorageRef: () => false,
}));

vi.mock("../stripe-checkout", () => ({
  createPaymentCheckout: vi.fn(async () => ({ sessionId: "cs_unused", url: "https://checkout.example.com/pay" })),
  retrieveCheckoutSession: vi.fn(async () => {
    throw new Error("webhook settle never retrieves the session");
  }),
  refundCheckoutSessionPayment: vi.fn(async (session: unknown) => {
    h.refunds.push(session);
    return true;
  }),
  checkoutBaseUrl: () => "https://example.com",
  isCheckoutTestMode: () => true,
}));

/* The settle path reads/writes live_shop_sales, live_shop_products,
   live_shop_streams and live_shop_alerts through the drizzle
   builder. The fake matches rows by rendering the condition's
   "col" = $n equality pairs (the sibling harnesses' pattern). */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { liveShopSalesTable, liveShopProductsTable, liveShopStreamsTable, liveShopAlertsTable } = actual;
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();

  function storeFor(table: unknown): Array<Record<string, any>> {
    if (table === liveShopSalesTable) return h.sales;
    if (table === liveShopProductsTable) return h.products;
    if (table === liveShopStreamsTable) return h.streams;
    if (table === liveShopAlertsTable) return h.alerts;
    return [];
  }

  function matchRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    const rows = storeFor(table);
    if (!cond) return [...rows];
    const q = dialect.sqlToQuery(cond as never);
    const pairs: Array<[string, unknown]> = [];
    const re = /"(\w+)"\s*=\s*\$(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(q.sql)) !== null) pairs.push([m[1]!, q.params[Number(m[2]) - 1]]);
    if (pairs.length === 0) return [...rows];
    return rows.filter((r) => pairs.every(([col, val]) => r[col] === val));
  }

  function selectChain(table: unknown) {
    let cond: unknown;
    const chain: any = {
      where: (c: unknown) => {
        cond = c;
        return chain;
      },
      orderBy: (..._a: unknown[]) => chain,
      limit: async (n: number) => matchRows(table, cond).slice(0, n).map((r) => ({ ...r })),
      then: (resolve: (v: unknown) => void) => resolve(matchRows(table, cond).map((r) => ({ ...r }))),
    };
    return chain;
  }

  const fakeDb: any = {
    select: (_proj?: unknown) => ({ from: (table: unknown) => selectChain(table) }),
    insert: (table: unknown) => ({
      values: (v: Record<string, any>) => {
        let inserted: Record<string, any> | null = null;
        const doInsert = () => {
          if (inserted) return inserted;
          inserted = { id: randomUUID(), created_at: new Date(), ...v };
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
        where: (cond: unknown) => ({
          returning: async () => {
            const rows = matchRows(table, cond);
            for (const r of rows) Object.assign(r, v);
            return rows.map((r) => ({ ...r }));
          },
        }),
      }),
    }),
    execute: async () => ({ rows: [] }),
  };
  return { ...actual, db: fakeDb };
});

import { stripeWebhookHandler } from "../stripe-webhook";

function seed(streamStatus = "live") {
  h.products = [
    { id: PRODUCT_ID, user_id: SELLER_ID, name: "Gold Hoodie", price_cents: 2500, created_at: new Date() },
  ];
  h.streams = [{ id: STREAM_ID, user_id: SELLER_ID, status: streamStatus }];
  h.sales = [];
  h.alerts = [];
  h.refunds = [];
}

function liveShopEvent(paymentStatus: string) {
  return {
    id: "evt_liveshop_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: SESSION_ID,
        payment_status: paymentStatus,
        amount_total: 2500,
        currency: "usd",
        payment_intent: "pi_liveshop_1",
        metadata: {
          purchase_kind: "live_shop",
          product_id: PRODUCT_ID,
          seller_user_id: SELLER_ID,
          buyer_user_id: BUYER_ID,
          stream_id: STREAM_ID,
          quantity: "1",
          total_cents: "2500",
          unit_price_cents: "2500",
        },
      },
    },
  };
}

async function deliver(event: unknown) {
  h.event = event;
  const res: any = { statusCode: 0, body: null as any };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  const req: any = {
    headers: { "stripe-signature": "sig_test" },
    body: Buffer.from("payload"),
  };
  await stripeWebhookHandler(req, res);
  return res;
}

beforeEach(() => {
  seed();
  h.event = null;
});

describe("stripe webhook — live shop settle (WEBHOOK-SETTLE)", () => {
  it("a paid live-shop session records the sale and the overlay alert once, with no verify call", async () => {
    const res = await deliver(liveShopEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "live_shop" });

    expect(h.sales).toHaveLength(1);
    expect(h.sales[0]).toMatchObject({
      user_id: SELLER_ID,
      product_id: PRODUCT_ID,
      buyer_user_id: BUYER_ID,
      price_cents: 2500,
      status: "paid",
      stripe_session_id: SESSION_ID,
    });
    expect(h.sales[0]?.platform_fee_cents).toBeGreaterThan(0);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0]).toMatchObject({ stream_id: STREAM_ID, product_id: PRODUCT_ID, total_cents: 2500 });
  });

  it("a replayed delivery records no second sale and no second alert", async () => {
    await deliver(liveShopEvent("paid"));
    const res = await deliver(liveShopEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(h.sales).toHaveLength(1);
    expect(h.alerts).toHaveLength(1);
  });

  it("an unpaid live-shop session records nothing", async () => {
    const res = await deliver(liveShopEvent("unpaid"));
    expect(res.statusCode).toBe(200);
    expect(h.sales).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
  });

  it("Q150: a paid session whose stream has ended records no sale and is auto-refunded", async () => {
    seed("ended");
    const res = await deliver(liveShopEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(h.sales).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
    expect(h.refunds).toHaveLength(1);
  });
});
