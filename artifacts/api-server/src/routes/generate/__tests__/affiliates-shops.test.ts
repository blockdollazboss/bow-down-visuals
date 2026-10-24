/**
 * Creator Product Affiliates (#16) — the SHOPS rail end to end.
 * Drives the REAL shops + affiliates routers over pg-mem with Stripe
 * faked at the lib/stripe-checkout seam (the market-checkout pattern),
 * and pins:
 *  - product create/PATCH carry the creator-set affiliate setting
 *    (enabling without a rate refuses);
 *  - checkout carries a validated code on the matching line's pending
 *    rows only, and the guarded paid flip records the commission owed
 *    exactly once — verify replays and a second markMarketSalePaid
 *    (the webhook's call) never double-record;
 *  - commission = creator-set % of the line's seller net; the 5% fee
 *    and the buyer's total never move;
 *  - guest self-referral (buyer email == the affiliate's account email)
 *    earns nothing; a code for a product not in the cart refuses.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userPlan: "pro",
  createCalls: [] as Array<{ params: any; opts: any }>,
  sessions: new Map<string, any>(),
  seq: 0,
  failCreate: false,
  stripeConfigured: true,
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userPlan = h.userPlan;
    next();
  },
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
  getOpenAI: vi.fn(() => { throw new Error("no ai in affiliate shops tests"); }),
}));

vi.mock("../../../lib/supabase-admin", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

vi.mock("../../../lib/objectStorage", () => ({
  SHOP_PRODUCTS_BUCKET: "shop-products",
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  isStorageRef: vi.fn(() => false),
}));

vi.mock("../../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

/* The shared 30/min public limiter is not what this suite tests — other
   suites keep the real one; here it's a pass-through so a slow,
   contended box can't 429 the flows under test. */
vi.mock("../../../lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, publicApiLimiter: (_req: any, _res: any, next: any) => next() };
});

