/**
 * payment-reversals-rails.test.ts — stack800 Lane 1, items 15–17:
 * the D1 dashboard-refund clawback for the store / beats / sponsor /
 * shoutout rails, driven through the REAL webhook handler
 * (charge.refunded → stripeWebhookHandler → processStripeChargeReversal)
 * over pg-mem, with the Stripe client and Supabase mocked — the
 * stripe-webhook-reversals.test.ts pattern.
 *
 * INVENTORY against the pre-existing suites (what they already prove,
 * so this file writes only the missing end-to-end pins):
 *  - payment-reversals.test.ts drives processChargeReversal DIRECTLY
 *    (never the webhook) for: credit packs, referral totals,
 *    memberships, and a "beats / digital / marketplace" describe —
 *    an EXCLUSIVE beat license flip + sellable-again, digital sales,
 *    and shop_events marketplace lines. Its DDL declares store_orders,
 *    live_shop_sales, tip_jar_tips, shoutout_requests, sponsor_deals
 *    and sponsor_payouts, but NO test in it touches those tables.
 *  - stripe-webhook-reversals.test.ts drives the webhook only for
 *    credit packs + the unidentifiable-charge manual-review row.
 *  - stripe-webhook-sponsor-pi.test.ts covers sponsor escrow FUNDING
 *    (payment_intent.succeeded → markEscrowFunded), not reversal.
 *
 * So the missing pins, per item:
 *  15. STOREFRONT store rail — the engine keys on store_orders by
 *      stripe_session_id = the Checkout session id (session metadata
 *      type='storefront_purchase', written by routes/storefront.ts
 *      verify). This is a DOLLAR rail: granted_credits is 0 and no VB
 *      moves; the grant being clawed is the entitlement itself —
 *      order status, the delivery token, and co-seller split entries.
 *  16. BEATS rail — beat_licenses keyed on the session id: the
 *      webhook-level pin (incl. a NON-exclusive tier and the
 *      partial-refund-keeps-license rule) was missing entirely.
 *  17a. SPONSOR rail — sponsor_deals identified via the Checkout
 *      session's metadata.sponsor_deal_id (or the deal's
 *      stripe_session_id): a RELEASED deal (a sponsor_payouts row
 *      exists) parks in manual review BY DESIGN; an UNRELEASED funded
 *      deal auto-returns to escrow_status='unfunded'. The on-site
 *      PaymentIntent funding shape (deal's stripe_session_id IS the
 *      PI id — markEscrowFunded(dealId, pi.id, pi.id)) has NO
 *      Checkout session for sessions.list to find; since the
 *      escrow-refund-identify fix, identifyRail probes sponsor_deals
 *      by payment-intent id on the session miss, so a PI-funded
 *      refund walks the SAME sponsor_deal path (unreleased →
 *      auto-unfund; released → identified manual review). A payment
 *      intent no deal records still parks as UNIDENTIFIED.
 *  17b. SHOUTOUT rail — shoutout_requests keyed on the session id
 *      (checkout metadata type='shoutout_request'): a full refund
 *      flips the paid request to 'refunded'. Also a dollar rail —
 *      granted_credits 0, no VB moves; the entitlement is the request.
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
  event_type text NOT NULL,
  stripe_session_id text,
  payment_status text,
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
CREATE TABLE sale_split_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_kind text NOT NULL,
  sale_id uuid NOT NULL,
  product_id uuid,
  seller_user_id uuid,
  owner_user_id uuid,
  amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'earned',
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
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
`;

const BUYER = "11111111-1111-4111-8111-111111111111";
const CREATOR = "22222222-2222-4222-8222-222222222222";
const PROFILE = "44444444-4444-4444-8444-444444444444";

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

function refundEvent(over: {
  eventId?: string;
  chargeId: string;
  pi: string;
  amount: number;
  refunded: number;
}) {
  return {
    id: over.eventId ?? "evt_r1",
    type: "charge.refunded",
    data: {
      object: {
        id: over.chargeId,
        payment_intent: over.pi,
        amount: over.amount,
        amount_refunded: over.refunded,
        currency: "usd",
      },
    },
  };
}

async function q(query: ReturnType<typeof sql>) {
  const r = await testState.db.execute(query);
  return r.rows as Array<Record<string, unknown>>;
}

async function reversalRow(chargeId: string) {
  const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = ${chargeId}`);
  return rows[0];
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
  /* A VB balance that must NOT move on any of these dollar rails. */
  sb.profiles.set(BUYER, { id: BUYER, credits: 6000, bonus_credits: 0, bonus_credits_expires_at: null });
  vi.clearAllMocks();
});

