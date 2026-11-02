/**
 * stripe-webhook-storefront-exactly-once.test.ts — GATE #5 PRE-PROOF
 * (stack1200/gateproof-storefront).
 *
 * The LEGACY storefront rail (routes/storefront.ts,
 * POST /storefront/checkout → metadata type "storefront_purchase")
 * is distinct from the new shops rail (routes/generate/shops.ts).
 * Gate #5's browser runs proved the SHOP live on staging; this rail
 * was proved only in pieces:
 *   - stripe-webhook-storefront.test.ts (WEBHOOK-SETTLE): a paid
 *     session settles with NO verify call (order + one token, flat
 *     5% on $5.00), a replay adds no second ORDER, an unpaid session
 *     records no order — all on an UNLIMITED-inventory product with
 *     no discount code and no ticket entitlement.
 *   - storefront-embedded-checkout.test.ts: the embedded session
 *     shape + the same $5.00 fee pin through verify.
 *   - storefront-checkout-row8.test.ts: full hosted session shape,
 *     fee mechanism (DB accounting, no Connect fee on the charge),
 *     discount rejections, verify/webhook race → one order.
 *
 * What NONE of those pins — the exactly-once surface BEYOND the
 * order row, driven through the WEBHOOK ALONE (no verify call):
 *   1. Finite inventory is claimed exactly once: a paid webhook
 *      decrements by the purchased quantity; a replayed delivery
 *      decrements NOTHING more (a double-claim would sell stock
 *      the seller does not have).
 *   2. The seller is paid exactly once: the recorded orders carry
 *      exactly one creator_amount_cents total (the Connect payout
 *      sweep pays the sum of creator_amount_cents over completed
 *      orders — one order at the flat 5% split is the whole pay
 *      basis; a second order or a mutated split would double-pay).
 *   3. A discount code's used_count moves exactly once, and the
 *      fee splits the DISCOUNTED gross ($5.00 − 10% = $4.50 →
 *      23¢ fee / $4.27 creator, feeSplit rounds half up).
 *   4. A ticket entitlement lands exactly once via webhook alone:
 *      one order, one event_rsvps row, rsvp_count = 1, and a
 *      replay changes none of them.
 *   5. Delivery tokens after a replay: every token row belongs to
 *      the ONE recorded order and the purchased file (the settle
 *      re-mints a download link on a duplicate delivery — that is
 *      the buyer's re-delivery door, the same one
 *      POST /storefront/orders/:id/delivery-token exposes; the
 *      ENTITLEMENT is the order, and there is exactly one).
 *   6. A failed (unpaid) payment burns NOTHING: no order, no
 *      token, no inventory claim, no discount use, no seller
 *      credit — and the same session still settles exactly once
 *      when the paid delivery later arrives.
 *
 * Harness mirrors stripe-webhook-storefront.test.ts exactly
 * (pg-mem, signature bypassed via the mocked guarded client).
 *
 * HARNESS QUIRK (proven in isolation, 2026-11-01): pg-mem flips
 * the operands of `column - $param` — UPDATE … SET inventory =
 * inventory - $qty stores qty − inventory (a literal `- 1` claim,
 * like the bump claim, computes correctly). Real Postgres is
 * unaffected; this is a fixture artifact, not rail behaviour. The
 * inventory seeds below are therefore sized so the claimed end
 * state is 0 — identical under both arithmetics — and the
 * sold-out test pins the claim's WHERE guard, which pg-mem
 * evaluates correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-storefront-exactly-once";

const CREATOR = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const EVENT_ID = randomUUID();
const SESSION_ID = "cs_storefront_exactly_once_1";
const FILE_URL = "https://cdn.example.com/test-download.zip";

const h = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  return {
    db: null as any,
    event: null as any,
    session: null as any,
  };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(async () => 0),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => false),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = BUYER;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: vi.fn(() => ({
      webhooks: { constructEvent: () => h.event },
      checkout: {
        sessions: {
          create: vi.fn(async () => ({ id: "cs_unused", url: "https://checkout.example.com/pay" })),
          retrieve: vi.fn(async () => h.session),
        },
      },
    })),
  };
});

vi.mock("../mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  isStorageRef: vi.fn(() => false),
}));

import { stripeWebhookHandler } from "../stripe-webhook";
import { createTestDb } from "./test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE events (
  id uuid PRIMARY KEY, title text, rsvp_count integer NOT NULL DEFAULT 0
);
CREATE TABLE store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', price_cents integer NOT NULL,
  compare_at_cents integer, inventory integer NOT NULL DEFAULT -1,
  media_urls jsonb NOT NULL DEFAULT '[]', service_details jsonb,
  gift_card_denominations_cents jsonb,
  bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0,
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  event_id uuid, related_links jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (price_cents >= 0)
, media_alt_texts jsonb NOT NULL DEFAULT '[]');
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL, product_kind text NOT NULL,
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL,
  discount_code text, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed',
  bump_product_id uuid, bump_title text, bump_amount_cents integer,
  bump_platform_fee_cents integer, bump_creator_amount_cents integer,
  fulfillment_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_orders_session_ux ON store_orders (stripe_session_id);
CREATE TABLE discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, code text NOT NULL, percent_off integer NOT NULL,
  max_uses integer NOT NULL DEFAULT -1, used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_delivery_tokens (
  token text PRIMARY KEY, order_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL, code_last4 text NOT NULL,
  profile_id uuid NOT NULL, product_id uuid,
  buyer_user_id uuid, recipient_email text NOT NULL,
  recipient_name text, message text,
  initial_cents integer NOT NULL, balance_cents integer NOT NULL,
  reserved_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gift_card_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id uuid NOT NULL, kind text NOT NULL,
  amount_cents integer NOT NULL, balance_after_cents integer NOT NULL,
  ref text, idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gift_card_ledger_idem_ux ON gift_card_ledger (idempotency_key);
CREATE TABLE gift_card_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id uuid NOT NULL, rail text NOT NULL, ref text NOT NULL,
  amount_cents integer NOT NULL, status text NOT NULL DEFAULT 'reserved',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gift_card_reservations_rail_ref_ux ON gift_card_reservations (rail, ref);
CREATE TABLE email_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), list_id uuid NOT NULL, email text NOT NULL,
  name text, source text NOT NULL DEFAULT 'landing', confirmed boolean NOT NULL DEFAULT true,
  opens integer NOT NULL DEFAULT 0, unsubscribed_at timestamptz,
  subscribed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE event_rsvps (
  event_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (event_id, user_id)
);`;

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  h.event = null;
  h.session = null;
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
});

async function seedDigital(inventory: number) {
  await h.db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, description, price_cents, inventory, media_urls) VALUES (${PRODUCT_ID}, ${PROFILE_ID}, 'digital', 'TEST Digital Download', '', 500, ${inventory}, '["https://cdn.example.com/test-download.zip"]'::jsonb)`);
}

async function seedDiscount() {
  await h.db.execute(sql`INSERT INTO discount_codes (profile_id, code, percent_off) VALUES (${PROFILE_ID}, 'SAVE10', 10)`);
}

function storefrontEvent(paymentStatus: string, meta: Record<string, string> = {}, amountTotal = 500) {
  return {
    id: "evt_storefront_once_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: SESSION_ID,
        payment_status: paymentStatus,
        amount_total: amountTotal,
        currency: "usd",
        payment_intent: "pi_storefront_once_1",
        metadata: {
          type: "storefront_purchase",
          buyer_user_id: BUYER,
          profile_id: PROFILE_ID,
          product_id: PRODUCT_ID,
          product_kind: "digital",
          quantity: "1",
          amount_cents: "500",
          ...meta,
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

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const rows = await h.db.execute(query);
  return Number((rows.rows[0] as any).v);
}
const orderCount = () => scalar(sql`SELECT COUNT(*)::int AS v FROM store_orders`);
const tokenCount = () => scalar(sql`SELECT COUNT(*)::int AS v FROM store_delivery_tokens`);
const inventoryOf = async () => {
  const rows = await h.db.execute(sql`SELECT inventory FROM store_products WHERE id = ${PRODUCT_ID}`);
  return Number((rows.rows[0] as any).inventory);
};
const discountUsed = () => scalar(sql`SELECT used_count AS v FROM discount_codes WHERE profile_id = ${PROFILE_ID}`);
/* The seller's pay basis: the Connect payout sweep pays the sum of
   creator_amount_cents over completed store_orders. */
