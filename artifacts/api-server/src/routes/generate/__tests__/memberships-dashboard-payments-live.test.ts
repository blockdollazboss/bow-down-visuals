/**
 * Memberships dashboard paymentsLive truth (Stack 200 Lane C item 1):
 * GET /api/memberships/dashboard hardcoded `paymentsLive: true` with a
 * TEST-mode comment, claiming payments are live regardless of whether
 * the Stripe rail is configured — while its sibling surfaces (tip jar,
 * shoutouts creators list + revenue) derive the flag from the
 * configured rail via paymentsConfigured(). The dashboard now derives
 * it the same way.
 *
 * These pins hold BOTH directions: live when the rail is configured,
 * NOT live when it is not — a flag fix must never dress a dead rail up
 * as live. Fake-db chains mirror shoutouts-creators-payments-live;
 * no network, no real keys.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const CREATOR_USER_ID = "33333333-3333-4333-8333-333333333333";
const TIER_ID = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  members: [] as Array<Record<string, any>>,
  tiers: [] as Array<Record<string, any>>,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { fanMembersTable, fanTiersTable } = actual;

  function rowsFor(table: unknown): Array<Record<string, any>> {
    if (table === fanMembersTable) return h.members;
    if (table === fanTiersTable) return h.tiers;
    return [];
  }

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = () => rowsFor(table);
          const chain: any = {
            orderBy: () => ({
              then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
            }),
            limit: async () => rows(),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        }),
      }),
    }),
    delete: () => ({ where: async () => [] }),
  };
  return { ...actual, db: fakeDb };
});

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = CREATOR_USER_ID;
    req.userCredits = 0;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
    const ck = typeof clientKey === "string" && clientKey.trim().length >= 8 ? clientKey.trim() : null;
    return ck ? `${scope}:${userId}:client:${ck}` : `${scope}:${userId}:${JSON.stringify(intent ?? {})}`;
  },
  voidChargeIdempotencyKey: async () => {},
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "test-model"),
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

vi.mock("../../../lib/payment-record", () => ({
  recordCreditUsage: vi.fn(),
}));

import router from "../memberships";

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
  h.tiers = [
    { id: TIER_ID, user_id: CREATOR_USER_ID, name: "Gold", sort_order: 0 },
  ];
  h.members = [
    {
      id: "55555555-5555-4555-8555-555555555555",
      user_id: CREATOR_USER_ID,
      tier_id: TIER_ID,
      status: "active",
      fan_user_id: null,
      price_cents: 500,
      trial_ends_at: null,
      current_period_end: null,
      paused_at: null,
      paused_until: null,
    },
  ];
});

async function call(method: string, path: string) {
  const r = await realFetch(`${baseUrl}${path}`, { method });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("GET /memberships/dashboard paymentsLive truth (stack200 C1)", () => {
  it("reports live when the payment rail is configured", async () => {
    const { status, json } = await call("GET", "/memberships/dashboard");
    expect(status).toBe(200);
    expect(json.paymentsLive).toBe(true);
    /* The dashboard sums still come from real tracked rows. */
    expect(json.activeMembers).toBe(1);
    expect(json.mrrCents).toBe(500);
  });

  it("reports NOT live when the rail is not configured", async () => {
    const savedKey = process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_SECRET_KEY"];
    try {
      const { status, json } = await call("GET", "/memberships/dashboard");
      expect(status).toBe(200);
      expect(json.paymentsLive).toBe(false);
      /* The dashboard itself is a free read — it keeps serving; only
         the payment claim drops. */
      expect(json.activeMembers).toBe(1);
      expect(json.mrrCents).toBe(500);
    } finally {
      if (savedKey !== undefined) process.env["STRIPE_SECRET_KEY"] = savedKey;
    }
  });
});
