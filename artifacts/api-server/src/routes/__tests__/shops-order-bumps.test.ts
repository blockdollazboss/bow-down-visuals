/**
 * Order bumps (Stack-100 #3, feature #13) — the SHOPS CART rail
 * (routes/generate/shops.ts + lib/market-sale.ts). Drives the REAL
 * shops router over pg-mem with Stripe faked at the lib/stripe-checkout
 * seam and pins:
 *  - a seller attaches ONE add-on (own shop only, never itself, never
 *    a $0 product; a paused add-on may be attached but isn't offered);
 *    the public shop payload resolves the live offer at the seller-set
 *    price / % off;
 *  - cart checkout totals are server-computed: ticked bump rides the
 *    same session as its own line/row (marked bump_for_product_id),
 *    flat-5% per-line fee like every cart line; unticked → totals
 *    byte-identical to the pre-feature rail; a tick with no live offer
 *    (or for a product not in the cart) refuses the WHOLE checkout —
 *    no rows, no session, no charge;
 *  - the shop discount code discounts cart lines only, never the bump;
 *  - double-charge impossibility: the guarded pending→sale flip lands
 *    exactly once — duplicate verify is a pure no-op, the discount use
 *    is counted exactly once, and the receipt's lines[] flags the bump;
 *  - pre-migration (bump columns absent): no offers anywhere, legacy
 *    checkout/verify byte-identical, attach answers an honest 500.
 *
 * Hand-computed money (fee = round(line gross × 5%) per line):
 *  A 2000¢ ×2 = 4000 (fee 200) · B 1000¢ ×1 (fee 50) ·
 *  bump C 3000¢ at 10% off = 2700 (fee 135) ·
 *  ticked total 7700, fee 385, seller net 7315.
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
import { markMarketSalePaid } from "../../lib/market-sale";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const BUMP_DDL = (withBump: boolean) => `
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
  pinned_ugc_ad_id uuid${withBump ? ",\n  bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0" : ""},
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  buyer_email text, stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text, discount_code text${withBump ? ",\n  bump_for_product_id uuid" : ""},
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
const OTHER_SHOP_ID = randomUUID();
let withBumpColumns = true;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[shops-bumps] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function seedProduct(shopId: string, userId: string, name: string, price: number, status = "active"): Promise<string> {
  const id = randomUUID();
  await h.db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, status)
    VALUES (${id}, ${shopId}, ${userId}, ${name}, ${price}, ${status})
  `);
  return id;
}

let A: string; let B: string; let C: string; let FREE: string;

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(BUMP_DDL(withBumpColumns));
  h.db = db;
  h.userId = SELLER;
  h.stripeCreates = [];
  h.sessions = new Map();
  await h.db.execute(sql`
    INSERT INTO shops (id, user_id, name, handle) VALUES (${SHOP_ID}, ${SELLER}, 'Queen Shop', 'queen-shop')
  `);
  await h.db.execute(sql`
    INSERT INTO shops (id, user_id, name, handle) VALUES (${OTHER_SHOP_ID}, ${OTHER_SELLER}, 'Other Shop', 'other-shop')
  `);
  A = await seedProduct(SHOP_ID, SELLER, "Gold Hoodie", 2000);
  B = await seedProduct(SHOP_ID, SELLER, "Silver Cap", 1000);
  C = await seedProduct(SHOP_ID, SELLER, "Bonus Sticker Pack", 3000);
  FREE = await seedProduct(SHOP_ID, SELLER, "Free Sample", 0);
});

async function req(method: string, path: string, body?: unknown, as?: string) {
  if (as) h.userId = as;
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function attach(productId: string, bumpId: string | null, percentOff = 0, shopId = SHOP_ID, as = SELLER) {
  return req("PUT", `/shops/${shopId}/products/${productId}/bump`, { bumpProductId: bumpId, percentOff }, as);
}

async function checkout(body: Record<string, unknown>) {
  return req("POST", "/storefronts/checkout", { shopId: SHOP_ID, buyerEmail: "buyer@example.com", ...body });
}

async function eventRows(sessionId?: string) {
  const r = sessionId
    ? await h.db.execute(sql`SELECT * FROM shop_events WHERE stripe_session_id = ${sessionId}`)
    : await h.db.execute(sql`SELECT * FROM shop_events`);
  return r.rows as Array<Record<string, unknown>>;
}

describe("shops bumps — seller attach", () => {
  it("attaches, reports live, and detaches", async () => {
    const r = await attach(A, C, 10);
    expect(r.status).toBe(200);
    expect(r.json.bumpConfig).toEqual({ bumpProductId: C, percentOff: 10 });
    expect(r.json.offerLive).toBe(true);
    expect(r.json.bump.priceCents).toBe(2700);

    const off = await attach(A, null);
    expect(off.status).toBe(200);
    expect(off.json.bumpConfig).toBeNull();
    expect(off.json.offerLive).toBe(false);
  });

  it("refuses other-shop targets, self, and $0 products; non-owner 404s", async () => {
    const foreign = await seedProduct(OTHER_SHOP_ID, OTHER_SELLER, "Foreign", 5000);
    expect((await attach(A, foreign)).json.error).toBe("BUMP_NOT_YOURS");
    expect((await attach(A, A)).json.error).toBe("BUMP_SELF");
    expect((await attach(A, FREE)).json.error).toBe("BUMP_FREE");
    const notMine = await attach(A, C, 0, SHOP_ID, OTHER_SELLER);
    expect(notMine.status).toBe(404);
  });

  it("a paused add-on may be attached but is not offered", async () => {
    const paused = await seedProduct(SHOP_ID, SELLER, "Paused Extra", 1500, "paused");
    const r = await attach(A, paused, 0);
    expect(r.status).toBe(200);
    expect(r.json.offerLive).toBe(false);
    const pub = await req("GET", "/shops/handle/queen-shop");
    const pa = (pub.json.products as Array<any>).find((p) => p.id === A);
    expect(pa.bump).toBeNull();
  });
});

describe("shops bumps — buyer offer + checkout", () => {
  it("the public shop payload resolves the live offer at the seller-set % off", async () => {
    await attach(A, C, 10);
    const pub = await req("GET", "/shops/handle/queen-shop");
    expect(pub.status).toBe(200);
    const pa = (pub.json.products as Array<any>).find((p) => p.id === A);
    expect(pa.bump).toMatchObject({ productId: C, listPriceCents: 3000, percentOff: 10, priceCents: 2700 });
    const pb = (pub.json.products as Array<any>).find((p) => p.id === B);
    expect(pb.bump).toBeNull();
  });

  it("the slug storefront payload (the shop page's read) resolves the offer too", async () => {
    await attach(A, C, 10);
    const pub = await req("GET", "/storefronts/slug/queen-shop");
    expect(pub.status).toBe(200);
    const pa = (pub.json.products as Array<any>).find((p) => p.id === A);
    expect(pa.bump).toMatchObject({ productId: C, priceCents: 2700, percentOff: 10 });
    const pb = (pub.json.products as Array<any>).find((p) => p.id === B);
    expect(pb.bump).toBeNull();
  });

  it("ticked checkout: one session, bump as its own marked line, totals reconcile", async () => {
    await attach(A, C, 10);
    const r = await checkout({ items: [{ productId: A, quantity: 2 }, { productId: B, quantity: 1 }], includeBumps: [A] });
    expect(r.status).toBe(201);
    expect(r.json.gross_cents).toBe(7700);
    expect(r.json.platform_fee_cents).toBe(385);
    expect(r.json.seller_net_cents).toBe(7315);
    expect(h.stripeCreates).toHaveLength(1);
    const items = h.stripeCreates[0].params.line_items as Array<any>;
    expect(items).toHaveLength(3);
    expect(items[2].price_data.unit_amount).toBe(2700);
    expect(items[2].price_data.product_data.name).toContain("(add-on)");
    const bumpLine = (r.json.lines as Array<any>).find((l) => l.isBump);
    expect(bumpLine).toMatchObject({ productId: C, gross_cents: 2700, platform_fee_cents: 135, seller_net_cents: 2565, bumpForProductId: A });

    const rows = await eventRows(r.json.sessionId);
    expect(rows).toHaveLength(3);
    const bumpRow = rows.find((x) => x["bump_for_product_id"] === A);
    expect(bumpRow).toBeTruthy();
    expect(Number(bumpRow!["amount_cents"])).toBe(2700);
    expect(Number(bumpRow!["platform_fee_cents"])).toBe(135);
    expect(bumpRow!["discount_code"]).toBeNull();
    expect(rows.every((x) => x["event_type"] === "pending_sale")).toBe(true);
  });

  it("unticked checkout is byte-identical to the pre-feature rail", async () => {
    await attach(A, C, 10);
    const r = await checkout({ items: [{ productId: A, quantity: 2 }, { productId: B, quantity: 1 }] });
    expect(r.status).toBe(201);
    expect(r.json.gross_cents).toBe(5000);
    expect(r.json.platform_fee_cents).toBe(250);
    expect(r.json.seller_net_cents).toBe(4750);
    expect(h.stripeCreates[0].params.line_items).toHaveLength(2);
    expect((r.json.lines as Array<any>).every((l) => l.isBump === false)).toBe(true);
    const rows = await eventRows(r.json.sessionId);
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x["bump_for_product_id"] == null)).toBe(true);
  });

  it("a tick with no live offer refuses the whole checkout — no rows, no session", async () => {
    const r = await checkout({ items: [{ productId: B, quantity: 1 }], includeBumps: [B] });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BUMP_NOT_OFFERED");
    expect(h.stripeCreates).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
  });

  it("a tick for a product not in the cart refuses the whole checkout", async () => {
    await attach(A, C, 10);
    const r = await checkout({ items: [{ productId: B, quantity: 1 }], includeBumps: [A] });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BUMP_NOT_IN_CART");
    expect(h.stripeCreates).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
  });

  it("the same add-on ticked via two cart products collapses to one line", async () => {
    await attach(A, C, 10);
    await attach(B, C, 10);
    const r = await checkout({ items: [{ productId: A, quantity: 1 }, { productId: B, quantity: 1 }], includeBumps: [A, B] });
    expect(r.status).toBe(201);
    expect(r.json.gross_cents).toBe(2000 + 1000 + 2700);
    expect((r.json.lines as Array<any>).filter((l) => l.isBump)).toHaveLength(1);
    expect(h.stripeCreates[0].params.line_items).toHaveLength(3);
  });

  it("the shop discount code discounts cart lines only, never the bump", async () => {
    await attach(A, C, 10);
    await h.db.execute(sql`
      INSERT INTO shop_discount_codes (shop_id, code, percent_off) VALUES (${SHOP_ID}, 'SAVE10', 10)
    `);
    const r = await checkout({ items: [{ productId: A, quantity: 1 }], includeBumps: [A], discountCode: "SAVE10" });
    expect(r.status).toBe(201);
    /* Main: 2000 → 1800 (fee 90). Bump: still 2700 (fee 135). */
    expect(r.json.gross_cents).toBe(4500);
    expect(r.json.platform_fee_cents).toBe(225);
    const bumpLine = (r.json.lines as Array<any>).find((l) => l.isBump);
    expect(bumpLine.gross_cents).toBe(2700);
  });

  it("a free cart with a ticked bump takes the card path (the bump is priced)", async () => {
    await attach(FREE, C, 0);
    const r = await checkout({ items: [{ productId: FREE, quantity: 1 }], includeBumps: [FREE] });
    expect(r.status).toBe(201);
    expect(r.json.free).toBeUndefined();
    expect(r.json.status).toBe("pending_payment");
    expect(r.json.gross_cents).toBe(3000);
  });
});

