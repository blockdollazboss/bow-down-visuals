/**
 * payment-reversals.test.ts — the refund / chargeback clawback engine
 * (defect D1) against real Postgres semantics (pg-mem).
 *
 * Pinned contract:
 *  - a refunded credit pack loses exactly the VB it granted (pro-rata
 *    on partial refunds; a completing refund claws the remainder);
 *  - a webhook replay NEVER double-claws (cumulative claim row);
 *  - a lost dispute forces the FULL reversal even with no refund;
 *  - a balance that can't cover the claw is debited to zero — never
 *    negative — and the rest lands in shortfall_credits;
 *  - the referral share a purchase paid claws back by the same
 *    fraction, from the award's own record;
 *  - a refunded membership loses its entitlement (fan_members →
 *    'refunded', gift row too) — but only on a FULL refund; a partial
 *    refund keeps it and says so in the audit details;
 *  - beats flip to the rail's own 'refunded' status and an exclusive
 *    beat is sellable again; digital sales flip + download links die;
 *    marketplace lines flip out of event_type='sale' so payout and
 *    earnings stop counting them;
 *  - a charge no grant record identifies is NOT skipped: it lands as
 *    a 'needs_manual_review' audit row (and branding orders, which a
 *    machine must not un-print, park there identified);
 *  - a mid-reversal failure marks the row 'failed' and throws, and
 *    the Stripe retry reclaims it and finishes the job.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Fake db handle (pg-mem), swapped per test ─────────────────────── */
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

