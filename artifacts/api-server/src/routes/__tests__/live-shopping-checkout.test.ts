/**
 * Live-shopping native checkout (0132): the default buy path completes
 * ON-platform — checkout at the listed price, verify-gated 'paid' sale,
 * test sales stay labeled test forever.
 *
 * Fake-db style mirrors memberships-payments.test.ts. Stripe is faked at
 * the lib/stripe-checkout boundary.
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
  stores: new Map<string, Array<Record<string, any>>>(),
  checkoutCalls: [] as Array<Record<string, any>>,
  refundCalls: [] as Array<unknown>,
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
  while ((m = re.exec(sqlText)) !== null) pairs.push([m[1]!, params[Number(m[2]) - 1]]);
  if (pairs.length === 0) return [...rows];
  return rows.filter((r) => pairs.every(([col, val]) => r[col] === val));
}

function selectChain(table: unknown, fields?: Record<string, any>) {
  let cond: unknown;
  const project = (rows: Array<Record<string, any>>) => {
    if (!fields) return rows.map((r) => ({ ...r }));
    return rows.map((r) => {
      const out: Record<string, any> = {};
      for (const [key, col] of Object.entries(fields)) out[key] = r[(col as any).name];
      return out;
    });
  };
  const chain: any = {
    where: (c: unknown) => {
      cond = c;
      return chain;
    },
    orderBy: (..._a: unknown[]) => chain,
    limit: async (n: number) => project(matchRows(table, cond).slice(0, n)),
    then: (resolve: (v: unknown) => void) => resolve(project(matchRows(table, cond))),
  };
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
            status: "test",
            buyer_user_id: null,
            stripe_session_id: null,
            stream_id: null,
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
        where: (cond: unknown) => ({
          returning: async () => {
            const matched = matchRows(table, cond);
            for (const r of matched) Object.assign(r, v);
            return matched.map((r) => ({ ...r }));
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        const matched = new Set(matchRows(table, cond));
        const rows = storeFor(table);
        for (let i = rows.length - 1; i >= 0; i--) if (matched.has(rows[i]!)) rows.splice(i, 1);
        return [];
      },
    }),
  };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-test"),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async () => null),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (u: string) => u),
}));

vi.mock("../../lib/stripe-checkout", () => ({
  createPaymentCheckout: vi.fn(async (input: Record<string, any>) => {
    h.checkoutCalls.push(input);
    return { sessionId: "cs_test_ls_1", url: "https://checkout.example.com/pay" };
  }),
  retrieveCheckoutSession: vi.fn(async () => h.session),
  refundCheckoutSessionPayment: vi.fn(async (session: unknown) => {
    h.refundCalls.push(session);
    return true;
  }),
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

import router from "../live-shopping";

const SELLER = randomUUID();
const BUYER = randomUUID();

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

function seedStream(overrides: Record<string, any> = {}): Record<string, any> {
  const stream = {
    id: randomUUID(),
    user_id: SELLER,
    title: "Friday merch drop",
    status: "live",
    pinned_product_id: null,
    started_at: new Date(),
    ended_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  h.stores.get("live_shop_streams")!.push(stream);
  return stream;
}

function seedProduct(overrides: Record<string, any> = {}): Record<string, any> {
  const product = {
    id: randomUUID(),
    user_id: SELLER,
    name: "Gold Hoodie",
    price_cents: 4999,
    image_url: null,
    external_url: "https://shop.example.com/hoodie",
    description: null,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  h.stores.get("live_shop_products")!.push(product);
  return product;
}

beforeEach(() => {
  h.stores = new Map([
    ["live_shop_products", []],
    ["live_shop_streams", []],
    ["live_shop_sales", []],
    ["live_shop_alerts", []],
  ]);
  h.checkoutCalls = [];
  h.refundCalls = [];
  h.session = null;
  h.userId = BUYER;
});

async function call(method: string, path: string, body?: unknown) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

describe("live-shopping native checkout", () => {
  it("checkout charges listed price × quantity; verify records a paid sale (idempotent)", async () => {
    const product = seedProduct();
    const co = await call("POST", "/live-shopping/checkout", { product_id: product.id, quantity: 2 });
    expect(co.status).toBe(200);
    expect(co.data.totalCents).toBe(9998);
    expect(h.checkoutCalls[0]!.amountCents).toBe(9998);
    expect(h.stores.get("live_shop_sales")).toHaveLength(0);

    h.session = {
      id: "cs_test_ls_1",
      payment_status: "paid",
      amount_total: 9998,
      metadata: {
        purchase_kind: "live_shop",
        product_id: product.id,
        seller_user_id: SELLER,
        buyer_user_id: BUYER,
        quantity: "2",
        stream_id: "",
      },
    };
    const v = await call("POST", "/live-shopping/verify", { sessionId: "cs_test_ls_1" });
    expect(v.status).toBe(200);
    expect(v.data.sale.status).toBe("paid");
    expect(v.data.sale.totalCents).toBe(9998);
    expect(v.data.sale.platformFeeCents).toBe(500);
    expect(v.data.sale.creatorPayoutCents).toBe(9498);

    const row = h.stores.get("live_shop_sales")![0]!;
    expect(row.status).toBe("paid");
    expect(row.buyer_user_id).toBe(BUYER);
    expect(row.user_id).toBe(SELLER);

    const v2 = await call("POST", "/live-shopping/verify", { sessionId: "cs_test_ls_1" });
    expect(v2.data.duplicate).toBe(true);
    expect(h.stores.get("live_shop_sales")).toHaveLength(1);
  });

  it("F4: checkout locks the price; a later price rise does not reject or reprice the paid session", async () => {
    const product = seedProduct();
    const co = await call("POST", "/live-shopping/checkout", { product_id: product.id, quantity: 2 });
    expect(co.status).toBe(200);
    /* The lock rides the checkout metadata. */
    expect(h.checkoutCalls[0]!.metadata.total_cents).toBe("9998");
    expect(h.checkoutCalls[0]!.metadata.unit_price_cents).toBe("4999");

    h.session = {
      id: "cs_test_ls_1",
      payment_status: "paid",
      amount_total: 9998,
      metadata: { ...h.checkoutCalls[0]!.metadata },
    };
    /* Seller raises the price after the buyer paid. */
    h.stores.get("live_shop_products")![0]!.price_cents = 7999;
    const v = await call("POST", "/live-shopping/verify", { sessionId: "cs_test_ls_1" });
    expect(v.status).toBe(200);
    expect(v.data.sale.totalCents).toBe(9998);
    const row = h.stores.get("live_shop_sales")![0]!;
    expect(row.price_cents).toBe(4999); // locked unit price recorded, not the new one
  });

  it("F3: a product deleted after payment auto-refunds instead of stranding the buyer", async () => {
    const product = seedProduct();
    const co = await call("POST", "/live-shopping/checkout", { product_id: product.id, quantity: 1 });
    expect(co.status).toBe(200);
    h.session = {
      id: "cs_test_ls_1",
      payment_status: "paid",
      amount_total: 4999,
      metadata: { ...h.checkoutCalls[0]!.metadata },
    };
    h.stores.set("live_shop_products", []);
    const v = await call("POST", "/live-shopping/verify", { sessionId: "cs_test_ls_1" });
    expect(v.status).toBe(400);
    expect(v.data.refunded).toBe(true);
    expect(v.data.error).toContain("refunded in full");
    expect(h.refundCalls).toHaveLength(1);
    expect(h.stores.get("live_shop_sales")).toHaveLength(0);
  });

  it("unpaid sessions record nothing; sellers cannot buy their own product", async () => {
    const product = seedProduct();
    h.userId = SELLER;
    expect((await call("POST", "/live-shopping/checkout", { product_id: product.id })).status).toBe(400);
    h.userId = BUYER;
    await call("POST", "/live-shopping/checkout", { product_id: product.id });
    h.session = {
      id: "cs_test_ls_1",
      payment_status: "unpaid",
      amount_total: 4999,
      metadata: {
        purchase_kind: "live_shop",
        product_id: product.id,
        seller_user_id: SELLER,
        buyer_user_id: BUYER,
        quantity: "1",
        stream_id: "",
      },
    };
    expect((await call("POST", "/live-shopping/verify", { sessionId: "cs_test_ls_1" })).status).toBe(400);
    expect(h.stores.get("live_shop_sales")).toHaveLength(0);
  });

  it("Q150: checkout against a live stream succeeds exactly as before (5% fee)", async () => {
    const product = seedProduct();
    const stream = seedStream({ status: "live" });
    const co = await call("POST", "/live-shopping/checkout", {
      product_id: product.id,
      stream_id: stream.id,
      quantity: 1,
    });
    expect(co.status).toBe(200);
    expect(h.checkoutCalls).toHaveLength(1);
    expect(h.checkoutCalls[0]!.metadata.stream_id).toBe(stream.id);

    h.session = {
      id: "cs_test_ls_1",
      payment_status: "paid",
      amount_total: 4999,
      metadata: { ...h.checkoutCalls[0]!.metadata },
    };
    const v = await call("POST", "/live-shopping/verify", { sessionId: "cs_test_ls_1" });
    expect(v.status).toBe(200);
    expect(v.data.sale.status).toBe("paid");
    expect(v.data.sale.platformFeeCents).toBe(250); // 5% of 4999, half-up
    const row = h.stores.get("live_shop_sales")![0]!;
    expect(row.stream_id).toBe(stream.id);
    /* A verified in-stream purchase fires the overlay alert. */
    expect(h.stores.get("live_shop_alerts")).toHaveLength(1);
    expect(h.refundCalls).toHaveLength(0);
  });

  it("Q150: checkout against an ended stream is refused before any charge", async () => {
    const product = seedProduct();
    const stream = seedStream({ status: "ended", ended_at: new Date() });
    const co = await call("POST", "/live-shopping/checkout", {
      product_id: product.id,
      stream_id: stream.id,
      quantity: 1,
    });
    expect(co.status).toBe(409);
    expect(co.data.code).toBe("STREAM_NOT_LIVE");
    expect(co.data.error).toContain("ended");
    /* Zero charge: no Stripe session was ever created, no sale row. */
    expect(h.checkoutCalls).toHaveLength(0);
    expect(h.stores.get("live_shop_sales")).toHaveLength(0);
  });

  it("Q150: checkout against a scheduled (not yet live) stream is refused too", async () => {
    const product = seedProduct();
    const stream = seedStream({ status: "scheduled", started_at: null });
    const co = await call("POST", "/live-shopping/checkout", {
      product_id: product.id,
      stream_id: stream.id,
    });
    expect(co.status).toBe(409);
    expect(co.data.code).toBe("STREAM_NOT_LIVE");
    expect(h.checkoutCalls).toHaveLength(0);
    expect(h.stores.get("live_shop_sales")).toHaveLength(0);
  });

  it("Q150: verify refuses + refunds when the stream ended after checkout", async () => {
    const product = seedProduct();
    const stream = seedStream({ status: "live" });
    const co = await call("POST", "/live-shopping/checkout", {
      product_id: product.id,
      stream_id: stream.id,
      quantity: 1,
    });
    expect(co.status).toBe(200);
    /* The stream ends while the buyer is on the Stripe page. */
    h.stores.get("live_shop_streams")![0]!.status = "ended";
    h.stores.get("live_shop_streams")![0]!.ended_at = new Date();

    h.session = {
      id: "cs_test_ls_1",
      payment_status: "paid",
      amount_total: 4999,
      metadata: { ...h.checkoutCalls[0]!.metadata },
    };
    const v = await call("POST", "/live-shopping/verify", { sessionId: "cs_test_ls_1" });
    expect(v.status).toBe(409);
    expect(v.data.code).toBe("STREAM_NOT_LIVE");
    expect(v.data.refunded).toBe(true);
    expect(h.refundCalls).toHaveLength(1);
    /* Zero ledger movement: no paid sale, no overlay alert. */
    expect(h.stores.get("live_shop_sales")).toHaveLength(0);
    expect(h.stores.get("live_shop_alerts")).toHaveLength(0);
  });

  it("Q150: a sale recorded while live stays a duplicate no-op after the stream ends", async () => {
    const product = seedProduct();
    const stream = seedStream({ status: "live" });
    await call("POST", "/live-shopping/checkout", {
      product_id: product.id,
      stream_id: stream.id,
      quantity: 1,
    });
    h.session = {
      id: "cs_test_ls_1",
      payment_status: "paid",
      amount_total: 4999,
      metadata: { ...h.checkoutCalls[0]!.metadata },
    };
    const v = await call("POST", "/live-shopping/verify", { sessionId: "cs_test_ls_1" });
    expect(v.status).toBe(200);
    expect(h.stores.get("live_shop_sales")).toHaveLength(1);

    h.stores.get("live_shop_streams")![0]!.status = "ended";
    const v2 = await call("POST", "/live-shopping/verify", { sessionId: "cs_test_ls_1" });
    expect(v2.status).toBe(200);
    expect(v2.data.duplicate).toBe(true);
    expect(h.stores.get("live_shop_sales")).toHaveLength(1);
    expect(h.refundCalls).toHaveLength(0);
  });

  it("Q150: manual test sales and purchase alerts refuse non-live streams, allow live ones", async () => {
    const product = seedProduct();
    const ended = seedStream({ status: "ended", ended_at: new Date() });
    const live = seedStream({ status: "live" });
    h.userId = SELLER;

    const badSale = await call("POST", "/live-shopping/sales", {
      product_id: product.id,
      stream_id: ended.id,
      quantity: 1,
    });
    expect(badSale.status).toBe(409);
    expect(badSale.data.code).toBe("STREAM_NOT_LIVE");
    expect(h.stores.get("live_shop_sales")).toHaveLength(0);

    const goodSale = await call("POST", "/live-shopping/sales", {
      product_id: product.id,
      stream_id: live.id,
      quantity: 1,
    });
    expect(goodSale.status).toBe(201);
    expect(h.stores.get("live_shop_sales")).toHaveLength(1);

    const badAlert = await call("POST", `/live-shopping/streams/${ended.id}/alerts`, {
      product_id: product.id,
    });
    expect(badAlert.status).toBe(409);
    expect(badAlert.data.code).toBe("STREAM_NOT_LIVE");
    expect(h.stores.get("live_shop_alerts")).toHaveLength(0);

    const goodAlert = await call("POST", `/live-shopping/streams/${live.id}/alerts`, {
      product_id: product.id,
    });
    expect(goodAlert.status).toBe(201);
    expect(h.stores.get("live_shop_alerts")).toHaveLength(1);
  });

  it("dashboard separates paid sales from manually recorded test sales", async () => {
    const product = seedProduct();
    /* A legacy/manual test sale. */
    h.userId = SELLER;
    const testSale = await call("POST", "/live-shopping/sales", { product_id: product.id, quantity: 1 });
    expect(testSale.status).toBe(201);
    expect(testSale.data.test).toBe(true);

    /* A real paid checkout sale. */
    h.userId = BUYER;
    await call("POST", "/live-shopping/checkout", { product_id: product.id, quantity: 1 });
    h.session = {
      id: "cs_test_ls_1",
      payment_status: "paid",
      amount_total: 4999,
      metadata: {
        purchase_kind: "live_shop",
        product_id: product.id,
        seller_user_id: SELLER,
        buyer_user_id: BUYER,
        quantity: "1",
        stream_id: "",
      },
    };
    await call("POST", "/live-shopping/verify", { sessionId: "cs_test_ls_1" });

    h.userId = SELLER;
    const dash = await call("GET", "/live-shopping/dashboard");
    expect(dash.data.totals.paid_sales).toBe(1);
    expect(dash.data.totals.test_sales).toBe(1);
    expect(dash.data.totals.paid_revenue_cents).toBe(4999);
    expect(dash.data.test_data).toBe(true);
    expect(dash.data.note).toContain("test");
  });
});
