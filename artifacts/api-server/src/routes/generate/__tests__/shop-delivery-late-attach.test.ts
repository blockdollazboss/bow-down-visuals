/**
 * Digital delivery — the LATE ATTACH gap (stack1100 lane G5A, Gate #5
 * part 2 finding P2-2). Harness mirrors shop-delivery.test.ts: real
 * shops router over pg-mem, Stripe mocked at the lib/stripe-checkout
 * seam, storage mocked at the supabase-admin seam.
 *
 * The chain hole this pins: delivery is a flip-time snapshot. A
 * product sold while it carried no deliverable (the Gate #5 shape —
 * "TEST Digital Download" sitting at the physical default with no
 * file) leaves the buyer an honest but INERT order-record row, and
 * when the seller later fixes the listing (PATCH -> digital + file)
 * nothing ever heals the past sale: the buyer paid and still cannot
 * download. These tests walk the whole arc on the real routers:
 *   buy file-less -> deliveryMissing -> seller attaches -> buyer CAN
 *   download (library row + receipt), exactly once, and never for
 *   anyone who did not pay.
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


const STRANGER = randomUUID();
const STRANGER_EMAIL = "stranger@example.com";

/** Seed a shop whose product sits at the physical default with NO
 *  file — byte-for-byte the Gate #5 "TEST Digital Download" shape. */
async function seedShopWithFilelessProduct(priceCents = 500) {
  const shopId = randomUUID(); const pid = randomUUID();
  const handle = "gate5-" + shopId.slice(0, 8);
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${SELLER}, 'Gate5 Shop', ${handle})`);
  await h.db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents)
    VALUES (${pid}, ${shopId}, ${SELLER}, 'TEST Digital Download — delete pre-launch', ${priceCents})
  `);
  return { shopId, handle, pid };
}

/** Buy one unit as the signed-in buyer (session rides along, so the
 *  order stamps the buyer's account id — the Gate #5 shape) and flip
 *  it paid through the verify door. Returns the verify payload. */
async function buyAndPay(shopId: string, pid: string) {
  h.userId = BUYER; h.userEmail = BUYER_EMAIL;
  const co = await req("POST", "/storefronts/checkout", {
    shopId, productId: pid, quantity: 1, buyerEmail: BUYER_EMAIL,
  });
  expect(co.status).toBe(201);
  expect(co.json.paid).toBe(false);
  const session = h.sessions.get(co.json.sessionId);
  session.payment_status = "paid";
  const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
  expect(v.status).toBe(200);
  expect(v.json.paid).toBe(true);
  return { sessionId: co.json.sessionId as string, verify: v.json };
}

async function libraryAs(userId: string, email: string) {
  h.userId = userId; h.userEmail = email;
  const lib = await req("GET", "/shops/my-purchases");
  expect(lib.status).toBe(200);
  return lib.json.purchases as any[];
}

