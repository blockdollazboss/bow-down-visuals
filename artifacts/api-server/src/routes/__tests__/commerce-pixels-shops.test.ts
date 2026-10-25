/**
 * Commerce tracking pixels (wave-4 #41, migration 0240) — the SHOPS rail
 * (routes/generate/shops.ts). Drives the REAL shops router over pg-mem
 * with Stripe faked at the lib/stripe-checkout seam and pins:
 *  - the shop owner's pixel IDs persist through PATCH /shops/:id and
 *    read back on /shops/mine (owner) — the settings round-trip;
 *  - an invalid ID refuses the WHOLE save (400) and changes nothing;
 *    "" clears a field; a non-owner PATCH 404s;
 *  - the public payloads (handle + slug) carry ONLY the sanitized
 *    `pixels` object — never the raw columns — and a bent value stored
 *    out-of-band presents as null (can never arm a pixel);
 *  - no IDs configured → pixels are all null on every surface
 *    (silence is the default: nothing can fire);
 *  - checkout verify (the checkout-success path) carries the seller's
 *    pixels alongside the paid receipt, so the shop page fires its
 *    Purchase event from server truth — and a pixel-less shop's
 *    verify carries all-null pixels.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  stripeCreates: [] as Array<{ params: any; options: any }>,
  sessions: new Map<string, any>(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userCredits = 10000;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../lib/stripe-checkout", () => ({
  getCheckoutStripe: () => ({
    checkout: {
      sessions: {
        create: async (params: any, options: any) => {
          const id = `cs_test_${h.stripeCreates.length + 1}`;
          h.stripeCreates.push({ params, options });
          const amount_total = (params.line_items as Array<any>).reduce(
            (sum, li) => sum + li.price_data.unit_amount * (li.quantity ?? 1),
            0,
          );
          h.sessions.set(id, { id, payment_status: "paid", amount_total, metadata: params.metadata });
          return { id, url: "https://checkout.example.com/pay" };
        },
      },
    },
  }),
  retrieveCheckoutSession: async (id: string) => {
    const s = h.sessions.get(id);
    if (!s) throw new Error("No such checkout session");
    return s;
  },
  checkoutBaseUrl: () => "https://example.com",
  isCheckoutTestMode: () => true,
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../lib/objectStorage", () => ({
  SHOP_PRODUCTS_BUCKET: "shop-products",
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  isStorageRef: vi.fn(() => false),
}));

import shopsRouter from "../generate/shops";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE shops (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL,
  tagline text, description text, banner_color text NOT NULL DEFAULT '#0a0a0a',
  accent_color text NOT NULL DEFAULT '#d4af37', banner_image_url text,
  custom_domain text, domain_verified boolean NOT NULL DEFAULT false,
  domain_verification_token text,
  meta_pixel_id text, tiktok_pixel_id text, google_tag_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL, user_id uuid NOT NULL, name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0, description text,
  image_url text, image_path text, status text NOT NULL DEFAULT 'active',
  pinned_ugc_ad_id uuid,
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  image_alt_text text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  buyer_email text, stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text, discount_code text, affiliate_code text,
  settled_payout_id uuid, settled_at timestamptz, ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL,
  code text NOT NULL, percent_off integer NOT NULL,
  max_uses integer NOT NULL DEFAULT -1, used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ugc_ads (id uuid PRIMARY KEY, status text, video_ref text);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const SELLER = randomUUID();
const OTHER_SELLER = randomUUID();
const SHOP_ID = randomUUID();
const PIXEL_SHOP_ID = randomUUID();
let PRODUCT: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[commerce-pixels-shops] unhandled route error:", err?.message ?? err);
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
  h.userId = SELLER;
  h.stripeCreates = [];
  h.sessions = new Map();
  await h.db.execute(sql`
    INSERT INTO shops (id, user_id, name, handle) VALUES (${SHOP_ID}, ${SELLER}, 'Plain Shop', 'plain-shop')
  `);
  await h.db.execute(sql`
    INSERT INTO shops (id, user_id, name, handle, meta_pixel_id, tiktok_pixel_id, google_tag_id)
    VALUES (${PIXEL_SHOP_ID}, ${SELLER}, 'Pixel Shop', 'pixel-shop', '123456789012345', 'C9ABCDEFGHIJKLMN12', 'G-ABC123XYZ9')
  `);
  PRODUCT = randomUUID();
  await h.db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, status)
    VALUES (${PRODUCT}, ${PIXEL_SHOP_ID}, ${SELLER}, 'Gold Hoodie', 2000, 'active')
  `);
  const plainProduct = randomUUID();
  await h.db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, status)
    VALUES (${plainProduct}, ${SHOP_ID}, ${SELLER}, 'Silver Cap', 1000, 'active')
  `);
});

async function req(method: string, path: string, body?: unknown, as?: string) {
  if (as) h.userId = as;
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("shops pixels — settings persistence", () => {
  it("PATCH saves all three IDs; mine reads them back; the row holds them", async () => {
    const r = await req("PATCH", `/shops/${SHOP_ID}`, {
      meta_pixel_id: "123456789012345",
      tiktok_pixel_id: "C9ABCDEFGHIJKLMN12",
      google_tag_id: "AW-123456789",
    });
    expect(r.status).toBe(200);
    expect(r.json.shop.pixels).toEqual({
      metaPixelId: "123456789012345",
      tiktokPixelId: "C9ABCDEFGHIJKLMN12",
      googleTagId: "AW-123456789",
    });
    const mine = await req("GET", "/shops/mine");
    const shop = (mine.json.shops as Array<any>).find((s) => s.id === SHOP_ID);
    expect(shop.pixels).toEqual(r.json.shop.pixels);
    const row = await h.db.execute(sql`SELECT meta_pixel_id, google_tag_id FROM shops WHERE id = ${SHOP_ID}`);
    expect(row.rows[0]).toMatchObject({ meta_pixel_id: "123456789012345", google_tag_id: "AW-123456789" });
  });

  it("an invalid ID refuses the whole save and changes nothing", async () => {
    const r = await req("PATCH", `/shops/${SHOP_ID}`, {
      meta_pixel_id: "123456789012345",
      google_tag_id: "not-a-tag",
    });
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toContain("Google tag");
    const row = await h.db.execute(sql`SELECT meta_pixel_id, google_tag_id FROM shops WHERE id = ${SHOP_ID}`);
    expect(row.rows[0]).toMatchObject({ meta_pixel_id: null, google_tag_id: null });
  });

  it('"" clears a field; omitted fields stay as they are', async () => {
    const cleared = await req("PATCH", `/shops/${PIXEL_SHOP_ID}`, { meta_pixel_id: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.json.shop.pixels).toEqual({
      metaPixelId: null,
      tiktokPixelId: "C9ABCDEFGHIJKLMN12",
      googleTagId: "G-ABC123XYZ9",
    });
  });

  it("a non-owner PATCH 404s and writes nothing", async () => {
    const r = await req("PATCH", `/shops/${PIXEL_SHOP_ID}`, { meta_pixel_id: "999999999" }, OTHER_SELLER);
    expect(r.status).toBe(404);
    const row = await h.db.execute(sql`SELECT meta_pixel_id FROM shops WHERE id = ${PIXEL_SHOP_ID}`);
    expect((row.rows[0] as any).meta_pixel_id).toBe("123456789012345");
  });

  it("a pixel-free PATCH (name only) leaves the pixels untouched", async () => {
    const r = await req("PATCH", `/shops/${PIXEL_SHOP_ID}`, { name: "Renamed Shop" });
    expect(r.status).toBe(200);
    expect(r.json.shop.pixels.metaPixelId).toBe("123456789012345");
  });
});

describe("shops pixels — public payloads", () => {
  it("handle payload carries sanitized pixels and never the raw columns", async () => {
    const pub = await req("GET", "/shops/handle/pixel-shop");
    expect(pub.status).toBe(200);
    expect(pub.json.pixels).toEqual({
      metaPixelId: "123456789012345",
      tiktokPixelId: "C9ABCDEFGHIJKLMN12",
      googleTagId: "G-ABC123XYZ9",
    });
    expect(pub.json.shop.meta_pixel_id).toBeUndefined();
    expect(pub.json.shop.tiktok_pixel_id).toBeUndefined();
    expect(pub.json.shop.google_tag_id).toBeUndefined();
  });

  it("slug payload carries the same sanitized pixels", async () => {
    const pub = await req("GET", "/storefronts/slug/pixel-shop");
    expect(pub.status).toBe(200);
    expect(pub.json.pixels.metaPixelId).toBe("123456789012345");
    expect(pub.json.shop.meta_pixel_id).toBeUndefined();
  });

  it("no IDs configured → every public surface reports all-null pixels", async () => {
    const pub = await req("GET", "/shops/handle/plain-shop");
    expect(pub.json.pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: null });
    const slug = await req("GET", "/storefronts/slug/plain-shop");
    expect(slug.json.pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: null });
  });

  it("a bent value stored out-of-band presents as null — it can never arm", async () => {
    await h.db.execute(sql`UPDATE shops SET meta_pixel_id = 'junk!!', tiktok_pixel_id = 'has spaces' WHERE id = ${PIXEL_SHOP_ID}`);
    const pub = await req("GET", "/shops/handle/pixel-shop");
    expect(pub.json.pixels).toEqual({
      metaPixelId: null,
      tiktokPixelId: null,
      googleTagId: "G-ABC123XYZ9",
    });
  });
});

describe("shops pixels — checkout-success (verify) payload", () => {
  it("verify carries the seller's pixels with the paid receipt", async () => {
    const co = await req("POST", "/storefronts/checkout", {
      shopId: PIXEL_SHOP_ID, buyerEmail: "buyer@example.com",
      items: [{ productId: PRODUCT, quantity: 1 }],
    });
    expect(co.status).toBe(201);
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.status).toBe(200);
    expect(v.json.paid).toBe(true);
    expect(v.json.pixels).toEqual({
      metaPixelId: "123456789012345",
      tiktokPixelId: "C9ABCDEFGHIJKLMN12",
      googleTagId: "G-ABC123XYZ9",
    });
    const st = await req("GET", `/storefronts/checkout/status?sessionId=${co.json.sessionId}`);
    expect(st.json.pixels.metaPixelId).toBe("123456789012345");
  });

  it("a pixel-less shop's verify carries all-null pixels (nothing can fire)", async () => {
    const rows = await h.db.execute(sql`SELECT id FROM shop_products WHERE shop_id = ${SHOP_ID} LIMIT 1`);
    const plainProduct = String((rows.rows[0] as any).id);
    const co = await req("POST", "/storefronts/checkout", {
      shopId: SHOP_ID, buyerEmail: "buyer@example.com",
      items: [{ productId: plainProduct, quantity: 1 }],
    });
    expect(co.status).toBe(201);
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.json.paid).toBe(true);
    expect(v.json.pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: null });
  });
});
