/**
 * Co-seller revenue splits (Wave 4 #36) — BOTH rails end to end over
 * pg-mem with the real routers (storefront, shops, earnings,
 * sale-splits read views), Stripe faked at both seams.
 *
 * Pins:
 *  - splits set on product create/PATCH on both rails; bad lists
 *    (sum ≠ 100, owner missing, unknown co-seller) refuse with the
 *    machine's codes; a product without splits behaves exactly as
 *    before (no entries, earnings untouched);
 *  - a fulfilled sale records BOTH sellers' entries off the seller NET
 *    (the flat 5% fee is out before the split), exactly once under
 *    verify replays;
 *  - /earnings and the Connect payout total move symmetrically: the
 *    owner drops by the co-seller's share, the co-seller rises by it;
 *  - a full refund through the payment-reversals engine flips the
 *    parent sale AND reverses BOTH sides' entries, exactly once — a
 *    replayed reversal changes nothing further.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userPlan: "pro",
  userEmail: "",
  storeSessions: new Map<string, any>(),
  shopSessions: new Map<string, any>(),
  createCalls: [] as Array<{ params: any; opts: any }>,
  seq: 0,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userPlan = h.userPlan;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: vi.fn(() => "gpt-6-sol"),
  getOpenAI: vi.fn(() => { throw new Error("no ai in split tests"); }),
}));

vi.mock("../../lib/supabase-admin", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

vi.mock("../../lib/stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: vi.fn(() => ({
      checkout: {
        sessions: {
          create: vi.fn(async (params: any) => {
            h.seq += 1;
            const id = `cs_test_${h.seq}`;
            const session = {
              id,
              url: `https://checkout.example.com/pay/${id}`,
              payment_status: "paid",
              amount_total: Number(params.metadata?.amount_cents ?? 0),
              metadata: params.metadata,
            };
            h.storeSessions.set(id, session);
            return session;
          }),
          retrieve: vi.fn(async (id: string) => {
            const s = h.storeSessions.get(id);
            if (!s) throw new Error("no such session");
            return s;
          }),
        },
      },
    })),
  };
});

vi.mock("../../lib/stripe-checkout", () => ({
  getCheckoutStripe: vi.fn(() => ({
    checkout: {
      sessions: {
        create: vi.fn(async (params: any, opts: any) => {
          h.createCalls.push({ params, opts });
          h.seq += 1;
          const id = `cs_shop_${h.seq}`;
          const session = {
            id,
            url: `https://checkout.example.com/pay/${id}`,
            payment_status: "unpaid",
            amount_total: (params.line_items as any[]).reduce(
              (s: number, li: any) => s + li.price_data.unit_amount * li.quantity, 0),
            metadata: params.metadata,
          };
          h.shopSessions.set(id, session);
          return session;
        }),
      },
    },
  })),
  retrieveCheckoutSession: vi.fn(async (id: string) => {
    const s = h.shopSessions.get(id);
    if (!s) throw new Error("no such session");
    return s;
  }),
  checkoutBaseUrl: vi.fn(() => "https://example.com"),
  isCheckoutTestMode: vi.fn(() => true),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, publicApiLimiter: (_req: any, _res: any, next: any) => next() };
});

vi.mock("../../lib/objectStorage", () => ({
  SHOP_PRODUCTS_BUCKET: "shop-products",
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  isStorageRef: vi.fn(() => false),
}));

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-splits";

import storefrontRouter from "../storefront";
import shopsRouter from "../generate/shops";
import earningsRouter from "../earnings";
import saleSplitsRouter from "../sale-splits";
import { pendingPayoutCents } from "../stripe-connect";
import { processChargeReversal } from "../../lib/payment-reversals";
import { __resetSaleSplitProbes } from "../../lib/sale-splits";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE profiles (id uuid PRIMARY KEY, email text, plan text);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE events (id uuid PRIMARY KEY, title text, rsvp_count integer NOT NULL DEFAULT 0);
CREATE TABLE store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', price_cents integer NOT NULL,
  compare_at_cents integer, inventory integer NOT NULL DEFAULT -1,
  media_urls jsonb NOT NULL DEFAULT '[]', service_details jsonb,
  event_id uuid, related_links jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  splits jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (price_cents >= 0),
  media_alt_texts jsonb NOT NULL DEFAULT '[]', gift_card_denominations_cents jsonb,
  bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL DEFAULT '', product_kind text NOT NULL DEFAULT 'digital',
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL,
  discount_code text, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  bump_product_id uuid, bump_amount_cents integer, bump_platform_fee_cents integer, bump_creator_amount_cents integer,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed',
  fulfillment_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_orders_session_ux ON store_orders (stripe_session_id);
CREATE TABLE store_delivery_tokens (
  token text PRIMARY KEY, order_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL, code text NOT NULL,
  percent_off integer NOT NULL, max_uses integer NOT NULL DEFAULT -1, used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
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
CREATE TABLE event_rsvps (event_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (event_id, user_id));
CREATE TABLE shops (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL,
  handle text NOT NULL UNIQUE, tagline text, description text,
  banner_color text NOT NULL DEFAULT '#0a0a0a', accent_color text NOT NULL DEFAULT '#d4af37',
  banner_image_url text, custom_domain text, domain_verified boolean NOT NULL DEFAULT FALSE,
  domain_verification_token text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_products (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  name text NOT NULL, price_cents integer NOT NULL DEFAULT 0, description text,
  image_url text, image_path text, status text NOT NULL DEFAULT 'active', pinned_ugc_ad_id uuid,
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  splits jsonb, image_alt_text text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, buyer_email text,
  settled_payout_id uuid, settled_at timestamptz, ip_hash text,
  stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text, discount_code text,
  affiliate_code text, bump_for_product_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_discount_codes (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, code text NOT NULL,
  percent_off integer NOT NULL, max_uses integer NOT NULL DEFAULT -1,
  used_count integer NOT NULL DEFAULT 0, expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE affiliate_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL, affiliate_user_id uuid NOT NULL, seller_user_id uuid NOT NULL,
  surface text NOT NULL, product_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX affiliate_codes_code_ux ON affiliate_codes (UPPER(code));
CREATE UNIQUE INDEX affiliate_codes_affiliate_product_ux ON affiliate_codes (affiliate_user_id, surface, product_id);
CREATE TABLE affiliate_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code_id uuid NOT NULL, affiliate_user_id uuid NOT NULL, seller_user_id uuid NOT NULL,
  surface text NOT NULL, product_id uuid, product_title text NOT NULL DEFAULT '',
  order_ref text NOT NULL, buyer_user_id uuid, buyer_email text,
  gross_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  seller_net_cents integer NOT NULL DEFAULT 0, commission_bps integer NOT NULL,
  commission_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'owed',
  created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz
);
CREATE UNIQUE INDEX affiliate_sales_once_ux ON affiliate_sales (surface, order_ref, product_id);
CREATE TABLE sale_split_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_kind text NOT NULL, sale_id uuid NOT NULL,
  surface text NOT NULL, product_id uuid NOT NULL, product_title text NOT NULL DEFAULT '',
  owner_user_id uuid NOT NULL, seller_user_id uuid NOT NULL, seller_profile_id uuid,
  role text NOT NULL CHECK (role IN ('owner', 'co_seller')),
  share_pct numeric NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  gross_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'earned' CHECK (status IN ('earned', 'reversed')),
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(), reversed_at timestamptz
);
CREATE UNIQUE INDEX sale_split_entries_once_ux ON sale_split_entries (sale_kind, sale_id, product_id, seller_user_id);
CREATE INDEX sale_split_entries_seller_idx ON sale_split_entries (seller_user_id, status);
CREATE INDEX sale_split_entries_owner_idx ON sale_split_entries (owner_user_id, status);
CREATE INDEX sale_split_entries_sale_idx ON sale_split_entries (sale_kind, sale_id);
CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text, stripe_charge_id text NOT NULL, stripe_payment_intent_id text,
  trigger text NOT NULL, rail text NOT NULL, user_id uuid, session_id text,
  granted_credits integer NOT NULL DEFAULT 0, credits_clawed integer NOT NULL DEFAULT 0,
  referral_credits_clawed integer NOT NULL DEFAULT 0,
  refunded_cents_seen integer NOT NULL DEFAULT 0, charge_amount_cents integer,
  dispute_lost boolean NOT NULL DEFAULT false, entitlement_revoked boolean NOT NULL DEFAULT false,
  seller_reversed boolean NOT NULL DEFAULT false, shortfall_credits integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing', details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_reversals_charge_ux ON payment_reversals (stripe_charge_id);
CREATE TABLE creator_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, profile_id uuid,
  amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'paid',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE digital_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_user_id uuid, seller_user_id uuid, profile_id uuid,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed', stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fan_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, fan_user_id uuid, price_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'active',
  settled_payout_id uuid, settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE live_stream_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_user_id uuid,
  amount_vb integer NOT NULL DEFAULT 0, creator_credited_at timestamptz
);
CREATE TABLE sponsor_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_user_id text, deal_id uuid,
  net_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'released',
  settled_payout_id uuid, settled_at timestamptz
);
CREATE TABLE sponsor_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text, status text, escrow_status text,
  total_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0
);
CREATE TABLE stripe_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_payment_intent_id text,
  stripe_session_id text, user_id uuid, credit_pack text, credits_amount integer
);
CREATE TABLE beat_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_user_id uuid, buyer_id uuid, producer_id uuid,
  beat_id uuid, tier text, stripe_session_id text,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0, status text
);
CREATE TABLE live_shop_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_user_id uuid, buyer_user_id uuid, user_id uuid,
  stripe_session_id text,
  total_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0, status text
);
CREATE TABLE shoutout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_user_id uuid, creator_user_id uuid,
  stripe_session_id text, price_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, status text
);
CREATE TABLE tip_jar_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_user_id uuid, page_user_id uuid, stripe_session_id text,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0, status text
);
CREATE TABLE gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code_hash text, stripe_session_id text,
  balance_cents integer NOT NULL DEFAULT 0, reserved_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gift_card_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), gift_card_id uuid, rail text, ref text,
  amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'reserved',
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_surface text, sale_ref text, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE license_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), license_key_id uuid
);
`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

/* Store rail pair */
const OWNER = randomUUID();
const CO = randomUUID();
const PROFILE_ID = randomUUID();
const CO_PROFILE_ID = randomUUID();
const BUYER = randomUUID();
/* Shop rail pair (separate users so rail arithmetic never mixes) */
const SHOP_OWNER = randomUUID();
const SHOP_CO = randomUUID();
const SHOP_PROFILE_ID = randomUUID();
const SHOP_CO_PROFILE_ID = randomUUID();
const SHOP_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use("/api", shopsRouter);
  app.use("/api", earningsRouter);
  app.use("/api", saleSplitsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[sale-splits-rails] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  h.userId = OWNER;
  h.userPlan = "pro";
  h.userEmail = "owner@example.com";
  h.storeSessions = new Map();
  h.shopSessions = new Map();
  h.createCalls = [];
  h.seq = 0;
  __resetSaleSplitProbes();
  await db.execute(sql`INSERT INTO profiles (id, email) VALUES
    (${OWNER}, 'owner@example.com'), (${CO}, 'co@example.com'), (${BUYER}, 'buyer@example.com'),
    (${SHOP_OWNER}, 'shopowner@example.com'), (${SHOP_CO}, 'shopco@example.com')`);
  await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES
    (${PROFILE_ID}, ${OWNER}, 'owner-one', 'Owner One'),
    (${CO_PROFILE_ID}, ${CO}, 'co-two', 'Co Two'),
    (${SHOP_PROFILE_ID}, ${SHOP_OWNER}, 'shop-owner', 'Shop Owner'),
    (${SHOP_CO_PROFILE_ID}, ${SHOP_CO}, 'shop-co', 'Shop Co')`);
  await db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${SHOP_ID}, ${SHOP_OWNER}, 'Collab Shop', 'collabshop')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function splitRows(): Promise<any[]> {
  const r = await h.db.execute(sql`SELECT * FROM sale_split_entries ORDER BY created_at, role`);
  return r.rows as any[];
}

/* The store rail's paid checkout can't run in pg-mem (pre-existing
   IS NOT DISTINCT FROM gap, documented by the affiliate suites), so
   verify is driven with a session fabricated exactly as checkout
   mints it — verify is where the order and the splits record. */
function fabricateStoreSession(args: { productId: string; buyer: string }) {
  h.seq += 1;
  const id = `cs_fab_${h.seq}`;
  h.storeSessions.set(id, {
    id,
    url: `https://checkout.example.com/pay/${id}`,
    payment_status: "paid",
    amount_total: 10000,
    metadata: {
      type: "storefront_purchase",
      buyer_user_id: args.buyer,
      profile_id: PROFILE_ID,
      product_id: args.productId,
      product_kind: "digital",
      quantity: "1",
      discount_code: "",
      affiliate_code: "",
      amount_cents: "10000",
      platform_fee_cents: "500",
      creator_amount_cents: "9500",
      event_id: "",
    },
  });
  return id;
}