describe("shops bumps — verify / double-charge impossibility", () => {
  async function paidCheckout() {
    await attach(A, C, 10);
    await h.db.execute(sql`
      INSERT INTO shop_discount_codes (shop_id, code, percent_off) VALUES (${SHOP_ID}, 'SAVE10', 10)
    `);
    const r = await checkout({
      items: [{ productId: A, quantity: 1 }],
      includeBumps: [A],
      discountCode: "SAVE10",
    });
    expect(r.status).toBe(201);
    return r.json.sessionId as string;
  }

  it("verify flips the bump row with its group; the receipt flags the bump line", async () => {
    const sessionId = await paidCheckout();
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(v.status).toBe(200);
    expect(v.json.paid).toBe(true);
    expect(v.json.gross_cents).toBe(4500);
    expect(v.json.platform_fee_cents).toBe(225);
    expect(v.json.seller_net_cents).toBe(4275);
    const bumpLine = (v.json.lines as Array<any>).find((l) => l.isBump);
    expect(bumpLine).toMatchObject({ productId: C, gross_cents: 2700, bumpForProductId: A });
    const rows = await eventRows(sessionId);
    expect(rows.every((x) => x["event_type"] === "sale")).toBe(true);
  });

  it("duplicate verify is a pure no-op and the discount use is counted exactly once", async () => {
    const sessionId = await paidCheckout();
    const v1 = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(v1.json.duplicate).toBe(false);
    const v2 = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(v2.json.duplicate).toBe(true);
    /* The webhook door runs the same guarded flip — also a no-op now. */
    const again = await markMarketSalePaid(sessionId);
    expect(again.flipped).toBe(0);
    const rows = await eventRows(sessionId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((x) => x["event_type"] === "sale")).toHaveLength(2);
    const code = await h.db.execute(sql`SELECT used_count FROM shop_discount_codes WHERE code = 'SAVE10'`);
    expect(Number((code.rows[0] as any).used_count)).toBe(1);
    /* Status reads the same truth. */
    const st = await req("GET", `/storefronts/checkout/status?sessionId=${sessionId}`);
    expect(st.json.paid).toBe(true);
    expect((st.json.lines as Array<any>).some((l) => l.isBump)).toBe(true);
  });
});

