/**
 * Tip jar EMBEDDED checkout (World money-parity server lane):
 * POST /api/tips/:handle/checkout accepts uiMode — an embedded ask
 * creates the same session in embedded_page ui_mode and answers a
 * clientSecret (no hosted URL) so the World PortraitTip mounts the
 * payment form in-panel; the hosted answer keeps the legacy shape,
 * and the EMBEDDED_CHECKOUT kill switch forces it. Harness mirrors
 * tip-jar-checkout.test.ts; the FakeStripe records create params and
 * answers the way real Stripe does per ui_mode.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";

const OWNER_ID = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  tips: [] as Array<Record<string, any>>,
  stripePaid: true,
  sessionSeq: 0,
  createCalls: [] as Array<Record<string, any>>,
  omitSecret: false,
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { tipJarTipsTable, creatorProfilesTable } = actual;

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    const { params } = render(cond);
    const key = String(params[0] ?? "");
    if (table === tipJarTipsTable) {
      return h.tips.filter((r) => r.stripe_session_id === key || r.id === key);
    }
    if (table === creatorProfilesTable) return [];
    return [];
  }

  function applyUpdate(table: unknown, patch: Record<string, any>, cond: unknown) {
    if (table !== tipJarTipsTable) return [];
    const { params } = render(cond);
    const row = h.tips.find((r) => params.includes(r.id) || params.includes(r.stripe_session_id));
    if (!row) return [];
    const statusGuard = params.find((p) => p === "pending_payment");
    if (statusGuard && row.status !== statusGuard) return [];
    Object.assign(row, patch);
    return [row];
  }

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => selectRows(table, cond);
          return {
            limit: async () => rows(),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = {
            id: randomUUID(),
            stripe_session_id: null,
            paid_at: null,
            created_at: new Date(),
            ...v,
          };
          h.tips.push(row);
          return [row];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: unknown) => ({
          then: (res: any, rej: any) => Promise.resolve(applyUpdate(table, patch, cond)).then(res, rej),
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        const { params } = render(cond);
        h.tips = h.tips.filter((r) => !params.includes(r.id));
      },
    }),
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
              id: `cs_tip_${h.sessionSeq}`,
              url: null,
              client_secret: h.omitSecret ? null : `cs_tip_${h.sessionSeq}_secret`,
            };
          }
          return { id: `cs_tip_${h.sessionSeq}`, url: `https://checkout.example/tip/${h.sessionSeq}` };
        },
        retrieve: async (id: string) => ({
          id,
          payment_status: h.stripePaid ? "paid" : "unpaid",
          metadata: { type: "tip_jar" },
        }),
      },
    };
  },
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = OWNER_ID;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import router, { __resetTipJarStores } from "../tip-jar";

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

beforeEach(async () => {
  h.tips = [];
  h.stripePaid = true;
  h.sessionSeq = 0;
  h.createCalls = [];
  h.omitSecret = false;
  __resetTipJarStores();
  const { status } = await call("POST", "/tips/settings", {
    handle: "royal-voice",
    displayName: "Royal Voice",
    message: "Thanks for the love!",
    suggestedAmounts: [5, 10, 25],
  });
  expect(status).toBe(200);
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

describe("tip jar checkout presentation", () => {
  it("hosted (no uiMode): legacy answer — hosted URL, no clientSecret", async () => {
    const { status, json } = await call("POST", "/tips/royal-voice/checkout", {
      amount: 10,
      fanName: "Big Fan",
      message: "Love the show!",
    });
    expect(status).toBe(200);
    expect(json.checkoutUrl).toContain("checkout.example");
    expect(json.clientSecret).toBeNull();
    expect(json.uiMode).toBe("hosted");
    const params = h.createCalls[0]!;
    expect(params.ui_mode).toBeUndefined();
    expect(params.success_url).toContain("/tips/royal-voice");
    expect(params.metadata).toEqual({ type: "tip_jar", tipId: json.tipId });
    expect(h.tips[0]).toMatchObject({ amount_cents: 1000, status: "pending_payment", stripe_session_id: "cs_tip_1" });
  });

  it("embedded: answers the clientSecret, creates the session in embedded_page ui_mode", async () => {
    const { status, json } = await call("POST", "/tips/royal-voice/checkout", {
      amount: 10,
      fanName: "Big Fan",
      message: "Love the show!",
      uiMode: "embedded",
    });
    expect(status).toBe(200);
    expect(json.clientSecret).toBe("cs_tip_1_secret");
    expect(json.checkoutUrl).toBeNull();
    expect(json.uiMode).toBe("embedded");
    const params = h.createCalls[0]!;
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toContain("/tips/royal-voice?session_id={CHECKOUT_SESSION_ID}");
    expect(params.success_url).toBeUndefined();
    expect(params.cancel_url).toBeUndefined();
    expect(params.metadata).toEqual({ type: "tip_jar", tipId: json.tipId });
    expect(params.line_items[0].price_data.unit_amount).toBe(1000);
    expect(h.tips[0]).toMatchObject({ status: "pending_payment", stripe_session_id: "cs_tip_1" });

    /* The success flow is unchanged: verify flips the tip paid once. */
    const v = await call("POST", "/tips/checkout/verify", { sessionId: "cs_tip_1" });
    expect(v.json).toMatchObject({ status: "paid", amountCents: 1000 });
    expect(h.tips[0]!.status).toBe("paid");
  });

  it("kill switch off: an embedded ask is answered with the hosted shape", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT", "off");
    const { status, json } = await call("POST", "/tips/royal-voice/checkout", {
      amount: 10,
      fanName: "Fan",
      message: "",
      uiMode: "embedded",
    });
    expect(status).toBe(200);
    expect(json.uiMode).toBe("hosted");
    expect(json.checkoutUrl).toContain("checkout.example");
    expect(json.clientSecret).toBeNull();
    expect(h.createCalls[0]!.ui_mode).toBeUndefined();
  });

  it("embedded session without a client secret fails the creation and drops the orphan tip row", async () => {
    h.omitSecret = true;
    const { status, json } = await call("POST", "/tips/royal-voice/checkout", {
      amount: 10,
      fanName: "Fan",
      message: "",
      uiMode: "embedded",
    });
    expect(status).toBe(502);
    expect(json.error).toContain("Could not start checkout");
    expect(h.tips).toHaveLength(0);
  });

  it("refusal paths are unchanged with uiMode present: 404 unknown handle, 400 bad amount", async () => {
    const missing = await call("POST", "/tips/nobody/checkout", { amount: 5, uiMode: "embedded" });
    expect(missing.status).toBe(404);
    const bad = await call("POST", "/tips/royal-voice/checkout", { amount: 0, uiMode: "embedded" });
    expect(bad.status).toBe(400);
    expect(h.tips).toHaveLength(0);
    expect(h.createCalls).toHaveLength(0);
  });
});
