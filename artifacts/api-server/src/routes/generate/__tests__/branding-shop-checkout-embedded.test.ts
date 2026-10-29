/**
 * Branding-shop EMBEDDED checkout (World money-parity server lane):
 * POST /api/branding-shop/checkout accepts uiMode — an embedded ask
 * creates the same session in embedded_page ui_mode and answers a
 * clientSecret (no hosted URL) so the World Branding stand can mount
 * the payment form in-panel; the hosted answer keeps the legacy
 * shape, the EMBEDDED_CHECKOUT kill switch forces it, and the
 * demo/no-key path is untouched. The server-side total recompute,
 * metadata and idempotency key are identical across presentations.
 *
 * Harness: REAL router, fake db.execute (the route's raw-SQL shape),
 * Stripe faked at the module boundary answering per ui_mode.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";

const USER_ID = randomUUID();
const ORDER_ID = randomUUID();

const h = vi.hoisted(() => ({
  order: null as Record<string, any> | null,
  createCalls: [] as Array<Record<string, any>>,
  updates: [] as Array<unknown[]>,
  sessionSeq: 0,
  omitSecret: false,
}));

const dialect = new PgDialect();

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb: any = {
    execute: async (query: unknown) => {
      const q = dialect.sqlToQuery(query as never);
      const text = q.sql;
      const params = q.params as unknown[];
      if (text.includes("FROM branding_orders")) {
        return { rows: h.order ? [h.order] : [] };
      }
      if (text.includes("UPDATE branding_orders")) {
        h.updates.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  return { ...actual, db: fakeDb };
});

vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: Record<string, any>) => {
          h.createCalls.push(params);
          h.sessionSeq += 1;
          if (params.ui_mode === "embedded_page") {
            return {
              id: `cs_brand_${h.sessionSeq}`,
              url: null,
              client_secret: h.omitSecret ? null : `cs_brand_${h.sessionSeq}_secret`,
            };
          }
          return { id: `cs_brand_${h.sessionSeq}`, url: `https://checkout.example/brand/${h.sessionSeq}` };
        },
      },
    };
  },
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import router from "../branding-shop";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

beforeEach(() => {
  h.order = {
    id: ORDER_ID,
    user_id: USER_ID,
    items: [{ product: "tshirt", size: "M", color: "black", qty: 1, unitPriceCents: 2499 }],
    total_cents: 2499,
    name: "Jane Doe",
    email: "jane@example.com",
    paid: false,
  };
  h.createCalls = [];
  h.updates = [];
  h.sessionSeq = 0;
  h.omitSecret = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function call(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("branding-shop checkout presentation", () => {
  it("hosted (no uiMode): legacy answer — hosted URL, no clientSecret, session bound", async () => {
    const { status, json } = await call("POST", "/branding-shop/checkout", { orderId: ORDER_ID });
    expect(status).toBe(200);
    expect(json.checkoutUrl).toBe("https://checkout.example/brand/1");
    expect(json.clientSecret).toBeNull();
    expect(json.uiMode).toBe("hosted");
    expect(json.orderId).toBe(ORDER_ID);
    const params = h.createCalls[0]!;
    expect(params.ui_mode).toBeUndefined();
    expect(params.success_url).toContain(`order=${ORDER_ID}&paid=1`);
    expect(params.metadata).toMatchObject({ branding_order_id: ORDER_ID, kind: "branding_order" });
    expect(h.updates).toHaveLength(1);
  });

  it("embedded: answers the clientSecret; same recomputed total, metadata and session binding", async () => {
    const { status, json } = await call("POST", "/branding-shop/checkout", { orderId: ORDER_ID, uiMode: "embedded" });
    expect(status).toBe(200);
    expect(json.clientSecret).toBe("cs_brand_1_secret");
    expect(json.checkoutUrl).toBeNull();
    expect(json.uiMode).toBe("embedded");
    const params = h.createCalls[0]!;
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toContain(`order=${ORDER_ID}&paid=1`);
    expect(params.success_url).toBeUndefined();
    expect(params.cancel_url).toBeUndefined();
    /* The server-recomputed total rides the line items, unchanged. */
    expect(params.line_items[0].price_data.unit_amount).toBe(2499);
    expect(params.metadata).toMatchObject({ branding_order_id: ORDER_ID, kind: "branding_order" });
    expect(h.updates).toHaveLength(1);
  });

  it("kill switch off: an embedded ask is answered with the hosted shape", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT", "off");
    const { status, json } = await call("POST", "/branding-shop/checkout", { orderId: ORDER_ID, uiMode: "embedded" });
    expect(status).toBe(200);
    expect(json.uiMode).toBe("hosted");
    expect(json.checkoutUrl).toBe("https://checkout.example/brand/1");
    expect(json.clientSecret).toBeNull();
    expect(h.createCalls[0]!.ui_mode).toBeUndefined();
  });

  it("embedded session without a client secret: 502 and the session is NOT bound to the order", async () => {
    h.omitSecret = true;
    const { status, json } = await call("POST", "/branding-shop/checkout", { orderId: ORDER_ID, uiMode: "embedded" });
    expect(status).toBe(502);
    expect(json.error).toContain("Could not start checkout");
    expect(h.updates).toHaveLength(0);
  });

  it("refusal paths are unchanged with uiMode present: 404 unknown order, 400 already paid", async () => {
    h.order = null;
    const missing = await call("POST", "/branding-shop/checkout", { orderId: ORDER_ID, uiMode: "embedded" });
    expect(missing.status).toBe(404);

    h.order = {
      id: ORDER_ID,
      user_id: USER_ID,
      items: [{ product: "tshirt", size: "M", color: "black", qty: 1, unitPriceCents: 2499 }],
      total_cents: 2499,
      name: "Jane Doe",
      email: "jane@example.com",
      paid: true,
    };
    const paid = await call("POST", "/branding-shop/checkout", { orderId: ORDER_ID, uiMode: "embedded" });
    expect(paid.status).toBe(400);
    expect(h.createCalls).toHaveLength(0);
  });
});
