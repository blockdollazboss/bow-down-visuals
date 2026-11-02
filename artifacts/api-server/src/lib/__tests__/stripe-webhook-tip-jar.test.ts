/**
 * stripe-webhook-tip-jar.test.ts — TIP-TRUTH (stack1200).
 *
 * Gate #5 staging evidence (Nov 1, stack1100 build): a $5.00 tip
 * paid on the hosted checkout confirmed ONLY because the fan's
 * browser returned to the tip page and the page called
 * /tips/checkout/verify. The Stripe webhook — the rail every other
 * money family settles through — had NO branch for tip sessions at
 * all: a checkout.session.completed with metadata.type "tip_jar"
 * fell through the whole dispatch to the credit-grant tail, which
 * logged "missing user_id in session metadata" and answered 200.
 * A fan who closed the tab after paying left the tip
 * pending_payment forever: never in the creator's totals, never a
 * notification (the express-pay P0-8 failure class, one rail over).
 *
 * This suite drives the REAL webhook handler with a fabricated
 * (signature-bypassed via the mocked client) tip event and pins:
 *   - a paid tip session settles the durable tip row exactly once;
 *   - the creator tell (claim + gated push) lands exactly once;
 *   - a replayed delivery changes nothing;
 *   - an unpaid session settles nothing and tells nobody;
 *   - an unknown session is a warned 200, never a crash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const OWNER_ID = "55555555-5555-4555-8555-555555555555";
const TIP_ID = "77777777-7777-4777-8777-777777777777";
const SESSION_ID = "cs_tip_webhook_1";

const h = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  return {
    tips: [] as Array<Record<string, any>>,
    event: null as any,
    claims: [] as Array<Record<string, any>>,
    claimKeys: new Set<string>(),
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
  buildCheckoutSessionIdempotencyKey: vi.fn(() => "tip-jar-key"),
  buildPaymentIntentIdempotencyKey: vi.fn(() => "pi-key"),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => false),
}));

vi.mock("../job-notifications", () => ({
  createJobNotification: async (input: Record<string, any>) => {
    const key = `${input["jobType"]}:${input["jobId"]}`;
    if (h.claimKeys.has(key)) return false;
    h.claimKeys.add(key);
    h.claims.push(input);
    return true;
  },
}));

vi.mock("../push-events", () => ({
  notifyUserEvent: async (input: Record<string, any>) => {
    h.pushes.push(input);
    return { bellLanded: true, push: null, pushSkippedReason: null };
  },
}));

vi.mock("../rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = OWNER_ID;
    next();
  },
}));

/* The tip settle path reads/writes tip_jar_tips through the drizzle
   builder. The fake models the builder surface tip-jar.ts uses —
   key lookups, page-scoped reads, the guarded status flip. */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { tipJarTipsTable, creatorProfilesTable } = actual;
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const render = (cond: unknown): { params: unknown[] } => {
    const q = dialect.sqlToQuery(cond as never);
    return { params: q.params as unknown[] };
  };

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    if (table === creatorProfilesTable) return [];
    if (table !== tipJarTipsTable) return [];
    if (cond === undefined) return [...h.tips];
    const { params } = render(cond);
    const pageScoped = h.tips.filter((r) => params.includes(r.page_user_id));
    let rows =
      pageScoped.length > 0
        ? pageScoped
        : h.tips.filter((r) => params.includes(r.stripe_session_id) || params.includes(r.id));
    if (pageScoped.length > 0) {
      if (params.includes("paid")) rows = rows.filter((r) => r.status === "paid");
      else if (params.includes("pending_payment")) rows = rows.filter((r) => r.status === "pending_payment");
    }
    return rows;
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
            orderBy: () => ({ limit: async () => rows() }),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = { id: randomUUID(), stripe_session_id: null, paid_at: null, created_at: new Date(), ...v };
          h.tips.push(row);
          return [row];
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
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        const { params } = render(cond);
        h.tips = h.tips.filter((r) => !params.includes(r.id));
      },
    }),
    execute: async () => ({ rows: [] }),
  };
  return { ...actual, db: fakeDb };
});

import { stripeWebhookHandler } from "../stripe-webhook";

function seedPendingTip() {
  h.tips = [
    {
      id: TIP_ID,
      page_user_id: OWNER_ID,
      handle: "royal-voice",
      fan_name: "Big Fan",
      message: "Love the show!",
      amount_cents: 500,
      currency: "usd",
      status: "pending_payment",
      stripe_session_id: SESSION_ID,
      created_at: new Date(),
      paid_at: null,
    },
  ];
}

function tipEvent(paymentStatus: string, sessionId = SESSION_ID) {
  return {
    id: "evt_tip_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: paymentStatus,
        amount_total: 500,
        currency: "usd",
        payment_intent: "pi_tip_1",
        metadata: { type: "tip_jar", tipId: TIP_ID },
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
  seedPendingTip();
  h.claims = [];
  h.claimKeys = new Set();
  h.pushes = [];
  h.event = null;
});

describe("stripe webhook — tip jar settle (TIP-TRUTH)", () => {
  it("a paid tip session settles the tip and tells the creator once", async () => {
    const res = await deliver(tipEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "tip_jar" });

    expect(h.tips[0]!.status).toBe("paid");
    expect(h.tips[0]!.paid_at).toBeInstanceOf(Date);

    expect(h.claims).toHaveLength(1);
    expect(h.claims[0]).toMatchObject({
      jobType: "sale",
      jobId: `tip:${TIP_ID}`,
      userId: OWNER_ID,
      status: "completed",
    });
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]).toMatchObject({ userId: OWNER_ID, category: "money", kind: "tip_received", link: "/tips" });
  });

  it("a replayed delivery settles nothing twice and tells nobody twice", async () => {
    await deliver(tipEvent("paid"));
    const res = await deliver(tipEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(h.tips[0]!.status).toBe("paid");
    expect(h.claims).toHaveLength(1);
    expect(h.pushes).toHaveLength(1);
  });

  it("an unpaid tip session settles nothing and tells nobody", async () => {
    const res = await deliver(tipEvent("unpaid"));
    expect(res.statusCode).toBe(200);
    expect(h.tips[0]!.status).toBe("pending_payment");
    expect(h.claims).toHaveLength(0);
    expect(h.pushes).toHaveLength(0);
  });

  it("an unknown tip session is a warned 200, never a crash", async () => {
    const res = await deliver(tipEvent("paid", "cs_tip_unknown"));
    expect(res.statusCode).toBe(200);
    expect(h.tips[0]!.status).toBe("pending_payment");
    expect(h.claims).toHaveLength(0);
    expect(h.pushes).toHaveLength(0);
  });
});