describe("shops bumps — pre-migration (bump columns absent)", () => {
  beforeAll(() => { withBumpColumns = false; });
  afterAll(() => { withBumpColumns = true; });

  it("no offers anywhere; a tick refuses; attach 500s honestly", async () => {
    const pub = await req("GET", "/shops/handle/queen-shop");
    expect((pub.json.products as Array<any>).every((p) => p.bump === null)).toBe(true);
    const ticked = await checkout({ items: [{ productId: A, quantity: 1 }], includeBumps: [A] });
    expect(ticked.status).toBe(400);
    expect(ticked.json.error).toBe("BUMP_NOT_OFFERED");
    expect(h.stripeCreates).toHaveLength(0);
    const put = await attach(A, C, 10);
    expect(put.status).toBe(500);
  });

  it("legacy checkout + verify work byte-identically without the columns", async () => {
    const r = await checkout({ items: [{ productId: A, quantity: 2 }, { productId: B, quantity: 1 }] });
    expect(r.status).toBe(201);
    expect(r.json.gross_cents).toBe(5000);
    expect(r.json.platform_fee_cents).toBe(250);
    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: r.json.sessionId });
    expect(v.status).toBe(200);
    expect(v.json.paid).toBe(true);
    expect(v.json.gross_cents).toBe(5000);
    expect((v.json.lines as Array<any>).every((l) => l.isBump === false)).toBe(true);
  });
});
