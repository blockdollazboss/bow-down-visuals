/**
 * shop-design-premigration.test.ts — the honest pre-migration state
 * (migration 0320, store-starters lane).
 *
 * Boots the shops router against a shops table WITHOUT layout_style /
 * font_style and pins the deploy-order discipline (the commerce
 * pixels precedent):
 *   - A PATCH that touches layout/font gets an honest 503
 *     (shop_design_not_ready) and NOTHING from that request saves —
 *     never a silent drop of the design or a partial write.
 *   - Every other shop write keeps working.
 *   - Reads present the defaults (showcase + house = the current
 *     look), so the storefront renders exactly as before.
 *
 * Separate file on purpose: the column probe caches per process, so
 * the pre-migration world must not share a process with the migrated
 * suite. Same pg-mem harness as commerce-pixels-shops.test.ts.
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

/* Identical to the migrated suite's DDL minus layout_style/font_style. */
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
const SHOP_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[shop-design-premigration] unhandled route error:", err?.message ?? err);
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
    INSERT INTO shops (id, user_id, name, handle) VALUES (${SHOP_ID}, ${SELLER}, 'Old Shop', 'old-shop')
  `);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("shop design — pre-migration honesty", () => {
  it("a design-touching PATCH gets an honest 503 and NOTHING from the request saves", async () => {
    const r = await req("PATCH", `/shops/${SHOP_ID}`, {
      name: "Renamed Shop",
      layout_style: "gallery",
      font_style: "royal",
    });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("shop_design_not_ready");
    const row = await h.db.execute(sql`SELECT name FROM shops WHERE id = ${SHOP_ID}`);
    expect((row.rows[0] as any).name).toBe("Old Shop");
  });

  it("a non-design PATCH keeps working untouched", async () => {
    const r = await req("PATCH", `/shops/${SHOP_ID}`, { name: "Renamed Shop", banner_color: "#112233" });
    expect(r.status).toBe(200);
    expect(r.json.shop.name).toBe("Renamed Shop");
    expect(r.json.shop.banner_color).toBe("#112233");
  });

  it("reads present the defaults — the current look — with no columns behind them", async () => {
    const mine = await req("GET", "/shops/mine");
    const mineShop = (mine.json.shops as Array<any>).find((s) => s.id === SHOP_ID);
    expect(mineShop.layout_style).toBe("showcase");
    expect(mineShop.font_style).toBe("house");

    const pub = await req("GET", "/storefronts/slug/old-shop");
    expect(pub.status).toBe(200);
    expect(pub.json.shop.layout_style).toBe("showcase");
    expect(pub.json.shop.font_style).toBe("house");
  });
});
