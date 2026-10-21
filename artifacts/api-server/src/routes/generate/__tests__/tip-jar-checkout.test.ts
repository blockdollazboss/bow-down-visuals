/**
 * Tip jar real checkout (0142, DE-14): the in-memory intent flow is
 * unchanged, but a fan can now actually pay — checkout records a
 * durable tip_jar_tips row + opens a Checkout session; verify flips
 * the row to "paid" exactly once (stripe_session_id is UNIQUE, the
 * status guard makes replays no-ops).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";

const OWNER_ID = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  tips: [] as Array<Record<string, any>>,
  stripePaid: true,
  sessionSeq: 0,
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
        create: async () => {
          h.sessionSeq += 1;
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
  __resetTipJarStores();
  const { status } = await call("POST", "/tips/settings", {
    handle: "royal-voice",
    displayName: "Royal Voice",
    message: "Thanks for the love!",
    suggestedAmounts: [5, 10, 25],
  });
  expect(status).toBe(200);
});

async function call(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("tip jar checkout (0142, DE-14)", () => {
  it("checkout records a durable tip row and returns the session URL", async () => {
    const { status, json } = await call("POST", "/tips/royal-voice/checkout", {
      amount: 10,
      fanName: "Big Fan",
      message: "Love the show!",
    });
    expect(status).toBe(200);
    expect(json.checkoutUrl).toContain("checkout.example");
    expect(h.tips).toHaveLength(1);
    expect(h.tips[0]).toMatchObject({
      page_user_id: OWNER_ID,
      handle: "royal-voice",
      amount_cents: 1000,
      status: "pending_payment",
      stripe_session_id: "cs_tip_1",
    });
  });

  it("verify marks the tip paid exactly once", async () => {
    await call("POST", "/tips/royal-voice/checkout", { amount: 25, fanName: "Fan", message: "" });
    const first = await call("POST", "/tips/checkout/verify", { sessionId: "cs_tip_1" });
    expect(first.json).toMatchObject({ status: "paid", amountCents: 2500 });
    expect(h.tips[0]!.status).toBe("paid");
    expect(h.tips[0]!.paid_at).toBeInstanceOf(Date);

    const again = await call("POST", "/tips/checkout/verify", { sessionId: "cs_tip_1" });
    expect(again.json.status).toBe("paid");
    expect(h.tips).toHaveLength(1);
  });

  it("verify leaves an unpaid session pending", async () => {
    await call("POST", "/tips/royal-voice/checkout", { amount: 5, fanName: "Fan", message: "" });
    h.stripePaid = false;
    const { json } = await call("POST", "/tips/checkout/verify", { sessionId: "cs_tip_1" });
    expect(json.paid).toBe(false);
    expect(h.tips[0]!.status).toBe("pending_payment");
  });

  it("checkout 404s for an unknown handle and validates amounts", async () => {
    const missing = await call("POST", "/tips/nobody/checkout", { amount: 5 });
    expect(missing.status).toBe(404);
    const bad = await call("POST", "/tips/royal-voice/checkout", { amount: 0 });
    expect(bad.status).toBe(400);
    expect(h.tips).toHaveLength(0);
  });

  it("the public page now reports payments live when configured", async () => {
    const { status, json } = await call("GET", "/tips/page/royal-voice");
    expect(status).toBe(200);
    expect(json.paymentsLive).toBe(true);
    expect(json.notice).toContain("charged securely");
  });
});
