/**
 * Stack 8 Item 2 — characterization for the shops + storefronts surfaces
 * (both operate on shops / shop_products / shop_events) as they behave
 * TODAY, mounted the way production mounts them (both routers, one app).
 * Must pass UNCHANGED after storefronts.ts merges into shops.ts (the
 * storefronts module becomes a re-export shim, so both imports resolve
 * to the one canonical shop router).
 *
 * The third surface named in the census, routes/storefront.ts
 * (/storefront/*, store_products/store_orders — the per-profile catalog),
 * is a DIFFERENT data model and is characterized separately by its own
 * suite; it is not part of this merge (see Stack 8 report).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({ db: null as any, userId: "", userPlan: "pro" }));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.userPlan = testState.userPlan;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getTextModel: vi.fn(() => "gpt-6-sol"),
  getOpenAI: vi.fn(() => { throw new Error("no ai in characterization"); }),
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

/* 0144: checkout now opens a real (test-mode) Stripe session — faked at
   the house seam, lib/stripe-checkout, exactly as memberships/beats do. */
const stripeH = vi.hoisted(() => ({ sessions: new Map<string, any>(), seq: 0 }));
vi.mock("../../../lib/stripe-checkout", () => ({
  getCheckoutStripe: vi.fn(() => ({
    checkout: { sessions: { create: vi.fn(async (params: any) => {
      stripeH.seq += 1;
      const id = `cs_test_${stripeH.seq}`;
      const session = { id, url: `https://checkout.example.com/pay/${id}`, payment_status: "unpaid",
        amount_total: (params.line_items as any[]).reduce((s: number, li: any) => s + li.price_data.unit_amount * li.quantity, 0),
        metadata: params.metadata };
      stripeH.sessions.set(id, session);
      return session;
    }) } },
  })),
  retrieveCheckoutSession: vi.fn(async (id: string) => {
    const s = stripeH.sessions.get(id);
    if (!s) throw new Error("no such session");
    return s;
  }),
  checkoutBaseUrl: vi.fn(() => "https://example.com"),
  isCheckoutTestMode: vi.fn(() => true),
}));

import shopsRouter from "../shops";
import storefrontsRouter from "../storefronts";
import { createTestDb } from "../../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
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
  image_url text, image_path text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, buyer_email text, ip_hash text,
  stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use("/api", storefrontsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[characterization] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  testState.db = db;
  testState.userId = USER;
  testState.userPlan = "pro";
  vi.clearAllMocks();
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function seedShopWithProduct(price = 2000) {
  const shopId = randomUUID(); const productId = randomUUID();
  await testState.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${USER}, 'Merge Shop', ${"merge-" + shopId.slice(0, 8)})`);
  await testState.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${productId}, ${shopId}, ${USER}, 'Widget', ${price})`);
  return { shopId, productId };
}

describe("storefronts surface over the shared shops tables", () => {
  it("GET /storefronts/slug/:slug serves shop + products, fee pct, no user_id leak", async () => {
    // NOTE: GET /storefronts (hub) and /:id/analytics use a correlated
    // COUNT subquery / DATE_TRUNC that pg-mem cannot execute — those two
    // reads are characterized by storefronts-profile-slug.test.ts-style
    // fake-db tests in the existing suite, not here.
    const { shopId } = await seedShopWithProduct();
    const mine = await req("GET", "/shops/mine");
    const handle = mine.json.shops[0].handle;
    const { status, json } = await req("GET", `/storefronts/slug/${handle}`);
    expect(status).toBe(200);
    expect(json.platformFeePct).toBe(10);
    expect(json.shop.id).toBe(shopId);
    expect(json.shop.user_id).toBeUndefined();
    expect(json.products).toHaveLength(1);
    const missing = await req("GET", "/storefronts/slug/no-such-shop");
    expect(missing.status).toBe(404);
  });

  it("POST /storefronts/checkout records a PENDING order at the 10% platform fee, and only a paid verify lands the sale (0144)", async () => {
    const { shopId, productId } = await seedShopWithProduct(2000);
    const { status, json } = await req("POST", "/storefronts/checkout", {
      shopId, productId, quantity: 2, buyerEmail: "fan@example.com",
    });
    expect(status).toBe(201);
    expect(json.gross_cents).toBe(4000);
    expect(json.platform_fee_cents).toBe(400);
    expect(json.seller_net_cents).toBe(3600);
    /* Updated 0144: at click time the order is pending — NOT a sale.
       (This characterization previously pinned the record-at-click
       behavior; the real card checkout supersedes it deliberately.) */
    expect(json.paid).toBe(false);
    expect(json.status).toBe("pending_payment");
    expect(json.url).toContain("https://checkout.example.com/pay/");
    const ev = await testState.db.execute(sql`SELECT amount_cents, platform_fee_cents, event_type FROM shop_events WHERE shop_id = ${shopId}`);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0]).toMatchObject({ amount_cents: 4000, platform_fee_cents: 400, event_type: "pending_sale" });
    // The paid session flips it into the sale the ledger reads.
    stripeH.sessions.get(json.sessionId).payment_status = "paid";
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: json.sessionId });
    expect(v.json.paid).toBe(true);
    const after = await testState.db.execute(sql`SELECT event_type, payment_status FROM shop_events WHERE shop_id = ${shopId}`);
    expect(after.rows[0]).toMatchObject({ event_type: "sale", payment_status: "paid" });
  });

  it("POST /storefronts/checkout 404s for an unknown product", async () => {
    const { shopId } = await seedShopWithProduct();
    const { status } = await req("POST", "/storefronts/checkout", {
      shopId, productId: randomUUID(), quantity: 1,
    });
    expect(status).toBe(404);
  });

  it("domain attach is Pro-gated: free plan 403, pro plan issues a TXT token", async () => {
    const { shopId } = await seedShopWithProduct();
    testState.userPlan = "creator";
    const denied = await req("POST", `/storefronts/${shopId}/domain`, { domain: "shop.example.com" });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toBe("PRO_TIER_REQUIRED");

    testState.userPlan = "pro";
    const ok = await req("POST", `/storefronts/${shopId}/domain`, { domain: "shop.example.com" });
    expect(ok.status).toBe(200);
    expect(ok.json.verified).toBe(false);
    expect(ok.json.verification.type).toBe("TXT");
    expect(ok.json.verification.host).toBe("bdv-verify.shop.example.com");
  });
});

describe("cross-surface: shops.ts reads what storefronts.ts writes (same tables)", () => {
  it("GET /shops/handle/:handle serves the shop + products; /shops/mine lists it", async () => {
    const { shopId } = await seedShopWithProduct();
    const mine = await req("GET", "/shops/mine");
    expect(mine.status).toBe(200);
    const handle = mine.json.shops[0].handle;
    expect(mine.json.shops[0].id).toBe(shopId);
    const pub = await req("GET", `/shops/handle/${handle}`);
    expect(pub.status).toBe(200);
    expect(pub.json.products).toHaveLength(1);
    expect(pub.json.products[0].name).toBe("Widget");
  });
});