/* ═══ Item 15 — STOREFRONT store rail (store_orders) ═══════════════ */

describe("item 15 — storefront store rail reversal (store_orders, via webhook)", () => {
  async function seedStoreOrder() {
    h.sessionsByPi.set("pi_store", [
      { id: "cs_store_1", metadata: { type: "storefront_purchase", buyer_user_id: BUYER, profile_id: PROFILE } },
    ]);
    const order = await q(sql`
      INSERT INTO store_orders (buyer_user_id, profile_id, product_id, amount_cents, creator_amount_cents, stripe_session_id, status)
      VALUES (${BUYER}, ${PROFILE}, gen_random_uuid(), 5000, 4750, 'cs_store_1', 'completed')
      RETURNING id
    `);
    const orderId = String(order[0]?.["id"]);
    await q(sql`
      INSERT INTO store_delivery_tokens (token, order_id, file_url, expires_at)
      VALUES ('tok_store_1', ${orderId}, 'https://files.example/pack.zip', now() + interval '48 hours')
    `);
    await q(sql`
      INSERT INTO sale_split_entries (sale_kind, sale_id, seller_user_id, owner_user_id, amount_cents, status)
      VALUES ('store_order', ${orderId}, ${CREATOR}, ${CREATOR}, 4750, 'earned')
    `);
    return orderId;
  }

  it("a full dashboard refund revokes the order, kills the delivery token and reverses the split entries — no VB moves on this dollar rail", async () => {
    const orderId = await seedStoreOrder();
    const res = await deliver(refundEvent({ chargeId: "ch_store", pi: "pi_store", amount: 5000, refunded: 5000 }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, reversed: true, rail: "storefront_order", creditsClawed: 0 });

    const orders = await q(sql`SELECT status FROM store_orders WHERE id = ${orderId}`);
    expect(orders[0]?.["status"]).toBe("refunded");
    const token = await q(sql`SELECT expires_at FROM store_delivery_tokens WHERE token = 'tok_store_1'`);
    expect(new Date(String(token[0]?.["expires_at"])).getTime()).toBeLessThanOrEqual(Date.now());
    const splits = await q(sql`SELECT status, reversed_at FROM sale_split_entries WHERE sale_id = ${orderId}`);
    expect(splits[0]?.["status"]).toBe("reversed");
    expect(splits[0]?.["reversed_at"]).not.toBeNull();

    const row = await reversalRow("ch_store");
    expect(row).toMatchObject({
      rail: "storefront_order", status: "completed", granted_credits: 0,
      credits_clawed: 0, entitlement_revoked: true, seller_reversed: true,
    });
    /* The dollar refund is Stripe's side; no Visual Bucs were granted
       by this purchase, so none can remain clawed-or-unclawed. */
    expect(Number(sb.profiles.get(BUYER)?.["credits"])).toBe(6000);
    const ledger = await q(sql`SELECT * FROM credit_usage`);
    expect(ledger).toHaveLength(0);

    /* Replay: duplicate, nothing flips a second time. */
    const again = await deliver(refundEvent({ chargeId: "ch_store", pi: "pi_store", amount: 5000, refunded: 5000 }));
    expect(again.statusCode).toBe(200);
    expect(again.body).toMatchObject({ received: true, duplicate: true });
    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_store'`);
    expect(rows).toHaveLength(1);
  });

  it("a partial refund keeps the order + token (recorded, not silent); the completing refund revokes", async () => {
    const orderId = await seedStoreOrder();
    const half = await deliver(refundEvent({ chargeId: "ch_store", pi: "pi_store", amount: 5000, refunded: 2500 }));
    expect(half.statusCode).toBe(200);
    expect(half.body).toMatchObject({ received: true, reversed: true, rail: "storefront_order" });
    let orders = await q(sql`SELECT status FROM store_orders WHERE id = ${orderId}`);
    expect(orders[0]?.["status"]).toBe("completed");
    const token = await q(sql`SELECT expires_at FROM store_delivery_tokens WHERE token = 'tok_store_1'`);
    expect(new Date(String(token[0]?.["expires_at"])).getTime()).toBeGreaterThan(Date.now());
    const row = await reversalRow("ch_store");
    expect((row?.["details"] as Record<string, unknown>)?.["partialRefundEntitlementKept"]).toBe(true);
    expect(row).toMatchObject({ entitlement_revoked: false });

    const full = await deliver(
      refundEvent({ eventId: "evt_r2", chargeId: "ch_store", pi: "pi_store", amount: 5000, refunded: 5000 }),
    );
    expect(full.body).toMatchObject({ received: true, reversed: true, rail: "storefront_order" });
    orders = await q(sql`SELECT status FROM store_orders WHERE id = ${orderId}`);
    expect(orders[0]?.["status"]).toBe("refunded");
  });
});

