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
 *  - the referral lookup runs against the REAL schema shapes (D7):
 *    referral_payouts has no referrer_user_id — the referrer resolves
 *    through referral_id → referrals — and the fake Supabase enforces
 *    the drizzle schema's column sets, so a phantom-column select
 *    fails here instead of in production;
 *  - a reversal whose pack leg finished but whose referral leg did
 *    not is reclaimed on retry (the claim gate checks referral work),
 *    never answered 'duplicate' with the referral claw outstanding.
 *  - the award's referrals row loses exactly the clawed amount from
 *    its displayed total_referrer_earned (floored at 0), keyed to the
 *    referral_credits_clawed delta — retries and no-award reversals
 *    move it not at all.
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

/* ── Fake Supabase (profiles balances + referral tables) ─────────────
   SCHEMA-FAITHFUL since D7: the old fake ignored the select() column
   list entirely, so payment-reversals could select a column that does
   not exist (referral_payouts.referrer_user_id) and every test stayed
   green while production 500'd. This fake now validates every
   requested column against the table's REAL column set and projects
   only the requested columns into the returned row, exactly like
   PostgREST. The referral-table sets below are pinned against the
   drizzle schema objects by the "schema pins" test in this file —
   if the schema changes, that test fails until this list follows.
   `profiles` has no drizzle table (Supabase is its system of record);
   its list is the verified set the reversal engine touches (base
   table + supabase/migrations/0054 bonus columns). */
