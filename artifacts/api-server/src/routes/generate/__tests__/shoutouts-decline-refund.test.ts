/**
 * Decline refund (stack1400 ruling #15, Y3): when a creator declines
 * a PAID shoutout request, the fan is refunded in full, automatically,
 * as part of the decline. Pins:
 *   - paid decline → exactly one full Stripe refund on the request's
 *     checkout session (house rail idempotency key refund:<session>),
 *     the request lands in 'refunded', THEN the decline email goes
 *     out stating the full refund;
 *   - unpaid declines (free, or priced-but-never-paid) behave exactly
 *     as before — no refund attempt, no money language in the copy;
 *   - a double-decline / replay cannot refund or email twice;
 *   - a failed refund does not fake success: the decline doesn't
 *     land, the state stays recoverable, no email claims a refund,
 *     and a retry completes the decline with one landed refund.
 * Fake-db idiom mirrors shoutouts-fanout.test.ts, with the status
 * guard generalized (any status param in the WHERE is a guard).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const CREATOR_USER_ID = "11111111-1111-4111-8111-111111111111";
const SETTINGS_ID = "22222222-2222-4222-8222-222222222222";
const KNOWN_STATUSES = ["pending_payment", "accepted", "in_progress", "delivered", "declined", "refunded"];

const h = vi.hoisted(() => ({
  settings: [] as Array<Record<string, any>>,
  requests: [] as Array<Record<string, any>>,
  stripePaid: true,
  sessionSeq: 0,
  paymentIntentId: "pi_test_1" as string | null,
  refundFails: false,
  refundCalls: [] as Array<{ params: any; opts: any }>,
  refundSuccesses: 0,
}));

function render(cond: unknown): { sql: string; params: unknown[] } {
  const { PgDialect } = require("drizzle-orm/pg-core");
  const q = new PgDialect().sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { shoutoutSettingsTable, shoutoutRequestsTable } = actual;

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    const { params } = render(cond);
    const key = String(params[0] ?? "");
    if (table === shoutoutSettingsTable) {
      return h.settings.filter((r) => r.id === key || r.user_id === key);
    }
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
    /* Any known-status param past the id is a state guard
       (pending_payment for the paid flip, the current status for the
       refund claim, 'refunded' for its rollback). */
    for (const p of params.slice(1)) {
      if (typeof p === "string" && KNOWN_STATUSES.includes(p) && row.status !== p) return [];
    }
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
          payment_intent: h.paymentIntentId,
          metadata: { type: "shoutout_request" },
        }),
      },
    };
    refunds = {
      create: async (params: any, opts: any) => {
        h.refundCalls.push({ params, opts });
        if (h.refundFails) throw new Error("stripe refund exploded");
        h.refundSuccesses += 1;
        return { id: "re_test_1", status: "succeeded" };
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

import router, {
  __setShoutoutFanMailer,
  buildShoutoutDeclinedEmail,
  type ShoutoutFanEmail,
} from "../shoutouts";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
let mails: ShoutoutFanEmail[];

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
  __setShoutoutFanMailer(null);
  server.closeAllConnections?.();
  server.close();
});

function seedSettings(priceCents: number) {
  h.settings = [
    {
      id: SETTINGS_ID,
      user_id: CREATOR_USER_ID,
      display_name: "Royal Voice",
      price_cents: priceCents,
      turnaround_days: 3,
      guidelines: "",
      accepting: "true",
    },
  ];
}

beforeEach(() => {
  h.requests = [];
  h.stripePaid = true;
  h.sessionSeq = 0;
  h.paymentIntentId = "pi_test_1";
  h.refundFails = false;
  h.refundCalls = [];
  h.refundSuccesses = 0;
  mails = [];
  __setShoutoutFanMailer(async (email) => {
    mails.push(email);
  });
});

