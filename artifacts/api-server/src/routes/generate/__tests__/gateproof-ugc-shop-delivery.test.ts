/**
 * Gate #5 pre-proof — UGC PURCHASE + DELIVERY leg.
 *
 * Finding first: there is NO distinct UGC purchase rail in the code.
 * "UGC" in this codebase is exactly two things:
 *   - UGC Product Ads (routes/ugc-ads): a member pays Visual Bucs to
 *     the SITE to generate an ad (400 VB video / 100 VB persona) —
 *     no buyer→seller sale, no seller credit. Pinned by
 *     routes/__tests__/ugc-ads.test.ts (25 tests).
 *   - UGC Briefs Board (routes/ugc-briefs): brands post briefs,
 *     creators claim/deliver, brands approve — and the router states
 *     in its header, its schema comment, and every DTO
 *     (UGC_BRIEF_PAYMENT_NOTE) that there is NO payment rail: no
 *     price, fee, escrow, or Visual Bucs ever moves. Pinned by
 *     routes/__tests__/ugc-briefs.test.ts (10 tests), including a
 *     key-scan asserting no money field exists in the brief shape.
 *
 * So this file pre-proves the CLOSEST REAL RAIL the leg can mean —
 * creator content sold in customer shops (routes/generate/shops.ts):
 *   POST /storefronts/checkout        (pending first, server pricing)
 *   POST /storefronts/checkout/verify (the guarded paid flip,
 *                                      lib/market-sale)
 *   GET  /shops/my-purchases          (the buyer's delivery library,
 *                                      lib/shop-delivery)
 * at the ruled flat 5% fee (STOREFRONT_PLATFORM_FEE_BPS = 500,
 * shops.ts:1929-1930 — fee out of the seller's cut; the buyer pays
 * exactly the listed price).
 *
 * Already proven elsewhere (run + cited in the leg report):
 * market-checkout.test.ts (12), shop-delivery.test.ts (7),
 * shop-checkout-buyer-delivery.test.ts (7),
 * shop-delivery-late-attach.test.ts (6),
 * shop-sale-notify-delivery-gap.test.ts (8).
 *
 * THIS file pins only what those suites do NOT:
 *   1. Pre-purchase no-leak: while an order is still pending, NO
 *      door (checkout receipt, verify, status, the buyer's own
 *      library, a stranger's library) carries the deliverable URL.
 *   2. Post-purchase entitlement on the NORMAL flip-time path: the
 *      paid delivery reaches the buyer only — a signed-in stranger
 *      and the seller (who did not buy) get an empty library and no
 *      URL. (Existing stranger pins cover only the healed /
 *      read-time-net paths in shop-delivery-late-attach.)
 *   3. Seller paid exactly once, in money: a quantity-2 digital
 *      order flips to exactly ONE sale row (gross = listed × qty,
 *      fee = flat 5%, net = gross − fee) and verify replays + the
 *      webhook flip (markMarketSalePaid) add nothing — no second
 *      sale row, no second delivery.
 *   4. Failure on a DIGITAL product: a "paid" session whose total
 *      was tampered (doesn't match the order) is refused 400 and
 *      delivers nothing; a declined (never-paid) session likewise
 *      grants nothing and the order never becomes a sale.
 *
 * Harness mirrors shop-checkout-buyer-delivery.test.ts: real shops
 * router over pg-mem, Stripe faked at lib/stripe-checkout, buyer
 * session faked at lib/optional-auth (X-Test-Buyer header).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userPlan: "free",
  userEmail: null as string | null,
  buyers: {} as Record<string, string>,
  sessions: new Map<string, any>(),
  seq: 0,
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userPlan = h.userPlan;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("../../../lib/optional-auth", () => ({
  resolveOptionalSession: async (req: any) => {
    const id = req.headers["x-test-buyer"];
    if (typeof id === "string" && h.buyers[id]) {
      req.userId = id;
      req.userEmail = h.buyers[id];
    }
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getTextModel: vi.fn(() => "gpt-6-sol"),
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: vi.fn(() => { throw new Error("no ai in gateproof-ugc tests"); }),
}));

vi.mock("../../../lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files.example.com/${path}` } }),
      }),
    },
  })),
}));

vi.mock("../../../lib/objectStorage", () => ({
  SHOP_PRODUCTS_BUCKET: "shop-products",
  ensureShopProductsBucket: vi.fn(async () => {}),
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  normalizeToStorageRef: vi.fn((u: string) => u),
  isStorageRef: vi.fn(() => false),
}));

vi.mock("../../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../../lib/stripe-checkout", () => ({
  getCheckoutStripe: vi.fn(() => ({
    checkout: {
      sessions: {
        create: vi.fn(async (params: any) => {
          h.seq += 1;
          const id = `cs_test_${h.seq}`;
          const session = {
            id,
            url: `https://checkout.example.com/pay/${id}`,
            client_secret: null,
            payment_status: "unpaid",
            amount_total: (params.line_items as any[]).reduce(
              (s: number, li: any) => s + li.price_data.unit_amount * li.quantity, 0),
            metadata: params.metadata,
          };
          h.sessions.set(id, session);
          return session;
        }),
      },
    },
  })),
  retrieveCheckoutSession: vi.fn(async (id: string) => {
    const s = h.sessions.get(id);
    if (!s) throw new Error("no such session");
    return s;
  }),
  checkoutBaseUrl: vi.fn(() => "https://example.com"),
  isCheckoutTestMode: vi.fn(() => true),
}));

import shopsRouter from "../shops";
import { markMarketSalePaid } from "../../../lib/market-sale";
import { createTestDb } from "../../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE shops (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL,
  handle text NOT NULL UNIQUE, tagline text, description text,
  banner_color text NOT NULL DEFAULT '#0a0a0a', accent_color text NOT NULL DEFAULT '#d4af37',
  banner_image_url text, custom_domain text, domain_verified boolean NOT NULL DEFAULT FALSE,
  domain_verification_token text, meta_pixel_id text, tiktok_pixel_id text, google_tag_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_products (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  name text NOT NULL, price_cents integer NOT NULL DEFAULT 0, description text,
  image_url text, image_path text, status text NOT NULL DEFAULT 'active', pinned_ugc_ad_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  image_alt_text text,
  product_type text NOT NULL DEFAULT 'physical', deliverable_url text, deliverable_name text
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, buyer_email text, buyer_user_id uuid,
  settled_payout_id uuid, settled_at timestamptz, ip_hash text,
  stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text, discount_code text, affiliate_code text,
  created_at timestamptz NOT NULL DEFAULT now(), bump_for_product_id uuid
);
CREATE TABLE shop_discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, code text NOT NULL,
  percent_off integer NOT NULL, max_uses integer NOT NULL DEFAULT -1,
  used_count integer NOT NULL DEFAULT 0, expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text
);
CREATE TABLE users (
  id uuid PRIMARY KEY, email text
);
CREATE TABLE shop_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_event_id uuid NOT NULL UNIQUE,
  shop_id uuid NOT NULL,
  product_id uuid,
  buyer_user_id uuid,
  buyer_email text,
  order_id text NOT NULL,
  product_name text,
  deliverable_url text NOT NULL,
  deliverable_name text,
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
CREATE UNIQUE INDEX gift_card_reservations_rail_ref_ux ON gift_card_reservations (rail, ref);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const SELLER = randomUUID();
const BUYER = randomUUID();
const STRANGER = randomUUID();
const BUYER_EMAIL = "ugc-buyer@example.com";
const STRANGER_EMAIL = "ugc-stranger@example.com";
const FILE_URL = "https://files.example.com/creator-content-pack.zip";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[gateproof-ugc] unhandled route error:", err?.message ?? err);
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
    name: "gen_random_uuid", args: [], returns: "uuid" as never,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  h.userId = SELLER;
  h.userPlan = "free";
  h.userEmail = "seller@example.com";
  h.buyers = { [BUYER]: BUYER_EMAIL };
  h.sessions = new Map();
  h.seq = 0;
  await h.db.execute(sql`INSERT INTO users (id, email) VALUES (${BUYER}, ${BUYER_EMAIL})`);
  await h.db.execute(sql`INSERT INTO users (id, email) VALUES (${STRANGER}, ${STRANGER_EMAIL})`);
  await h.db.execute(sql`INSERT INTO users (id, email) VALUES (${SELLER}, 'seller@example.com')`);
});

async function req(method: string, path: string, body?: unknown, asBuyer?: string) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(asBuyer ? { "X-Test-Buyer": asBuyer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

/** A creator's digital content listing — the "UGC sold in a shop" unit. */
async function seedShopWithDigital(priceCents = 500) {
  const shopId = randomUUID(); const pid = randomUUID();
  const handle = "ugc-" + shopId.slice(0, 8);
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${SELLER}, 'Creator Shop', ${handle})`);
  await h.db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, product_type, deliverable_url, deliverable_name)
    VALUES (${pid}, ${shopId}, ${SELLER}, 'Creator Content Pack', ${priceCents}, 'digital', ${FILE_URL}, 'creator-content-pack.zip')
  `);
  return { shopId, handle, pid };
}