/* ── Fake Supabase (profiles balances + referral_payouts) ──────────── */
const sb = vi.hoisted(() => ({
  profiles: new Map<string, Record<string, unknown>>(),
  referralPayouts: [] as Array<Record<string, unknown>>,
  profileUpdateFails: false,
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
              if (sb.profileUpdateFails) {
                resolve({ data: null, error: { message: "update failed (fake)" } });
                return;
              }
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
  };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createTestDb } from "./test-db";
import { processChargeReversal, type ReversalCharge } from "../payment-reversals";
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
CREATE TABLE fan_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tier_id uuid NOT NULL DEFAULT gen_random_uuid(),
  fan_label text NOT NULL DEFAULT 'fan',
  fan_user_id uuid,
  status text NOT NULL DEFAULT 'active',
  price_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text,
  settled_payout_id uuid,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fan_membership_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id text,
  status text NOT NULL DEFAULT 'pending_payment',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE beats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exclusive_sold boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE beat_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  producer_id uuid NOT NULL,
  tier text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  commission_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_payment',
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE digital_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  item_kind text NOT NULL DEFAULT 'track',
  item_id uuid NOT NULL DEFAULT gen_random_uuid(),
  stripe_session_id text UNIQUE,
  amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE download_links (
  token text PRIMARY KEY,
  sale_id uuid NOT NULL,
  file_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_count integer NOT NULL DEFAULT 0
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  product_id uuid,
  amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0,
  buyer_email text,
  stripe_session_id text,
  payment_status text,
  quantity integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid,
  profile_id uuid NOT NULL,
  product_id uuid,
  amount_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_delivery_tokens (
  token text PRIMARY KEY,
  order_id uuid NOT NULL,
  file_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE live_shop_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  buyer_user_id uuid,
  status text NOT NULL DEFAULT 'test',
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tip_jar_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending_payment',
  stripe_session_id text,
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
CREATE TABLE sponsor_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_status text NOT NULL DEFAULT 'unfunded',
  status text NOT NULL DEFAULT 'draft',
  stripe_session_id text
);
CREATE TABLE sponsor_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'released',
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

const BUYER = "11111111-1111-4111-8111-111111111111";
const CREATOR = "22222222-2222-4222-8222-222222222222";
const REFERRER = "33333333-3333-4333-8333-333333333333";

/* Fake Stripe: checkout-session lookup by payment intent. */
const sessionsByPi = new Map<string, Array<Record<string, unknown>>>();
const stripeFake = {
  checkout: {
    sessions: {
      list: async ({ payment_intent }: { payment_intent: string }) => ({
        data: sessionsByPi.get(payment_intent) ?? [],
      }),
    },
  },
} as never;

function charge(over: Partial<ReversalCharge>): ReversalCharge {
  return {
    id: "ch_1",
    paymentIntentId: "pi_1",
    amountCents: 3900,
    refundedCents: 3900,
    currency: "usd",
    ...over,
  };
}

function setBalance(userId: string, credits: number, bonus = 0) {
  sb.profiles.set(userId, {
    id: userId,
    credits,
    bonus_credits: bonus,
    bonus_credits_expires_at: null,
  });
}
function balance(userId: string): number {
  return Number(sb.profiles.get(userId)?.["credits"] ?? 0);
}

async function q(query: ReturnType<typeof sql>) {
  const r = await testState.db.execute(query);
  return r.rows as Array<Record<string, unknown>>;
}

async function seedPack(pi = "pi_1", session = "cs_pack_1", credits = 5000) {
  await q(sql`
    INSERT INTO stripe_payments (stripe_session_id, stripe_payment_intent_id, user_id, credit_pack, credits_amount, amount_total, currency, status)
    VALUES (${session}, ${pi}, ${BUYER}, 'pack_5000', ${credits}, 3900, 'usd', 'completed')
  `);
}

beforeEach(() => {
  const t = createTestDb();
  /* pg-mem ships no gen_random_uuid — register the production default
     so the DDL below matches the real schema's shape. */
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
  sb.profileUpdateFails = false;
  sessionsByPi.clear();
  vi.clearAllMocks();
});

describe("credit packs — the VB rail", () => {
  it("a full refund claws back exactly the granted VB, with a ledger row and a completed audit row", async () => {
    await seedPack();
    setBalance(BUYER, 6000);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "credit_pack", creditsClawed: 5000, shortfallCredits: 0 });
    expect(balance(BUYER)).toBe(1000);

    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_1'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "completed", granted_credits: 5000, credits_clawed: 5000, rail: "credit_pack" });

    const ledger = await q(sql`SELECT * FROM credit_usage WHERE user_id = ${BUYER}`);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ credits_used: 5000, idempotency_key: "clawback:ch_1:credits:5000" });
  });

  it("a webhook replay does NOT double-claw", async () => {
    await seedPack();
    setBalance(BUYER, 6000);
    await processChargeReversal({ stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}) });
    const out2 = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out2).toEqual({ outcome: "duplicate" });
    expect(balance(BUYER)).toBe(1000);
    const ledger = await q(sql`SELECT * FROM credit_usage WHERE user_id = ${BUYER}`);
    expect(ledger).toHaveLength(1);
  });

  it("partial refunds claw pro-rata; a completing refund claws only the remainder", async () => {
    await seedPack();
    setBalance(BUYER, 6000);
    const half = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded",
      charge: charge({ refundedCents: 1950 }),
    });
    expect(half).toMatchObject({ outcome: "reversed", creditsClawed: 2500 });
    expect(balance(BUYER)).toBe(3500);
    const rest = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_2", trigger: "charge.refunded", charge: charge({ refundedCents: 3900 }),
    });
    expect(rest).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });
    expect(balance(BUYER)).toBe(1000);
  });

  it("shortfall: the balance is debited to zero, never negative, and the rest is recorded", async () => {
    await seedPack();
    setBalance(BUYER, 1200);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out).toMatchObject({ outcome: "reversed", creditsClawed: 1200, shortfallCredits: 3800 });
    expect(balance(BUYER)).toBe(0);
    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_1'`);
    expect(rows[0]).toMatchObject({ status: "partial_shortfall", shortfall_credits: 3800, credits_clawed: 1200 });
  });

  it("a lost dispute claws the FULL grant even though nothing was 'refunded'", async () => {
    await seedPack();
    setBalance(BUYER, 6000);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_d1", trigger: "charge.dispute.closed",
      charge: charge({ refundedCents: 0 }), disputeLost: true,
    });
    expect(out).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });
    expect(balance(BUYER)).toBe(1000);
    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_1'`);
    expect(rows[0]).toMatchObject({ status: "completed", dispute_lost: true });
    const ledger = await q(sql`SELECT * FROM credit_usage WHERE user_id = ${BUYER}`);
    expect(String(ledger[0]?.["action"])).toContain("chargeback");
  });

  it("the referral share the purchase paid claws back from the award's own record", async () => {
    await seedPack();
    setBalance(BUYER, 6000);
    setBalance(REFERRER, 2000);
    sb.referralPayouts.push({
      id: "rp_1",
      referral_id: "ref_1",
      stripe_session_id: "cs_pack_1",
      referee_credits_purchased: 5000,
      referrer_user_id: REFERRER,
      referrer_credits_awarded: 1250,
    });
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });
    expect(balance(REFERRER)).toBe(750);
    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_1'`);
    expect(rows[0]).toMatchObject({ referral_credits_clawed: 1250 });
    const refLedger = await q(sql`SELECT * FROM credit_usage WHERE user_id = ${REFERRER}`);
    expect(refLedger).toHaveLength(1);
    expect(refLedger[0]).toMatchObject({ credits_used: 1250 });
  });

  it("express packs (payment row keyed on the PI itself) claw back through the same lookup", async () => {
    await seedPack("pi_express", "pi_express", 1000);
    setBalance(BUYER, 3000);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded",
      charge: charge({ id: "ch_x", paymentIntentId: "pi_express", amountCents: 900, refundedCents: 900 }),
    });
    expect(out).toMatchObject({ outcome: "reversed", creditsClawed: 1000 });
    expect(balance(BUYER)).toBe(2000);
  });

  it("a failed reversal marks the row failed, throws, and the retry reclaims and finishes", async () => {
    await seedPack();
    setBalance(BUYER, 6000);
    sb.profileUpdateFails = true;
    await expect(
      processChargeReversal({ stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}) }),
    ).rejects.toThrow();
    const failed = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_1'`);
    expect(failed[0]).toMatchObject({ status: "failed", credits_clawed: 0 });
    expect(balance(BUYER)).toBe(6000);

    sb.profileUpdateFails = false;
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_2", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });
    expect(balance(BUYER)).toBe(1000);
  });

  it("a fresh in-flight claim answers inflight (the webhook will 500 and Stripe retries)", async () => {
    await seedPack();
    setBalance(BUYER, 6000);
    await q(sql`
      INSERT INTO payment_reversals (stripe_charge_id, stripe_payment_intent_id, trigger, rail, status)
      VALUES ('ch_1', 'pi_1', 'charge.refunded', 'credit_pack', 'processing')
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out).toEqual({ outcome: "inflight" });
    expect(balance(BUYER)).toBe(6000);
  });
});

describe("memberships — entitlement revocation", () => {
  async function seedMembership() {
    sessionsByPi.set("pi_m", [{ id: "cs_m_1", metadata: {} }]);
    const member = await q(sql`
      INSERT INTO fan_members (user_id, fan_user_id, status, price_cents, stripe_session_id)
      VALUES (${CREATOR}, ${BUYER}, 'active', 1500, 'cs_m_1')
      RETURNING id
    `);
    await q(sql`
      INSERT INTO fan_membership_gifts (stripe_session_id, status) VALUES ('cs_m_1', 'active')
    `);
    return String(member[0]?.["id"]);
  }
  const mCharge = (over: Partial<ReversalCharge>): ReversalCharge =>
    charge({ id: "ch_m", paymentIntentId: "pi_m", amountCents: 1500, refundedCents: 1500, ...over });

  it("a full refund revokes the membership and its gift row", async () => {
    await seedMembership();
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_m1", trigger: "charge.refunded", charge: mCharge({}),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "membership" });
    const members = await q(sql`SELECT status FROM fan_members WHERE stripe_session_id = 'cs_m_1'`);
    expect(members[0]?.["status"]).toBe("refunded");
    const gifts = await q(sql`SELECT status FROM fan_membership_gifts WHERE stripe_session_id = 'cs_m_1'`);
    expect(gifts[0]?.["status"]).toBe("refunded");
    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_m'`);
    expect(rows[0]).toMatchObject({ status: "completed", entitlement_revoked: true, seller_reversed: true });
  });

  it("a partial refund keeps the entitlement (and records that it did); completing the refund revokes", async () => {
    await seedMembership();
    const half = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_m1", trigger: "charge.refunded", charge: mCharge({ refundedCents: 750 }),
    });
    expect(half).toMatchObject({ outcome: "reversed" });
    let members = await q(sql`SELECT status FROM fan_members WHERE stripe_session_id = 'cs_m_1'`);
    expect(members[0]?.["status"]).toBe("active");
    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_m'`);
    expect((rows[0]?.["details"] as Record<string, unknown>)?.["partialRefundEntitlementKept"]).toBe(true);

    const full = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_m2", trigger: "charge.refunded", charge: mCharge({ refundedCents: 1500 }),
    });
    expect(full).toMatchObject({ outcome: "reversed" });
    members = await q(sql`SELECT status FROM fan_members WHERE stripe_session_id = 'cs_m_1'`);
    expect(members[0]?.["status"]).toBe("refunded");

    const again = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_m3", trigger: "charge.refunded", charge: mCharge({}),
    });
    expect(again).toEqual({ outcome: "duplicate" });
  });

  it("a lost dispute revokes the membership in full", async () => {
    await seedMembership();
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_m9", trigger: "charge.dispute.closed",
      charge: mCharge({ refundedCents: 0 }), disputeLost: true,
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "membership" });
    const members = await q(sql`SELECT status FROM fan_members WHERE stripe_session_id = 'cs_m_1'`);
    expect(members[0]?.["status"]).toBe("refunded");
  });
});

