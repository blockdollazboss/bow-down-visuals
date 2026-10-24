/**
 * Shop discount codes (migration 0190) — marketplace shops reach parity
 * with the profile storefront's discount_codes. These tests drive the
 * REAL shops router over pg-mem with Stripe faked at the house seam
 * (lib/stripe-checkout, same as market-checkout.test.ts) and pin:
 *  - owner-only code management (another owner's shop 404s on every verb);
 *  - validate answers without spending a use;
 *  - checkout math = the STOREFRONT's exact sequence: percent off the
 *    unit price (rounded), line gross from the discounted unit, then
 *    the ruled 5% fee (500 bps) out of the discounted gross;
 *  - a code is scoped to its shop — the same name at another shop
 *    never applies, and a code that only exists elsewhere is BAD_CODE;
 *  - a use is counted exactly once, when the sale is RECORDED: at the
 *    paid flip (verify / markMarketSalePaid replays do not re-count),
 *    and immediately for a free cart whose sale records at checkout;
 *  - max_uses is enforced at checkout once the counted uses land.
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
  getOpenAI: vi.fn(() => { throw new Error("no ai in shop discount tests"); }),
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
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer
, image_alt_text text);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, buyer_email text,
  settled_payout_id uuid, settled_at timestamptz, ip_hash text,
  stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text, discount_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  affiliate_code text
);
CREATE TABLE shop_discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, code text NOT NULL,
  percent_off integer NOT NULL, max_uses integer NOT NULL DEFAULT -1,
  used_count integer NOT NULL DEFAULT 0, expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shop_discount_codes_shop_code_ux ON shop_discount_codes (shop_id, code);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const OWNER = randomUUID();
const OTHER = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[shop-discounts] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  const { db, mem } = createTestDb();
  /* pg-mem ships almost no native functions; the real schema defaults
     ids with gen_random_uuid() (migration 0190's table included). */
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  h.userId = OWNER;
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

async function seedShop(owner: string = OWNER) {
  const shopId = randomUUID(); const p1 = randomUUID(); const p2 = randomUUID(); const pFree = randomUUID();
  const handle = "disc-" + shopId.slice(0, 8);
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${owner}, 'Discount Shop', ${handle})`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${p1}, ${shopId}, ${owner}, 'Hoodie', 2000)`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${p2}, ${shopId}, ${owner}, 'Cap', 500)`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${pFree}, ${shopId}, ${owner}, 'Sticker Pack', 0)`);
  return { shopId, handle, p1, p2, pFree };
}

async function createCode(shopId: string, body: Record<string, unknown>) {
  return req("POST", `/shops/${shopId}/discounts`, body);
}

async function usedCount(shopId: string, code: string) {
  const r = await h.db.execute(sql`SELECT used_count FROM shop_discount_codes WHERE shop_id = ${shopId} AND code = ${code}`);
  return Number((r.rows[0] as any)?.used_count ?? -1);
}

async function eventsFor(shopId: string) {
  const r = await h.db.execute(sql`SELECT event_type, payment_status, amount_cents, platform_fee_cents, quantity, discount_code FROM shop_events WHERE shop_id = ${shopId} ORDER BY amount_cents DESC`);
  return r.rows as Array<Record<string, any>>;
}

