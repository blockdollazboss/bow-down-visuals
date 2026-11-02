/**
 * stripe-webhook-storefront.test.ts — WEBHOOK-SETTLE (stack1200).
 *
 * Storefront purchases were in the Gate #5 tip defect CLASS:
 * checkout sessions stamp metadata type "storefront_purchase",
 * and the webhook dispatch had NO branch that settles them (its
 * expired-session handling only recorded abandoned checkouts) —
 * the order recorded ONLY if the buyer's browser returned and
 * the page called /storefront/verify. A buyer who closed the tab
 * after paying had no order recorded: no delivery, no download
 * token, no seller tell, no co-seller splits.
 *
 * This suite drives the REAL webhook handler (pg-mem, harness
 * mirrors storefront-embedded-checkout.test.ts) with a fabricated
 * (signature-bypassed via the mocked client) storefront event and
 * pins:
 *   - a paid storefront session records the order (flat 5% split)
 *     and mints the digital delivery token exactly once, with NO
 *     verify call;
 *   - a replayed delivery records no second order;
 *   - an unpaid session records nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-storefront-webhook";

const CREATOR = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const SESSION_ID = "cs_storefront_webhook_1";

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
  await h.db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, description, price_cents, media_urls) VALUES (${PRODUCT_ID}, ${PROFILE_ID}, 'digital', 'TEST Digital Download', '', 500, '["https://cdn.example.com/test-download.zip"]'::jsonb)`);
});

function storefrontEvent(paymentStatus: string) {
  return {
    id: "evt_storefront_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: SESSION_ID,
        payment_status: paymentStatus,
        amount_total: 500,
        currency: "usd",
        payment_intent: "pi_storefront_1",
        metadata: {
          type: "storefront_purchase",
          buyer_user_id: BUYER,
          profile_id: PROFILE_ID,
          product_id: PRODUCT_ID,
          product_kind: "digital",
          quantity: "1",
          amount_cents: "500",
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

async function orderCount(): Promise<number> {
  const rows = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM store_orders`);
  return Number((rows.rows[0] as any).c);
}

describe("stripe webhook — storefront settle (WEBHOOK-SETTLE)", () => {
  it("a paid storefront session records the order and mints the delivery token, with no verify call", async () => {
    const res = await deliver(storefrontEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "storefront_purchase" });

    const orders = await h.db.execute(sql`SELECT buyer_user_id, amount_cents, platform_fee_cents, creator_amount_cents, status FROM store_orders`);
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0]).toMatchObject({
      buyer_user_id: BUYER,
      amount_cents: 500,
      platform_fee_cents: 25,
      creator_amount_cents: 475,
      status: "completed",
    });

    const tokens = await h.db.execute(sql`SELECT file_url FROM store_delivery_tokens`);
    expect(tokens.rows).toHaveLength(1);
    expect((tokens.rows[0] as any).file_url).toBe("https://cdn.example.com/test-download.zip");
  });

  it("a replayed delivery records no second order", async () => {
    await deliver(storefrontEvent("paid"));
    const res = await deliver(storefrontEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(await orderCount()).toBe(1);
  });

  it("an unpaid storefront session records nothing", async () => {
    const res = await deliver(storefrontEvent("unpaid"));
    expect(res.statusCode).toBe(200);
    expect(await orderCount()).toBe(0);
  });
});
