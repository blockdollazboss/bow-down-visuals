/**
 * In-person selling (POS mode) — Stack-100 #3, item #28.
 *
 * POST /api/shops/:id/pos/checkout — the seller builds a cart from their
 * OWN shop's live products and gets ONE hosted Stripe Checkout URL back
 * (rendered by My Shop as a QR code + payment link; the customer pays
 * on their own phone). POST /api/shops/:id/pos/cash-sale — the seller
 * records a cash sale into the Money Tracker.
 *
 * These tests drive the REAL shops router over pg-mem with Stripe
 * faked at the same seam as market-checkout.test.ts, and pin:
 *  - POS checkout is owner-only: another user's shop 404s, and a cart
 *    can only contain the seller's own shop's products;
 *  - amounts are priced from the server's product rows (client amounts
 *    ignored) with the SAME flat-5% fee math as the online rail, and
 *    the order lands in the SAME shop_events records — pending first,
 *    flipped to a sale only by the existing verify path once paid;
 *  - the in-person channel is marked (pos_ group id + session metadata
 *    channel='in_person_qr'), never disguised as an online sale;
 *  - session failure leaves no order behind; a paused product refuses;
 *  - cash sales land in money_entries as income / merch_sales /
 *    source='in_person_cash' at full gross with NO fee, create NO
 *    shop_events rows, and refuse $0 products;
 *  - nothing anywhere claims card-reader / tap-to-pay support.
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
  getOpenAI: vi.fn(() => { throw new Error("no ai in pos tests"); }),
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
, affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer, image_alt_text text);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, buyer_email text,
  settled_payout_id uuid, settled_at timestamptz, ip_hash text,
  stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text, discount_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE money_entries (
  id uuid PRIMARY KEY, user_id uuid NOT NULL,
  entry_type text NOT NULL, category text NOT NULL DEFAULT 'other',
  amount_cents integer NOT NULL, note text NOT NULL DEFAULT '',
  source text, entry_date date NOT NULL, release_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const SELLER = randomUUID();
const STRANGER = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[pos] unhandled route error:", err?.message ?? err);
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
  h.userId = SELLER;
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

async function seedShop(owner: string = SELLER) {
  const shopId = randomUUID(); const p1 = randomUUID(); const p2 = randomUUID();
  const handle = "pos-" + shopId.slice(0, 8);
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${owner}, 'POS Shop', ${handle})`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${p1}, ${shopId}, ${owner}, 'Hoodie', 2000)`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${p2}, ${shopId}, ${owner}, 'Cap', 500)`);
  return { shopId, handle, p1, p2 };
}

async function eventsFor(shopId: string) {
  const r = await h.db.execute(sql`SELECT event_type, payment_status, amount_cents, platform_fee_cents, quantity, stripe_session_id, checkout_group_id, paid_at FROM shop_events WHERE shop_id = ${shopId} ORDER BY amount_cents DESC`);
  return r.rows as Array<Record<string, any>>;
}

async function moneyFor(userId: string) {
  const r = await h.db.execute(sql`SELECT entry_type, category, amount_cents, note, source FROM money_entries WHERE user_id = ${userId} ORDER BY amount_cents DESC`);
  return r.rows as Array<Record<string, any>>;
}

describe("POST /shops/:id/pos/checkout — QR / payment-link sale", () => {
  it("prices from server rows, records pending in shop_events, marks the in-person channel, returns the payment link", async () => {
    const { shopId, p1, p2 } = await seedShop();
    const { status, json } = await req("POST", `/shops/${shopId}/pos/checkout`, {
      items: [{ productId: p1, quantity: 2 }, { productId: p2, quantity: 1 }],
      gross_cents: 1, // lying client amount — never read
    });
    expect(status).toBe(201);
    expect(json.paid).toBe(false);
    expect(json.status).toBe("pending_payment");
    expect(json.channel).toBe("in_person_qr");
    /* Same flat-5% math as the online rail: 4500 gross → 225 fee. */
    expect(json.gross_cents).toBe(4500);
    expect(json.platform_fee_cents).toBe(225);
    expect(json.platform_fee_pct).toBe(5);
    expect(json.seller_net_cents).toBe(4275);
    /* The payment link IS the hosted session URL (QR target). */
    expect(json.paymentLink).toBe(`https://checkout.example.com/pay/${json.sessionId}`);
    expect(json.url).toBe(json.paymentLink);
    expect(json.groupId).toMatch(/^pos_/);

    expect(h.createCalls).toHaveLength(1);
    const { params, opts } = h.createCalls[0]!;
    expect(params.metadata).toMatchObject({
      type: "marketplace_shop_purchase",
      shop_id: shopId,
      channel: "in_person_qr",
    });
    expect(opts.idempotencyKey).toBe(`market-sale:${json.groupId}`);

    const rows = await eventsFor(shopId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.event_type === "pending_sale" && r.payment_status === "pending")).toBe(true);
    expect(rows.every((r) => r.checkout_group_id === json.groupId)).toBe(true);
    expect(rows.every((r) => r.stripe_session_id === json.sessionId)).toBe(true);
    expect(rows[0]).toMatchObject({ amount_cents: 4000, platform_fee_cents: 200, quantity: 2 });
  });

  it("becomes a sale through the EXISTING verify flip once the session is paid — exactly once", async () => {
    const { shopId, p1 } = await seedShop();
    const start = await req("POST", `/shops/${shopId}/pos/checkout`, { items: [{ productId: p1, quantity: 1 }] });
    const sessionId = start.json.sessionId as string;

    /* Unpaid: verify leaves it pending. */
    const early = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(early.json.paid).toBe(false);
    expect((await eventsFor(shopId))[0]!.event_type).toBe("pending_sale");

    h.sessions.get(sessionId).payment_status = "paid";
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(v.json.paid).toBe(true);
    const rows = await eventsFor(shopId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: "sale", payment_status: "paid", amount_cents: 2000, platform_fee_cents: 100 });

    /* Replay: still one sale row, reported as a duplicate. */
    const again = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(again.json.duplicate).toBe(true);
    expect(await eventsFor(shopId)).toHaveLength(1);
  });

  it("is owner-only: another seller's shop 404s for both POS doors and writes nothing", async () => {
    const { shopId, p1 } = await seedShop(STRANGER);
    const co = await req("POST", `/shops/${shopId}/pos/checkout`, { items: [{ productId: p1, quantity: 1 }] });
    expect(co.status).toBe(404);
    const cash = await req("POST", `/shops/${shopId}/pos/cash-sale`, { items: [{ productId: p1, quantity: 1 }] });
    expect(cash.status).toBe(404);
    expect(h.createCalls).toHaveLength(0);
    expect(await eventsFor(shopId)).toHaveLength(0);
    expect(await moneyFor(SELLER)).toHaveLength(0);
  });

  it("a product from a DIFFERENT shop can never enter the cart (404, nothing written)", async () => {
    const mine = await seedShop();
    const theirs = await seedShop(STRANGER);
    const { status } = await req("POST", `/shops/${mine.shopId}/pos/checkout`, {
      items: [{ productId: theirs.p1, quantity: 1 }],
    });
    expect(status).toBe(404);
    expect(await eventsFor(mine.shopId)).toHaveLength(0);
    expect(h.createCalls).toHaveLength(0);
  });

  it("a paused product refuses at the till, exactly like online checkout", async () => {
    const { shopId } = await seedShop();
    const pausedId = randomUUID();
    await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, status) VALUES (${pausedId}, ${shopId}, ${SELLER}, 'Paused Hoodie', 2000, 'paused')`);
    const { status } = await req("POST", `/shops/${shopId}/pos/checkout`, { items: [{ productId: pausedId, quantity: 1 }] });
    expect(status).toBe(404);
    expect(await eventsFor(shopId)).toHaveLength(0);
    const cash = await req("POST", `/shops/${shopId}/pos/cash-sale`, { items: [{ productId: pausedId, quantity: 1 }] });
    expect(cash.status).toBe(404);
    expect(await moneyFor(SELLER)).toHaveLength(0);
  });

  it("session-creation failure: honest 502, no order left behind", async () => {
    const { shopId, p1 } = await seedShop();
    h.failCreate = true;
    const { status, json } = await req("POST", `/shops/${shopId}/pos/checkout`, { items: [{ productId: p1, quantity: 1 }] });
    expect(status).toBe(502);
    expect(json.error).toMatch(/nothing was charged/i);
    expect(await eventsFor(shopId)).toHaveLength(0);
  });

  it("payments not configured: honest 503 before any row is written", async () => {
    const { shopId, p1 } = await seedShop();
    h.stripeConfigured = false;
    const { status } = await req("POST", `/shops/${shopId}/pos/checkout`, { items: [{ productId: p1, quantity: 1 }] });
    expect(status).toBe(503);
    expect(await eventsFor(shopId)).toHaveLength(0);
  });

  it("a free cart records as paid with no_payment_required and no session", async () => {
    const { shopId } = await seedShop();
    const freeId = randomUUID();
    await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${freeId}, ${shopId}, ${SELLER}, 'Freebie', 0)`);
    const { status, json } = await req("POST", `/shops/${shopId}/pos/checkout`, { items: [{ productId: freeId, quantity: 1 }] });
    expect(status).toBe(201);
    expect(json).toMatchObject({ free: true, paid: true, paymentStatus: "no_payment_required", channel: "in_person_qr" });
    expect(h.createCalls).toHaveLength(0);
    const rows = await eventsFor(shopId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: "sale", payment_status: "no_payment_required" });
    expect(String(rows[0]!.checkout_group_id)).toMatch(/^pos_/);
  });

  it("400s an empty cart", async () => {
    const { shopId } = await seedShop();
    expect((await req("POST", `/shops/${shopId}/pos/checkout`, { items: [] })).status).toBe(400);
    expect((await req("POST", `/shops/${shopId}/pos/cash-sale`, { items: [] })).status).toBe(400);
  });
});