describe("shop discount codes — owner management", () => {
  it("creates, lists, patches and deletes a code; duplicate name 409s; bad percent 400s", async () => {
    const { shopId } = await seedShop();
    const created = await createCode(shopId, { code: "save25", percentOff: 25 });
    expect(created.status).toBe(201);
    expect(created.json.code).toMatchObject({ code: "SAVE25", percentOff: 25, maxUses: -1, usedCount: 0, isActive: true });

    const dup = await createCode(shopId, { code: "SAVE25", percentOff: 10 });
    expect(dup.status).toBe(409);

    const bad = await createCode(shopId, { code: "TOOMUCH", percentOff: 95 });
    expect(bad.status).toBe(400);

    const list = await req("GET", `/shops/${shopId}/discounts`);
    expect(list.status).toBe(200);
    expect(list.json.codes).toHaveLength(1);

    const codeId = created.json.code.id;
    const patched = await req("PATCH", `/shops/${shopId}/discounts/${codeId}`, { isActive: false });
    expect(patched.status).toBe(200);
    const after = await req("GET", `/shops/${shopId}/discounts`);
    expect(after.json.codes[0].isActive).toBe(false);

    const removed = await req("DELETE", `/shops/${shopId}/discounts/${codeId}`);
    expect(removed.status).toBe(200);
    const empty = await req("GET", `/shops/${shopId}/discounts`);
    expect(empty.json.codes).toHaveLength(0);
  });

  it("another owner's shop 404s on every management verb", async () => {
    const { shopId } = await seedShop();
    const created = await createCode(shopId, { code: "MINE10", percentOff: 10 });
    const codeId = created.json.code.id;

    h.userId = OTHER;
    expect((await req("GET", `/shops/${shopId}/discounts`)).status).toBe(404);
    expect((await createCode(shopId, { code: "SNEAKY", percentOff: 50 })).status).toBe(404);
    expect((await req("PATCH", `/shops/${shopId}/discounts/${codeId}`, { isActive: false })).status).toBe(404);
    expect((await req("DELETE", `/shops/${shopId}/discounts/${codeId}`)).status).toBe(404);

    h.userId = OWNER;
    const list = await req("GET", `/shops/${shopId}/discounts`);
    expect(list.json.codes).toHaveLength(1);
    expect(list.json.codes[0].isActive).toBe(true);
  });
});

describe("shop discount codes — validate + checkout math", () => {
  it("validate answers for THIS shop only and never spends a use", async () => {
    const { shopId } = await seedShop();
    const other = await seedShop(OTHER);
    await createCode(shopId, { code: "SAVE25", percentOff: 25 });
    h.userId = OTHER;
    await createCode(other.shopId, { code: "OTHER50", percentOff: 50 });
    h.userId = OWNER;

    const ok = await req("GET", `/shops/${shopId}/discounts/validate?code=save25`);
    expect(ok.json).toMatchObject({ valid: true, code: "SAVE25", percentOff: 25 });

    const foreign = await req("GET", `/shops/${shopId}/discounts/validate?code=OTHER50`);
    expect(foreign.json.valid).toBe(false);

    expect(await usedCount(shopId, "SAVE25")).toBe(0);
  });

  it("checkout applies the storefront's exact math: unit discount first, 5% fee on the discounted gross", async () => {
    const { shopId, p1 } = await seedShop();
    await createCode(shopId, { code: "SAVE25", percentOff: 25 });

    /* Storefront sequence for a 2000¢ unit at 25% off, qty 2:
       unit = round(2000 * 75 / 100) = 1500; gross = 1500 * 2 = 3000;
       fee = round(3000 * 500 / 10000) = 150; net = 2850. */
    const { status, json } = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: p1, quantity: 2 }], discountCode: "save25",
    });
    expect(status).toBe(201);
    expect(json.gross_cents).toBe(3000);
    expect(json.list_gross_cents).toBe(4000);
    expect(json.platform_fee_cents).toBe(150);
    expect(json.seller_net_cents).toBe(2850);
    expect(json.discount_code).toBe("SAVE25");
    expect(json.percent_off).toBe(25);
    expect(json.lines[0]).toMatchObject({ unit_cents: 1500, list_unit_cents: 2000, gross_cents: 3000, platform_fee_cents: 150 });

    /* The hosted session charges the discounted unit. */
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0].params.line_items[0].price_data.unit_amount).toBe(1500);
    expect(h.createCalls[0].params.metadata.discount_code).toBe("SAVE25");

    /* Pending rows carry the discounted amounts + the code — and the
       use is NOT counted yet (counting happens when the sale records). */
    const rows = await eventsFor(shopId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: "pending_sale", amount_cents: 3000, platform_fee_cents: 150, discount_code: "SAVE25" });
    expect(await usedCount(shopId, "SAVE25")).toBe(0);
  });

  it("a code that exists only at another shop is BAD_CODE and writes no rows", async () => {
    const { shopId, p1 } = await seedShop();
    const other = await seedShop(OTHER);
    h.userId = OTHER;
    await createCode(other.shopId, { code: "THEIRS", percentOff: 50 });
    h.userId = OWNER;

    const { status, json } = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: p1, quantity: 1 }], discountCode: "THEIRS",
    });
    expect(status).toBe(400);
    expect(json.error).toBe("BAD_CODE");
    expect(await eventsFor(shopId)).toHaveLength(0);
    expect(h.createCalls).toHaveLength(0);
  });

  it("an inactive code is refused at checkout", async () => {
    const { shopId, p1 } = await seedShop();
    const created = await createCode(shopId, { code: "OFF10", percentOff: 10 });
    await req("PATCH", `/shops/${shopId}/discounts/${created.json.code.id}`, { isActive: false });
    const { status, json } = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: p1, quantity: 1 }], discountCode: "OFF10",
    });
    expect(status).toBe(400);
    expect(json.error).toBe("BAD_CODE");
  });
});

