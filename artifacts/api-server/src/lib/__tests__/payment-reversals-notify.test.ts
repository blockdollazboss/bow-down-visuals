/**
 * payment-reversals-notify.test.ts — notification-completeness
 * census (stack1200): when a payment reversal lands, the people it
 * takes money or access FROM must hear it.
 *
 * THE GAP: processChargeReversal clawed pack Bucs from buyers,
 * clawed referral earnings from referrers, revoked buyers'
 * entitlements and reversed sellers' ledgers — and told NONE of
 * them (only sponsor/performance creators were told, inside
 * reverseEntitlement). Balances and libraries changed silently.
 *
 * The fix fires four tells at the completion point, each gated by
 * what THIS run actually did and claimed on job_notifications
 * (jobType "sale") so replays and top-up runs never double-tell:
 * the pack claw (buyer), the referral claw (referrer), the
 * entitlement revocation (buyer), and the seller-ledger reversal
 * (seller, sponsor/performance excluded — already told). Scaffolding
 * (pg-mem + schema-faithful Supabase fake) is shared with
 * payment-reversals.test.ts.
 */
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
      /* Join #2: the referral lanes extended the schema — canonical
         email (0275) + welcome_status (0276). The D7 guard exists to
         force exactly this sync. */
      "referee_canonical_email", "welcome_status",
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
import { __setJobNotificationsDb } from "../job-notifications";
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
CREATE TABLE digital_license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  buyer_user_id uuid NOT NULL,
  item_kind text NOT NULL,
  item_id uuid NOT NULL,
  item_title text NOT NULL DEFAULT '',
  file_url text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_cipher text NOT NULL,
  key_suffix text NOT NULL,
  max_downloads integer,
  download_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  revoked_at timestamptz,
  revoked_reason text,
  reissue_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
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
  buyer_user_id uuid,
  stripe_session_id text,
  payment_status text,
  quantity integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  affiliate_code text
, bump_for_product_id uuid);
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

/* ── Census additions (stack1200): the tell tables ──────────────────
   job_notifications (the exactly-once claim ledger), notifications
   (the member bell), push_notification_prefs (the door's gate),
   creator_profiles (digital/storefront seller resolution) and
   push_subscriptions (the door's push leg reads it). Column sets
   follow the live drizzle schemas. */