describe("POST /shops/:id/pos/cash-sale — in-person cash recorder", () => {
  it("lands in the Money Tracker as in-person cash at full gross, no fee, no shop_events rows, no Stripe session", async () => {
    const { shopId, p1, p2 } = await seedShop();
    const { status, json } = await req("POST", `/shops/${shopId}/pos/cash-sale`, {
      items: [{ productId: p1, quantity: 2 }, { productId: p2, quantity: 1 }],
    });
    expect(status).toBe(201);
    expect(json.recorded).toBe(true);
    expect(json.channel).toBe("in_person_cash");
    expect(json.gross_cents).toBe(4500);
    expect(json.platform_fee_cents).toBe(0);
    expect(json.seller_net_cents).toBe(4500);
    expect(json.entries).toHaveLength(2);

    const entries = await moneyFor(SELLER);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.entry_type === "income")).toBe(true);
    expect(entries.every((e) => e.category === "merch_sales")).toBe(true);
    expect(entries.every((e) => e.source === "in_person_cash")).toBe(true);
    expect(entries[0]).toMatchObject({ amount_cents: 4000 });
    expect(String(entries[0]!.note)).toMatch(/in-person cash sale/i);
    expect(String(entries[0]!.note)).toMatch(/Hoodie/);

    /* Cash is NOT a platform sale: no shop_events rows, no session. */
    expect(await eventsFor(shopId)).toHaveLength(0);
    expect(h.createCalls).toHaveLength(0);
  });

  it("refuses a $0 product — a giveaway is not a cash sale", async () => {
    const { shopId } = await seedShop();
    const freeId = randomUUID();
    await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${freeId}, ${shopId}, ${SELLER}, 'Freebie', 0)`);
    const { status, json } = await req("POST", `/shops/${shopId}/pos/cash-sale`, { items: [{ productId: freeId, quantity: 1 }] });
    expect(status).toBe(400);
    expect(json.error).toMatch(/free products/i);
    expect(await moneyFor(SELLER)).toHaveLength(0);
  });

  it("merges duplicate lines and caps quantity like the checkout rail", async () => {
    const { shopId, p2 } = await seedShop();
    const { status, json } = await req("POST", `/shops/${shopId}/pos/cash-sale`, {
      items: [{ productId: p2, quantity: 1 }, { productId: p2, quantity: 2 }],
    });
    expect(status).toBe(201);
    expect(json.gross_cents).toBe(1500);
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].quantity).toBe(3);
  });
});
