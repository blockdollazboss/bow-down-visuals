/**
 * stripe-webhook-membership.test.ts — WEBHOOK-SETTLE (stack1200).
 *
 * Fan memberships were in the Gate #5 tip defect CLASS: checkout
 * sessions stamp purchase_kind "membership", and the webhook
 * dispatch had NO branch for them — a paid session fell through to
 * the credit-grant tail, which logged "missing user_id in
 * metadata" and answered 200. The join settled ONLY if the fan's
 * browser returned and the page called /memberships/verify (the
 * staging Gate #5 run found the buyer not-a-member after paid
 * clicks that never landed). A fan who closed the tab after paying
 * never became a member: money taken, no seat, no creator tell.
 *
 * This suite drives the REAL webhook handler with a fabricated
 * (signature-bypassed via the mocked client) membership event and
 * pins:
 *   - a paid membership session activates the membership exactly
 *     once, with NO verify call, and the creator's join bell lands
 *     once;
 *   - a replayed delivery creates no second member and tells
 *     nobody twice;
 *   - an unpaid session activates nothing;
 *   - a session whose tier is gone settles nothing (the settle's
 *     own auto-refund path answers the webhook 200).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const CREATOR_ID = "55555555-5555-4555-8555-555555555555";
const FAN_ID = "66666666-6666-4666-8666-666666666666";
const TIER_ID = "77777777-7777-4777-8777-777777777777";
const SESSION_ID = "cs_membership_webhook_1";

const h = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  return {
    tiers: [] as Array<Record<string, any>>,
    members: [] as Array<Record<string, any>>,
    gifts: [] as Array<Record<string, any>>,
    profiles: [] as Array<Record<string, any>>,
    event: null as any,
    pushes: [] as Array<Record<string, any>>,
    refunds: [] as Array<unknown>,
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
  buildCheckoutSessionIdempotencyKey: vi.fn(() => "membership-key"),
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
    req.userId = FAN_ID;
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

vi.mock("../stripe-checkout", () => ({
  createPaymentCheckout: vi.fn(async () => ({ sessionId: "cs_unused", url: "https://checkout.example.com/pay" })),
  retrieveCheckoutSession: vi.fn(async () => {
    throw new Error("webhook settle never retrieves the session");
  }),
  refundCheckoutSessionPayment: vi.fn(async (session: unknown) => {
    h.refunds.push(session);
    return true;
  }),
  checkoutBaseUrl: () => "https://example.com",
  isCheckoutTestMode: () => true,
}));

vi.mock("../api-webhooks", () => ({
  emitNewMemberWebhook: vi.fn(),
}));

vi.mock("../overlay-events", () => ({
  emitOverlayMemberAlert: vi.fn(),
}));

/* The membership settle path reads/writes fan_tiers, fan_members,
   fan_membership_gifts and creator_profiles through the drizzle
   builder. The fake matches rows by rendering the condition's
   "col" = $n equality pairs (the beats-payments harness pattern). */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { fanTiersTable, fanMembersTable, fanMembershipGiftsTable, creatorProfilesTable } = actual;
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();

  function storeFor(table: unknown): Array<Record<string, any>> {
    if (table === fanTiersTable) return h.tiers;
    if (table === fanMembersTable) return h.members;
    if (table === fanMembershipGiftsTable) return h.gifts;
    if (table === creatorProfilesTable) return h.profiles;
    return [];
  }

  function matchRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    const rows = storeFor(table);
    if (!cond) return [...rows];
    const q = dialect.sqlToQuery(cond as never);
    const sqlText = q.sql;
    const params = q.params as unknown[];
    const pairs: Array<[string, unknown]> = [];
    const re = /"(\w+)"\s*=\s*\$(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sqlText)) !== null) pairs.push([m[1]!, params[Number(m[2]) - 1]]);
    if (pairs.length === 0) return [...rows];
    return rows.filter((r) => pairs.every(([col, val]) => r[col] === val));
  }

  function selectChain(table: unknown) {
    let cond: unknown;
    const chain: any = {
      where: (c: unknown) => {
        cond = c;
        return chain;
      },
      orderBy: (..._a: unknown[]) => chain,
      limit: async (n: number) => matchRows(table, cond).slice(0, n).map((r) => ({ ...r })),
      then: (resolve: (v: unknown) => void) => resolve(matchRows(table, cond).map((r) => ({ ...r }))),
    };
    return chain;
  }

  const fakeDb: any = {
    select: (_proj?: unknown) => ({ from: (table: unknown) => selectChain(table) }),
    insert: (table: unknown) => ({
      values: (v: Record<string, any>) => {
        let inserted: Record<string, any> | null = null;
        const doInsert = () => {
          if (inserted) return inserted;
          inserted = {
            id: randomUUID(),
            created_at: new Date(),
            updated_at: new Date(),
            joined_at: new Date(),
            stripe_session_id: null,
            ...v,
          };
          storeFor(table).push(inserted);
          return inserted;
        };
        return {
          returning: async () => [{ ...doInsert() }],
          then: (resolve: (v: unknown) => void) => resolve([doInsert()]),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (v: Record<string, any>) => ({
        where: (cond: unknown) => {
          let done: Array<Record<string, any>> | null = null;
          const apply = () => {
            if (done) return done;
            done = matchRows(table, cond);
            for (const r of done) Object.assign(r, v);
            return done;
          };
          return {
            returning: async () => apply().map((r) => ({ ...r })),
            then: (resolve: (v: unknown) => void) => resolve(apply()),
          };
        },
      }),
    }),
    execute: async () => ({ rows: [] }),
  };
  return { ...actual, db: fakeDb };
});