describe("shop digital delivery — late attach (Gate #5 P2-2)", () => {
  it("GATE #5 ARC: file-less sale -> inert order record -> seller attaches the file -> the buyer can download", async () => {
    const { shopId, pid } = await seedShopWithFilelessProduct(500);
    const { sessionId, verify } = await buyAndPay(shopId, pid);
    /* The money side was always right: $5.00 -> $0.25 fee / $4.75 net. */
    expect(verify.platform_fee_cents).toBe(25);
    expect(verify.seller_net_cents).toBe(475);
    expect(verify.deliveries).toHaveLength(0);
    expect(await deliveryCount()).toBe(0);

    /* The buyer's library: the order IS there (stack600 honesty) but
       inert — no download, because no delivery exists. */
    const before = await libraryAs(BUYER, BUYER_EMAIL);
    expect(before).toHaveLength(1);
    expect(before[0].deliveryMissing).toBe(true);
    expect(before[0].downloadUrl).toBeNull();
    expect(before[0].productName).toBe("TEST Digital Download — delete pre-launch");

    /* The seller fixes the listing: flips it to digital and attaches
       the file buyers already paid for. */
    h.userId = SELLER; h.userEmail = "seller@example.com";
    const patch = await req("PATCH", `/shops/${shopId}/products/${pid}`, {
      product_type: "digital",
      deliverable_url: FILE_URL,
      deliverable_name: "beat-pack.zip",
    });
    expect(patch.status).toBe(200);
    expect(patch.json.product.product_type).toBe("digital");
    expect(patch.json.product.deliverable_url).toBe(FILE_URL);

    /* THE HEAL: the past paid sale now delivers — durably (a real
       shop_deliveries row), in the buyer's library, and on the
       order's own receipt. */
    expect(await deliveryCount()).toBe(1);
    const after = await libraryAs(BUYER, BUYER_EMAIL);
    expect(after).toHaveLength(1);
    expect(after[0].deliveryMissing).toBe(false);
    expect(after[0].downloadUrl).toBe(FILE_URL);
    expect(after[0].fileName).toBe("beat-pack.zip");
    expect(after[0].orderId).toBe(verify.orderId);

    const status = await req("GET", `/storefronts/checkout/status?sessionId=${sessionId}`);
    expect(status.status).toBe(200);
    expect(status.json.deliveries).toHaveLength(1);
    expect(status.json.deliveries[0].deliverable_url).toBe(FILE_URL);
  });

  it("entitlement: the healed download reaches ONLY the buyer — never a stranger, never the public payload", async () => {
    const { shopId, handle, pid } = await seedShopWithFilelessProduct(500);
    await buyAndPay(shopId, pid);
    h.userId = SELLER; h.userEmail = "seller@example.com";
    const patch = await req("PATCH", `/shops/${shopId}/products/${pid}`, {
      product_type: "digital", deliverable_url: FILE_URL, deliverable_name: "beat-pack.zip",
    });
    expect(patch.status).toBe(200);
    expect(await deliveryCount()).toBe(1);

    /* A signed-in stranger's library: no row, no URL, nothing. */
    const strangerLib = await libraryAs(STRANGER, STRANGER_EMAIL);
    expect(strangerLib).toHaveLength(0);

    /* The seller's own library doesn't gain the buyer's delivery. */
    const sellerLib = await libraryAs(SELLER, "seller@example.com");
    expect(sellerLib).toHaveLength(0);

    /* The public storefront still never carries the deliverable. */
    const pub = await req("GET", `/shops/handle/${handle}`);
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.json)).not.toContain(FILE_URL);
    expect(JSON.stringify(pub.json)).not.toContain("deliverable");
  });

  it("honest state survives: a paid product whose seller NEVER attaches a file stays an order record — no fabricated download", async () => {
    const { shopId, pid } = await seedShopWithFilelessProduct(500);
    await buyAndPay(shopId, pid);
    /* An unrelated seller edit (rename) must not conjure a download. */
    h.userId = SELLER; h.userEmail = "seller@example.com";
    const patch = await req("PATCH", `/shops/${shopId}/products/${pid}`, { name: "Renamed Download" });
    expect(patch.status).toBe(200);
    expect(await deliveryCount()).toBe(0);
    const lib = await libraryAs(BUYER, BUYER_EMAIL);
    expect(lib).toHaveLength(1);
    expect(lib[0].deliveryMissing).toBe(true);
    expect(lib[0].downloadUrl).toBeNull();
    expect(lib[0].productName).toBe("Renamed Download");
  });

  it("idempotent: re-saving the listing (file again, price change) never duplicates the healed delivery", async () => {
    const { shopId, pid } = await seedShopWithFilelessProduct(500);
    await buyAndPay(shopId, pid);
    h.userId = SELLER; h.userEmail = "seller@example.com";
    await req("PATCH", `/shops/${shopId}/products/${pid}`, {
      product_type: "digital", deliverable_url: FILE_URL, deliverable_name: "beat-pack.zip",
    });
    expect(await deliveryCount()).toBe(1);
    await req("PATCH", `/shops/${shopId}/products/${pid}`, {
      deliverable_url: FILE_URL, deliverable_name: "beat-pack.zip",
    });
    await req("PATCH", `/shops/${shopId}/products/${pid}`, { price_cents: 600 });
    expect(await deliveryCount()).toBe(1);
    const lib = await libraryAs(BUYER, BUYER_EMAIL);
    expect(lib).toHaveLength(1);
    expect(lib[0].downloadUrl).toBe(FILE_URL);
  });

  it("guest buyer (email key) heals too: checkout email alone carries the late delivery", async () => {
    const { shopId, pid } = await seedShopWithFilelessProduct(500);
    /* Guest checkout: no session, just the typed email. */
    h.userId = ""; h.userEmail = null;
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1, buyerEmail: BUYER_EMAIL,
    });
    expect(co.status).toBe(201);
    const session = h.sessions.get(co.json.sessionId);
    session.payment_status = "paid";
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.json.paid).toBe(true);
    expect(await deliveryCount()).toBe(0);

    h.userId = SELLER; h.userEmail = "seller@example.com";
    await req("PATCH", `/shops/${shopId}/products/${pid}`, {
      product_type: "digital", deliverable_url: FILE_URL, deliverable_name: "beat-pack.zip",
    });
    expect(await deliveryCount()).toBe(1);
    /* The buyer signs up later with the same email and finds it. */
    const lib = await libraryAs(BUYER, BUYER_EMAIL);
    expect(lib).toHaveLength(1);
    expect(lib[0].deliveryMissing).toBe(false);
    expect(lib[0].downloadUrl).toBe(FILE_URL);
  });

  it("read-time net: a paid line whose flip-time delivery write was lost still reads downloadable — presentation only, no row fabricated", async () => {
    const { shopId, pid } = await seedShopWithDigital(500);
    /* Simulate the lost write directly: a PAID sale line for an
       already-digital product, stamped to the buyer, with NO
       shop_deliveries row and no later PATCH to trigger the heal. */
    const saleId = randomUUID();
    await h.db.execute(sql`
      INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, buyer_email, buyer_user_id, payment_status, paid_at, checkout_group_id)
      VALUES (${saleId}, ${shopId}, ${SELLER}, 'sale', ${pid}, 500, 25, ${BUYER_EMAIL}, ${BUYER}, 'paid', now(), 'grp-lost-write')
    `);
    expect(await deliveryCount()).toBe(0);
    const lib = await libraryAs(BUYER, BUYER_EMAIL);
    expect(lib).toHaveLength(1);
    expect(lib[0].deliveryMissing).toBe(false);
    expect(lib[0].downloadUrl).toBe(FILE_URL);
    expect(lib[0].orderId).toBe("grp-lost-write");
    /* Presentation only — the durable record is still row-less until
       a seller save runs the backfill. */
    expect(await deliveryCount()).toBe(0);
    /* …and the net never widens entitlement: a stranger sees nothing. */
    const strangerLib = await libraryAs(STRANGER, STRANGER_EMAIL);
    expect(strangerLib).toHaveLength(0);
  });
});
