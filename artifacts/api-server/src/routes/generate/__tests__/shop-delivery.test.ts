/**
 * Digital delivery for marketplace shops (payfix lane 4). Harness
 * mirrors shops-gift-tender.test.ts: real shops router over pg-mem,
 * Stripe mocked at the lib/stripe-checkout seam, storage mocked at
 * the supabase-admin seam.
 *
 * Pins the launch-blocker fix from the Oct 26 payments gate (Pass 2B):
 *  - a FREE seller can create a shop and list a digital product
 *    (flat 5% fee rail — the fee is asserted here too);
 *  - a digital product with no deliverable is refused (400);
 *  - a PAID purchase delivers exactly once: delivery row + visible
 *    order id + buyer library entry (GET /api/shops/my-purchases);
 *  - webhook/verify replays never deliver twice;
 *  - an UNPAID (declined/abandoned) session delivers NOTHING;
 *  - a physical product never creates a delivery;
 *  - the deliverable URL never leaks on the public storefront payload.
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
  getOpenAI: vi.fn(() => { throw new Error("no ai in delivery tests"); }),
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
  platform_fee_cents integer NOT NULL DEFAULT 0, buyer_email text,
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
const BUYER_EMAIL = "fan@example.com";
const FILE_URL = "https://files.example.com/beat-pack.zip";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[shop-delivery] unhandled route error:", err?.message ?? err);
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
  h.sessions = new Map();
  h.seq = 0;
  await h.db.execute(sql`INSERT INTO users (id, email) VALUES (${BUYER}, ${BUYER_EMAIL})`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
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
    VALUES (${pid}, ${shopId}, ${SELLER}, 'Beat Pack', ${priceCents}, 'digital', ${FILE_URL}, 'beat-pack.zip')
  `);
  return { shopId, handle, pid };
}

async function deliveryCount() {
  const r = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM shop_deliveries`);
  return Number((r.rows[0] as any).c);
}

describe("shop digital delivery (payfix lane 4)", () => {
  it("FREE seller creates a shop (201, no PRO_TIER_REQUIRED) and lists products at the flat 5% rail", async () => {
    const created = await req("POST", "/shops", { name: "Free Shop", handle: "free-shop-1" });
    expect(created.status).toBe(201);
    const shopId = created.json.shop.id;

    /* Digital without a deliverable = the launch blocker reborn: refuse. */
    const bad = await req("POST", `/shops/${shopId}/products`, {
      name: "Empty Download", price_cents: 500, product_type: "digital",
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("DELIVERABLE_REQUIRED");
    expect(bad.json.message).toContain("needs its file");

    const good = await req("POST", `/shops/${shopId}/products`, {
      name: "Beat Pack", price_cents: 500, product_type: "digital",
      deliverable_url: FILE_URL, deliverable_name: "beat-pack.zip",
    });
    expect(good.status).toBe(201);
    expect(good.json.product.product_type).toBe("digital");
    expect(good.json.product.deliverable_url).toBe(FILE_URL);
  });

  it("deliverable upload (JSON base64 shape) returns a stored URL", async () => {
    const { shopId } = await seedShopWithDigital();
    const up = await req("POST", `/shops/${shopId}/deliverables/upload`, {
      fileName: "loops.zip", contentType: "application/zip",
      dataBase64: Buffer.from("zip-bytes").toString("base64"),
    });
    expect(up.status).toBe(201);
    expect(up.json.url).toContain("loops.zip");
    expect(up.json.name).toBe("loops.zip");
  });

  it("public storefront shows the product kind but NEVER the deliverable URL", async () => {
    const { handle } = await seedShopWithDigital();
    const pub = await req("GET", `/shops/handle/${handle}`);
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.json)).not.toContain(FILE_URL);
    expect(JSON.stringify(pub.json)).not.toContain("deliverable");
  });

  it("PAID purchase delivers exactly once — verify + webhook replays — with a visible order id and a buyer library entry", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1, buyerEmail: BUYER_EMAIL,
    });
    expect(co.status).toBe(201);
    expect(co.json.paid).toBe(false);
    expect(await deliveryCount()).toBe(0);

    const session = h.sessions.get(co.json.sessionId);
    session.payment_status = "paid";
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.status).toBe(200);
    expect(v.json.paid).toBe(true);
    /* Flat 5% fee rail, untouched: $5.00 -> $0.25 fee / $4.75 net. */
    expect(v.json.platform_fee_cents).toBe(25);
    expect(v.json.seller_net_cents).toBe(475);
    expect(typeof v.json.orderId).toBe("string");
    expect(v.json.orderId.length).toBeGreaterThan(0);
    expect(v.json.deliveries).toHaveLength(1);
    expect(v.json.deliveries[0].deliverable_url).toBe(FILE_URL);
    expect(v.json.deliveries[0].order_id).toBe(v.json.orderId);
    expect(await deliveryCount()).toBe(1);

    /* Replays through BOTH doors deliver nothing twice. */
    const v2 = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v2.json.duplicate).toBe(true);
    expect(v2.json.deliveries).toHaveLength(1);
    await markMarketSalePaid(co.json.sessionId);
    expect(await deliveryCount()).toBe(1);

    /* The buyer's library: the same delivery, keyed by their account. */
    h.userId = BUYER; h.userEmail = BUYER_EMAIL;
    const lib = await req("GET", "/shops/my-purchases");
    expect(lib.status).toBe(200);
    expect(lib.json.purchases).toHaveLength(1);
    expect(lib.json.purchases[0].orderId).toBe(v.json.orderId);
    expect(lib.json.purchases[0].downloadUrl).toBe(FILE_URL);
    expect(lib.json.purchases[0].fileName).toBe("beat-pack.zip");
    expect(lib.json.purchases[0].productName).toBe("Beat Pack");
  });

  it("UNPAID session (declined/abandoned) delivers NOTHING and the library stays empty", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1, buyerEmail: BUYER_EMAIL,
    });
    expect(co.status).toBe(201);
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.status).toBe(200);
    expect(v.json.paid).toBe(false);
    expect(await deliveryCount()).toBe(0);

    h.userId = BUYER; h.userEmail = BUYER_EMAIL;
    const lib = await req("GET", "/shops/my-purchases");
    expect(lib.json.purchases).toHaveLength(0);
  });

  it("FREE digital product delivers on the in-place paid path, exactly once, with an order id", async () => {
    const { shopId, pid } = await seedShopWithDigital(0);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: pid, quantity: 1 }], buyerEmail: BUYER_EMAIL,
    });
    expect(co.status).toBe(201);
    expect(co.json.paid).toBe(true);
    expect(typeof co.json.orderId).toBe("string");
    expect(co.json.deliveries).toHaveLength(1);
    expect(co.json.deliveries[0].deliverable_url).toBe(FILE_URL);
    expect(await deliveryCount()).toBe(1);
  });

  it("PAID physical product creates NO delivery", async () => {
    const shopId = randomUUID(); const pid = randomUUID();
    await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${SELLER}, 'Phys Shop', ${"ph-" + shopId.slice(0, 8)})`);
    await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${pid}, ${shopId}, ${SELLER}, 'Hoodie', 2000)`);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1, buyerEmail: BUYER_EMAIL,
    });
    expect(co.status).toBe(201);
    const session = h.sessions.get(co.json.sessionId);
    session.payment_status = "paid";
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.json.paid).toBe(true);
    expect(v.json.deliveries).toHaveLength(0);
    expect(await deliveryCount()).toBe(0);
  });
});