/* ═══ Item 16 — BEATS rail (beat_licenses) ═════════════════════════ */

describe("item 16 — beats rail reversal (beat_licenses, via webhook)", () => {
  async function seedLicense(tier: string, exclusiveSold: boolean) {
    h.sessionsByPi.set("pi_beat", [{ id: "cs_beat_1", metadata: {} }]);
    const beat = await q(sql`INSERT INTO beats (exclusive_sold) VALUES (${exclusiveSold}) RETURNING id`);
    const beatId = String(beat[0]?.["id"]);
    await q(sql`
      INSERT INTO beat_licenses (beat_id, buyer_id, producer_id, tier, price_cents, commission_cents, status, stripe_session_id)
      VALUES (${beatId}, ${BUYER}, ${CREATOR}, ${tier}, 4999, 750, 'completed', 'cs_beat_1')
    `);
    return beatId;
  }

  it("a full refund on a NON-exclusive (premium) license revokes it via the webhook — replay is a duplicate", async () => {
    await seedLicense("premium", false);
    const res = await deliver(refundEvent({ chargeId: "ch_beat", pi: "pi_beat", amount: 4999, refunded: 4999 }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, reversed: true, rail: "beat_license", creditsClawed: 0 });
    const lic = await q(sql`SELECT status FROM beat_licenses WHERE stripe_session_id = 'cs_beat_1'`);
    expect(lic[0]?.["status"]).toBe("refunded");
    const row = await reversalRow("ch_beat");
    expect(row).toMatchObject({ rail: "beat_license", status: "completed", entitlement_revoked: true, seller_reversed: true });
    expect(Number(sb.profiles.get(BUYER)?.["credits"])).toBe(6000);

    const again = await deliver(refundEvent({ chargeId: "ch_beat", pi: "pi_beat", amount: 4999, refunded: 4999 }));
    expect(again.body).toMatchObject({ received: true, duplicate: true });
  });

  it("a full refund on an EXCLUSIVE license via the webhook makes the beat sellable again (webhook-level pin for the engine-proven flip)", async () => {
    const beatId = await seedLicense("exclusive", true);
    const res = await deliver(refundEvent({ chargeId: "ch_beatx", pi: "pi_beat", amount: 49999, refunded: 49999 }));
    expect(res.body).toMatchObject({ received: true, reversed: true, rail: "beat_license" });
    const lic = await q(sql`SELECT status FROM beat_licenses WHERE stripe_session_id = 'cs_beat_1'`);
    expect(lic[0]?.["status"]).toBe("refunded");
    const beat = await q(sql`SELECT exclusive_sold FROM beats WHERE id = ${beatId}`);
    expect(beat[0]?.["exclusive_sold"]).toBe(false);
  });

  it("a partial refund keeps the license 'completed' (recorded); the completing refund revokes it", async () => {
    await seedLicense("premium", false);
    const half = await deliver(refundEvent({ chargeId: "ch_beatp", pi: "pi_beat", amount: 4999, refunded: 2500 }));
    expect(half.body).toMatchObject({ received: true, reversed: true, rail: "beat_license" });
    let lic = await q(sql`SELECT status FROM beat_licenses WHERE stripe_session_id = 'cs_beat_1'`);
    expect(lic[0]?.["status"]).toBe("completed");
    const row = await reversalRow("ch_beatp");
    expect((row?.["details"] as Record<string, unknown>)?.["partialRefundEntitlementKept"]).toBe(true);

    const full = await deliver(
      refundEvent({ eventId: "evt_r2", chargeId: "ch_beatp", pi: "pi_beat", amount: 4999, refunded: 4999 }),
    );
    expect(full.body).toMatchObject({ received: true, reversed: true, rail: "beat_license" });
    lic = await q(sql`SELECT status FROM beat_licenses WHERE stripe_session_id = 'cs_beat_1'`);
    expect(lic[0]?.["status"]).toBe("refunded");
  });
});

