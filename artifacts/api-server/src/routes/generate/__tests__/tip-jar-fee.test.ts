/**
 * Item 19 (stack800 Lane 1, Group D) — tip-jar fee math pin.
 *
 * The never-run gate leg asks for the money tip's platform split,
 * pinned to the cent. Inventory finding (flagged in the lane notes):
 * there is NO fee split on this rail — no split function, no fee
 * constant, and the checkout session (tip-jar.ts, POST
 * /tips/:handle/checkout) is created with no application_fee_amount,
 * no payment_intent_data and no transfer_data. lib/one-tip-jar.ts
 * covers the separate VB/USD jar merge, not money fees, and the
 * existing tip-jar-checkout.test.ts fake Stripe discards the session
 * params, so the fee shape was never pinned.
 *
 * This file pins the code's own truth, to the cent: the fan is
 * charged the full tip, the durable tip row records the full tip,
 * and the platform split on this rail today is exactly 0 — the
 * session carries no fee fields at all. If a tip fee is ever ruled,
 * this pin is the test that must change first.
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
  createParams: null as any,
  createOptions: null as any,
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
        create: async (params: any, options: any) => {
          h.sessionSeq += 1;
          h.createParams = params;
          h.createOptions = options;
          return { id: `cs_tipfee_${h.sessionSeq}`, url: `https://checkout.example/tipfee/${h.sessionSeq}` };
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
  h.createParams = null;
  h.createOptions = null;
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

describe("item 19 — tip-jar fee math: the session carries NO platform split", () => {
  it.each([
    // [tipDollars, expectedCents]
    [10, 1000],
    [25, 2500],
    [4.99, 499], // odd cents: dollars→cents rounds to 499, charged in full
    [1.01, 101], // just above the $1 minimum — another odd-cent full charge
  ])("a $%s tip charges %i¢ in full — unit_amount is the whole tip", async (dollars, cents) => {
    const { status, json } = await call("POST", "/tips/royal-voice/checkout", {
      amount: dollars,
      fanName: "Big Fan",
      message: "Love the show!",
    });
    expect(status).toBe(200);
    expect(json.checkoutUrl).toContain("checkout.example");

    const params = h.createParams;
    expect(params.mode).toBe("payment");
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].price_data.unit_amount).toBe(cents);
    expect(params.line_items[0].price_data.currency).toBe("usd");
    expect(params.line_items[0].quantity).toBe(1);
    expect(params.metadata).toMatchObject({ type: "tip_jar", tipId: json.tipId });

    /* The split, to the cent: platform fee = 0 because the session
       carries no fee mechanism at all — no application fee, no
       payment-intent fee data, no destination transfer split. */
    expect(params.application_fee_amount).toBeUndefined();
    expect(params.payment_intent_data).toBeUndefined();
    expect(params.transfer_data).toBeUndefined();
    expect(params.on_behalf_of).toBeUndefined();
    const platformFeeCents = params.application_fee_amount ?? 0;
    const creatorSideCents = params.line_items[0].price_data.unit_amount - platformFeeCents;
    expect(platformFeeCents).toBe(0);
    expect(creatorSideCents).toBe(cents);

    /* The durable tip row records the same full amount — nothing is
       shaved between the fan's charge and the creator's record. */
    expect(h.tips).toHaveLength(1);
    expect(h.tips[0]).toMatchObject({ amount_cents: cents, status: "pending_payment" });
  });

  it("verify settles the tip at the full recorded amount — no fee appears at settle time either", async () => {
    await call("POST", "/tips/royal-voice/checkout", { amount: 25, fanName: "Fan", message: "" });
    const { json } = await call("POST", "/tips/checkout/verify", { sessionId: "cs_tipfee_1" });
    expect(json).toMatchObject({ status: "paid", amountCents: 2500 });
    expect(h.tips[0]!.status).toBe("paid");
    expect(h.tips[0]!.amount_cents).toBe(2500);
  });
});
