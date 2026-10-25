/**
 * Wishlists + price-drop alerts (Wave 4 #38) — drives the REAL wishlist
 * router plus BOTH seller price-edit routes (storefront PATCH and
 * shops PATCH) over pg-mem and pins:
 *  - save records the current price as at-add AND alert floor; re-save
 *    is idempotent and never resets price history;
 *  - unknown product 404s, unavailable (inactive / paused) 409s;
 *  - per-user isolation: another fan's list/check/remove never touch
 *    the owner's rows, and there is no seller read of who saved what;
 *  - a drop below the floor alerts each saver exactly once through the
 *    notifications rail, then the floor resets to the new price;
 *  - rises never alert and never raise the floor (rise then partial
 *    fall back above the floor stays silent); a further drop below the
 *    reset floor alerts again;
 *  - a repeat/no-op price write alerts nobody;
 *  - removing from the wishlist stops all future alerts;
 *  - the detector itself is claim-safe: calling it twice for the same
 *    drop notifies once.
 *
 * The wishlists DDL below mirrors migration 0237 statement for
 * statement.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<any>,
  session: null as any,
  sessions: new Map<string, any>(),
}));

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

vi.mock("../../lib/stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: vi.fn(() => ({
      checkout: {
        sessions: {
          create: vi.fn(async (params: any) => {
            h.stripeCreates.push(params);
            return { id: `cs_test_${h.stripeCreates.length}`, url: "https://checkout.example.com/pay" };
          }),
          retrieve: vi.fn(async () => h.session),
        },
      },
    })),
  };
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

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../lib/objectStorage", () => ({
  SHOP_PRODUCTS_BUCKET: "shop-products",
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  isStorageRef: vi.fn(() => false),
}));

import wishlistsRouter from "../wishlists";
import storefrontRouter from "../storefront";
import shopsRouter from "../generate/shops";
import { detectWishlistPriceDrop } from "../../lib/wishlists";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE events (
  id uuid PRIMARY KEY, title text, rsvp_count integer NOT NULL DEFAULT 0
);
CREATE TABLE store_products (
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', price_cents integer NOT NULL,
  compare_at_cents integer, inventory integer NOT NULL DEFAULT -1,
  media_urls jsonb NOT NULL DEFAULT '[]', service_details jsonb,
  event_id uuid, related_links jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (price_cents >= 0),
  media_alt_texts jsonb NOT NULL DEFAULT '[]', gift_card_denominations_cents jsonb,
  bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0
);
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
  bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  buyer_email text, stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text, discount_code text, affiliate_code text,
  bump_for_product_id uuid,
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
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  body text NOT NULL DEFAULT '', link text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_kind text NOT NULL,
  item_id uuid NOT NULL,
  price_at_add_cents integer NOT NULL,
  lowest_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wishlists_item_kind_check CHECK (item_kind IN ('store_product', 'shop_product')),
  CONSTRAINT wishlists_price_at_add_nonneg CHECK (price_at_add_cents >= 0),
  CONSTRAINT wishlists_lowest_nonneg CHECK (lowest_cents >= 0)
);
CREATE UNIQUE INDEX wishlists_user_item_unique ON wishlists (user_id, item_kind, item_id);
CREATE INDEX wishlists_user_idx ON wishlists (user_id);
CREATE INDEX wishlists_item_idx ON wishlists (item_kind, item_id);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const FAN_A = randomUUID();
const FAN_B = randomUUID();
const SELLER = randomUUID();
const PROFILE_ID = randomUUID();
const STORE_PRODUCT = randomUUID();
const INACTIVE_PRODUCT = randomUUID();
const SHOP_SELLER = randomUUID();
const SHOP_ID = randomUUID();
const SHOP_PRODUCT = randomUUID();
const PAUSED_PRODUCT = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", wishlistsRouter);
  app.use("/api", storefrontRouter);
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[wishlists test] unhandled:", err?.message ?? err);
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
  h.userId = FAN_A;
  h.userEmail = "fan-a@example.com";
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${SELLER}, 'seller-sam', 'Seller Sam')`);
  await h.db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents) VALUES (${STORE_PRODUCT}, ${PROFILE_ID}, 'digital', 'Beat Pack Deluxe', 5000)`);
  await h.db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents, is_active) VALUES (${INACTIVE_PRODUCT}, ${PROFILE_ID}, 'digital', 'Retired Pack', 3000, false)`);
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${SHOP_ID}, ${SHOP_SELLER}, 'Sam''s Shop', 'sams-shop')`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${SHOP_PRODUCT}, ${SHOP_ID}, ${SHOP_SELLER}, 'Gold Chain Print', 8000)`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, status) VALUES (${PAUSED_PRODUCT}, ${SHOP_ID}, ${SHOP_SELLER}, 'Paused Print', 2000, 'paused')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

function as(userId: string) {
  h.userId = userId;
}

async function dropAlertsFor(userId: string): Promise<Array<Record<string, unknown>>> {
  const r = await h.db.execute(sql`
    SELECT title, body, link FROM notifications
    WHERE user_id = ${userId} AND kind = 'wishlist_price_drop'
    ORDER BY created_at ASC
  `);
  return r.rows as Array<Record<string, unknown>>;
}

async function wishlistRow(userId: string, itemId: string): Promise<Record<string, unknown> | undefined> {
  const r = await h.db.execute(sql`
    SELECT price_at_add_cents, lowest_cents FROM wishlists
    WHERE user_id = ${userId} AND item_id = ${itemId}
  `);
  return r.rows[0] as Record<string, unknown> | undefined;
}

describe("wishlist routes", () => {
  it("saves a store product, recording the current price as at-add and floor", async () => {
    const res = await req("POST", "/wishlists", { itemKind: "store_product", itemId: STORE_PRODUCT });
    expect(res.status).toBe(201);
    expect(res.json.created).toBe(true);
    expect(Number(res.json.wishlist.price_at_add_cents)).toBe(5000);
    expect(Number(res.json.wishlist.lowest_cents)).toBe(5000);

    const check = await req("GET", `/wishlists/check?itemKind=store_product&itemId=${STORE_PRODUCT}`);
    expect(check.json.wishlisted).toBe(true);

    const list = await req("GET", "/wishlists");
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0].title).toBe("Beat Pack Deluxe");
    expect(list.json.items[0].currentPriceCents).toBe(5000);
    expect(list.json.items[0].link).toBe(`/storefront/product/${STORE_PRODUCT}`);
  });

  it("saves a shop product and links to the shop", async () => {
    const res = await req("POST", "/wishlists", { itemKind: "shop_product", itemId: SHOP_PRODUCT });
    expect(res.status).toBe(201);
    expect(Number(res.json.wishlist.price_at_add_cents)).toBe(8000);
    const list = await req("GET", "/wishlists");
    expect(list.json.items[0].link).toBe("/shop/sams-shop");
  });

  it("re-save is idempotent and never resets price history", async () => {
    await req("POST", "/wishlists", { itemKind: "store_product", itemId: STORE_PRODUCT });
    await h.db.execute(sql`UPDATE store_products SET price_cents = 6000 WHERE id = ${STORE_PRODUCT}`);
    const res = await req("POST", "/wishlists", { itemKind: "store_product", itemId: STORE_PRODUCT });
    expect(res.status).toBe(200);
    expect(res.json.created).toBe(false);
    expect(Number(res.json.wishlist.price_at_add_cents)).toBe(5000);
    expect(Number(res.json.wishlist.lowest_cents)).toBe(5000);
    const list = await req("GET", "/wishlists");
    expect(list.json.items).toHaveLength(1);
  });

  it("404s an unknown product and 409s unavailable ones; 400s a bad kind", async () => {
    expect((await req("POST", "/wishlists", { itemKind: "store_product", itemId: randomUUID() })).status).toBe(404);
    expect((await req("POST", "/wishlists", { itemKind: "store_product", itemId: INACTIVE_PRODUCT })).status).toBe(409);
    expect((await req("POST", "/wishlists", { itemKind: "shop_product", itemId: PAUSED_PRODUCT })).status).toBe(409);
    expect((await req("POST", "/wishlists", { itemKind: "beat", itemId: STORE_PRODUCT })).status).toBe(400);
  });

  it("keeps wishlists per-user: no cross-user read, check, or remove", async () => {
    await req("POST", "/wishlists", { itemKind: "store_product", itemId: STORE_PRODUCT });
    as(FAN_B);
    expect((await req("GET", "/wishlists")).json.items).toHaveLength(0);
    expect((await req("GET", `/wishlists/check?itemKind=store_product&itemId=${STORE_PRODUCT}`)).json.wishlisted).toBe(false);
    const del = await req("DELETE", `/wishlists/store_product/${STORE_PRODUCT}`);
    expect(del.json.removed).toBe(false);
    as(FAN_A);
    expect((await req("GET", "/wishlists")).json.items).toHaveLength(1);
  });

  it("remove deletes the row and reports honestly on a second remove", async () => {
    await req("POST", "/wishlists", { itemKind: "store_product", itemId: STORE_PRODUCT });
    const del = await req("DELETE", `/wishlists/store_product/${STORE_PRODUCT}`);
    expect(del.json).toEqual({ ok: true, removed: true });
    expect((await req("GET", "/wishlists")).json.items).toHaveLength(0);
    const again = await req("DELETE", `/wishlists/store_product/${STORE_PRODUCT}`);
    expect(again.json).toEqual({ ok: true, removed: false });
  });
});

describe("price-drop alerts through the real seller price edits", () => {
  it("storefront PATCH: a drop alerts each saver once, floor resets, rises stay silent, a further drop alerts again", async () => {
    as(FAN_A);
    await req("POST", "/wishlists", { itemKind: "store_product", itemId: STORE_PRODUCT });
    as(FAN_B);
    await req("POST", "/wishlists", { itemKind: "store_product", itemId: STORE_PRODUCT });

    as(SELLER);
    const patch = await req("PATCH", `/storefront/products/${STORE_PRODUCT}`, { priceCents: 4000 });
    expect(patch.status).toBe(200);
    for (const fan of [FAN_A, FAN_B]) {
      const alerts = await dropAlertsFor(fan);
      expect(alerts).toHaveLength(1);
      expect(String(alerts[0]!["body"])).toContain("$40.00");
      expect(String(alerts[0]!["link"])).toBe(`/storefront/product/${STORE_PRODUCT}`);
      expect(Number((await wishlistRow(fan, STORE_PRODUCT))!["lowest_cents"])).toBe(4000);
    }

    /* Same price written again + a title-only edit: nobody re-alerts. */
    await req("PATCH", `/storefront/products/${STORE_PRODUCT}`, { priceCents: 4000 });
    await req("PATCH", `/storefront/products/${STORE_PRODUCT}`, { title: "Beat Pack Deluxe II" });
    expect(await dropAlertsFor(FAN_A)).toHaveLength(1);

    /* Rise: silent, and the floor does NOT follow the price up. */
    await req("PATCH", `/storefront/products/${STORE_PRODUCT}`, { priceCents: 4500 });
    expect(await dropAlertsFor(FAN_A)).toHaveLength(1);
    expect(Number((await wishlistRow(FAN_A, STORE_PRODUCT))!["lowest_cents"])).toBe(4000);

    /* Fall back, but still above the floor: not a new drop. */
    await req("PATCH", `/storefront/products/${STORE_PRODUCT}`, { priceCents: 4200 });
    expect(await dropAlertsFor(FAN_A)).toHaveLength(1);

    /* Below the floor: a second alert, floor resets again. */
    await req("PATCH", `/storefront/products/${STORE_PRODUCT}`, { priceCents: 3500 });
    const alerts = await dropAlertsFor(FAN_A);
    expect(alerts).toHaveLength(2);
    expect(String(alerts[1]!["body"])).toContain("$35.00");
    expect(Number((await wishlistRow(FAN_A, STORE_PRODUCT))!["lowest_cents"])).toBe(3500);
  });

  it("removing from the wishlist stops all future alerts", async () => {
    as(FAN_A);
    await req("POST", "/wishlists", { itemKind: "store_product", itemId: STORE_PRODUCT });
    as(FAN_B);
    await req("POST", "/wishlists", { itemKind: "store_product", itemId: STORE_PRODUCT });
    as(FAN_A);
    await req("DELETE", `/wishlists/store_product/${STORE_PRODUCT}`);

    as(SELLER);
    await req("PATCH", `/storefront/products/${STORE_PRODUCT}`, { priceCents: 3000 });
    expect(await dropAlertsFor(FAN_A)).toHaveLength(0);
    expect(await dropAlertsFor(FAN_B)).toHaveLength(1);
  });

  it("shops PATCH: a shop product drop alerts with the shop link; a rise stays silent", async () => {
    as(FAN_A);
    await req("POST", "/wishlists", { itemKind: "shop_product", itemId: SHOP_PRODUCT });

    as(SHOP_SELLER);
    const patch = await req("PATCH", `/shops/${SHOP_ID}/products/${SHOP_PRODUCT}`, { price_cents: 6000 });
    expect(patch.status).toBe(200);
    const alerts = await dropAlertsFor(FAN_A);
    expect(alerts).toHaveLength(1);
    expect(String(alerts[0]!["body"])).toContain("$60.00");
    expect(String(alerts[0]!["body"])).toContain("Gold Chain Print");
    expect(String(alerts[0]!["link"])).toBe("/shop/sams-shop");

    await req("PATCH", `/shops/${SHOP_ID}/products/${SHOP_PRODUCT}`, { price_cents: 7000 });
    expect(await dropAlertsFor(FAN_A)).toHaveLength(1);
    expect(Number((await wishlistRow(FAN_A, SHOP_PRODUCT))!["lowest_cents"])).toBe(6000);
  });
});

describe("detector (lib)", () => {
  it("is claim-safe: the same drop delivered twice notifies once", async () => {
    as(FAN_A);
    await req("POST", "/wishlists", { itemKind: "store_product", itemId: STORE_PRODUCT });
    const input = { itemKind: "store_product" as const, itemId: STORE_PRODUCT, newPriceCents: 2500 };
    expect((await detectWishlistPriceDrop(input, h.db)).alerted).toBe(1);
    expect((await detectWishlistPriceDrop(input, h.db)).alerted).toBe(0);
    expect(await dropAlertsFor(FAN_A)).toHaveLength(1);
  });

  it("no-ops for unwishlisted products and invalid prices, never throwing", async () => {
    expect((await detectWishlistPriceDrop({ itemKind: "store_product", itemId: STORE_PRODUCT, newPriceCents: 1 }, h.db)).alerted).toBe(0);
    expect((await detectWishlistPriceDrop({ itemKind: "store_product", itemId: STORE_PRODUCT, newPriceCents: -5 }, h.db)).alerted).toBe(0);
    expect((await detectWishlistPriceDrop({ itemKind: "shop_product", itemId: randomUUID(), newPriceCents: 100 }, h.db)).alerted).toBe(0);
  });
});
