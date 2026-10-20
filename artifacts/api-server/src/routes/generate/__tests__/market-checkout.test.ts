/**
 * Marketplace real card checkout (0144) — POST /api/storefronts/checkout
 * no longer records a sale at click time. These tests drive the REAL
 * shops router over pg-mem with Stripe faked at the house's existing
 * mock seam (lib/stripe-checkout — the same boundary memberships and
 * beats fake), and pin:
 *  - the order is recorded PENDING first (event_type='pending_sale'),
 *    priced from the server's own product rows (client amounts ignored);
 *  - one hosted session covers the whole cart, test-mode seam only;
 *  - verify flips pending -> sale ONLY for a paid session whose total
 *    matches the order, and the flip is idempotent across verify
 *    replays and a direct markMarketSalePaid (the webhook's call);
 *  - session-creation failure is an honest error with no order left;
 *  - a free cart completes as paid with no_payment_required, no session;
 *  - the status endpoint never reads a pending order as paid.
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
  getOpenAI: vi.fn(() => { throw new Error("no ai in market checkout tests"); }),
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
import { markMarketSalePaid } from "../../../lib/market-sale";
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
  image_url text, image_path text, status text NOT NULL DEFAULT 'active', pinned_ugc_ad_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, buyer_email text,
  settled_payout_id uuid, settled_at timestamptz, ip_hash text,
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
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[market-checkout] unhandled route error:", err?.message ?? err);
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
  h.db = db;
  h.userId = USER;
  h.userPlan = "pro";
  h.createCalls = [];
  h.sessions = new Map();
  h.seq = 0;
  h.failCreate = false;
  h.stripeConfigured = true;
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function seedShop() {
  const shopId = randomUUID(); const p1 = randomUUID(); const p2 = randomUUID();
  const handle = "market-" + shopId.slice(0, 8);
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${USER}, 'Market Shop', ${handle})`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${p1}, ${shopId}, ${USER}, 'Hoodie', 2000)`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${p2}, ${shopId}, ${USER}, 'Cap', 500)`);
  return { shopId, handle, p1, p2 };
}

async function eventsFor(shopId: string) {
  const r = await h.db.execute(sql`SELECT event_type, payment_status, amount_cents, platform_fee_cents, quantity, stripe_session_id, paid_at FROM shop_events WHERE shop_id = ${shopId} ORDER BY amount_cents DESC`);
  return r.rows as Array<Record<string, any>>;
}

describe("POST /storefronts/checkout — pending first, real session", () => {
  it("prices the cart from server rows (client amounts ignored), records pending, opens one session", async () => {
    const { shopId, handle, p1, p2 } = await seedShop();
    const { status, json } = await req("POST", "/storefronts/checkout", {
      shopId,
      items: [{ productId: p1, quantity: 2 }, { productId: p2, quantity: 1 }],
      buyerEmail: "fan@example.com",
      amount_cents: 1, // a lying client amount — must never be read
      gross_cents: 1,
    });
    expect(status).toBe(201);
    expect(json.paid).toBe(false);
    expect(json.status).toBe("pending_payment");
    expect(json.gross_cents).toBe(4500);
    expect(json.platform_fee_cents).toBe(225);
    expect(json.seller_net_cents).toBe(4275);
    expect(json.url).toBe(`https://checkout.example.com/pay/${json.sessionId}`);
    expect(json.checkoutUrl).toBe(json.url);
    expect(json.testMode).toBe(true);

    // One session, line items at the SERVER's prices and quantities.
    expect(h.createCalls).toHaveLength(1);
    const { params, opts } = h.createCalls[0]!;
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([
      expect.objectContaining({ quantity: 2, price_data: expect.objectContaining({ unit_amount: 2000, currency: "usd" }) }),
      expect.objectContaining({ quantity: 1, price_data: expect.objectContaining({ unit_amount: 500, currency: "usd" }) }),
    ]);
    expect(params.metadata).toMatchObject({ type: "marketplace_shop_purchase", shop_id: shopId });
    expect(params.success_url).toBe(`https://example.com/shop/${handle}?checkout=paid&session_id={CHECKOUT_SESSION_ID}`);
    expect(params.cancel_url).toBe(`https://example.com/shop/${handle}?checkout=cancelled`);
    expect(opts.idempotencyKey).toMatch(/^market-sale:/);

    // Pending rows exist; NO sale exists yet (earnings/analytics truth).
    const rows = await eventsFor(shopId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.event_type === "pending_sale" && r.payment_status === "pending")).toBe(true);
    expect(rows.every((r) => r.stripe_session_id === json.sessionId)).toBe(true);
    expect(rows[0]).toMatchObject({ amount_cents: 4000, platform_fee_cents: 200, quantity: 2 });
  });

  it("keeps the legacy single-line shape working", async () => {
    const { shopId, p1 } = await seedShop();
    const { status, json } = await req("POST", "/storefronts/checkout", { shopId, productId: p1, quantity: 1 });
    expect(status).toBe(201);
    expect(json.status).toBe("pending_payment");
    expect(json.gross_cents).toBe(2000);
  });

  it("404s an unknown product and 400s an empty order", async () => {
    const { shopId } = await seedShop();
    expect((await req("POST", "/storefronts/checkout", { shopId, items: [{ productId: randomUUID(), quantity: 1 }] })).status).toBe(404);
    expect((await req("POST", "/storefronts/checkout", { shopId })).status).toBe(400);
    expect(await eventsFor(shopId)).toHaveLength(0);
  });

  it("session-creation failure: honest 502 and no order left behind", async () => {
    const { shopId, p1 } = await seedShop();
    h.failCreate = true;
    const { status, json } = await req("POST", "/storefronts/checkout", { shopId, productId: p1, quantity: 1 });
    expect(status).toBe(502);
    expect(json.error).toMatch(/nothing was charged/i);
    expect(await eventsFor(shopId)).toHaveLength(0);
  });

  it("payments not configured: honest 503 before any row is written", async () => {
    const { shopId, p1 } = await seedShop();
    h.stripeConfigured = false;
    const { status } = await req("POST", "/storefronts/checkout", { shopId, productId: p1, quantity: 1 });
    expect(status).toBe(503);
    expect(await eventsFor(shopId)).toHaveLength(0);
  });

  it("a paused product can never sell: 404, no rows, no session — paid and free alike", async () => {
    const { shopId } = await seedShop();
    const pausedId = randomUUID();
    await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, status) VALUES (${pausedId}, ${shopId}, ${USER}, 'Paused Hoodie', 2000, 'paused')`);
    const { status, json } = await req("POST", "/storefronts/checkout", { shopId, productId: pausedId, quantity: 1 });
    expect(status).toBe(404);
    expect(json.error).toBe("Product not found.");
    expect(await eventsFor(shopId)).toHaveLength(0);
    expect(h.createCalls).toHaveLength(0);

    /* Free paused goods refuse on the same path — the free branch
       (which records a sale with no payment) is never reached. */
    const pausedFreeId = randomUUID();
    await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, status) VALUES (${pausedFreeId}, ${shopId}, ${USER}, 'Paused Freebie', 0, 'paused')`);
    const freeAttempt = await req("POST", "/storefronts/checkout", { shopId, productId: pausedFreeId, quantity: 1 });
    expect(freeAttempt.status).toBe(404);
    expect(await eventsFor(shopId)).toHaveLength(0);
  });

  it("a mixed cart (one live + one paused) refuses whole: no partial order is written", async () => {
    const { shopId, p1 } = await seedShop();
    const pausedId = randomUUID();
    await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, status) VALUES (${pausedId}, ${shopId}, ${USER}, 'Paused Cap', 500, 'paused')`);
    const { status } = await req("POST", "/storefronts/checkout", {
      shopId,
      items: [{ productId: p1, quantity: 1 }, { productId: pausedId, quantity: 1 }],
    });
    expect(status).toBe(404);
    expect(await eventsFor(shopId)).toHaveLength(0);
    expect(h.createCalls).toHaveLength(0);
  });

  it("a free cart completes as paid with no session and no charge", async () => {
    const shopId = randomUUID(); const freeId = randomUUID();
    await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${USER}, 'Free Shop', ${"free-" + shopId.slice(0, 8)})`);
    await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${freeId}, ${shopId}, ${USER}, 'Freebie', 0)`);
    const { status, json } = await req("POST", "/storefronts/checkout", { shopId, productId: freeId, quantity: 1 });
    expect(status).toBe(201);
    expect(json).toMatchObject({ free: true, paid: true, status: "paid", paymentStatus: "no_payment_required" });
    expect(h.createCalls).toHaveLength(0);
    const rows = await eventsFor(shopId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: "sale", payment_status: "no_payment_required" });
  });
});