const sb = vi.hoisted(() => ({
  profiles: new Map<string, Record<string, unknown>>(),
  referralPayouts: [] as Array<Record<string, unknown>>,
  referrals: [] as Array<Record<string, unknown>>,
  profileUpdateFails: false,
  referralLookupFails: false,
  tableColumns: {
    profiles: [
      "id", "credits", "bonus_credits", "bonus_credits_expires_at",
      "daily_streak", "last_daily_claim", "last_wheel_spin",
    ],
    referral_payouts: [
      "id", "referral_id", "stripe_session_id", "referee_credits_purchased",
      "referrer_credits_awarded", "created_at",
    ],
    referrals: [
      "id", "referrer_user_id", "referee_user_id", "referrer_credits_awarded",
      "referee_credits_awarded", "revenue_share_pct", "share_expires_at",
      "total_referrer_earned", "created_at",
    ],
  } as Record<string, string[]>,
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
          _selectCols: null as string[] | null,
          select(cols?: unknown) {
            if (typeof cols === "string") {
              q._selectCols = cols.split(",").map((s) => s.trim()).filter(Boolean);
            }
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
            if (table === "referrals" && sb.referralLookupFails) {
              return { data: null, error: { message: "referral read failed (fake)", code: "PGRST000" } };
            }
            /* PostgREST column validation: an unknown column in the
               select list is an error (42703), never silent data —
               this is the exact failure production produced for D7. */
            const cols = q._selectCols as string[] | null;
            const known = sb.tableColumns[table];
            if (cols && known) {
              for (const c of cols) {
                if (!known.includes(c)) {
                  return {
                    data: null,
                    error: { message: `column ${table}.${c} does not exist`, code: "42703" },
                  };
                }
              }
            }
            const f = q._filters as Record<string, unknown>;
            const row = rowsFor(table).find((r) => Object.entries(f).every(([k, v]) => r[k] === v));
            if (!row) return { data: null, error: { message: "no rows", code: "PGRST116" } };
            if (!cols) return { data: row, error: null };
            const projected: Record<string, unknown> = {};
            for (const c of cols) projected[c] = row[c];
            return { data: projected, error: null };
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
import { sql, getTableColumns } from "drizzle-orm";
import { referralPayoutsTable, referralsTable } from "@workspace/db";
import { getSupabaseAdmin } from "../supabase-admin";
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
  created_at timestamptz NOT NULL DEFAULT now(),
  affiliate_code text
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
  sb.referrals = [];
  sb.profileUpdateFails = false;
  sb.referralLookupFails = false;
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
    /* Seeded in the REAL schema shape (D7): the payout row carries
       NO referrer id — the referrer lives on the referrals row the
       payout's referral_id points at. */
    sb.referralPayouts.push({
      id: "rp_1",
      referral_id: "ref_1",
      stripe_session_id: "cs_pack_1",
      referee_credits_purchased: 5000,
      referrer_credits_awarded: 1250,
    });
    sb.referrals.push({
      id: "ref_1",
      referrer_user_id: REFERRER,
      referee_user_id: BUYER,
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

  it("schema pins: the fake's referral column sets ARE the drizzle schema's (the D7 guard)", async () => {
    const payoutCols = Object.values(getTableColumns(referralPayoutsTable)).map((c) => c.name).sort();
    const referralCols = Object.values(getTableColumns(referralsTable)).map((c) => c.name).sort();
    expect([...(sb.tableColumns["referral_payouts"] ?? [])].sort()).toEqual(payoutCols);
    expect([...(sb.tableColumns["referrals"] ?? [])].sort()).toEqual(referralCols);
    /* The D7 fact itself: the payout table has no referrer column —
       the referrer is reachable only through referral_id. */
    expect(payoutCols).not.toContain("referrer_user_id");
    expect(payoutCols).toContain("referral_id");
    expect(referralCols).toContain("referrer_user_id");

    /* And the harness bites: selecting the phantom column off the
       payout table errors exactly like PostgREST did in production,
       so a regression of the D7 select fails this suite, not a deploy. */
    const admin = getSupabaseAdmin() as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => {
            single: () => Promise<{ data: unknown; error: { message: string; code: string } | null }>;
          };
        };
      };
    };
    const bad = await admin
      .from("referral_payouts")
      .select("id, referrer_user_id, referrer_credits_awarded")
      .eq("stripe_session_id", "cs_pack_1")
      .single();
    expect(bad.data).toBeNull();
    expect(bad.error?.code).toBe("42703");
    expect(bad.error?.message).toBe("column referral_payouts.referrer_user_id does not exist");
  });

  it("a full reversal run twice moves BOTH balances exactly once (pack + referral legs)", async () => {
    await seedPack();
    setBalance(BUYER, 6000);
    setBalance(REFERRER, 2000);
    sb.referralPayouts.push({
      id: "rp_1",
      referral_id: "ref_1",
      stripe_session_id: "cs_pack_1",
      referee_credits_purchased: 5000,
      referrer_credits_awarded: 1250,
    });
    sb.referrals.push({ id: "ref_1", referrer_user_id: REFERRER, referee_user_id: BUYER });

    const first = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(first).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });
    expect(balance(BUYER)).toBe(1000);
    expect(balance(REFERRER)).toBe(750);

    const second = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(second).toEqual({ outcome: "duplicate" });
    expect(balance(BUYER)).toBe(1000);
    expect(balance(REFERRER)).toBe(750);
    const buyerLedger = await q(sql`SELECT * FROM credit_usage WHERE user_id = ${BUYER}`);
    expect(buyerLedger).toHaveLength(1);
    const refLedger = await q(sql`SELECT * FROM credit_usage WHERE user_id = ${REFERRER}`);
    expect(refLedger).toHaveLength(1);
  });

  it("D7 replay: pack claw landed, referral leg failed — the retry runs the referral leg only, nothing claws twice", async () => {
    /* The live incident's exact shape: a $9 pack (1,000 VB granted,
       250 VB referral share), refunded after the endpoint subscribed
       to charge.refunded. */
    await seedPack("pi_1", "cs_pack_1", 1000);
    setBalance(BUYER, 6000);
    setBalance(REFERRER, 1000);
    sb.referralPayouts.push({
      id: "rp_9",
      referral_id: "ref_9",
      stripe_session_id: "cs_pack_1",
      referee_credits_purchased: 1000,
      referrer_credits_awarded: 250,
    });
    sb.referrals.push({ id: "ref_9", referrer_user_id: REFERRER, referee_user_id: BUYER });
    const nineDollar = charge({ amountCents: 900, refundedCents: 900 });

    /* First delivery: the pack claw lands and persists, then the
       referral read fails — the reversal throws (webhook 500). */
    sb.referralLookupFails = true;
    await expect(
      processChargeReversal({ stripe: stripeFake, eventId: "evt_r1", trigger: "charge.refunded", charge: nineDollar }),
    ).rejects.toThrow("referral lookup failed");
    expect(balance(BUYER)).toBe(5000);
    expect(balance(REFERRER)).toBe(1000);
    let rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_1'`);
    expect(rows[0]).toMatchObject({ status: "failed", credits_clawed: 1000, referral_credits_clawed: 0 });

    /* Stripe's retry: the claim gate must see the referral leg's
       remaining work (the pack leg has none) and reclaim — a
       'duplicate' answer here is the second half of defect D7. */
    sb.referralLookupFails = false;
    const retry = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_r2", trigger: "charge.refunded", charge: nineDollar,
    });
    expect(retry).toMatchObject({ outcome: "reversed", creditsClawed: 1000 });
    expect(balance(BUYER)).toBe(5000);
    expect(balance(REFERRER)).toBe(750);
    rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_1'`);
    expect(rows[0]).toMatchObject({ status: "completed", credits_clawed: 1000, referral_credits_clawed: 250 });
    const buyerLedger = await q(sql`SELECT * FROM credit_usage WHERE user_id = ${BUYER}`);
    expect(buyerLedger).toHaveLength(1);
    const refLedger = await q(sql`SELECT * FROM credit_usage WHERE user_id = ${REFERRER}`);
    expect(refLedger).toHaveLength(1);
    expect(refLedger[0]).toMatchObject({ credits_used: 250, idempotency_key: "clawback:ch_1:referral:250" });

    /* A third delivery is a plain duplicate; nothing moves. */
    const third = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_r3", trigger: "charge.refunded", charge: nineDollar,
    });
    expect(third).toEqual({ outcome: "duplicate" });
    expect(balance(BUYER)).toBe(5000);
    expect(balance(REFERRER)).toBe(750);
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