async function call(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function createRequest() {
  const r = await call("POST", "/shoutouts/requests", {
    creatorId: SETTINGS_ID,
    fanName: "Jamie Fan",
    fanEmail: "jamie@example.com",
    occasion: "Birthday",
    message: "Say happy birthday to Alex!",
  });
  expect(r.status).toBe(201);
  return r.json.request.id as string;
}

/** A $25 request carried all the way to paid (status accepted, paid_at set). */
async function paidRequest() {
  seedSettings(2500);
  const id = await createRequest();
  await call("POST", `/shoutouts/requests/${id}/checkout`);
  const sessionId = h.requests[0]!["stripe_session_id"] as string;
  const v = await call("POST", `/shoutouts/requests/${id}/checkout/verify`, { sessionId });
  expect(v.json.paid).toBe(true);
  expect(h.requests[0]!.status).toBe("accepted");
  expect(h.requests[0]!.paid_at).toBeTruthy();
  return { id, sessionId };
}

describe("paid decline refunds in full, automatically", () => {
  it("refunds exactly once on the request's session, lands 'refunded', and the email states the full refund", async () => {
    const { id, sessionId } = await paidRequest();
    const p = await call("PATCH", `/shoutouts/requests/${id}`, { status: "declined" });
    expect(p.status).toBe(200);
    expect(p.json.request.status).toBe("refunded");
    expect(h.requests[0]!.status).toBe("refunded");

    expect(h.refundCalls).toHaveLength(1);
    expect(h.refundSuccesses).toBe(1);
    expect(h.refundCalls[0]!.params).toEqual({ payment_intent: "pi_test_1" });
    expect(h.refundCalls[0]!.opts).toEqual({ idempotencyKey: `refund:${sessionId}` });

    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("jamie@example.com");
    expect(mails[0]!.html).toContain("refunded your payment in full");
    expect(mails[0]!.html).toContain("$25.00");
  });

  it("also refunds when the paid request had already been started (in_progress)", async () => {
    const { id } = await paidRequest();
    const started = await call("PATCH", `/shoutouts/requests/${id}`, { status: "in_progress" });
    expect(started.status).toBe(200);
    const p = await call("PATCH", `/shoutouts/requests/${id}`, { status: "declined" });
    expect(p.status).toBe(200);
    expect(p.json.request.status).toBe("refunded");
    expect(h.refundSuccesses).toBe(1);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.html).toContain("refunded your payment in full");
  });

  it("double-decline cannot refund or email twice: the replay is refused and Stripe saw one refund", async () => {
    const { id } = await paidRequest();
    const p1 = await call("PATCH", `/shoutouts/requests/${id}`, { status: "declined" });
    expect(p1.status).toBe(200);
    const p2 = await call("PATCH", `/shoutouts/requests/${id}`, { status: "declined" });
    expect(p2.status).toBe(409);
    expect(h.refundCalls).toHaveLength(1);
    expect(h.refundSuccesses).toBe(1);
    expect(mails).toHaveLength(1);
    expect(h.requests[0]!.status).toBe("refunded");
  });
});

describe("unpaid declines are unchanged", () => {
  it("a free request declines with no refund attempt and no money language", async () => {
    seedSettings(0);
    const id = await createRequest();
    const accept = await call("PATCH", `/shoutouts/requests/${id}`, { status: "accepted" });
    expect(accept.status).toBe(200);
    const p = await call("PATCH", `/shoutouts/requests/${id}`, { status: "declined" });
    expect(p.status).toBe(200);
    expect(p.json.request.status).toBe("declined");
    expect(h.refundCalls).toHaveLength(0);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.html.toLowerCase()).not.toContain("refund");
  });

  it("a priced request the fan never paid for declines with no refund attempt", async () => {
    seedSettings(2500);
    const id = await createRequest();
    await call("POST", `/shoutouts/requests/${id}/checkout`);
    expect(h.requests[0]!.stripe_session_id).toBeTruthy();
    expect(h.requests[0]!.paid_at).toBeNull();
    const p = await call("PATCH", `/shoutouts/requests/${id}`, { status: "declined" });
    expect(p.status).toBe(200);
    expect(p.json.request.status).toBe("declined");
    expect(h.refundCalls).toHaveLength(0);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.html.toLowerCase()).not.toContain("refund");
  });
});

describe("refund failure never fakes success", () => {
  it("a failed refund blocks the decline (502), keeps the state, sends no email — and a retry lands it, once", async () => {
    const { id } = await paidRequest();
    h.refundFails = true;
    const p1 = await call("PATCH", `/shoutouts/requests/${id}`, { status: "declined" });
    expect(p1.status).toBe(502);
    expect(p1.json.error).toContain("wasn't declined");
    expect(h.requests[0]!.status).toBe("accepted");
    expect(mails).toHaveLength(0);
    expect(h.refundSuccesses).toBe(0);

    h.refundFails = false;
    const p2 = await call("PATCH", `/shoutouts/requests/${id}`, { status: "declined" });
    expect(p2.status).toBe(200);
    expect(p2.json.request.status).toBe("refunded");
    expect(h.requests[0]!.status).toBe("refunded");
    expect(h.refundSuccesses).toBe(1);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.html).toContain("refunded your payment in full");
  });

  it("a paid session with no payment intent cannot be refunded → decline blocked, state kept, no email", async () => {
    const { id } = await paidRequest();
    h.paymentIntentId = null;
    const p = await call("PATCH", `/shoutouts/requests/${id}`, { status: "declined" });
    expect(p.status).toBe(502);
    expect(h.requests[0]!.status).toBe("accepted");
    expect(h.refundSuccesses).toBe(0);
    expect(mails).toHaveLength(0);
  });
});

describe("declined-email builder truth", () => {
  it("states the full refund only when refundCents says one landed", () => {
    const withRefund = buildShoutoutDeclinedEmail({
      fanName: "Jamie Fan",
      fanEmail: "jamie@example.com",
      creatorName: "Royal Voice",
      occasion: "Birthday",
      refundCents: 2500,
    });
    expect(withRefund.html).toContain("refunded your payment in full");
    expect(withRefund.html).toContain("$25.00");

    const without = buildShoutoutDeclinedEmail({
      fanName: "Jamie Fan",
      fanEmail: "jamie@example.com",
      creatorName: "Royal Voice",
      occasion: "Birthday",
    });
    expect(without.html.toLowerCase()).not.toContain("refund");
  });
});