/* ═══ Item 17a — SPONSOR rail (sponsor_deals escrow) ═══════════════ */

describe("item 17a — sponsor escrow reversal (sponsor_deals, via webhook)", () => {
  const DEAL = "55555555-5555-4555-8555-555555555555";

  it("RELEASED deal (payout row exists): the refund parks in MANUAL REVIEW by design — escrow + payout untouched, replay stays parked, nothing silently dropped", async () => {
    h.sessionsByPi.set("pi_sponsor", [
      { id: "cs_sponsor_1", metadata: { sponsor_deal_id: DEAL, sponsor_escrow: "true" } },
    ]);
    await q(sql`
      INSERT INTO sponsor_deals (id, escrow_status, status, stripe_session_id)
      VALUES (${DEAL}, 'released', 'paid', 'cs_sponsor_1')
    `);
    const payout = await q(sql`
      INSERT INTO sponsor_payouts (deal_id, status) VALUES (${DEAL}, 'released') RETURNING id
    `);
    const payoutId = String(payout[0]?.["id"]);

    const res = await deliver(refundEvent({ chargeId: "ch_sponsor_rel", pi: "pi_sponsor", amount: 100000, refunded: 100000 }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, warning: "Reversal needs manual review", rail: "sponsor_deal" });

    const row = await reversalRow("ch_sponsor_rel");
    expect(row).toMatchObject({ rail: "sponsor_deal", status: "needs_manual_review", entitlement_revoked: false });
    const details = row?.["details"] as Record<string, unknown>;
    expect(details?.["payoutId"]).toBe(payoutId);
    expect(String(details?.["manualReason"])).toContain("already released");

    /* Escrow state untouched — a human reconciles the creator side. */
    const deal = await q(sql`SELECT escrow_status, status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal[0]).toMatchObject({ escrow_status: "released", status: "paid" });
    const payouts = await q(sql`SELECT status FROM sponsor_payouts WHERE deal_id = ${DEAL}`);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]?.["status"]).toBe("released");

    const again = await deliver(refundEvent({ chargeId: "ch_sponsor_rel", pi: "pi_sponsor", amount: 100000, refunded: 100000 }));
    expect(again.body).toMatchObject({ received: true, warning: "Reversal needs manual review", rail: "sponsor_deal" });
    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_sponsor_rel'`);
    expect(rows).toHaveLength(1);
  });

  it("UNRELEASED funded deal (Checkout-funded): a full refund auto-returns the escrow to 'unfunded', so it can never be released against refunded money", async () => {
    h.sessionsByPi.set("pi_sponsor", [
      { id: "cs_sponsor_1", metadata: { sponsor_deal_id: DEAL, sponsor_escrow: "true" } },
    ]);
    await q(sql`
      INSERT INTO sponsor_deals (id, escrow_status, status, stripe_session_id)
      VALUES (${DEAL}, 'funded', 'funded', 'cs_sponsor_1')
    `);

    const res = await deliver(refundEvent({ chargeId: "ch_sponsor_unrel", pi: "pi_sponsor", amount: 100000, refunded: 100000 }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, reversed: true, rail: "sponsor_deal", creditsClawed: 0 });

    const deal = await q(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal[0]?.["escrow_status"]).toBe("unfunded");
    const row = await reversalRow("ch_sponsor_unrel");
    expect(row).toMatchObject({ rail: "sponsor_deal", status: "completed", entitlement_revoked: true, seller_reversed: true });

    const again = await deliver(refundEvent({ chargeId: "ch_sponsor_unrel", pi: "pi_sponsor", amount: 100000, refunded: 100000 }));
    expect(again.body).toMatchObject({ received: true, duplicate: true });
    const deal2 = await q(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal2[0]?.["escrow_status"]).toBe("unfunded");
  });

  it("UNRELEASED funded deal funded on-site by PaymentIntent (stripe_session_id IS the PI id, no Checkout session): the refund is identified by payment-intent id and auto-returns the escrow to 'unfunded' — the deal moves with the refund exactly as the Checkout-funded shape does", async () => {
    /* The exact shape stripe-webhook-sponsor-pi.test.ts proves the
       funding side writes: markEscrowFunded(dealId, pi.id, pi.id).
       sessions.list(payment_intent) finds no Checkout session for a
       bare PaymentIntent; identifyRail's sponsor_deals PI probe is
       what reaches the deal. (Pre-fix this parked as UNIDENTIFIED
       with the escrow left 'funded' — lane 1 FLAG 2.) */
    await q(sql`
      INSERT INTO sponsor_deals (id, escrow_status, status, stripe_session_id, stripe_payment_intent_id)
      VALUES (${DEAL}, 'funded', 'funded', 'pi_sponsor_pi', 'pi_sponsor_pi')
    `);

    const res = await deliver(refundEvent({ chargeId: "ch_sponsor_pi", pi: "pi_sponsor_pi", amount: 100000, refunded: 100000 }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, reversed: true, rail: "sponsor_deal", creditsClawed: 0 });

    const deal = await q(sql`SELECT escrow_status, status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal[0]).toMatchObject({ escrow_status: "unfunded", status: "funded" });
    const row = await reversalRow("ch_sponsor_pi");
    expect(row).toMatchObject({
      rail: "sponsor_deal", status: "completed", session_id: "pi_sponsor_pi",
      entitlement_revoked: true, seller_reversed: true,
    });

    const again = await deliver(refundEvent({ chargeId: "ch_sponsor_pi", pi: "pi_sponsor_pi", amount: 100000, refunded: 100000 }));
    expect(again.body).toMatchObject({ received: true, duplicate: true });
    const deal2 = await q(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal2[0]?.["escrow_status"]).toBe("unfunded");
  });

  it("PI-funded deal, partial refund before release: the escrow stays 'funded' (entitlement kept, recorded); the completing refund auto-unfunds it", async () => {
    await q(sql`
      INSERT INTO sponsor_deals (id, escrow_status, status, stripe_session_id, stripe_payment_intent_id)
      VALUES (${DEAL}, 'funded', 'funded', 'pi_sponsor_pi', 'pi_sponsor_pi')
    `);

    const half = await deliver(refundEvent({ chargeId: "ch_sponsor_pi_part", pi: "pi_sponsor_pi", amount: 100000, refunded: 50000 }));
    expect(half.body).toMatchObject({ received: true, reversed: true, rail: "sponsor_deal" });
    let deal = await q(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal[0]?.["escrow_status"]).toBe("funded");
    const row = await reversalRow("ch_sponsor_pi_part");
    expect(row).toMatchObject({ rail: "sponsor_deal", status: "completed", entitlement_revoked: false });
    expect((row?.["details"] as Record<string, unknown>)?.["partialRefundEntitlementKept"]).toBe(true);

    const full = await deliver(
      refundEvent({ eventId: "evt_r2", chargeId: "ch_sponsor_pi_part", pi: "pi_sponsor_pi", amount: 100000, refunded: 100000 }),
    );
    expect(full.body).toMatchObject({ received: true, reversed: true, rail: "sponsor_deal" });
    deal = await q(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal[0]?.["escrow_status"]).toBe("unfunded");
    const row2 = await reversalRow("ch_sponsor_pi_part");
    expect(row2).toMatchObject({ rail: "sponsor_deal", status: "completed", entitlement_revoked: true });
  });

  it("PI-funded RELEASED deal (payout row exists): the refund is IDENTIFIED and parks in manual review by design — rail sponsor_deal, not 'unidentified'; escrow + payout untouched", async () => {
    await q(sql`
      INSERT INTO sponsor_deals (id, escrow_status, status, stripe_session_id, stripe_payment_intent_id)
      VALUES (${DEAL}, 'released', 'paid', 'pi_sponsor_pi', 'pi_sponsor_pi')
    `);
    const payout = await q(sql`
      INSERT INTO sponsor_payouts (deal_id, status) VALUES (${DEAL}, 'released') RETURNING id
    `);
    const payoutId = String(payout[0]?.["id"]);

    const res = await deliver(refundEvent({ chargeId: "ch_sponsor_pi_rel", pi: "pi_sponsor_pi", amount: 100000, refunded: 100000 }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, warning: "Reversal needs manual review", rail: "sponsor_deal" });

    const row = await reversalRow("ch_sponsor_pi_rel");
    expect(row).toMatchObject({ rail: "sponsor_deal", status: "needs_manual_review", entitlement_revoked: false });
    const details = row?.["details"] as Record<string, unknown>;
    expect(details?.["payoutId"]).toBe(payoutId);
    expect(String(details?.["manualReason"])).toContain("already released");

    const deal = await q(sql`SELECT escrow_status, status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal[0]).toMatchObject({ escrow_status: "released", status: "paid" });
  });

  it("a payment intent NO sponsor deal records (another deal's PI differs): the refund still parks as UNIDENTIFIED manual review and the other deal is untouched — the PI probe does not over-catch", async () => {
    await q(sql`
      INSERT INTO sponsor_deals (id, escrow_status, status, stripe_session_id, stripe_payment_intent_id)
      VALUES (${DEAL}, 'funded', 'funded', 'pi_someone_else', 'pi_someone_else')
    `);

    const res = await deliver(refundEvent({ chargeId: "ch_unknown_pi", pi: "pi_unknown", amount: 5000, refunded: 5000 }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, warning: "Reversal needs manual review", rail: "unidentified" });

    const rows = await q(sql`SELECT * FROM payment_reversals WHERE stripe_charge_id = 'ch_unknown_pi'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rail: "unidentified", status: "needs_manual_review" });
    expect(String((rows[0]?.["details"] as Record<string, unknown>)?.["manualReason"])).toContain("No grant record");

    const deal = await q(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal[0]?.["escrow_status"]).toBe("funded");
  });
});

/* ═══ Item 17b — SHOUTOUT rail (shoutout_requests) ═════════════════ */

describe("item 17b — shoutout rail reversal (shoutout_requests, via webhook)", () => {
  async function seedShoutout(status = "accepted") {
    h.sessionsByPi.set("pi_shout", [
      { id: "cs_shout_1", metadata: { type: "shoutout_request", requestId: "req_1" } },
    ]);
    await q(sql`
      INSERT INTO shoutout_requests (creator_user_id, status, stripe_session_id)
      VALUES (${CREATOR}, ${status}, 'cs_shout_1')
    `);
  }

  it("a full dashboard refund flips the paid shoutout request to 'refunded' — replay is a duplicate, no VB moves on this dollar rail", async () => {
    await seedShoutout();
    const res = await deliver(refundEvent({ chargeId: "ch_shout", pi: "pi_shout", amount: 7500, refunded: 7500 }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, reversed: true, rail: "shoutout_request", creditsClawed: 0 });
    const reqs = await q(sql`SELECT status FROM shoutout_requests WHERE stripe_session_id = 'cs_shout_1'`);
    expect(reqs[0]?.["status"]).toBe("refunded");
    const row = await reversalRow("ch_shout");
    expect(row).toMatchObject({
      rail: "shoutout_request", status: "completed", granted_credits: 0,
      entitlement_revoked: true, seller_reversed: true,
    });
    expect(Number(sb.profiles.get(BUYER)?.["credits"])).toBe(6000);

    const again = await deliver(refundEvent({ chargeId: "ch_shout", pi: "pi_shout", amount: 7500, refunded: 7500 }));
    expect(again.body).toMatchObject({ received: true, duplicate: true });
  });

  it("a partial refund keeps the request 'accepted' (recorded); the completing refund revokes it", async () => {
    await seedShoutout();
    const half = await deliver(refundEvent({ chargeId: "ch_shoutp", pi: "pi_shout", amount: 7500, refunded: 3750 }));
    expect(half.body).toMatchObject({ received: true, reversed: true, rail: "shoutout_request" });
    let reqs = await q(sql`SELECT status FROM shoutout_requests WHERE stripe_session_id = 'cs_shout_1'`);
    expect(reqs[0]?.["status"]).toBe("accepted");
    const row = await reversalRow("ch_shoutp");
    expect((row?.["details"] as Record<string, unknown>)?.["partialRefundEntitlementKept"]).toBe(true);

    const full = await deliver(
      refundEvent({ eventId: "evt_r2", chargeId: "ch_shoutp", pi: "pi_shout", amount: 7500, refunded: 7500 }),
    );
    expect(full.body).toMatchObject({ received: true, reversed: true, rail: "shoutout_request" });
    reqs = await q(sql`SELECT status FROM shoutout_requests WHERE stripe_session_id = 'cs_shout_1'`);
    expect(reqs[0]?.["status"]).toBe("refunded");
  });
});
