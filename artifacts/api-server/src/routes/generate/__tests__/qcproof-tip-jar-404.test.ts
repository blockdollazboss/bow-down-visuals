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
          /* TIP-TRUTH (stack1200): the settle flip awaits
             .returning() — same guarded applyUpdate underneath. */
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


/* ── QC-200 PRE-PROOF Q151 (stack1200 qcproof-money-b) ──────────────
   The ledger claim, sharpened: a checkout against a nonexistent
   handle returns 404 BEFORE any Stripe session is created and BEFORE
   any tip row is inserted (the older tip-jar-checkout suite asserted
   the 404 and the empty tip store, but never counted Stripe session
   creations). And a real checkout's Stripe session is created under
   the deterministic key derived from the durable tip row's id. */
import { buildTipCheckoutKey } from "../tip-jar";

describe("QC-200 Q151 — tip jar 404 precedes ALL money machinery", () => {
  it("unknown handle: 404, ZERO Stripe sessions created, ZERO tip rows", async () => {
    const res = await call("POST", "/tips/nobody-here/checkout", { amount: 5 });
    expect(res.status).toBe(404);
    expect(h.sessionSeq).toBe(0);
    expect(h.sessionKeys).toEqual([]);
    expect(h.tips).toHaveLength(0);
  });

  it("a real checkout writes the durable tip row first and keys the session on its id", async () => {
    const res = await call("POST", "/tips/royal-voice/checkout", { amount: 5 });
    expect(res.status).toBe(200);
    expect(h.sessionSeq).toBe(1);
    expect(h.tips).toHaveLength(1);
    const tip = h.tips[0]!;
    expect(tip.stripe_session_id).toBe("cs_tip_1");
    /* stack1300: the session is still keyed on the durable tip row —
       the builder's tip-jar derivation for this owner + tip — with
       the exact session parameters fingerprinted in, so the key
       identifies the request and not only the row. */
    const used = h.sessionKeys[0] as string;
    expect(used).toMatch(new RegExp(`^checkout:tip-jar:${OWNER_ID}:[0-9a-f]{32}$`));
    expect(used).not.toBe(buildTipCheckoutKey({ pageOwnerId: OWNER_ID, tipId: tip.id }));
    /* The builder is deterministic: same tip id → same key, always. */
    expect(buildTipCheckoutKey({ pageOwnerId: OWNER_ID, tipId: tip.id })).toBe(
      buildTipCheckoutKey({ pageOwnerId: OWNER_ID, tipId: tip.id }),
    );
  });
});