async function createSplitStoreProduct() {
  h.userId = OWNER;
  const r = await req("POST", "/storefront/products", {
    kind: "digital", title: "Collab Album", description: "", priceCents: 10000,
    mediaUrls: ["https://cdn.example.com/album.zip"],
    splits: [
      { userId: OWNER, sharePct: 60 },
      { userId: CO, sharePct: 40 },
    ],
  });
  expect(r.status).toBe(201);
  return r.json.product as any;
}

async function earningsOf(userId: string) {
  h.userId = userId;
  const r = await req("GET", "/earnings");
  expect(r.status).toBe(200);
  return r.json.sources.storeSales;
}

describe("store rail — splits on the product", () => {
  it("create stores the splits and presents them with seller names", async () => {
    const product = await createSplitStoreProduct();
    expect(product.splits).toHaveLength(2);
    const co = product.splits.find((s: any) => s.userId === CO);
    expect(co.sharePct).toBe(40);
    expect(co.name).toBe("Co Two");
    expect(co.slug).toBe("co-two");
  });

  it("refuses bad lists: sum ≠ 100, owner missing, unknown co-seller", async () => {
    h.userId = OWNER;
    const badSum = await req("POST", "/storefront/products", {
      kind: "digital", title: "Bad Sum", description: "", priceCents: 1000,
      splits: [{ userId: OWNER, sharePct: 60 }, { userId: CO, sharePct: 30 }],
    });
    expect(badSum.status).toBe(400);
    expect(badSum.json.error).toBe("split_sum");

    const noOwner = await req("POST", "/storefront/products", {
      kind: "digital", title: "No Owner", description: "", priceCents: 1000,
      splits: [{ userId: CO, sharePct: 100 }],
    });
    expect(noOwner.status).toBe(400);
    expect(noOwner.json.error).toBe("owner_missing");

    const ghost = await req("POST", "/storefront/products", {
      kind: "digital", title: "Ghost", description: "", priceCents: 1000,
      splits: [{ userId: OWNER, sharePct: 50 }, { userId: randomUUID(), sharePct: 50 }],
    });
    expect(ghost.status).toBe(400);
    expect(ghost.json.error).toBe("seller_not_found");
  });

  it("PATCH replaces and clears the splits", async () => {
    const product = await createSplitStoreProduct();
    h.userId = OWNER;
    const cleared = await req("PATCH", `/storefront/products/${product.id}`, { splits: null });
    expect(cleared.status).toBe(200);
    expect(cleared.json.product.splits).toBeNull();
    const replaced = await req("PATCH", `/storefront/products/${product.id}`, {
      splits: [{ userId: OWNER, sharePct: 70 }, { userId: CO, sharePct: 30 }],
    });
    expect(replaced.status).toBe(200);
    expect(replaced.json.product.splits.find((s: any) => s.userId === CO).sharePct).toBe(30);
  });
});

