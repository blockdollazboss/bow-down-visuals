/**
 * shop-design-shops.test.ts — store layout + font settings round trip
 * through the REAL shops rail (migration 0320, store-starters lane).
 *
 * Wave #3's color starters had no layout/font settings to write to;
 * this suite proves the new pair rides the exact rail the colors use
 * (PATCH /api/shops/:id -> shops.layout_style / shops.font_style) and
 * reads back sanitized on every surface:
 *   PATCH -> owner reads (mine / handle) -> public storefront slug
 * Partial saves keep the other axis (COALESCE discipline), an unknown
 * value refuses the whole save (zod enums), a non-owner writes
 * nothing, and a bent value sitting in the row presents as the
 * default — never to the render.
 *
 * Same pg-mem harness as commerce-pixels-shops.test.ts, with the two
 * 0320 columns added to the shops DDL.
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
  layout_style text NOT NULL DEFAULT 'showcase', font_style text NOT NULL DEFAULT 'house',
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

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[shop-design-shops] unhandled route error:", err?.message ?? err);
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
    INSERT INTO shops (id, user_id, name, handle) VALUES (${SHOP_ID}, ${SELLER}, 'Design Shop', 'design-shop')
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

describe("shop design settings — the round trip", () => {
  it("PATCH saves layout + font; owner + public reads hand them back; the row holds them", async () => {
    const r = await req("PATCH", `/shops/${SHOP_ID}`, { layout_style: "gallery", font_style: "royal" });
    expect(r.status).toBe(200);
    expect(r.json.shop.layout_style).toBe("gallery");
    expect(r.json.shop.font_style).toBe("royal");

    const mine = await req("GET", "/shops/mine");
    const mineShop = (mine.json.shops as Array<any>).find((s) => s.id === SHOP_ID);
    expect(mineShop.layout_style).toBe("gallery");
    expect(mineShop.font_style).toBe("royal");

    const byHandle = await req("GET", "/shops/handle/design-shop");
    expect(byHandle.json.shop.layout_style).toBe("gallery");
    expect(byHandle.json.shop.font_style).toBe("royal");

    /* The payload the live storefront renders from. */
    const pub = await req("GET", "/storefronts/slug/design-shop");
    expect(pub.status).toBe(200);
    expect(pub.json.shop.layout_style).toBe("gallery");
    expect(pub.json.shop.font_style).toBe("royal");

    const row = await h.db.execute(sql`SELECT layout_style, font_style FROM shops WHERE id = ${SHOP_ID}`);
    expect(row.rows[0]).toMatchObject({ layout_style: "gallery", font_style: "royal" });
  });

  it("a fresh shop presents the defaults — showcase + house — on every read", async () => {
    const mine = await req("GET", "/shops/mine");
    const mineShop = (mine.json.shops as Array<any>).find((s) => s.id === SHOP_ID);
    expect(mineShop.layout_style).toBe("showcase");
    expect(mineShop.font_style).toBe("house");
    const pub = await req("GET", "/storefronts/slug/design-shop");
    expect(pub.json.shop.layout_style).toBe("showcase");
    expect(pub.json.shop.font_style).toBe("house");
  });

  it("a partial PATCH keeps the other axis (and the colors) untouched", async () => {
    await req("PATCH", `/shops/${SHOP_ID}`, { layout_style: "list", font_style: "classic" });
    const r = await req("PATCH", `/shops/${SHOP_ID}`, { font_style: "royal" });
    expect(r.status).toBe(200);
    expect(r.json.shop.layout_style).toBe("list");
    expect(r.json.shop.font_style).toBe("royal");
    expect(r.json.shop.banner_color).toBe("#0a0a0a");
    expect(r.json.shop.accent_color).toBe("#d4af37");
  });

  it("a color-only PATCH leaves the design untouched (the two starter axes stay independent)", async () => {
    await req("PATCH", `/shops/${SHOP_ID}`, { layout_style: "gallery", font_style: "classic" });
    const r = await req("PATCH", `/shops/${SHOP_ID}`, { banner_color: "#123456", accent_color: "#654321" });
    expect(r.status).toBe(200);
    expect(r.json.shop.layout_style).toBe("gallery");
    expect(r.json.shop.font_style).toBe("classic");
  });

  it("an unknown layout or font refuses the whole save and changes nothing", async () => {
    const badLayout = await req("PATCH", `/shops/${SHOP_ID}`, { layout_style: "banana", font_style: "royal" });
    expect(badLayout.status).toBe(400);
    const badFont = await req("PATCH", `/shops/${SHOP_ID}`, { font_style: "comic" });
    expect(badFont.status).toBe(400);
    const row = await h.db.execute(sql`SELECT layout_style, font_style FROM shops WHERE id = ${SHOP_ID}`);
    expect(row.rows[0]).toMatchObject({ layout_style: "showcase", font_style: "house" });
  });

  it("a non-owner PATCH 404s and writes nothing", async () => {
    const r = await req("PATCH", `/shops/${SHOP_ID}`, { layout_style: "list" }, OTHER_SELLER);
    expect(r.status).toBe(404);
    const row = await h.db.execute(sql`SELECT layout_style FROM shops WHERE id = ${SHOP_ID}`);
    expect((row.rows[0] as any).layout_style).toBe("showcase");
  });

  it("a bent value sitting in the row presents as the default, never to the render", async () => {
    await h.db.execute(sql`UPDATE shops SET layout_style = 'banana', font_style = 'wingdings' WHERE id = ${SHOP_ID}`);
    const pub = await req("GET", "/storefronts/slug/design-shop");
    expect(pub.json.shop.layout_style).toBe("showcase");
    expect(pub.json.shop.font_style).toBe("house");
    /* And a later partial save resolves against the sanitized design,
       so the bent row heals instead of pinning the bad value. */
    const r = await req("PATCH", `/shops/${SHOP_ID}`, { font_style: "royal" });
    expect(r.status).toBe(200);
    expect(r.json.shop.layout_style).toBe("showcase");
    const row = await h.db.execute(sql`SELECT layout_style, font_style FROM shops WHERE id = ${SHOP_ID}`);
    expect(row.rows[0]).toMatchObject({ layout_style: "showcase", font_style: "royal" });
  });

  it("creating a shop presents the default design (existing look preserved)", async () => {
    const created = await req("POST", "/shops", { name: "Fresh Shop", handle: "fresh-shop" });
    expect(created.status).toBe(201);
    expect(created.json.shop.layout_style).toBe("showcase");
    expect(created.json.shop.font_style).toBe("house");
  });
});
