/**
 * payment-reversals-ugc-brief.test.ts — C-25: the UGC Briefs escrow
 * rail joins the reversal engine.
 *
 * Before this the engine could not identify a brief charge at all:
 * its funding sessions carry ugc_brief_id metadata, but no probe
 * read them, so a refunded brief charge parked as 'unidentified'
 * manual review while the brief kept reading escrow_status='funded'
 * — approvable (releasable) against money Stripe had already
 * returned. The same hole closed for sponsor deals and performance
 * bookings.
 *
 * Driven through the REAL webhook handler (charge.refunded →
 * stripeWebhookHandler → processStripeChargeReversal) over pg-mem —
 * the payment-reversals-performance.test.ts pattern.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { DataType } from "pg-mem";
import { sql } from "drizzle-orm";

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
  referrals: [] as Array<Record<string, unknown>>,
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
    if (table === "referrals") return sb.referrals;
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
        };
        return q;
      },
    }),
  };
});

import { stripeWebhookHandler } from "../stripe-webhook";
import { createTestDb } from "./test-db";

/* The engine's session probes touch every rail's table — declare the
   full probe surface (same as payment-reversals-performance) plus
   the rail under test. */
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
CREATE TABLE fan_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  fan_user_id uuid,
  status text NOT NULL DEFAULT 'active',
  stripe_session_id text,
  settled_payout_id uuid,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE digital_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  stripe_session_id text UNIQUE,
  status text NOT NULL DEFAULT 'completed',
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  buyer_user_id uuid,
  event_type text NOT NULL,
  stripe_session_id text,
  payment_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE live_shop_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  buyer_user_id uuid,
  stripe_session_id text,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tip_jar_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipper_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'paid',
  stripe_session_id text,
  delivery_token text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_delivery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sale_split_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE beats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exclusive_status text NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE beat_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_id uuid NOT NULL,
  buyer_user_id uuid NOT NULL,
  tier text NOT NULL DEFAULT 'basic',
  status text NOT NULL DEFAULT 'active',
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sponsor_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_status text NOT NULL DEFAULT 'unfunded',
  status text NOT NULL DEFAULT 'draft',
  stripe_session_id text,
  stripe_payment_intent_id text
);
CREATE TABLE sponsor_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'released',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shoutout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending_payment',
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE performance_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'proposed',
  escrow_status text NOT NULL DEFAULT 'unfunded',
  artist_payout_cents integer,
  stripe_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ugc_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_user_id uuid,
  claimed_by_user_id uuid,
  status text NOT NULL DEFAULT 'open',
  escrow_status text NOT NULL DEFAULT 'unfunded',
  stripe_session_id text,
  stripe_payment_intent_id text,
  released_amount_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

const BRAND = "22222222-2222-4222-8222-222222222222";
const CREATOR = "33333333-3333-4333-8333-333333333333";
const BRIEF = "66666666-6666-4666-8666-666666666666";
const PI = "pi_ugc_brief_1";
const CHARGE = "ch_ugc_brief_1";
const SESSION = "cs_ugc_brief_1";

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

function refundEvent(refunded: number) {
  return {
    id: "evt_ugc_brief_1",
    type: "charge.refunded",
    data: {
      object: {
        id: CHARGE,
        payment_intent: PI,
        amount: 10001,
        amount_refunded: refunded,
        currency: "usd",
      },
    },
  };
}

async function seedBrief(status: string, escrow: string, releasedAmount: number | null) {
  await testState.db.execute(sql`
    INSERT INTO ugc_briefs (id, brand_user_id, claimed_by_user_id, status, escrow_status, stripe_session_id, stripe_payment_intent_id, released_amount_cents)
    VALUES (${BRIEF}, ${BRAND}, ${CREATOR}, ${status}, ${escrow}, ${SESSION}, ${PI}, ${releasedAmount})
  `);
  h.sessionsByPi.set(PI, [{ id: SESSION, payment_intent: PI, metadata: { ugc_brief_id: BRIEF } }]);
  h.chargesById.set(CHARGE, { id: CHARGE, payment_intent: PI, amount: 10001, amount_refunded: 0, currency: "usd" });
}

async function briefRow() {
  const r = await testState.db.execute(sql`SELECT status, escrow_status FROM ugc_briefs WHERE id = ${BRIEF}`);
  return r.rows[0] as Record<string, unknown>;
}
async function reversalRow() {
  const r = await testState.db.execute(sql`SELECT rail, status, entitlement_revoked, refunded_cents_seen FROM payment_reversals WHERE stripe_charge_id = ${CHARGE}`);
  return r.rows[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
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
  sb.referrals = [];
  h.sessionsByPi.clear();
  h.chargesById.clear();
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  sb.profiles.set(BRAND, { id: BRAND, credits: 6000, bonus_credits: 0, bonus_credits_expires_at: null });
  vi.clearAllMocks();
});

describe("ugc-brief rail — reversal identification", () => {
  it("a full refund of a FUNDED brief flips its escrow to refunded — it can never be released against returned money", async () => {
    await seedBrief("delivered", "funded", null);
    const res = await deliver(refundEvent(10001));
    expect(res.statusCode).toBe(200);
    const rev = await reversalRow();
    /* Pre-fix: rail 'unidentified', status 'manual_review', and the
       brief stayed escrow_status='funded' — releasable in full. */
    expect(rev).toMatchObject({ rail: "ugc_brief", status: "completed", entitlement_revoked: true });
    /* The brief's lifecycle status is untouched (a refund is not a
       close) — only the escrow state moved. */
    expect(await briefRow()).toMatchObject({ status: "delivered", escrow_status: "refunded" });
  });

  it("a full refund of a RELEASED brief parks in manual review as the ugc_brief rail — escrow untouched", async () => {
    await seedBrief("approved", "released", 10001);
    const res = await deliver(refundEvent(10001));
    expect(res.statusCode).toBe(200);
    const rev = await reversalRow();
    expect(rev).toMatchObject({ rail: "ugc_brief", status: "needs_manual_review", entitlement_revoked: false });
    expect(await briefRow()).toMatchObject({ status: "approved", escrow_status: "released" });
  });

  it("control: a PARTIAL refund keeps the escrow funded — the release-side held-netting is what guards the money", async () => {
    await seedBrief("claimed", "funded", null);
    const res = await deliver(refundEvent(4000));
    expect(res.statusCode).toBe(200);
    const rev = await reversalRow();
    expect(rev).toMatchObject({ rail: "ugc_brief", status: "completed", entitlement_revoked: false, refunded_cents_seen: 4000 });
    expect(await briefRow()).toMatchObject({ status: "claimed", escrow_status: "funded" });
  });
});