describe("verify + status — the paid flip, exactly once", () => {
  async function startCheckout() {
    const seed = await seedShop();
    const { json } = await req("POST", "/storefronts/checkout", {
      shopId: seed.shopId, items: [{ productId: seed.p1, quantity: 2 }, { productId: seed.p2, quantity: 1 }],
    });
    return { ...seed, sessionId: json.sessionId as string };
  }

  it("an unpaid session stays pending everywhere — never displayed as paid", async () => {
    const { shopId, sessionId } = await startCheckout();
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(v.status).toBe(200);
    expect(v.json.paid).toBe(false);
    expect(v.json.status).toBe("pending_payment");
    const s = await req("GET", `/storefronts/checkout/status?sessionId=${sessionId}`);
    expect(s.json.paid).toBe(false);
    expect(s.json.status).toBe("pending_payment");
    expect((await eventsFor(shopId)).every((r) => r.event_type === "pending_sale")).toBe(true);
  });

  it("a paid session flips pending -> sale; replays and the webhook's flip never double-fulfil", async () => {
    const { shopId, sessionId } = await startCheckout();
    h.sessions.get(sessionId).payment_status = "paid";

    const v1 = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(v1.json).toMatchObject({ paid: true, status: "paid", duplicate: false, gross_cents: 4500, platform_fee_cents: 225, seller_net_cents: 4275 });
    expect(v1.json.lines.map((l: any) => l.productName)).toEqual(["Hoodie", "Cap"]);

    const rows = await eventsFor(shopId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.event_type === "sale" && r.payment_status === "paid" && r.paid_at)).toBe(true);

    // Replay: verify again, and run the webhook door's flip directly.
    const v2 = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(v2.json).toMatchObject({ paid: true, duplicate: true });
    const again = await markMarketSalePaid(sessionId);
    expect(again.flipped).toBe(0);
    expect(await eventsFor(shopId)).toHaveLength(2);

    const s = await req("GET", `/storefronts/checkout/status?sessionId=${sessionId}`);
    expect(s.json).toMatchObject({ paid: true, status: "paid", gross_cents: 4500 });
  });

  it("a paid session whose total does not match the order never fulfils", async () => {
    const { shopId, sessionId } = await startCheckout();
    const s = h.sessions.get(sessionId);
    s.payment_status = "paid";
    s.amount_total = 1;
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(v.status).toBe(400);
    expect((await eventsFor(shopId)).every((r) => r.event_type === "pending_sale")).toBe(true);
  });

  it("verify/status 404 for an unknown session", async () => {
    expect((await req("POST", "/storefronts/checkout/verify", { sessionId: "cs_test_nope" })).status).toBe(404);
    expect((await req("GET", "/storefronts/checkout/status?sessionId=cs_test_nope")).status).toBe(404);
  });
});