describe("shop discount codes — redemption counting", () => {
  it("counts exactly one use at the paid flip — one checkout, however many lines; verify + webhook replays never re-count", async () => {
    const { shopId, p1, p2 } = await seedShop();
    await createCode(shopId, { code: "SAVE25", percentOff: 25 });

    /* Two lines, both carrying the code on their rows — the flip must
       still count ONE use for the one checkout. */
    const co = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: p1, quantity: 1 }, { productId: p2, quantity: 1 }], discountCode: "SAVE25",
    });
    expect(co.status).toBe(201);
    const sessionId = co.json.sessionId;
    const pending = await eventsFor(shopId);
    expect(pending).toHaveLength(2);
    expect(pending.every((r) => r.discount_code === "SAVE25")).toBe(true);
    expect(await usedCount(shopId, "SAVE25")).toBe(0);

    h.sessions.get(sessionId).payment_status = "paid";
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(v.json.paid).toBe(true);
    expect(await usedCount(shopId, "SAVE25")).toBe(1);

    const replay = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(replay.json.duplicate).toBe(true);
    const direct = await markMarketSalePaid(sessionId);
    expect(direct.flipped).toBe(0);
    expect(await usedCount(shopId, "SAVE25")).toBe(1);
  });

  it("a free cart records its sale at checkout — and counts the presented code there", async () => {
    const { shopId, pFree } = await seedShop();
    await createCode(shopId, { code: "FREEBIE", percentOff: 10 });

    const { status, json } = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: pFree, quantity: 1 }], discountCode: "FREEBIE",
    });
    expect(status).toBe(201);
    expect(json.free).toBe(true);
    const rows = await eventsFor(shopId);
    expect(rows[0]).toMatchObject({ event_type: "sale", payment_status: "no_payment_required", discount_code: "FREEBIE" });
    expect(await usedCount(shopId, "FREEBIE")).toBe(1);
  });

  it("max_uses is enforced once the counted use lands", async () => {
    const { shopId, pFree, p1 } = await seedShop();
    await createCode(shopId, { code: "ONCE", percentOff: 10, maxUses: 1 });

    const first = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: pFree, quantity: 1 }], discountCode: "ONCE",
    });
    expect(first.status).toBe(201);
    expect(await usedCount(shopId, "ONCE")).toBe(1);

    const second = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: p1, quantity: 1 }], discountCode: "ONCE",
    });
    expect(second.status).toBe(400);
    expect(second.json.error).toBe("BAD_CODE");
  });

  it("a checkout without a code is untouched: full price, 5% fee, no code on the rows", async () => {
    const { shopId, p1 } = await seedShop();
    await createCode(shopId, { code: "UNUSED", percentOff: 90 });
    const { status, json } = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: p1, quantity: 1 }],
    });
    expect(status).toBe(201);
    expect(json.gross_cents).toBe(2000);
    expect(json.platform_fee_cents).toBe(100);
    expect(json.discount_code).toBeNull();
    const rows = await eventsFor(shopId);
    expect(rows[0].discount_code).toBeNull();
    expect(await usedCount(shopId, "UNUSED")).toBe(0);
  });
});
