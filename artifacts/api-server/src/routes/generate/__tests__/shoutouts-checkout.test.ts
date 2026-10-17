/**
 * Shoutout checkout (0142, DE-14): priced requests sat at
 * pending_payment forever — no charge existed. Now: checkout creates
 * a real (test-mode) Checkout session and stores its id; verify flips
 * pending_payment → accepted exactly once when the session is paid.
 * Free requests keep the manual flow (checkout refuses them).
 *
 * Fake-db chains mirror creator-profiles-me.test.ts; the Stripe SDK
 * is module-mocked — no network, no real keys.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";

const CREATOR_USER_ID = "33333333-3333-4333-8333-333333333333";
const SETTINGS_ID = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  settings: [] as Array<Record<string, any>>,
  requests: [] as Array<Record<string, any>>,
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
  const { shoutoutSettingsTable, shoutoutRequestsTable } = actual;

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    const { params } = render(cond);
    const key = String(params[0] ?? "");
    if (table === shoutoutSettingsTable) return h.settings.filter((r) => r.id === key);
    if (table === shoutoutRequestsTable) {
      return h.requests.filter((r) => r.id === key || r.creator_user_id === key);
    }
    return [];
  }

  function applyUpdate(table: unknown, patch: Record<string, any>, cond: unknown) {
    if (table !== shoutoutRequestsTable) return [];
    const { params } = render(cond);
    const id = String(params[0] ?? "");
    const row = h.requests.find((r) => r.id === id);
    if (!row) return [];
    /* The verify endpoint's guard: a status param in the WHERE means
       the update only lands while the row still carries that status. */
    const statusGuard = params.find((p) => typeof p === "string" && p === "pending_payment");
    if (statusGuard && row.status !== statusGuard) return [];
    Object.assign(row, patch);
    return [row];
  }

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const chain: any = {
            limit: async () => selectRows(table, cond),
            orderBy: () => ({ limit: async () => selectRows(table, cond) }),
            then: (res: any, rej: any) => Promise.resolve(selectRows(table, cond)).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = {
            id: randomUUID(),
            delivery_url: null,
            stripe_session_id: null,
            paid_at: null,
            delivered_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            ...v,
          };
          h.requests.push(row);
          return [row];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: unknown) => {
          const run = () => applyUpdate(table, patch, cond);
          return {
            returning: async () => run(),
            then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
          };
        },
      }),
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
          return { id: `cs_test_${h.sessionSeq}`, url: `https://checkout.example/${h.sessionSeq}` };
        },
        retrieve: async (id: string) => ({
          id,
          payment_status: h.stripePaid ? "paid" : "unpaid",
          metadata: { type: "shoutout_request" },
        }),
      },
    };
  },
}));

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
    },
  ];
  h.requests = [];
  h.stripePaid = true;
  h.sessionSeq = 0;
});

async function call(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function createRequest(priceCents = 2500) {
  h.settings[0]!["price_cents"] = priceCents;
  const { status, json } = await call("POST", "/shoutouts/requests", {
    creatorId: SETTINGS_ID,
    fanName: "Fan",
    occasion: "Birthday",
    message: "Say happy birthday!",
  });
  expect(status).toBe(201);
  return json.request as { id: string; status: string; priceCents: number };
}

describe("shoutout checkout (0142, DE-14)", () => {
  it("checkout starts a session for a priced request and stores its id", async () => {
    const request = await createRequest();
    const { status, json } = await call("POST", `/shoutouts/requests/${request.id}/checkout`);
    expect(status).toBe(200);
    expect(json.checkoutUrl).toContain("checkout.example");
    expect(h.requests[0]!.stripe_session_id).toBe("cs_test_1");
  });

  it("verify flips pending_payment → accepted exactly once when paid", async () => {
    const request = await createRequest();
    await call("POST", `/shoutouts/requests/${request.id}/checkout`);
    const sessionId = h.requests[0]!.stripe_session_id as string;

    const first = await call("POST", `/shoutouts/requests/${request.id}/checkout/verify`, { sessionId });
    expect(first.json).toMatchObject({ status: "accepted", paid: true });
    expect(h.requests[0]!.status).toBe("accepted");
    expect(h.requests[0]!.paid_at).toBeInstanceOf(Date);

    const again = await call("POST", `/shoutouts/requests/${request.id}/checkout/verify`, { sessionId });
    expect(again.json).toMatchObject({ status: "accepted", paid: true });
    expect(h.requests[0]!.status).toBe("accepted");
  });

  it("verify does not flip an unpaid session", async () => {
    const request = await createRequest();
    await call("POST", `/shoutouts/requests/${request.id}/checkout`);
    h.stripePaid = false;
    const { json } = await call("POST", `/shoutouts/requests/${request.id}/checkout/verify`, {
      sessionId: h.requests[0]!.stripe_session_id,
    });
    expect(json.paid).toBe(false);
    expect(h.requests[0]!.status).toBe("pending_payment");
  });

  it("verify rejects a session that doesn't match the request", async () => {
    const request = await createRequest();
    await call("POST", `/shoutouts/requests/${request.id}/checkout`);
    const { status } = await call("POST", `/shoutouts/requests/${request.id}/checkout/verify`, {
      sessionId: "cs_test_someone_elses",
    });
    expect(status).toBe(400);
    expect(h.requests[0]!.status).toBe("pending_payment");
  });

  it("free requests refuse checkout — the manual flow stands", async () => {
    const request = await createRequest(0);
    const { status, json } = await call("POST", `/shoutouts/requests/${request.id}/checkout`);
    expect(status).toBe(400);
    expect(json.error).toContain("free");
  });

  it("an already-accepted request can't check out again", async () => {
    const request = await createRequest();
    h.requests[0]!.status = "accepted";
    const { status } = await call("POST", `/shoutouts/requests/${request.id}/checkout`);
    expect(status).toBe(409);
  });
});
