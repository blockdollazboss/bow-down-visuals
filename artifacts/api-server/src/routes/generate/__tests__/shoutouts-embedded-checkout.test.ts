/**
 * Shoutout EMBEDDED checkout (stack1200 hosted-checkout sweep):
 * POST /shoutouts/requests/:id/checkout accepts uiMode: "embedded"
 * (gated on the EMBEDDED_CHECKOUT kill switch) and creates the SAME
 * session in embedded_page ui_mode — same amount, metadata and
 * buildShoutoutCheckoutKey idempotency — answering clientSecret with
 * checkoutUrl null. Hosted stays the default; verify is unchanged.
 *
 * Harness mirrors shoutouts-checkout.test.ts; the Stripe fake records
 * create params/options and answers like the real API (embedded →
 * client_secret, no url; hosted → url).
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
  createCalls: [] as Array<{ params: Record<string, any>; options: any }>,
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
          /* The checkout door awaits .where(...) directly (no
             .returning); verify awaits .returning. Both must apply. */
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
        create: async (params: Record<string, any>, options: any) => {
          h.sessionSeq += 1;
          h.createCalls.push({ params, options });
          const id = `cs_test_${h.sessionSeq}`;
          if (params.ui_mode === "embedded_page") {
            return { id, url: null, client_secret: `${id}_secret` };
          }
          return { id, url: `https://checkout.example/${h.sessionSeq}` };
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
  h.createCalls = [];
  delete process.env["EMBEDDED_CHECKOUT"];
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

describe("shoutout embedded checkout (sweep)", () => {
  it("embedded ask answers clientSecret + checkoutUrl null and stores the session id", async () => {
    const request = await createRequest();
    const { status, json } = await call("POST", `/shoutouts/requests/${request.id}/checkout`, { uiMode: "embedded" });
    expect(status).toBe(200);
    expect(json.checkoutUrl).toBeNull();
    expect(json.clientSecret).toBe("cs_test_1_secret");
    expect(json.uiMode).toBe("embedded");
    expect(json.sessionId).toBe("cs_test_1");
    expect(h.requests[0]!.stripe_session_id).toBe("cs_test_1");
    const { params } = h.createCalls[0]!;
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toContain(`/shoutouts?request=${request.id}&session_id={CHECKOUT_SESSION_ID}`);
    expect(params.success_url).toBeUndefined();
    expect(params.cancel_url).toBeUndefined();
  });

  it("embedded and hosted create the identical session but for presentation (same key, amount, metadata)", async () => {
    const request = await createRequest();
    await call("POST", `/shoutouts/requests/${request.id}/checkout`, { uiMode: "embedded" });
    /* Same still-pending request, hosted shape: the durable intent
       is identical, so the idempotency key must be too. */
    await call("POST", `/shoutouts/requests/${request.id}/checkout`);
    const [emb, host] = h.createCalls;
    const strip = (p: Record<string, any>) => {
      const { ui_mode, return_url, success_url, cancel_url, ...rest } = p;
      return rest;
    };
    expect(strip(emb!.params)).toEqual(strip(host!.params));
    expect(emb!.params.line_items[0].price_data.unit_amount).toBe(2500);
    expect(emb!.params.metadata).toEqual({ type: "shoutout_request", requestId: request.id });
    expect(host!.params.success_url).toContain("/shoutouts?request=");
    expect(emb!.options.idempotencyKey).toBeTruthy();
    expect(emb!.options.idempotencyKey).toBe(host!.options.idempotencyKey);
  });

  it("hosted stays the default and the explicit shape", async () => {
    const request = await createRequest();
    const dflt = await call("POST", `/shoutouts/requests/${request.id}/checkout`);
    expect(dflt.json.checkoutUrl).toContain("checkout.example");
    expect(dflt.json.clientSecret).toBeUndefined();
    expect(h.createCalls[0]!.params.ui_mode).toBeUndefined();
    expect(h.createCalls[0]!.params.success_url).toContain("/shoutouts?request=");

    const request2 = await createRequest();
    const expl = await call("POST", `/shoutouts/requests/${request2.id}/checkout`, { uiMode: "hosted" });
    expect(expl.json.checkoutUrl).toContain("checkout.example");
    expect(h.createCalls[1]!.params.ui_mode).toBeUndefined();
  });

  it("EMBEDDED_CHECKOUT=off forces hosted even when embedded is asked", async () => {
    process.env["EMBEDDED_CHECKOUT"] = "off";
    const request = await createRequest();
    const { status, json } = await call("POST", `/shoutouts/requests/${request.id}/checkout`, { uiMode: "embedded" });
    expect(status).toBe(200);
    expect(json.checkoutUrl).toContain("checkout.example");
    expect(json.clientSecret).toBeUndefined();
    expect(h.createCalls[0]!.params.ui_mode).toBeUndefined();
  });

  it("unknown uiMode is a 400 and no session is created", async () => {
    const request = await createRequest();
    const { status } = await call("POST", `/shoutouts/requests/${request.id}/checkout`, { uiMode: "popup" });
    expect(status).toBe(400);
    expect(h.createCalls).toHaveLength(0);
    expect(h.requests[0]!.stripe_session_id).toBeNull();
  });

  it("an embedded session still verifies into accepted exactly once", async () => {
    const request = await createRequest();
    await call("POST", `/shoutouts/requests/${request.id}/checkout`, { uiMode: "embedded" });
    const sessionId = h.requests[0]!.stripe_session_id as string;
    const first = await call("POST", `/shoutouts/requests/${request.id}/checkout/verify`, { sessionId });
    expect(first.json).toMatchObject({ status: "accepted", paid: true });
    expect(h.requests[0]!.status).toBe("accepted");
  });
});