vi.mock("../../../lib/stripe-checkout", () => ({
  getCheckoutStripe: vi.fn(() => {
    if (!h.stripeConfigured) throw new Error("STRIPE_SECRET_KEY is not configured");
    return {
      checkout: {
        sessions: {
          create: vi.fn(async (params: any, opts: any) => {
            if (h.failCreate) throw new Error("stripe is down");
            h.createCalls.push({ params, opts });
            h.seq += 1;
            const id = `cs_test_${h.seq}`;
            const session = {
              id,
              url: `https://checkout.example.com/pay/${id}`,
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
    };
  }),
  retrieveCheckoutSession: vi.fn(async (id: string) => {
    const s = h.sessions.get(id);
    if (!s) throw new Error("no such session");
    return s;
  }),
  checkoutBaseUrl: vi.fn(() => "https://example.com"),
  isCheckoutTestMode: vi.fn(() => true),
}));

import shopsRouter from "../shops";
import affiliatesRouter from "../../affiliates";
import { markMarketSalePaid } from "../../../lib/market-sale";
import { createTestDb } from "../../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE profiles (id uuid PRIMARY KEY, email text, plan text);
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text);
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
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, buyer_email text,
  settled_payout_id uuid, settled_at timestamptz, ip_hash text,
  stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text, discount_code text,
  affiliate_code text,
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
CREATE UNIQUE INDEX affiliate_sales_once_ux ON affiliate_sales (surface, order_ref, product_id);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const SELLER = randomUUID();
const FAN = randomUUID();
const SHOP_ID = randomUUID();
const P1 = randomUUID();
const P2 = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use("/api", affiliatesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[affiliates-shops] unhandled route error:", err?.message ?? err);
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
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  h.userId = SELLER;
  h.userPlan = "pro";
  h.createCalls = [];
  h.sessions = new Map();
  h.seq = 0;
  h.failCreate = false;
  h.stripeConfigured = true;
  await db.execute(sql`INSERT INTO profiles (id, email) VALUES (${SELLER}, 'seller@example.com'), (${FAN}, 'fan@example.com')`);
  await db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${SHOP_ID}, ${SELLER}, 'Seller Shop', 'sellershop')`);
  /* P1: $100 poster, affiliates open at 10%. P2: $5 sticker, no affiliates. */
  await db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, affiliate_enabled, affiliate_commission_bps)
                        VALUES (${P1}, ${SHOP_ID}, ${SELLER}, 'Poster', 10000, true, 1000)`);
  await db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${P2}, ${SHOP_ID}, ${SELLER}, 'Sticker', 500)`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function fanClaimsCode(productId: string) {
  h.userId = FAN;
  const r = await req("POST", "/affiliates/codes", { surface: "shop_product", productId });
  expect(r.status).toBe(201);
  h.userId = SELLER;
  return r.json.code.code as string;
}

async function affiliateSaleRows() {
  const r = await h.db.execute(sql`SELECT * FROM affiliate_sales`);
  return r.rows as any[];
}

async function checkoutAndPay(items: Array<{ productId: string; quantity: number }>, affiliateCode?: string, buyerEmail = "buyer@example.com") {
  const co = await req("POST", "/storefronts/checkout", {
    shopId: SHOP_ID, items, buyerEmail, ...(affiliateCode ? { affiliateCode } : {}),
  });
  expect(co.status).toBe(201);
  const session = h.sessions.get(co.json.sessionId);
  session.payment_status = "paid";
  const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
  expect(v.status).toBe(200);
  return { checkout: co.json, verify: v.json, sessionId: co.json.sessionId as string };
}

describe("shop product affiliate settings", () => {
  it("create + PATCH carry the setting; enabling without a rate refuses", async () => {
    h.userId = SELLER;
    const created = await req("POST", `/shops/${SHOP_ID}/products`, {
      name: "Mug", price_cents: 2500, affiliate_enabled: true, affiliate_commission_bps: 2500,
    });
    expect(created.status).toBe(201);
    expect(created.json.product.affiliate_enabled).toBe(true);
    expect(Number(created.json.product.affiliate_commission_bps)).toBe(2500);

    const noRate = await req("POST", `/shops/${SHOP_ID}/products`, {
      name: "Bad Mug", price_cents: 2500, affiliate_enabled: true,
    });
    expect(noRate.status).toBe(400);
    expect(noRate.json.error).toBe("COMMISSION_REQUIRED");

    const patched = await req("PATCH", `/shops/${SHOP_ID}/products/${P2}`, {
      affiliate_enabled: true, affiliate_commission_bps: 500,
    });
    expect(patched.status).toBe(200);
    expect(patched.json.product.affiliate_enabled).toBe(true);
    expect(Number(patched.json.product.affiliate_commission_bps)).toBe(500);
  });
});

describe("shops checkout attribution", () => {
  it("the paid flip records the commission exactly once — verify + webhook replays included", async () => {
    const code = await fanClaimsCode(P1);
    const { sessionId, checkout } = await checkoutAndPay(
      [{ productId: P1, quantity: 1 }, { productId: P2, quantity: 1 }], code);
    /* Cart $105: the code rides ONLY the Poster line ($100, fee $5, net $95 → $9.50). */
    expect(checkout.gross_cents).toBe(10500);
    expect(checkout.platform_fee_cents).toBe(525);
    const rows = await affiliateSaleRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].gross_cents)).toBe(10000);
    expect(Number(rows[0].platform_fee_cents)).toBe(500);
    expect(Number(rows[0].seller_net_cents)).toBe(9500);
    expect(Number(rows[0].commission_cents)).toBe(950);
    expect(rows[0].status).toBe("owed");

    /* Replay both doors: verify again, and the webhook's direct flip. */
    const replay = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(replay.json.duplicate).toBe(true);
    const again = await markMarketSalePaid(sessionId);
    expect(again.flipped).toBe(0);
    expect(await affiliateSaleRows()).toHaveLength(1);

    /* The code was carried on the matching pending line only. */
    const ev = await h.db.execute(sql`SELECT product_id, affiliate_code FROM shop_events WHERE event_type = 'sale' ORDER BY amount_cents DESC`);
    expect((ev.rows[0] as any).affiliate_code).toBe(code);
    expect((ev.rows[1] as any).affiliate_code).toBeNull();
  });

  it("guest self-referral by email earns nothing", async () => {
    const code = await fanClaimsCode(P1);
    await checkoutAndPay([{ productId: P1, quantity: 1 }], code, "fan@example.com");
    expect(await affiliateSaleRows()).toHaveLength(0);
  });

  it("a code for a product not in the cart refuses checkout; a bogus code too", async () => {
    const code = await fanClaimsCode(P1);
    const wrong = await req("POST", "/storefronts/checkout", {
      shopId: SHOP_ID, items: [{ productId: P2, quantity: 1 }], buyerEmail: "b@example.com", affiliateCode: code,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error).toBe("BAD_AFFILIATE_CODE");
    const bogus = await req("POST", "/storefronts/checkout", {
      shopId: SHOP_ID, items: [{ productId: P1, quantity: 1 }], buyerEmail: "b@example.com", affiliateCode: "AFF-NOPE",
    });
    expect(bogus.status).toBe(400);
  });

  it("no code, no commission — plain sales stay plain", async () => {
    await checkoutAndPay([{ productId: P1, quantity: 1 }]);
    expect(await affiliateSaleRows()).toHaveLength(0);
  });
});