const sellerCreditTotal = () =>
  scalar(sql`SELECT COALESCE(SUM(creator_amount_cents), 0)::int AS v FROM store_orders WHERE status = 'completed'`);

describe("stripe webhook — storefront exactly-once beyond the order row (GATE #5 PRE-PROOF)", () => {
  it("finite inventory is claimed exactly once and the seller is credited exactly once, across a replay", async () => {
    /* Buy the whole stock (2 of 2): the claimed end state is 0
       under both real and pg-mem arithmetic (see header quirk). */
    await seedDigital(2);
    const twoUnits = { quantity: "2", amount_cents: "1000" };

    const res = await deliver(storefrontEvent("paid", twoUnits, 1000));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "storefront_purchase" });
    expect(await orderCount()).toBe(1);
    expect(await inventoryOf()).toBe(0);
    /* $10.00 gross → flat 5%: 50¢ fee / $9.50 creator, exactly once. */
    const orders = await h.db.execute(sql`SELECT amount_cents, platform_fee_cents, creator_amount_cents FROM store_orders`);
    expect(orders.rows[0]).toMatchObject({ amount_cents: 1000, platform_fee_cents: 50, creator_amount_cents: 950 });
    expect(await sellerCreditTotal()).toBe(950);

    const replay = await deliver(storefrontEvent("paid", twoUnits, 1000));
    expect(replay.statusCode).toBe(200);
    expect(await orderCount()).toBe(1);
    expect(await inventoryOf()).toBe(0);
    expect(await sellerCreditTotal()).toBe(950);
  });

  it("a paid session for more units than remain in stock records no order and credits no seller", async () => {
    await seedDigital(1);
    const twoUnits = { quantity: "2", amount_cents: "1000" };

    const res = await deliver(storefrontEvent("paid", twoUnits, 1000));
    /* The settle's SOLD_OUT 409 is terminal at the webhook (warned
       200 — Stripe retries cannot restock); its buyer-facing
       refund conversation belongs to the buyer's verify return. */
    expect(res.statusCode).toBe(200);
    expect(await orderCount()).toBe(0);
    expect(await inventoryOf()).toBe(1);
    expect(await sellerCreditTotal()).toBe(0);
    expect(await tokenCount()).toBe(0);
  });

  it("a discount code is consumed exactly once and the 5% fee splits the discounted gross, across a replay", async () => {
    await seedDigital(-1);
    await seedDiscount();
    const discounted = { discount_code: "SAVE10", amount_cents: "450" };

    const res = await deliver(storefrontEvent("paid", discounted, 450));
    expect(res.statusCode).toBe(200);
    expect(await orderCount()).toBe(1);
    expect(await discountUsed()).toBe(1);
    /* $4.50 discounted gross → 23¢ fee / $4.27 creator (half-up). */
    const orders = await h.db.execute(sql`SELECT amount_cents, platform_fee_cents, creator_amount_cents, discount_code FROM store_orders`);
    expect(orders.rows[0]).toMatchObject({
      amount_cents: 450, platform_fee_cents: 23, creator_amount_cents: 427, discount_code: "SAVE10",
    });

    const replay = await deliver(storefrontEvent("paid", discounted, 450));
    expect(replay.statusCode).toBe(200);
    expect(await orderCount()).toBe(1);
    expect(await discountUsed()).toBe(1);
    expect(await sellerCreditTotal()).toBe(427);
  });

  it("a ticket entitlement lands exactly once via the webhook alone, across a replay", async () => {
    await h.db.execute(sql`INSERT INTO events (id, title) VALUES (${EVENT_ID}, 'TEST Show')`);
    await h.db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, description, price_cents, inventory, event_id, media_urls) VALUES (${PRODUCT_ID}, ${PROFILE_ID}, 'ticket', 'TEST Ticket', '', 500, -1, ${EVENT_ID}, '[]'::jsonb)`);
    const ticket = { product_kind: "ticket", event_id: EVENT_ID };

    const res = await deliver(storefrontEvent("paid", ticket));
    expect(res.statusCode).toBe(200);
    expect(await orderCount()).toBe(1);
    expect(await scalar(sql`SELECT COUNT(*)::int AS v FROM event_rsvps WHERE event_id = ${EVENT_ID} AND user_id = ${BUYER}`)).toBe(1);
    expect(await scalar(sql`SELECT rsvp_count AS v FROM events WHERE id = ${EVENT_ID}`)).toBe(1);

    const replay = await deliver(storefrontEvent("paid", ticket));
    expect(replay.statusCode).toBe(200);
    expect(await orderCount()).toBe(1);
    expect(await scalar(sql`SELECT COUNT(*)::int AS v FROM event_rsvps WHERE event_id = ${EVENT_ID} AND user_id = ${BUYER}`)).toBe(1);
    expect(await scalar(sql`SELECT rsvp_count AS v FROM events WHERE id = ${EVENT_ID}`)).toBe(1);
    expect(await sellerCreditTotal()).toBe(475);
  });

  it("after a replay, every delivery token belongs to the one recorded order and the purchased file", async () => {
    await seedDigital(-1);
    await deliver(storefrontEvent("paid"));
    await deliver(storefrontEvent("paid"));

    expect(await orderCount()).toBe(1);
    expect(await tokenCount()).toBeGreaterThanOrEqual(1);
    const orders = await h.db.execute(sql`SELECT id FROM store_orders`);
    const orderId = String((orders.rows[0] as any).id);
    const tokens = await h.db.execute(sql`SELECT order_id, file_url FROM store_delivery_tokens`);
    for (const t of tokens.rows as Array<Record<string, unknown>>) {
      expect(String(t["order_id"])).toBe(orderId);
      expect(t["file_url"]).toBe(FILE_URL);
    }
  });

  it("an unpaid delivery burns nothing — no order, token, inventory claim, discount use or seller credit — and the paid delivery still settles once", async () => {
    await seedDigital(1);
    await seedDiscount();
    const meta = { discount_code: "SAVE10", amount_cents: "450" };

    const res = await deliver(storefrontEvent("unpaid", meta, 450));
    expect(res.statusCode).toBe(200);
    expect(await orderCount()).toBe(0);
    expect(await tokenCount()).toBe(0);
    expect(await inventoryOf()).toBe(1);
    expect(await discountUsed()).toBe(0);
    expect(await sellerCreditTotal()).toBe(0);

    const paid = await deliver(storefrontEvent("paid", meta, 450));
    expect(paid.statusCode).toBe(200);
    expect(await orderCount()).toBe(1);
    expect(await inventoryOf()).toBe(0);
    expect(await discountUsed()).toBe(1);
    expect(await sellerCreditTotal()).toBe(427);
  });
});
