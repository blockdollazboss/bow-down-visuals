/**
 * Shop checkout: embedded-first + buyer-keyed delivery (stack400 lane 2).
 *
 * Pins the two Oct 28 payments-gate defects (order
 * 01a95a0f-815b-4209-bade-07e777f28536), which repeat the Oct 26 Pass 2B
 * failure with a different buyer:
 *  (A) the 2D shop checkout went through the Stripe-HOSTED page — the
 *      server already supported uiMode:"embedded" but only the World
 *      stand asked. Here: an embedded ask mints an embedded_page
 *      session + clientSecret, returns to the SHOP page when the caller
 *      names its /shop/ path (never an arbitrary URL), and stays hosted
 *      only when embedded isn't asked for.
 *  (B) delivery was keyed ONLY to a free-text buyer_email. A signed-in
 *      buyer who left that field blank got a delivery keyed to nobody.
 *      Here: a verified session riding along stamps buyer_user_id on
 *      the order lines (migration 0297), the paid flip carries it into
 *      shop_deliveries, and the buyer's library finds it by ACCOUNT —
 *      even with req.userEmail null at library time. Buyer == seller
 *      grants normally. Guest checkout keeps the email key.
 *
 * Harness mirrors shop-delivery.test.ts (real shops router over
 * pg-mem, Stripe faked at the lib/stripe-checkout seam) plus a faked
 * lib/optional-auth that resolves the X-Test-Buyer header to an
 * account, standing in for the buyer's Supabase session.
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
  sessionParams: new Map<string, any>(),
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
  getOpenAI: vi.fn(() => { throw new Error("no ai in buyer-delivery tests"); }),
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
          const embedded = params.ui_mode === "embedded_page";
          const session = {
            id,
            url: embedded ? null : `https://checkout.example.com/pay/${id}`,
            client_secret: embedded ? `${id}_secret_test` : null,
            payment_status: "unpaid",
            amount_total: (params.line_items as any[]).reduce(
              (s: number, li: any) => s + li.price_data.unit_amount * li.quantity, 0),
            metadata: params.metadata,
          };
          h.sessions.set(id, session);
          h.sessionParams.set(id, params);
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
const BUYER_EMAIL = "buyer-d@example.com";
const FILE_URL = "https://files.example.com/test-download.zip";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[shop-buyer-delivery] unhandled route error:", err?.message ?? err);
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
  h.buyers = { [BUYER]: BUYER_EMAIL, [SELLER]: "seller@example.com" };
  h.sessions = new Map();
  h.sessionParams = new Map();
  h.seq = 0;
  await h.db.execute(sql`INSERT INTO users (id, email) VALUES (${BUYER}, ${BUYER_EMAIL})`);
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

async function seedShopWithDigital(priceCents = 500) {
  const shopId = randomUUID(); const pid = randomUUID();
  const handle = "dl-" + shopId.slice(0, 8);
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${SELLER}, 'DL Shop', ${handle})`);
  await h.db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, product_type, deliverable_url, deliverable_name)
    VALUES (${pid}, ${shopId}, ${SELLER}, 'TEST Digital Download', ${priceCents}, 'digital', ${FILE_URL}, 'test-download.zip')
  `);
  return { shopId, handle, pid };
}

async function deliveryRows() {
  const r = await h.db.execute(sql`SELECT buyer_user_id, buyer_email, deliverable_url FROM shop_deliveries`);
  return r.rows as Array<Record<string, unknown>>;
}

describe("shop checkout — embedded-first (defect A)", () => {
  it("embedded ask mints an embedded_page session + clientSecret and returns to the shop page", async () => {
    const { shopId, handle, pid } = await seedShopWithDigital(500);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1,
      uiMode: "embedded", returnPath: `/shop/${handle}`,
    }, BUYER);
    expect(co.status).toBe(201);
    expect(co.json.clientSecret).toBeTruthy();
    expect(co.json.url).toBeNull();
    const params = h.sessionParams.get(co.json.sessionId);
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toBe(`https://example.com/shop/${handle}?checkout=paid&session_id={CHECKOUT_SESSION_ID}`);
    expect(params.success_url).toBeUndefined();
  });

  it("no embedded ask = the hosted fallback rail, unchanged", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    const co = await req("POST", "/storefronts/checkout", { shopId, productId: pid, quantity: 1 }, BUYER);
    expect(co.status).toBe(201);
    expect(co.json.clientSecret).toBeNull();
    expect(typeof co.json.url).toBe("string");
    const params = h.sessionParams.get(co.json.sessionId);
    expect(params.ui_mode).toBeUndefined();
  });

  it("a returnPath that is not a /shop/ path is never honored (World return stands)", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    for (const bad of ["https://evil.example.com/x", "/admin", "//evil.example.com"]) {
      const co = await req("POST", "/storefronts/checkout", {
        shopId, productId: pid, quantity: 1, uiMode: "embedded", returnPath: bad,
      }, BUYER);
      expect(co.status).toBe(201);
      const params = h.sessionParams.get(co.json.sessionId);
      expect(params.return_url).toBe("https://example.com/world?checkout=paid&session_id={CHECKOUT_SESSION_ID}");
    }
  });
});

describe("shop delivery — keyed to the buyer's account (defect B)", () => {
  it("signed-in buyer, NO email typed: paid flip delivers to their account; library finds it by account alone", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    /* The Oct 28 shape exactly: signed in, email field left blank. */
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1, uiMode: "embedded", returnPath: "/shop/x",
    }, BUYER);
    expect(co.status).toBe(201);

    /* The pending line carries the account id, not just an email. */
    const ev = await h.db.execute(sql`SELECT buyer_user_id, buyer_email FROM shop_events WHERE event_type = 'pending_sale'`);
    expect(String((ev.rows[0] as any).buyer_user_id)).toBe(BUYER);

    const session = h.sessions.get(co.json.sessionId);
    session.payment_status = "paid";
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.json.paid).toBe(true);
    /* Fee math untouched: $5.00 -> $0.25 fee / $4.75 net. */
    expect(v.json.platform_fee_cents).toBe(25);
    expect(v.json.seller_net_cents).toBe(475);
    expect(v.json.deliveries).toHaveLength(1);

    const rows = await deliveryRows();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!["buyer_user_id"])).toBe(BUYER);

    /* Library read with NO email on the request — account id only. */
    h.userId = BUYER; h.userEmail = null;
    const lib = await req("GET", "/shops/my-purchases");
    expect(lib.status).toBe(200);
    expect(lib.json.purchases).toHaveLength(1);
    expect(lib.json.purchases[0].downloadUrl).toBe(FILE_URL);
    expect(lib.json.purchases[0].productName).toBe("TEST Digital Download");
  });

  it("buyer == seller: buying from your own shop grants the delivery normally", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    const co = await req("POST", "/storefronts/checkout", { shopId, productId: pid, quantity: 1 }, SELLER);
    expect(co.status).toBe(201);
    const session = h.sessions.get(co.json.sessionId);
    session.payment_status = "paid";
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.json.paid).toBe(true);
    const rows = await deliveryRows();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!["buyer_user_id"])).toBe(SELLER);

    h.userId = SELLER; h.userEmail = null;
    const lib = await req("GET", "/shops/my-purchases");
    expect(lib.json.purchases).toHaveLength(1);
  });

  it("guest checkout keeps the email key: typed email delivers and the library matches it", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1, buyerEmail: BUYER_EMAIL,
    });
    expect(co.status).toBe(201);
    const session = h.sessions.get(co.json.sessionId);
    session.payment_status = "paid";
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.json.paid).toBe(true);
    const rows = await deliveryRows();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!["buyer_user_id"])).toBe(BUYER);

    h.userId = BUYER; h.userEmail = BUYER_EMAIL;
    const lib = await req("GET", "/shops/my-purchases");
    expect(lib.json.purchases).toHaveLength(1);
  });

  it("signed-in FREE purchase delivers on the in-place path, keyed to the account", async () => {
    const { shopId, pid } = await seedShopWithDigital(0);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: pid, quantity: 1 }],
    }, BUYER);
    expect(co.status).toBe(201);
    expect(co.json.paid).toBe(true);
    expect(co.json.deliveries).toHaveLength(1);
    const rows = await deliveryRows();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!["buyer_user_id"])).toBe(BUYER);
  });
});
