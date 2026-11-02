/**
 * stripe-webhook-shoutout.test.ts — WEBHOOK-SETTLE (stack1200).
 *
 * Gate #5's tip bug was a defect CLASS: a checkout surface whose
 * settlement depends on the buyer's browser returning for verify
 * loses the sale silently when the tab closes. Shoutouts were in
 * the class: checkout sessions carry metadata.type
 * "shoutout_request", and the webhook dispatch had NO branch for
 * them — a paid session fell through to the credit-grant tail,
 * which logged "missing user_id in metadata" and answered 200,
 * leaving the request in pending_payment forever (the fan paid, the
 * creator never heard, the shoutout was never owed).
 *
 * This suite drives the REAL webhook handler with a fabricated
 * (signature-bypassed via the mocked client) shoutout event and
 * pins:
 *   - a paid shoutout session flips the request to accepted
 *     exactly once, with NO verify call;
 *   - the creator's paid tell lands exactly once;
 *   - a replayed delivery changes nothing;
 *   - an unpaid session settles nothing and tells nobody;
 *   - an unknown session is a warned 200, never a crash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const CREATOR_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const SESSION_ID = "cs_shoutout_webhook_1";

const h = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  return {
    requests: [] as Array<Record<string, any>>,
    event: null as any,
    pushes: [] as Array<Record<string, any>>,
  };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(async () => 0),
}));

vi.mock("../stripe-client", () => ({
  createGuardedStripeClient: vi.fn(() => ({
    webhooks: { constructEvent: () => h.event },
  })),
  buildCheckoutSessionIdempotencyKey: vi.fn(() => "shoutout-key"),
  buildPaymentIntentIdempotencyKey: vi.fn(() => "pi-key"),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => false),
}));

vi.mock("../push-events", () => ({
  notifyUserEvent: async (input: Record<string, any>) => {
    h.pushes.push(input);
    return { bellLanded: true, push: null, pushSkippedReason: null };
  },
}));

vi.mock("../rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = CREATOR_ID;
    next();
  },
}));

vi.mock("../credits", () => ({
  chargeCredits: vi.fn(async () => undefined),
  refundCredits: vi.fn(async () => undefined),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../ai-clients", () => ({
  getOpenAI: vi.fn(() => {
    throw new Error("no openai in webhook test");
  }),
  getTextModel: vi.fn(() => "test-model"),
}));

vi.mock("../objectStorage", () => ({
  normalizeToStorageRef: (v: unknown) => v,
  refreshSupabaseStorageUrl: async (v: unknown) => v,
}));

vi.mock("../mirrorMedia", () => ({
  mirrorExternalMediaUrl: async () => null,
}));

/* The shoutout settle path reads/writes shoutout_requests through
   the drizzle builder. The fake models the builder surface
   shoutouts.ts uses — the session lookup and the guarded status
   flip (id + status equality rendered through PgDialect). */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { shoutoutRequestsTable } = actual;
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const render = (cond: unknown): { params: unknown[] } => {
    const q = dialect.sqlToQuery(cond as never);
    return { params: q.params as unknown[] };
  };

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    if (table !== shoutoutRequestsTable) return [];
    if (cond === undefined) return [...h.requests];
    const { params } = render(cond);
    return h.requests.filter(
      (r) => params.includes(r.stripe_session_id) || params.includes(r.id),
    );
  }

  function applyUpdate(table: unknown, patch: Record<string, any>, cond: unknown) {
    if (table !== shoutoutRequestsTable) return [];
    const { params } = render(cond);
    const row = h.requests.find((r) => params.includes(r.id));
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
            orderBy: () => ({ limit: async () => rows() }),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
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
    execute: async () => ({ rows: [] }),
  };
  return { ...actual, db: fakeDb };
});

import { stripeWebhookHandler } from "../stripe-webhook";

function seedPendingRequest() {
  h.requests = [
    {
      id: REQUEST_ID,
      creator_user_id: CREATOR_ID,
      fan_name: "Big Fan",
      fan_email: "fan@example.com",
      occasion: "birthday",
      price_cents: 2500,
      status: "pending_payment",
      stripe_session_id: SESSION_ID,
      paid_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];
}

function shoutoutEvent(paymentStatus: string, sessionId = SESSION_ID) {
  return {
    id: "evt_shoutout_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: paymentStatus,
        amount_total: 2500,
        currency: "usd",
        payment_intent: "pi_shoutout_1",
        metadata: { type: "shoutout_request", requestId: REQUEST_ID },
      },
    },
  };
}

async function deliver(event: unknown) {
  h.event = event;
  const res: any = { statusCode: 0, body: null as any };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  const req: any = {
    headers: { "stripe-signature": "sig_test" },
    body: Buffer.from("payload"),
  };
  await stripeWebhookHandler(req, res);
  return res;
}

beforeEach(() => {
  seedPendingRequest();
  h.pushes = [];
  h.event = null;
});

describe("stripe webhook — shoutout settle (WEBHOOK-SETTLE)", () => {
  it("a paid shoutout session accepts the request and tells the creator once, with no verify call", async () => {
    const res = await deliver(shoutoutEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "shoutout_request" });

    expect(h.requests[0]!.status).toBe("accepted");
    expect(h.requests[0]!.paid_at).toBeInstanceOf(Date);

    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]).toMatchObject({
      userId: CREATOR_ID,
      category: "money",
      kind: "shoutout_paid",
      link: "/shoutouts",
    });
  });

  it("a replayed delivery settles nothing twice and tells nobody twice", async () => {
    await deliver(shoutoutEvent("paid"));
    const res = await deliver(shoutoutEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(h.requests[0]!.status).toBe("accepted");
    expect(h.pushes).toHaveLength(1);
  });

  it("an unpaid shoutout session settles nothing and tells nobody", async () => {
    const res = await deliver(shoutoutEvent("unpaid"));
    expect(res.statusCode).toBe(200);
    expect(h.requests[0]!.status).toBe("pending_payment");
    expect(h.pushes).toHaveLength(0);
  });

  it("an unknown shoutout session is a warned 200, never a crash", async () => {
    const res = await deliver(shoutoutEvent("paid", "cs_shoutout_unknown"));
    expect(res.statusCode).toBe(200);
    expect(h.requests[0]!.status).toBe("pending_payment");
    expect(h.pushes).toHaveLength(0);
  });
});