describe("store rail — sale, earnings symmetry, refund unwinding", () => {
  it("records both sellers off the net, moves both earnings, and a full refund unwinds both sides exactly once", async () => {
    const product = await createSplitStoreProduct();
    const sessionId = fabricateStoreSession({ productId: product.id, buyer: BUYER });
    h.userId = BUYER;
    const v = await req("POST", "/storefront/verify", { sessionId });
    expect(v.status).toBe(200);

    const rows = await splitRows();
    expect(rows).toHaveLength(2);
    /* Net 9500 at 60/40 — the 500 fee is out before the split. */
    expect(Number(rows.find((r) => r.role === "owner").amount_cents)).toBe(5700);
    expect(Number(rows.find((r) => r.role === "co_seller").amount_cents)).toBe(3800);

    /* Verify replay: no second recording. */
    const replay = await req("POST", "/storefront/verify", { sessionId });
    expect(replay.json.duplicate).toBe(true);
    expect(await splitRows()).toHaveLength(2);

    /* Earnings symmetry. */
    const ownerEarn = await earningsOf(OWNER);
    expect(ownerEarn.totalCents).toBe(5700);
    expect(ownerEarn.breakdown.coSellerSharesPaidOutCents).toBe(3800);
    const coEarn = await earningsOf(CO);
    expect(coEarn.totalCents).toBe(3800);
    expect(coEarn.breakdown.coSellerSplitCents).toBe(3800);
    expect(coEarn.breakdown.coSellerSplitSales).toBe(1);

    /* Payout totals agree. */
    expect(await pendingPayoutCents(PROFILE_ID)).toBe(5700);
    expect(await pendingPayoutCents(CO_PROFILE_ID)).toBe(3800);

    /* Read views agree. */
    h.userId = CO;
    const mine = await req("GET", "/sale-splits/mine");
    expect(mine.status).toBe(200);
    expect(mine.json.totals.coSellerEarnedCents).toBe(3800);
    h.userId = OWNER;
    const owed = await req("GET", "/sale-splits/owed");
    expect(owed.json.totals.owedCents).toBe(3800);

    /* Full refund through the engine: parent flips, BOTH sides reverse. */
    const fakeStripe = {
      checkout: { sessions: { list: async () => ({ data: [{ id: sessionId }] }) } },
    } as any;
    const outcome = await processChargeReversal({
      stripe: fakeStripe,
      eventId: "evt_split_store_1",
      trigger: "charge.refunded",
      charge: { id: "ch_split_store_1", paymentIntentId: "pi_split_store_1", amountCents: 10000, refundedCents: 10000, currency: "usd" },
    });
    expect(outcome.outcome).toBe("reversed");
    const after = await splitRows();
    expect(after).toHaveLength(2);
    expect(after.every((r) => r.status === "reversed")).toBe(true);
    const orderRows = await h.db.execute(sql`SELECT status FROM store_orders WHERE stripe_session_id = ${sessionId}`);
    expect((orderRows.rows[0] as any).status).toBe("refunded");
    expect((await earningsOf(OWNER)).totalCents).toBe(0);
    expect((await earningsOf(CO)).totalCents).toBe(0);
    expect(await pendingPayoutCents(PROFILE_ID)).toBe(0);
    expect(await pendingPayoutCents(CO_PROFILE_ID)).toBe(0);

    /* Replay the reversal (new event, same charge): duplicate — the
       entries stay reversed, nothing double-claws. */
    const replayOutcome = await processChargeReversal({
      stripe: fakeStripe,
      eventId: "evt_split_store_2",
      trigger: "charge.refunded",
      charge: { id: "ch_split_store_1", paymentIntentId: "pi_split_store_1", amountCents: 10000, refundedCents: 10000, currency: "usd" },
    });
    expect(replayOutcome.outcome).toBe("duplicate");
    const final = await splitRows();
    expect(final.every((r) => r.status === "reversed")).toBe(true);
  });

  it("a product without splits sells exactly as before — no entries, full net to the owner", async () => {
    h.userId = OWNER;
    const created = await req("POST", "/storefront/products", {
      kind: "digital", title: "Solo Album", description: "", priceCents: 10000,
      mediaUrls: ["https://cdn.example.com/solo.zip"],
    });
    expect(created.status).toBe(201);
    expect(created.json.product.splits).toBeNull();
    const sessionId = fabricateStoreSession({ productId: created.json.product.id, buyer: BUYER });
    h.userId = BUYER;
    const v = await req("POST", "/storefront/verify", { sessionId });
    expect(v.status).toBe(200);
    expect(await splitRows()).toHaveLength(0);
    const ownerEarn = await earningsOf(OWNER);
    expect(ownerEarn.totalCents).toBe(9500);
    expect(ownerEarn.breakdown.coSellerSharesPaidOutCents).toBe(0);
    expect(await pendingPayoutCents(PROFILE_ID)).toBe(9500);
  });
});

