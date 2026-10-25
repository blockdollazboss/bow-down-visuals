/**
 * Commerce tracking pixels (wave-4 #41) — PRE-MIGRATION behavior.
 * Separate file on purpose: the routes cache their column probes per
 * process, so the no-columns world needs its own module registry.
 *
 * With migration 0240 not yet applied (no pixel columns anywhere):
 *  - pixel WRITES answer an honest 503 and change nothing, on both
 *    rails — a tracking setting is never silently dropped;
 *  - non-pixel updates keep working exactly as before;
 *  - every public/checkout payload reports all-null pixels (nothing
 *    can fire) and the storefront settings read says ready: false.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ db: null as any, userId: "", userEmail: "" }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userEmail = h.userEmail;
    req.userCredits = 10000;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

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
import storefrontRouter from "../storefront";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE shops (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL,
  tagline text, description text, banner_color text NOT NULL DEFAULT '#0a0a0a',
  accent_color text NOT NULL DEFAULT '#d4af37', banner_image_url text,
  custom_domain text, domain_verified boolean NOT NULL DEFAULT false,
  domain_verification_token text,
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
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const SELLER = randomUUID();
const SHOP_ID = randomUUID();
const PROFILE_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[commerce-pixels-premigration] unhandled route error:", err?.message ?? err);
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
  h.userEmail = "seller@example.com";
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${SHOP_ID}, ${SELLER}, 'Plain Shop', 'plain-shop')`);
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${SELLER}, 'queen-creator', 'Queen Creator')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("pre-migration commerce pixels", () => {
  it("shop pixel write → honest 503, and the shop is unchanged", async () => {
    const r = await req("PATCH", `/shops/${SHOP_ID}`, { meta_pixel_id: "123456789012345" });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("commerce_pixels_not_ready");
    const row = await h.db.execute(sql`SELECT name FROM shops WHERE id = ${SHOP_ID}`);
    expect((row.rows[0] as any).name).toBe("Plain Shop");
  });

  it("shop non-pixel updates keep working without the columns", async () => {
    const r = await req("PATCH", `/shops/${SHOP_ID}`, { name: "Renamed Shop" });
    expect(r.status).toBe(200);
    expect(r.json.shop.name).toBe("Renamed Shop");
    expect(r.json.shop.pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: null });
  });

  it("public shop payloads report all-null pixels", async () => {
    const pub = await req("GET", "/shops/handle/plain-shop");
    expect(pub.status).toBe(200);
    expect(pub.json.pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: null });
    const slug = await req("GET", "/storefronts/slug/plain-shop");
    expect(slug.json.pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: null });
    const mine = await req("GET", "/shops/mine");
    expect((mine.json.shops as Array<any>)[0].pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: null });
  });

  it("storefront settings read says ready:false; the write 503s honestly", async () => {
    const read = await req("GET", "/storefront/pixels");
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({
      ready: false,
      pixels: { metaPixelId: null, tiktokPixelId: null, googleTagId: null },
    });
    const write = await req("PATCH", "/storefront/pixels", { metaPixelId: "123456789012345" });
    expect(write.status).toBe(503);
    expect(write.json.error).toBe("commerce_pixels_not_ready");
  });
});
