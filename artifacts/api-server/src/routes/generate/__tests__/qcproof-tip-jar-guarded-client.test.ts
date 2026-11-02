/**
 * QC-200 PRE-PROOF Q151 residual (stack1200 qcproof-money-b) —
 * the GUARDED Stripe client fails closed on the tip-jar rail.
 *
 * Banked qcproof-tip-jar-404 pins the 404-before-Stripe leg and the
 * deterministic session key; stripe-guards pins the guarded client
 * itself (missing key / live key both throw). What no suite pinned:
 * the tip-jar ROUTES turn that throw into a 503 BEFORE any money
 * machinery moves — checkout inserts no tip row and creates no
 * session, and verify flips nothing (the tip stays pending_payment)
 * when payments are not configured or a live key is configured.
 *
 * Harness mirrors qcproof-tip-jar-404.test.ts; the only difference
 * is that these tests mutate STRIPE_SECRET_KEY, which the guarded
 * client (lib/stripe-client) reads at call time.
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
  sessionKeys: [] as Array<unknown>,
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
          returning: async () => applyUpdate(table, patch, cond),
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
        create: async (_params: unknown, opts?: { idempotencyKey?: string }) => {
          h.sessionSeq += 1;
          h.sessionKeys.push(opts?.idempotencyKey ?? null);
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
  h.sessionKeys = [];
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
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
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
});

async function call(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("QC-200 Q151 residual — the guarded client fails closed on the tip-jar rail", () => {
  it("checkout with NO Stripe key: 503, zero sessions, zero tip rows", async () => {
    delete process.env["STRIPE_SECRET_KEY"];
    const res = await call("POST", "/tips/royal-voice/checkout", { amount: 5 });
    expect(res.status).toBe(503);
    expect(res.json.error).toContain("not configured");
    expect(h.sessionSeq).toBe(0);
    expect(h.tips).toHaveLength(0);
  });

  it("checkout with a LIVE key: 503 the same way — test mode only, nothing moves", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_fake";
    const res = await call("POST", "/tips/royal-voice/checkout", { amount: 5 });
    expect(res.status).toBe(503);
    expect(h.sessionSeq).toBe(0);
    expect(h.tips).toHaveLength(0);
  });

  it("verify with NO Stripe key: 503 and the tip stays pending_payment; restoring the key lets the same verify land", async () => {
    const co = await call("POST", "/tips/royal-voice/checkout", { amount: 5 });
    expect(co.status).toBe(200);
    expect(h.tips).toHaveLength(1);
    expect(h.tips[0]!.status).toBe("pending_payment");
    const sessionId = h.tips[0]!.stripe_session_id as string;

    delete process.env["STRIPE_SECRET_KEY"];
    const refused = await call("POST", "/tips/checkout/verify", { sessionId });
    expect(refused.status).toBe(503);
    expect(h.tips[0]!.status).toBe("pending_payment");
    expect(h.tips[0]!.paid_at).toBeNull();

    process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
    const landed = await call("POST", "/tips/checkout/verify", { sessionId });
    expect(landed.status).toBe(200);
    expect(landed.json.status).toBe("paid");
    expect(h.tips[0]!.status).toBe("paid");
  });
});