describe("beats / digital / marketplace — access + seller ledger", () => {
  it("a refunded exclusive license flips to 'refunded' and the beat is sellable again", async () => {
    sessionsByPi.set("pi_b", [{ id: "cs_b_1", metadata: {} }]);
    const beat = await q(sql`INSERT INTO beats (exclusive_sold) VALUES (true) RETURNING id`);
    const beatId = String(beat[0]?.["id"]);
    await q(sql`
      INSERT INTO beat_licenses (beat_id, buyer_id, producer_id, tier, price_cents, status, stripe_session_id)
      VALUES (${beatId}, ${BUYER}, ${CREATOR}, 'exclusive', 49999, 'completed', 'cs_b_1')
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_b1", trigger: "charge.refunded",
      charge: charge({ id: "ch_b", paymentIntentId: "pi_b", amountCents: 49999, refundedCents: 49999 }),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "beat_license" });
    const lic = await q(sql`SELECT status FROM beat_licenses WHERE stripe_session_id = 'cs_b_1'`);
    expect(lic[0]?.["status"]).toBe("refunded");
    const b = await q(sql`SELECT exclusive_sold FROM beats WHERE id = ${beatId}`);
    expect(b[0]?.["exclusive_sold"]).toBe(false);
  });

  it("a refunded digital sale flips status and its download links die immediately", async () => {
    sessionsByPi.set("pi_d", [{ id: "cs_d_1", metadata: {} }]);
    const sale = await q(sql`
      INSERT INTO digital_sales (buyer_user_id, profile_id, stripe_session_id, amount_cents, creator_amount_cents)
      VALUES (${BUYER}, ${CREATOR}, 'cs_d_1', 2000, 1900) RETURNING id
    `);
    const saleId = String(sale[0]?.["id"]);
    await q(sql`
      INSERT INTO download_links (token, sale_id, file_url, expires_at)
      VALUES ('tok_1', ${saleId}, 'https://files.example/song.mp3', now() + interval '48 hours')
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_d1", trigger: "charge.refunded",
      charge: charge({ id: "ch_d", paymentIntentId: "pi_d", amountCents: 2000, refundedCents: 2000 }),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "digital_sale" });
    const s = await q(sql`SELECT status, refunded_at FROM digital_sales WHERE id = ${saleId}`);
    expect(s[0]?.["status"]).toBe("refunded");
    expect(s[0]?.["refunded_at"]).not.toBeNull();
    const link = await q(sql`SELECT expires_at FROM download_links WHERE token = 'tok_1'`);
    expect(new Date(String(link[0]?.["expires_at"])).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("marketplace lines flip out of 'sale' so payouts and earnings stop counting them", async () => {
    sessionsByPi.set("pi_s", [{ id: "cs_s_1", metadata: { type: "marketplace_shop_purchase" } }]);
    await q(sql`
      INSERT INTO shop_events (user_id, event_type, amount_cents, platform_fee_cents, stripe_session_id, payment_status)
      VALUES (${CREATOR}, 'sale', 5000, 250, 'cs_s_1', 'paid'),
             (${CREATOR}, 'sale', 3000, 150, 'cs_s_1', 'paid')
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_s1", trigger: "charge.refunded",
      charge: charge({ id: "ch_s", paymentIntentId: "pi_s", amountCents: 8000, refundedCents: 8000 }),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "marketplace_shop" });
    const lines = await q(sql`SELECT event_type, payment_status FROM shop_events WHERE stripe_session_id = 'cs_s_1'`);
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l["event_type"]).toBe("refunded_sale");
      expect(l["payment_status"]).toBe("refunded");
    }
  });
});

describe("manual review — identified or not, never silent", () => {
  it("an unidentifiable charge is logged into an audit row, not skipped — and replays stay parked", async () => {
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_u1", trigger: "charge.refunded",
      charge: charge({ id: "ch_unknown", paymentIntentId: "pi_nothing", amountCents: 500, refundedCents: 500 }),
    });
    expect(out).toEqual({ outcome: "manual_review", rail: "unidentified" });
    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_unknown'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "needs_manual_review", rail: "unidentified" });
    expect(String((rows[0]?.["details"] as Record<string, unknown>)?.["manualReason"])).toContain("No grant record");

    const again = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_u2", trigger: "charge.refunded",
      charge: charge({ id: "ch_unknown", paymentIntentId: "pi_nothing", amountCents: 500, refundedCents: 500 }),
    });
    expect(again).toEqual({ outcome: "manual_review", rail: "unidentified" });
    const still = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_unknown'`);
    expect(still).toHaveLength(1);
  });

  it("a charge with no payment intent at all parks as manual review", async () => {
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_u3", trigger: "charge.refunded",
      charge: charge({ id: "ch_nopi", paymentIntentId: null }),
    });
    expect(out).toEqual({ outcome: "manual_review", rail: "unidentified" });
  });

  it("branding orders are identified but park for a human (goods may already exist)", async () => {
    await q(sql`
      INSERT INTO stripe_payments (stripe_session_id, stripe_payment_intent_id, user_id, credit_pack, credits_amount, amount_total, currency, status)
      VALUES ('cs_brand_1', 'pi_brand', ${BUYER}, 'branding_order:ord_9', 0, 12900, 'usd', 'completed')
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_br1", trigger: "charge.refunded",
      charge: charge({ id: "ch_brand", paymentIntentId: "pi_brand", amountCents: 12900, refundedCents: 12900 }),
    });
    expect(out).toEqual({ outcome: "manual_review", rail: "branding_order" });
    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_brand'`);
    expect(rows[0]).toMatchObject({ status: "needs_manual_review", rail: "branding_order" });
    expect((rows[0]?.["details"] as Record<string, unknown>)?.["brandingOrderId"]).toBe("ord_9");
  });

  it("subscription charges (creator tier) park identified for a human", async () => {
    sessionsByPi.set("pi_t", [{ id: "cs_t_1", metadata: { kind: "creator_tier", user_id: BUYER }, subscription: "sub_1" }]);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_t1", trigger: "charge.refunded",
      charge: charge({ id: "ch_t", paymentIntentId: "pi_t", amountCents: 2500, refundedCents: 2500 }),
    });
    expect(out).toEqual({ outcome: "manual_review", rail: "subscription" });
    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_t'`);
    expect(rows[0]).toMatchObject({ status: "needs_manual_review", rail: "subscription" });
  });
});
