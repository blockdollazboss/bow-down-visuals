/**
 * Creators-list paymentsLive truth (stack1500 cleanup of the flag the
 * parity wave-4b trio flagged): GET /api/shoutouts/creators hardcoded
 * `paymentsLive: false` with a "v1 honesty" comment from before payment
 * processing shipped. Priced requests have settled through the embedded
 * checkout rail since 0142, so the flag lied on every response. It now
 * derives from the configured rail — the same truth the checkout
 * endpoint enforces (503 when no Stripe key is set), mirroring the tip
 * jar's paymentsConfigured() pins from stack1400.
 *
 * These pins hold BOTH directions: live when the rail is configured,
 * NOT live when it is not — a flag fix must never dress a dead rail up
 * as live. The first test fails against the old hardcoded false.
 *
 * Fake-db chains mirror shoutouts-checkout.test.ts; no network, no
 * real keys.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const CREATOR_USER_ID = "33333333-3333-4333-8333-333333333333";
const SETTINGS_ID = "44444444-4444-4444-8444-444444444444";
const QUIET_ID = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  settings: [] as Array<Record<string, any>>,
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { shoutoutSettingsTable } = actual;

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    if (table !== shoutoutSettingsTable) return [];
    const { params } = render(cond);
    const key = String(params[0] ?? "");
    /* The creators list filters on accepting; the settings/request
       flows look rows up by id or owner. Honor both shapes. */
    return h.settings.filter(
      (r) => r.accepting === key || r.id === key || r.user_id === key,
    );
  }

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => selectRows(table, cond);
          const chain: any = {
            limit: async () => rows(),
            orderBy: () => ({ limit: async () => rows() }),
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
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "test-model"),
}));

vi.mock("../../../lib/objectStorage", () => ({
  normalizeToStorageRef: (v: string) => v,
  refreshSupabaseStorageUrl: async (v: string) => v,
}));

vi.mock("../../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: string) => v,
}));

import router from "../shoutouts";

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
  h.settings = [
    {
      id: SETTINGS_ID,
      user_id: CREATOR_USER_ID,
      display_name: "Royal Voice",
      price_cents: 2500,
      turnaround_days: 3,
      guidelines: "",
      accepting: "true",
      updated_at: new Date(),
    },
    {
      id: QUIET_ID,
      user_id: "66666666-6666-4666-8666-666666666666",
      display_name: "Quiet Creator",
      price_cents: 1000,
      turnaround_days: 5,
      guidelines: "",
      accepting: "false",
      updated_at: new Date(),
    },
  ];
});

async function call(method: string, path: string) {
  const r = await realFetch(`${baseUrl}${path}`, { method });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("GET /shoutouts/creators paymentsLive truth", () => {
  it("reports live when the payment rail is configured", async () => {
    const { status, json } = await call("GET", "/shoutouts/creators");
    expect(status).toBe(200);
    expect(json.paymentsLive).toBe(true);
  });

  it("still lists only accepting creators alongside the flag", async () => {
    const { status, json } = await call("GET", "/shoutouts/creators");
    expect(status).toBe(200);
    expect(json.creators.map((c: any) => c.displayName)).toEqual(["Royal Voice"]);
  });

  it("reports NOT live when the rail is not configured", async () => {
    const savedKey = process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_SECRET_KEY"];
    try {
      const { status, json } = await call("GET", "/shoutouts/creators");
      expect(status).toBe(200);
      expect(json.paymentsLive).toBe(false);
      /* The list itself is free and public — it keeps serving; only
         the payment claim drops. */
      expect(json.creators).toHaveLength(1);
    } finally {
      if (savedKey !== undefined) process.env["STRIPE_SECRET_KEY"] = savedKey;
    }
  });
});