const EXTRA_DDL = `
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE push_notification_prefs (
  user_id uuid PRIMARY KEY,
  money_enabled boolean NOT NULL DEFAULT true,
  messages_enabled boolean NOT NULL DEFAULT true,
  live_enabled boolean NOT NULL DEFAULT true,
  mentions_enabled boolean NOT NULL DEFAULT true,
  social_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL DEFAULT '',
  auth text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
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
  t.mem.public.none(EXTRA_DDL);
  /* The claim ledger rides the same pg-mem database through the
     module's own test seam (production uses its pg Pool). */
  __setJobNotificationsDb({ execute: (query: unknown) => testState.db.execute(query) } as never);
  testState.db = t.db;
  sb.profiles.clear();
  sb.referralPayouts = [];
  sb.referrals = [];
  sb.profileUpdateFails = false;
  sb.referralLookupFails = false;
  sessionsByPi.clear();
  vi.clearAllMocks();
});

/* Scenarios appended to payment-reversals-notify.test.ts by the
   generator step — see that file. This staging file is merged in
   and deleted by the same step. */

async function bellsFor(userId: string) {
  return q(sql`SELECT * FROM notifications WHERE user_id = ${userId} ORDER BY created_at ASC`);
}
async function claimRows() {
  return q(sql`SELECT * FROM job_notifications ORDER BY created_at ASC`);
}

describe("reversal party tells — the clawed and revoked hear it", () => {
  it("a full pack refund tells the buyer the clawed amount and the referrer theirs — once", async () => {
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
      total_referrer_earned: 2000,
    });
    setBalance(BUYER, 6000);
    setBalance(REFERRER, 2000);

    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });

    const buyerBells = await bellsFor(BUYER);
    expect(buyerBells).toHaveLength(1);
    expect(buyerBells[0]).toMatchObject({ kind: "reversal_pack_clawback", link: "/credit-history" });
    expect(String(buyerBells[0]?.["body"])).toContain("5,000");

    const referrerBells = await bellsFor(REFERRER);
    expect(referrerBells).toHaveLength(1);
    expect(referrerBells[0]).toMatchObject({ kind: "reversal_referral_clawback", link: "/referrals" });
    expect(String(referrerBells[0]?.["body"])).toContain("1,250");

    expect(await claimRows()).toHaveLength(2);

    /* A replayed webhook moves nothing and tells nothing new. */
    const out2 = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded", charge: charge({}),
    });
    expect(out2).toEqual({ outcome: "duplicate" });
    expect(await bellsFor(BUYER)).toHaveLength(1);
    expect(await bellsFor(REFERRER)).toHaveLength(1);
  });

  it("a partial then completing refund tells each run's own clawed amount, never a repeat", async () => {
    await seedPack();
    setBalance(BUYER, 6000);
    const half = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_1", trigger: "charge.refunded",
      charge: charge({ refundedCents: 1950 }),
    });
    expect(half).toMatchObject({ outcome: "reversed", creditsClawed: 2500 });
    const rest = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_2", trigger: "charge.refunded", charge: charge({}),
    });
    expect(rest).toMatchObject({ outcome: "reversed", creditsClawed: 5000 });

    const buyerBells = await bellsFor(BUYER);
    expect(buyerBells).toHaveLength(2);
    expect(String(buyerBells[0]?.["body"])).toContain("2,500");
    expect(String(buyerBells[1]?.["body"])).toContain("2,500");
    /* Each tell names THIS run's take-back (2,500 + 2,500), keyed by
       the running total so neither is a duplicate of the other. */
    const claims = await claimRows();
    expect(claims.map((c) => c["job_id"]).sort()).toEqual([
      "rev:ch_1:pack:2500",
      "rev:ch_1:pack:5000",
    ]);
  });

  it("a beat license reversal tells the buyer (access removed) and the producer (sale reversed)", async () => {
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

    const buyerBells = await bellsFor(BUYER);
    expect(buyerBells).toHaveLength(1);
    expect(buyerBells[0]).toMatchObject({ kind: "reversal_purchase_refunded", link: "/beats" });

    const producerBells = await bellsFor(CREATOR);
    expect(producerBells).toHaveLength(1);
    expect(producerBells[0]).toMatchObject({ kind: "reversal_sale_reversed", link: "/beats" });
    /* The seller copy names NO amount — the reversal engine does not
       compute the seller-ledger figure, and the tell never invents
       one. */
    expect(String(producerBells[0]?.["body"])).not.toMatch(/\$\d/);
  });

  it("a digital-sale reversal resolves the seller through the profile and tells them — and tells the buyer", async () => {
    sessionsByPi.set("pi_d", [{ id: "cs_d_1", metadata: {} }]);
    const profileId = "44444444-4444-4444-8444-444444444444";
    await q(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${profileId}, ${CREATOR})`);
    const sale = await q(sql`
      INSERT INTO digital_sales (buyer_user_id, profile_id, stripe_session_id, amount_cents, creator_amount_cents)
      VALUES (${BUYER}, ${profileId}, 'cs_d_1', 2000, 1900) RETURNING id
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

    const sellerBells = await bellsFor(CREATOR);
    expect(sellerBells).toHaveLength(1);
    expect(sellerBells[0]).toMatchObject({ kind: "reversal_sale_reversed", link: "/earnings" });
    /* The digital buyer DOES carry an account identity on this
       rail (digital_sales.buyer_user_id is NOT NULL and the probe
       names it) — the buyer hears the purchase was reversed too. */
    const buyerBells = await bellsFor(BUYER);
    expect(buyerBells).toHaveLength(1);
    expect(buyerBells[0]).toMatchObject({ kind: "reversal_purchase_refunded", link: "/library" });
  });
});

/* ── FIND2 (stack1200): the buyer entitlement tell reaches the
   digital, storefront and marketplace buyers ─────────────────────
   reverseEntitlement already revoked these buyers' access (their
   rows flip), but REVERSAL_BUYER_LINKS named only membership /
   beat_license / live_shop_sale, so the revocation landed in
   silence. Identity was never the blocker:
     · digital_sales.buyer_user_id is NOT NULL — the probe names it;
     · store_orders.buyer_user_id is nullable (guest checkout) —
       the probe names it when present, and a null recipient no-ops;
     · shop_events.buyer_user_id exists (migration 0297) but the
       marketplace probe never selected it — and on that rail
       ident.userId is the SELLER, so the buyer id must ride in
       ident.details and the buyer tell must read it from there.
   (Shoutout fans carry NO account id by design — free-form fan
   identity in v1 — so no shoutout buyer tell is wired, ever.) */
describe("reversal buyer tells — digital / storefront / marketplace", () => {
  const PROFILE = "44444444-4444-4444-8444-444444444444";

  it("a digital buyer is told exactly once when a landed reversal revokes the purchase", async () => {
    sessionsByPi.set("pi_d2", [{ id: "cs_d2_1", metadata: {} }]);
    await q(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${CREATOR})`);
    await q(sql`
      INSERT INTO digital_sales (buyer_user_id, profile_id, stripe_session_id, amount_cents, creator_amount_cents)
      VALUES (${BUYER}, ${PROFILE}, 'cs_d2_1', 2000, 1900)
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_d2", trigger: "charge.refunded",
      charge: charge({ id: "ch_d2", paymentIntentId: "pi_d2", amountCents: 2000, refundedCents: 2000 }),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "digital_sale" });

    const buyerBells = await bellsFor(BUYER);
    expect(buyerBells).toHaveLength(1);
    expect(buyerBells[0]).toMatchObject({
      kind: "reversal_purchase_refunded",
      title: "Your purchase was reversed",
      link: "/library",
    });
    /* The seller tell still lands alongside — neither steals the other. */
    expect(await bellsFor(CREATOR)).toHaveLength(1);
    const claims = await claimRows();
    expect(claims.map((c) => `${String(c["user_id"])}:${String(c["job_id"])}`).sort()).toEqual([
      `${BUYER}:rev:ch_d2:entitlement`,
      `${CREATOR}:rev:ch_d2:seller`,
    ]);

    /* A replayed webhook tells nothing twice. */
    const out2 = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_d2", trigger: "charge.refunded",
      charge: charge({ id: "ch_d2", paymentIntentId: "pi_d2", amountCents: 2000, refundedCents: 2000 }),
    });
    expect(out2).toEqual({ outcome: "duplicate" });
    expect(await bellsFor(BUYER)).toHaveLength(1);
  });

  it("a storefront buyer is told once when a landed reversal revokes the order", async () => {
    sessionsByPi.set("pi_s2", [{ id: "cs_s2_1", metadata: {} }]);
    await q(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${CREATOR})`);
    await q(sql`
      INSERT INTO store_orders (buyer_user_id, profile_id, amount_cents, creator_amount_cents, stripe_session_id, status)
      VALUES (${BUYER}, ${PROFILE}, 3000, 2850, 'cs_s2_1', 'completed')
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_s2", trigger: "charge.refunded",
      charge: charge({ id: "ch_s2", paymentIntentId: "pi_s2", amountCents: 3000, refundedCents: 3000 }),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "storefront_order" });

    const buyerBells = await bellsFor(BUYER);
    expect(buyerBells).toHaveLength(1);
    expect(buyerBells[0]).toMatchObject({ kind: "reversal_purchase_refunded", link: "/library" });
    expect(await bellsFor(CREATOR)).toHaveLength(1);
  });

  it("a storefront GUEST order (buyer_user_id null) gets no buyer tell — and the reversal still lands", async () => {
    sessionsByPi.set("pi_s3", [{ id: "cs_s3_1", metadata: {} }]);
    await q(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${CREATOR})`);
    await q(sql`
      INSERT INTO store_orders (buyer_user_id, profile_id, amount_cents, creator_amount_cents, stripe_session_id, status)
      VALUES (NULL, ${PROFILE}, 3000, 2850, 'cs_s3_1', 'completed')
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_s3", trigger: "charge.refunded",
      charge: charge({ id: "ch_s3", paymentIntentId: "pi_s3", amountCents: 3000, refundedCents: 3000 }),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "storefront_order" });
    const orders = await q(sql`SELECT status FROM store_orders WHERE stripe_session_id = 'cs_s3_1'`);
    expect(orders[0]?.["status"]).toBe("refunded");
    /* No account, no tell — and no tell is faked to anyone else:
       the only bell is the seller's. */
    expect(await bellsFor(BUYER)).toHaveLength(0);
    const sellerBells = await bellsFor(CREATOR);
    expect(sellerBells).toHaveLength(1);
    expect(sellerBells[0]).toMatchObject({ kind: "reversal_sale_reversed" });
  });

  it("a marketplace buyer is told once — and the seller (ident.userId on this rail) is still told", async () => {
    sessionsByPi.set("pi_m", [{ id: "cs_m_1", metadata: {} }]);
    await q(sql`
      INSERT INTO shop_events (user_id, event_type, amount_cents, platform_fee_cents, buyer_email, buyer_user_id, stripe_session_id, payment_status)
      VALUES (${CREATOR}, 'sale', 2500, 125, 'buyer@example.com', ${BUYER}, 'cs_m_1', 'paid')
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_m1", trigger: "charge.refunded",
      charge: charge({ id: "ch_m", paymentIntentId: "pi_m", amountCents: 2500, refundedCents: 2500 }),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "marketplace_shop" });

    const buyerBells = await bellsFor(BUYER);
    expect(buyerBells).toHaveLength(1);
    expect(buyerBells[0]).toMatchObject({ kind: "reversal_purchase_refunded", link: "/library" });

    /* The buyer tell must NOT steal the seller's: on this rail
       ident.userId is the seller, and the seller tell reads it. */
    const sellerBells = await bellsFor(CREATOR);
    expect(sellerBells).toHaveLength(1);
    expect(sellerBells[0]).toMatchObject({ kind: "reversal_sale_reversed", link: "/earnings" });

    const claims = await claimRows();
    expect(claims.map((c) => `${String(c["user_id"])}:${String(c["job_id"])}`).sort()).toEqual([
      `${BUYER}:rev:ch_m:entitlement`,
      `${CREATOR}:rev:ch_m:seller`,
    ]);

    /* A replay / second completion point tells nobody twice.
       (The replay's outcome is deliberately not pinned here: the
       marketplace probe matches only 'sale'/'pending_sale' lines,
       so after the flip a replay no longer identifies the rail —
       pre-existing engine behaviour, unchanged by this fix. What
       the claim discipline guarantees, and what this pins, is that
       no second tell lands for either party.) */
    await processChargeReversal({
      stripe: stripeFake, eventId: "evt_m1", trigger: "charge.refunded",
      charge: charge({ id: "ch_m", paymentIntentId: "pi_m", amountCents: 2500, refundedCents: 2500 }),
    });
    expect(await bellsFor(BUYER)).toHaveLength(1);
    expect(await bellsFor(CREATOR)).toHaveLength(1);
    expect(await claimRows()).toHaveLength(2);
  });

  it("a marketplace GUEST line (buyer_user_id null) gets no buyer tell — the seller still hears it", async () => {
    sessionsByPi.set("pi_m2", [{ id: "cs_m2_1", metadata: {} }]);
    await q(sql`
      INSERT INTO shop_events (user_id, event_type, amount_cents, platform_fee_cents, buyer_email, buyer_user_id, stripe_session_id, payment_status)
      VALUES (${CREATOR}, 'sale', 2500, 125, 'guest@example.com', NULL, 'cs_m2_1', 'paid')
    `);
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_m2", trigger: "charge.refunded",
      charge: charge({ id: "ch_m2", paymentIntentId: "pi_m2", amountCents: 2500, refundedCents: 2500 }),
    });
    expect(out).toMatchObject({ outcome: "reversed", rail: "marketplace_shop" });
    const lines = await q(sql`SELECT event_type FROM shop_events WHERE stripe_session_id = 'cs_m2_1'`);
    expect(lines[0]?.["event_type"]).toBe("refunded_sale");
    expect(await bellsFor(BUYER)).toHaveLength(0);
    const sellerBells = await bellsFor(CREATOR);
    expect(sellerBells).toHaveLength(1);
    expect(sellerBells[0]).toMatchObject({ kind: "reversal_sale_reversed" });
  });
});
