/**
 * QC-200 PRE-PROOF Q152 (stack1200 qcproof-money-b) — shoutouts.
 *
 * shoutouts-checkout.test.ts already pins the core claim: a priced
 * request sits in pending_payment, verify flips it to accepted
 * exactly once under the status guard, an unpaid session flips
 * nothing, and a mismatched session is refused. The two ledger
 * claims no suite exercised:
 *  1. DETERMINISTIC CHECKOUT KEY — the Stripe session is created
 *     under buildShoutoutCheckoutKey for the durable request row,
 *     and a repeat checkout for the same still-pending request
 *     reuses the SAME key (Stripe then returns the same session
 *     instead of minting a second payable one).
 *  2. `refunded` IS TERMINAL + SYSTEM-ONLY — it is not one of the
 *     user-facing REQUEST_STATUSES (the PATCH zod schema rejects
 *     it with a 400 and the row does not move), no user transition
 *     targets it from any state, and a refunded request transitions
 *     nowhere. Only the clawback engine writes it, directly.
 *
 * Harness mirrors shoutouts-checkout.test.ts, extended to record
 * the idempotency keys the Stripe fake receives.
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
  sessionKeys: [] as Array<unknown>,
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
    if (table === shoutoutSettingsTable) return h.settings.filter((r) => r.id === key || r.user_id === key);
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
        create: async (_params: unknown, opts?: { idempotencyKey?: string }) => {
          h.sessionSeq += 1;
          h.sessionKeys.push(opts?.idempotencyKey ?? null);
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
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

vi.mock("../../../lib/objectStorage", () => ({
  normalizeToStorageRef: (v: string) => v,
  refreshSupabaseStorageUrl: async (v: string) => v,
}));

vi.mock("../../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: string) => v,
}));

import router, { buildShoutoutCheckoutKey, canTransition, REQUEST_STATUSES } from "../shoutouts";

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
  h.sessionKeys = [];
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

describe("QC-200 Q152 — deterministic checkout key", () => {
  it("the session is created under buildShoutoutCheckoutKey for the durable request, and a repeat checkout reuses the SAME key", async () => {
    const request = await createRequest();
    expect(request.status).toBe("pending_payment");

    const first = await call("POST", `/shoutouts/requests/${request.id}/checkout`);
    expect(first.status).toBe(200);
    /* stack1300: the route's key is the builder's derivation WITH the
       exact session parameters fingerprinted in — same builder, same
       rail/member shape, but not the bare intent-only key (that key
       is what Stripe refused whenever parameters changed under it). */
    const legacy = buildShoutoutCheckoutKey({
      creatorUserId: CREATOR_USER_ID,
      requestId: request.id,
      priceCents: 2500,
    });
    expect(h.sessionKeys).toHaveLength(1);
    const used = h.sessionKeys[0] as string;
    expect(used).toMatch(/^checkout:shoutout-request:.+:[0-9a-f]{32}$/);
    expect(used).not.toBe(legacy);

    /* Still pending (nobody paid yet): a double-click / lost response
       retries the checkout — same intent, same parameters, same key,
       so Stripe hands back the original session instead of a second
       payable one. */
    const again = await call("POST", `/shoutouts/requests/${request.id}/checkout`);
    expect(again.status).toBe(200);
    expect(h.sessionKeys).toEqual([used, used]);
    expect(h.requests[0]!.status).toBe("pending_payment");
  });

  it("the key is deterministic in its inputs and sensitive to the price", () => {
    const a = buildShoutoutCheckoutKey({ creatorUserId: CREATOR_USER_ID, requestId: "req-1", priceCents: 2500 });
    const b = buildShoutoutCheckoutKey({ creatorUserId: CREATOR_USER_ID, requestId: "req-1", priceCents: 2500 });
    const dearer = buildShoutoutCheckoutKey({ creatorUserId: CREATOR_USER_ID, requestId: "req-1", priceCents: 2600 });
    const other = buildShoutoutCheckoutKey({ creatorUserId: CREATOR_USER_ID, requestId: "req-2", priceCents: 2500 });
    expect(a).toBe(b);
    expect(a).not.toBe(dearer);
    expect(a).not.toBe(other);
  });
});

describe("QC-200 Q152 — `refunded` is a terminal, system-only state", () => {
  it("no user transition targets `refunded`, and a refunded request transitions nowhere", () => {
    const all = [...REQUEST_STATUSES, "refunded"] as const;
    for (const from of all) {
      expect(canTransition(from, "refunded" as never)).toBe(false);
    }
    for (const to of all) {
      expect(canTransition("refunded" as never, to as never)).toBe(false);
    }
    expect(REQUEST_STATUSES as readonly string[]).not.toContain("refunded");
  });

  it("the user PATCH door refuses `refunded` outright (400) and the row does not move", async () => {
    const request = await createRequest();
    const res = await call("PATCH", `/shoutouts/requests/${request.id}`, { status: "refunded" });
    expect(res.status).toBe(400);
    expect(h.requests[0]!.status).toBe("pending_payment");
  });

  it("even a request already in `refunded` cannot be moved by a user PATCH", async () => {
    const request = await createRequest();
    h.requests[0]!.status = "refunded"; /* as the clawback engine would write it, directly */
    const res = await call("PATCH", `/shoutouts/requests/${request.id}`, { status: "accepted" });
    expect(res.status).toBe(409);
    expect(h.requests[0]!.status).toBe("refunded");
  });
});
