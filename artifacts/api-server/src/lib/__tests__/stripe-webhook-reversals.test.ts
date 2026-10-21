/**
 * stripe-webhook-reversals.test.ts — the webhook's refund/chargeback
 * branches (defect D1) driving the REAL handler + REAL reversal
 * engine over pg-mem, with the Stripe client and Supabase mocked.
 *
 * Pinned contract:
 *  - charge.refunded for a credit pack → 200 {reversed:true} and the
 *    granted VB is gone from the buyer's balance;
 *  - the same event redelivered → 200 {duplicate:true}, no second claw;
 *  - charge.dispute.closed 'lost' retrieves the charge and reverses
 *    in full; 'won' reverses nothing and writes no row;
 *  - an unidentifiable charge → 200 with the manual-review warning
 *    (never a 500 retry loop) and an audit row a human can work.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const testState = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

const h = vi.hoisted(() => ({
  event: null as unknown,
  sessionsByPi: new Map<string, Array<Record<string, unknown>>>(),
  chargesById: new Map<string, Record<string, unknown>>(),
}));

const sb = vi.hoisted(() => ({
  profiles: new Map<string, Record<string, unknown>>(),
  referralPayouts: [] as Array<Record<string, unknown>>,
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    webhooks = { constructEvent: () => h.event };
    checkout = {
      sessions: {
        list: async ({ payment_intent }: { payment_intent: string }) => ({
          data: h.sessionsByPi.get(payment_intent) ?? [],
        }),
      },
    };
    charges = {
      retrieve: async (id: string) => {
        const c = h.chargesById.get(id);
        if (!c) throw new Error(`No such charge: ${id}`);
        return c;
      },
    };
  },
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => {
  function rowsFor(table: string): Array<Record<string, unknown>> {
    if (table === "profiles") return [...sb.profiles.values()];
    if (table === "referral_payouts") return sb.referralPayouts;
    return [];
  }
  return {
    getSupabaseAdmin: () => ({
      from(table: string) {
        const q: Record<string, unknown> = {
          _filters: {} as Record<string, unknown>,
          _update: null as Record<string, unknown> | null,
          select() {
            return q;
          },
          update(obj: Record<string, unknown>) {
            q._update = obj;
            return q;
          },
          eq(col: string, val: unknown) {
            (q._filters as Record<string, unknown>)[col] = val;
            return q;
          },
          async single() {
            const f = q._filters as Record<string, unknown>;
            const row = rowsFor(table).find((r) => Object.entries(f).every(([k, v]) => r[k] === v));
            if (!row) return { data: null, error: { message: "no rows", code: "PGRST116" } };
            return { data: row, error: null };
          },
          then(resolve: (v: unknown) => void) {
            if (q._update) {
              const f = q._filters as Record<string, unknown>;
              for (const r of rowsFor(table)) {
                if (Object.entries(f).every(([k, v]) => r[k] === v)) Object.assign(r, q._update);
              }
              resolve({ data: null, error: null });
              return;
            }
            resolve({ data: null, error: null });
          },
        };
        return q;
      },
    }),
    addCreditsAtomic: vi.fn(),
    addCreditsToProfile: vi.fn(),
  };
});

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => 0),
}));

import { createTestDb } from "./test-db";
import { stripeWebhookHandler } from "../stripe-webhook";
import { sql } from "drizzle-orm";
import { DataType } from "pg-mem";
import { randomUUID } from "crypto";

const DDL = `
CREATE TABLE stripe_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id text UNIQUE NOT NULL,
  stripe_payment_intent_id text,
  user_id uuid NOT NULL,
  credit_pack text,
  credits_amount integer NOT NULL,
  amount_total integer,
  currency text,
  status text DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text,
  stripe_charge_id text NOT NULL,
  stripe_payment_intent_id text,
  trigger text NOT NULL,
  rail text NOT NULL,
  user_id uuid,
  session_id text,
  granted_credits integer NOT NULL DEFAULT 0,
  credits_clawed integer NOT NULL DEFAULT 0,
  referral_credits_clawed integer NOT NULL DEFAULT 0,
  refunded_cents_seen integer NOT NULL DEFAULT 0,
  charge_amount_cents integer,
  dispute_lost boolean NOT NULL DEFAULT false,
  entitlement_revoked boolean NOT NULL DEFAULT false,
  seller_reversed boolean NOT NULL DEFAULT false,
  shortfall_credits integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_reversals_charge_ux ON payment_reversals (stripe_charge_id);
CREATE TABLE credit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  credits_used integer NOT NULL,
  project_id uuid,
  team_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_usage_idempotency_key_uidx ON credit_usage (idempotency_key) WHERE idempotency_key IS NOT NULL;
`;

const BUYER = "11111111-1111-4111-8111-111111111111";

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

async function deliver(event: unknown) {
  h.event = event;
  const res = makeRes();
  await stripeWebhookHandler(
    { headers: { "stripe-signature": "sig_test" }, body: Buffer.from("{}") } as never,
    res as never,
  );
  return res;
}

const refundEvent = {
  id: "evt_r1",
  type: "charge.refunded",
  data: {
    object: {
      id: "ch_1",
      payment_intent: "pi_1",
      amount: 3900,
      amount_refunded: 3900,
      currency: "usd",
    },
  },
};

beforeEach(async () => {
  const t = createTestDb();
  t.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  t.mem.public.none(DDL);
  testState.db = t.db;
  sb.profiles.clear();
  sb.referralPayouts = [];
  h.sessionsByPi.clear();
  h.chargesById.clear();
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  await testState.db.execute(sql`
    INSERT INTO stripe_payments (stripe_session_id, stripe_payment_intent_id, user_id, credit_pack, credits_amount, amount_total, currency, status)
    VALUES ('cs_pack_1', 'pi_1', ${BUYER}, 'pack_5000', 5000, 3900, 'usd', 'completed')
  `);
  sb.profiles.set(BUYER, { id: BUYER, credits: 6000, bonus_credits: 0, bonus_credits_expires_at: null });
  vi.clearAllMocks();
});

describe("webhook reversal branches", () => {
  it("charge.refunded reverses the pack grant and answers 200", async () => {
    const res = await deliver(refundEvent);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, reversed: true, rail: "credit_pack", creditsClawed: 5000 });
    expect(Number(sb.profiles.get(BUYER)?.["credits"])).toBe(1000);
  });

  it("the redelivered event is a duplicate — 200, no second claw", async () => {
    await deliver(refundEvent);
    const res = await deliver(refundEvent);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, duplicate: true });
    expect(Number(sb.profiles.get(BUYER)?.["credits"])).toBe(1000);
  });

  it("charge.dispute.closed 'lost' retrieves the charge and reverses in full", async () => {
    h.chargesById.set("ch_1", {
      id: "ch_1",
      payment_intent: "pi_1",
      amount: 3900,
      amount_refunded: 0,
      currency: "usd",
    });
    const res = await deliver({
      id: "evt_dp1",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_1", charge: "ch_1", status: "lost", amount: 3900 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, reversed: true, rail: "credit_pack" });
    expect(Number(sb.profiles.get(BUYER)?.["credits"])).toBe(1000);
    const rows = await testState.db.execute(sql`SELECT dispute_lost FROM payment_reversals WHERE stripe_charge_id = 'ch_1'`);
    expect(rows.rows[0]?.["dispute_lost"]).toBe(true);
  });

  it("charge.dispute.closed 'won' reverses nothing", async () => {
    const res = await deliver({
      id: "evt_dp2",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_2", charge: "ch_1", status: "won", amount: 3900 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, dispute: "won" });
    expect(Number(sb.profiles.get(BUYER)?.["credits"])).toBe(6000);
    const rows = await testState.db.execute(sql`SELECT id FROM payment_reversals`);
    expect(rows.rows).toHaveLength(0);
  });

  it("an unidentifiable refunded charge answers 200 with the manual-review warning and writes the audit row", async () => {
    const res = await deliver({
      id: "evt_u1",
      type: "charge.refunded",
      data: {
        object: { id: "ch_ghost", payment_intent: "pi_ghost", amount: 500, amount_refunded: 500, currency: "usd" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, warning: "Reversal needs manual review", rail: "unidentified" });
    const rows = await testState.db.execute(sql`SELECT status, rail FROM payment_reversals WHERE stripe_charge_id = 'ch_ghost'`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ status: "needs_manual_review", rail: "unidentified" });
  });
});