import { stripeWebhookHandler } from "../stripe-webhook";

function seedTier() {
  h.tiers = [
    {
      id: TIER_ID,
      user_id: CREATOR_ID,
      name: "Gold Club",
      price_cents: 500,
      annual_discount_pct: 0,
      is_active: "true",
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];
  h.profiles = [{ user_id: FAN_ID, displayName: "Big Fan" }];
  h.members = [];
  h.gifts = [];
}

function membershipEvent(paymentStatus: string, sessionId = SESSION_ID, tierId = TIER_ID) {
  return {
    id: "evt_membership_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: paymentStatus,
        amount_total: 500,
        currency: "usd",
        payment_intent: "pi_membership_1",
        customer_details: { email: "fan@example.com" },
        metadata: {
          purchase_kind: "membership",
          tier_id: tierId,
          creator_user_id: CREATOR_ID,
          fan_user_id: FAN_ID,
          purchaser_user_id: FAN_ID,
          billing_period: "monthly",
          amount_cents: "500",
          is_gift: "false",
        },
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
  seedTier();
  h.pushes = [];
  h.refunds = [];
  h.event = null;
});

describe("stripe webhook — membership settle (WEBHOOK-SETTLE)", () => {
  it("a paid membership session activates the membership and bells the creator once, with no verify call", async () => {
    const res = await deliver(membershipEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "membership" });

    expect(h.members).toHaveLength(1);
    expect(h.members[0]).toMatchObject({
      tier_id: TIER_ID,
      fan_user_id: FAN_ID,
      status: "active",
      price_cents: 500,
      stripe_session_id: SESSION_ID,
    });

    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]).toMatchObject({
      userId: CREATOR_ID,
      category: "money",
      kind: "membership_join",
      link: "/memberships",
    });
  });

  it("a replayed delivery creates no second member and tells nobody twice", async () => {
    await deliver(membershipEvent("paid"));
    const res = await deliver(membershipEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(h.members).toHaveLength(1);
    expect(h.pushes).toHaveLength(1);
  });

  it("an unpaid membership session activates nothing", async () => {
    const res = await deliver(membershipEvent("unpaid"));
    expect(res.statusCode).toBe(200);
    expect(h.members).toHaveLength(0);
    expect(h.pushes).toHaveLength(0);
  });

  it("a paid session whose tier is gone activates nothing and answers 200 (settle auto-refunds)", async () => {
    const res = await deliver(membershipEvent("paid", SESSION_ID, "88888888-8888-4888-8888-888888888888"));
    expect(res.statusCode).toBe(200);
    expect(h.members).toHaveLength(0);
    expect(h.refunds).toHaveLength(1);
    expect(h.pushes).toHaveLength(0);
  });
});