describe("referral lifetime total — total_referrer_earned follows the clawback", () => {
  function earnedOf(referralId: string): number {
    return Number(sb.referrals.find((r) => r.id === referralId)?.["total_referrer_earned"] ?? 0);
  }

  /* A referred 5,000-credit pack: award 1,250 (25%). The referrals
     row's lifetime total is seeded independently of the award so the
     assertions prove the decrement is the clawed amount, not a
     zeroing. */
  async function seedReferredPack(earned: number) {
    await seedPack();
    sb.referralPayouts.push({
      id: "rp_1",
      referral_id: "ref_1",
      stripe_session_id: "cs_pack_1",
      referee_credits_purchased: 5000,
      referrer_credits_awarded: 1250,
    });
    sb.referrals.push({
      id: "ref_1",
      referrer_user_id: REFERRER,
      referee_user_id: BUYER,
      total_referrer_earned: earned,
    });
  }

  it("a full refund decrements the award's referrals row by exactly the clawed amount", async () => {
    await seedReferredPack(2000);
    setBalance(BUYER, 6000);
    setBalance(REFERRER, 2000);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });
    expect(balance(REFERRER)).toBe(750);
    expect(earnedOf("ref_1")).toBe(750); // 2,000 − 1,250 clawed
  });

  it("a replayed reversal decrements once — the duplicate run moves nothing", async () => {
    await seedReferredPack(2000);
    setBalance(BUYER, 6000);
    setBalance(REFERRER, 2000);
    await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(earnedOf("ref_1")).toBe(750);
    const out2 = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out2).toEqual({ outcome: "duplicate" });
    expect(balance(REFERRER)).toBe(750);
    expect(earnedOf("ref_1")).toBe(750);
  });

  it("partial refunds decrement pro-rata; the completing refund decrements only the remainder", async () => {
    await seedReferredPack(1250);
    setBalance(BUYER, 6000);
    setBalance(REFERRER, 2000);
    const half = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded",
      charge: charge({ refundedCents: 1950 }),
    });
    expect(half).toMatchObject({ outcome: "reversed", creditsClawed: 2500 });
    expect(balance(REFERRER)).toBe(1375); // 2,000 − 625 (half of 1,250)
    expect(earnedOf("ref_1")).toBe(625);
    const rest = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_2", trigger: "charge.refunded", charge: charge({ refundedCents: 3900 }),
    });
    expect(rest).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });
    expect(balance(REFERRER)).toBe(750);
    expect(earnedOf("ref_1")).toBe(0);
  });

  it("the decrement never drives the total negative — it floors at 0", async () => {
    /* The row's displayed total sits BELOW the award (drift the
       decrement must absorb, not amplify): the claw still takes the
       full 1,250 of VB, the total just stops at 0. */
    await seedReferredPack(400);
    setBalance(BUYER, 6000);
    setBalance(REFERRER, 2000);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });
    expect(balance(REFERRER)).toBe(750);
    expect(earnedOf("ref_1")).toBe(0);
  });

  it("a reversal with no referral award touches no lifetime total", async () => {
    await seedPack();
    setBalance(BUYER, 6000);
    setBalance(REFERRER, 2000);
    /* A referrals row exists for this buyer (another purchase paid
       it), but THIS session paid no award — nothing may move. */
    sb.referrals.push({
      id: "ref_1",
      referrer_user_id: REFERRER,
      referee_user_id: BUYER,
      total_referrer_earned: 900,
    });
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });
    expect(balance(REFERRER)).toBe(2000);
    expect(earnedOf("ref_1")).toBe(900);
  });

  it("when the referral leg lands on a Stripe retry, the decrement lands with it — once", async () => {
    /* D7-replay shape with the lifetime total watching: run 1 fails
       the referral read AFTER the pack claw persisted, so nothing
       referral-side may move; the retry runs the leg and the
       decrement together; a third delivery is a duplicate. */
    await seedPack("pi_1", "cs_pack_1", 1000);
    setBalance(BUYER, 6000);
    setBalance(REFERRER, 1000);
    sb.referralPayouts.push({
      id: "rp_9",
      referral_id: "ref_9",
      stripe_session_id: "cs_pack_1",
      referee_credits_purchased: 1000,
      referrer_credits_awarded: 250,
    });
    sb.referrals.push({
      id: "ref_9",
      referrer_user_id: REFERRER,
      referee_user_id: BUYER,
      total_referrer_earned: 250,
    });
    const nineDollar = charge({ amountCents: 900, refundedCents: 900 });

    sb.referralLookupFails = true;
    await expect(
      processChargeReversal({ stripe: stripeFake, eventId: "evt_r1", trigger: "charge.refunded", charge: nineDollar }),
    ).rejects.toThrow("referral lookup failed");
    expect(balance(REFERRER)).toBe(1000);
    expect(earnedOf("ref_9")).toBe(250);

    sb.referralLookupFails = false;
    const retry = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_r2", trigger: "charge.refunded", charge: nineDollar,
    });
    expect(retry).toMatchObject({ outcome: "reversed", creditsClawed: 1000 });
    expect(balance(REFERRER)).toBe(750);
    expect(earnedOf("ref_9")).toBe(0);

    const third = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_r3", trigger: "charge.refunded", charge: nineDollar,
    });
    expect(third).toEqual({ outcome: "duplicate" });
    expect(balance(REFERRER)).toBe(750);
    expect(earnedOf("ref_9")).toBe(0);
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

  it("a refunded BUNDLE sale unwinds its series grant rows — but never the buyer's standalone purchase of the same series", async () => {
    /* Stack-100 #3 F15: a bundle's series components are granted as $0
       digital_sales rows keyed '<session>#grant:series:<itemId>'. */
    const seriesItem = "35353535-3535-4535-8535-353535353535";
    sessionsByPi.set("pi_bundle", [{ id: "cs_bundle_1", metadata: {} }]);
    const bundleSale = await q(sql`
      INSERT INTO digital_sales (buyer_user_id, profile_id, item_kind, item_id, stripe_session_id, amount_cents, creator_amount_cents)
      VALUES (${BUYER}, ${CREATOR}, 'bundle', gen_random_uuid(), 'cs_bundle_1', 1299, 1234) RETURNING id
    `);
    const bundleSaleId = String(bundleSale[0]?.["id"]);
    await q(sql`
      INSERT INTO digital_sales (buyer_user_id, profile_id, item_kind, item_id, stripe_session_id, amount_cents, creator_amount_cents)
      VALUES (${BUYER}, ${CREATOR}, 'series', ${seriesItem}, 'cs_bundle_1#grant:series:35353535-3535-4535-8535-353535353535', 0, 0)
    `);
    /* The buyer's OWN standalone purchase of the same series — a
       different checkout session — must survive the bundle refund. */
    await q(sql`
      INSERT INTO digital_sales (buyer_user_id, profile_id, item_kind, item_id, stripe_session_id, amount_cents, creator_amount_cents)
      VALUES (${BUYER}, ${CREATOR}, 'series', ${seriesItem}, 'cs_standalone_1', 1999, 1899)
    `);
    await q(sql`
      INSERT INTO download_links (token, sale_id, file_url, expires_at)
      VALUES ('tok_bundle', ${bundleSaleId}, 'https://files.example/track.mp3', now() + interval '48 hours')
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_bundle1", trigger: "charge.refunded",
      charge: charge({ id: "ch_bundle", paymentIntentId: "pi_bundle", amountCents: 1299, refundedCents: 1299 }),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "digital_sale" });
    const rows = await q(sql`
      SELECT stripe_session_id, status FROM digital_sales
      WHERE stripe_session_id IN ('cs_bundle_1', 'cs_bundle_1#grant:series:35353535-3535-4535-8535-353535353535', 'cs_standalone_1')
      ORDER BY stripe_session_id
    `);
    const bySession = new Map(rows.map((r) => [String(r["stripe_session_id"]), String(r["status"])]));
    expect(bySession.get("cs_bundle_1")).toBe("refunded");
    expect(bySession.get("cs_bundle_1#grant:series:35353535-3535-4535-8535-353535353535")).toBe("refunded");
    expect(bySession.get("cs_standalone_1")).toBe("completed");
    const link = await q(sql`SELECT expires_at FROM download_links WHERE token = 'tok_bundle'`);
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