describe("shop rail — splits on the product", () => {
  async function createSplitShopProduct() {
    h.userId = SHOP_OWNER;
    const r = await req("POST", `/shops/${SHOP_ID}/products`, {
      name: "Collab Poster", price_cents: 20000,
      splits: [
        { userId: SHOP_OWNER, sharePct: 75 },
        { userId: SHOP_CO, sharePct: 25 },
      ],
    });
    expect(r.status).toBe(201);
    return r.json.product as any;
  }

  it("create stores the splits; a bad list refuses", async () => {
    const product = await createSplitShopProduct();
    expect(product.splits).toHaveLength(2);
    expect(product.splits.find((s: any) => s.userId === SHOP_CO).sharePct).toBe(25);

    h.userId = SHOP_OWNER;
    const bad = await req("POST", `/shops/${SHOP_ID}/products`, {
      name: "Bad", price_cents: 1000,
      splits: [{ userId: SHOP_CO, sharePct: 100 }],
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("owner_missing");
  });

  it("a paid sale records both sellers off amount − fee; a full refund reverses both, exactly once", async () => {
    const product = await createSplitShopProduct();
    const co = await req("POST", "/storefronts/checkout", {
      shopId: SHOP_ID, items: [{ productId: product.id, quantity: 1 }], buyerEmail: "buyer@example.com",
    });
    expect(co.status).toBe(201);
    const sessionId = co.json.sessionId as string;
    const session = h.shopSessions.get(sessionId);
    session.payment_status = "paid";
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(v.status).toBe(200);

    const rows = await splitRows();
    expect(rows).toHaveLength(2);
    /* $200 gross, 5% fee $10, net $190 at 75/25 → 14250 / 4750. */
    expect(Number(rows.find((r) => r.role === "owner").amount_cents)).toBe(14250);
    expect(Number(rows.find((r) => r.role === "co_seller").amount_cents)).toBe(4750);
    expect(await pendingPayoutCents(SHOP_PROFILE_ID)).toBe(14250);
    expect(await pendingPayoutCents(SHOP_CO_PROFILE_ID)).toBe(4750);

    const fakeStripe = {
      checkout: { sessions: { list: async () => ({ data: [{ id: sessionId }] }) } },
    } as any;
    const outcome = await processChargeReversal({
      stripe: fakeStripe,
      eventId: "evt_split_shop_1",
      trigger: "charge.refunded",
      charge: { id: "ch_split_shop_1", paymentIntentId: "pi_split_shop_1", amountCents: 20000, refundedCents: 20000, currency: "usd" },
    });
    expect(outcome.outcome).toBe("reversed");
    const after = await splitRows();
    expect(after.every((r) => r.status === "reversed")).toBe(true);
    expect(await pendingPayoutCents(SHOP_PROFILE_ID)).toBe(0);
    expect(await pendingPayoutCents(SHOP_CO_PROFILE_ID)).toBe(0);

    /* Replay: the engine's shop flip rewrites event_type to
       'refunded_sale', so a second refund event can no longer
       identify the rail and lands in manual review (the engine's
       pre-existing posture for this rail) — the safety property is
       that NOTHING double-claws: entries stay reversed, payouts 0. */
    const replayOutcome = await processChargeReversal({
      stripe: fakeStripe,
      eventId: "evt_split_shop_2",
      trigger: "charge.refunded",
      charge: { id: "ch_split_shop_1", paymentIntentId: "pi_split_shop_1", amountCents: 20000, refundedCents: 20000, currency: "usd" },
    });
    expect(replayOutcome.outcome).toBe("manual_review");
    expect((await splitRows()).every((r) => r.status === "reversed")).toBe(true);
    expect(await pendingPayoutCents(SHOP_PROFILE_ID)).toBe(0);
    expect(await pendingPayoutCents(SHOP_CO_PROFILE_ID)).toBe(0);
  });
});