async function libraryAs(userId: string, email: string | null) {
  h.userId = userId; h.userEmail = email;
  return req("GET", "/shops/my-purchases");
}

async function deliveryCount() {
  const r = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM shop_deliveries`);
  return Number((r.rows[0] as any).c);
}

async function saleRows() {
  const r = await h.db.execute(sql`
    SELECT event_type, payment_status, amount_cents, platform_fee_cents, quantity
    FROM shop_events ORDER BY created_at ASC
  `);
  return r.rows as Array<Record<string, any>>;
}

async function buyAndPay(shopId: string, pid: string, quantity = 1) {
  const co = await req("POST", "/storefronts/checkout", {
    shopId, productId: pid, quantity,
  }, BUYER);
  expect(co.status).toBe(201);
  const session = h.sessions.get(co.json.sessionId);
  session.payment_status = "paid";
  const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
  expect(v.json.paid).toBe(true);
  return { co, v, sessionId: co.json.sessionId as string };
}

describe("Gate #5 UGC leg — closest real rail: creator content sold in shops", () => {
  it("pre-purchase: NO door leaks the deliverable while the order is pending", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1,
    }, BUYER);
    expect(co.status).toBe(201);
    expect(co.json.paid).toBe(false);
    /* The checkout receipt itself carries prices, never the file. */
    expect(JSON.stringify(co.json)).not.toContain(FILE_URL);
    expect(co.json.deliveries ?? []).toHaveLength(0);

    /* Verify on an unpaid session: pending receipt, no deliveries. */
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.status).toBe(200);
    expect(v.json.paid).toBe(false);
    expect(JSON.stringify(v.json)).not.toContain(FILE_URL);

    /* Status (the read-only door): pending, deliveries withheld. */
    const s = await req("GET", `/storefronts/checkout/status?sessionId=${co.json.sessionId}`);
    expect(s.status).toBe(200);
    expect(s.json.paid).toBe(false);
    expect(s.json.deliveries).toEqual([]);
    expect(JSON.stringify(s.json)).not.toContain(FILE_URL);

    /* The would-be buyer's own library: nothing until paid. */
    const buyerLib = await libraryAs(BUYER, BUYER_EMAIL);
    expect(buyerLib.json.purchases).toHaveLength(0);
    expect(JSON.stringify(buyerLib.json)).not.toContain(FILE_URL);

    /* And a stranger's library is equally empty. */
    const strangerLib = await libraryAs(STRANGER, STRANGER_EMAIL);
    expect(strangerLib.json.purchases).toHaveLength(0);
    expect(await deliveryCount()).toBe(0);
  });

  it("post-purchase entitlement: the flip-time delivery reaches ONLY the buyer", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    const { v } = await buyAndPay(shopId, pid);
    expect(v.json.deliveries).toHaveLength(1);
    expect(v.json.deliveries[0].deliverable_url).toBe(FILE_URL);
    expect(await deliveryCount()).toBe(1);

    /* The buyer retrieves it again from their library, any time. */
    const buyerLib = await libraryAs(BUYER, BUYER_EMAIL);
    expect(buyerLib.json.purchases).toHaveLength(1);
    expect(buyerLib.json.purchases[0].downloadUrl).toBe(FILE_URL);
    expect(buyerLib.json.purchases[0].productName).toBe("Creator Content Pack");

    /* A signed-in stranger: no row, no URL, nothing. */
    const strangerLib = await libraryAs(STRANGER, STRANGER_EMAIL);
    expect(strangerLib.json.purchases).toHaveLength(0);
    expect(JSON.stringify(strangerLib.json)).not.toContain(FILE_URL);

    /* The seller sold it but did not buy it: their library stays empty. */
    const sellerLib = await libraryAs(SELLER, "seller@example.com");
    expect(sellerLib.json.purchases).toHaveLength(0);
    expect(JSON.stringify(sellerLib.json)).not.toContain(FILE_URL);
  });

  it("seller paid exactly once, in money: qty-2 digital order = one sale row at listed x qty, flat 5% fee", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 2,
    }, BUYER);
    expect(co.status).toBe(201);
    /* The buyer is charged exactly the listed price x quantity. */
    expect(co.json.gross_cents).toBe(1000);
    expect(h.sessions.get(co.json.sessionId).amount_total).toBe(1000);
    expect(co.json.platform_fee_cents).toBe(50);
    expect(co.json.seller_net_cents).toBe(950);

    const session = h.sessions.get(co.json.sessionId);
    session.payment_status = "paid";
    const v1 = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v1.json.paid).toBe(true);
    expect(v1.json.duplicate).toBe(false);

    /* Both replay doors: verify again, then the webhook's own flip. */
    const v2 = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v2.json.duplicate).toBe(true);
    const again = await markMarketSalePaid(co.json.sessionId);
    expect(again.flipped).toBe(0);

    /* Exactly ONE sale row exists, carrying the whole order once:
       the shop_events 'sale' rows ARE the seller's earnings ledger
       (earnings/payout reads only ever read event_type='sale'). */
    const rows = await saleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: "sale", payment_status: "paid",
      amount_cents: 1000, platform_fee_cents: 50, quantity: 2,
    });
    const sellerNet = rows.reduce((s, r) => s + Number(r.amount_cents) - Number(r.platform_fee_cents), 0);
    expect(sellerNet).toBe(950);
    /* And exactly one delivery for the one paid order. */
    expect(await deliveryCount()).toBe(1);
  });

  it("failure: a 'paid' session whose total was tampered never fulfils a digital order", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1,
    }, BUYER);
    expect(co.status).toBe(201);
    const session = h.sessions.get(co.json.sessionId);
    session.payment_status = "paid";
    session.amount_total = 1; // paid, but not THIS order's price
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.status).toBe(400);
    expect(JSON.stringify(v.json)).not.toContain(FILE_URL);

    const rows = await saleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe("pending_sale");
    expect(await deliveryCount()).toBe(0);
    const buyerLib = await libraryAs(BUYER, BUYER_EMAIL);
    expect(buyerLib.json.purchases).toHaveLength(0);
  });

  it("failure: a declined (never-paid) session grants nothing and charges nothing", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1,
    }, BUYER);
    expect(co.status).toBe(201);
    /* Session stays 'unpaid' — the decline/abandon shape. */
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.json.paid).toBe(false);
    const s = await req("GET", `/storefronts/checkout/status?sessionId=${co.json.sessionId}`);
    expect(s.json.paid).toBe(false);
    expect(s.json.status).toBe("pending_payment");

    /* No sale was recorded (nothing for the seller, nothing charged
       as a sale), no delivery exists, the library is empty. */
    const rows = await saleRows();
    expect(rows.every((r) => r.event_type === "pending_sale")).toBe(true);
    expect(await deliveryCount()).toBe(0);
    const buyerLib = await libraryAs(BUYER, BUYER_EMAIL);
    expect(buyerLib.json.purchases).toHaveLength(0);
  });
});
