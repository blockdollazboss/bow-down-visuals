/**
 * Order bumps (Stack-100 #3, feature #13) — the storefront rail.
 * Drives the REAL storefront router over pg-mem with Stripe faked at
 * the lib/stripe-client seam (create records the session; retrieve
 * hands it back paid, exactly like a completed hosted checkout) and
 * pins:
 *  - a seller attaches ONE add-on (own product only, never itself,
 *    never a $0 lead magnet); detaching clears it; the buyer payload
 *    resolves the live offer at the seller-set price / % off;
 *  - checkout totals are server-computed: bump ticked → one session,
 *    two line items, flat-5% fee split across the lines; unticked →
 *    byte-identical legacy totals; a tick with no live offer refuses
 *    (no session, no charge);
 *  - double-charge impossibility: the same checkout double-submit
 *    produces ONE idempotency key (Stripe dedupes), ticked vs
 *    unticked produce different keys, and a duplicate verify records
 *    ONE order with zero repeated side effects;
 *  - the order record carries the bump as its own line (columns +
 *    receipt `lines[]` on verify, sales and purchases), the discount
 *    code discounts the main line only, and a bump that sells out
 *    between payment and verify still records — with the exact
 *    add-on refund owed stated in the fulfillment note.
 *
 * Hand-computed money (fee = round(gross × 5%), bump fee = its own
 * split, main absorbs any remainder):
 *  main 2000¢ ×2 = 4000 · bump 3000¢ at 10% off = 2700 · grand 6700
 *  fee total 335 · bump fee 135 / creator 2565 · main fee 200 / 3800
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-order-bumps";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<{ params: any; options: any }>,
  sessions: new Map<string, any>(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../lib/stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: vi.fn(() => ({
      checkout: {
        sessions: {
          create: vi.fn(async (params: any, options: any) => {
            const id = `cs_test_${h.stripeCreates.length + 1}`;
            h.stripeCreates.push({ params, options });
            const amount_total = (params.line_items as Array<any>).reduce(
              (sum, li) => sum + li.price_data.unit_amount * (li.quantity ?? 1),
              0,
            );
            h.sessions.set(id, {
              id,
              payment_status: "paid",
              amount_total,
              metadata: params.metadata,
            });
            return { id, url: "https://checkout.example.com/pay" };
          }),
          retrieve: vi.fn(async (id: string) => {
            const s = h.sessions.get(id);
            if (!s) throw new Error("No such checkout session");
            return s;
          }),
        },
      },
    })),
  };
});

/* Rate limiting is orthogonal infra with its own suites; the shared
   limiter would 429 this file's later tests purely for volume. */
vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  isStorageRef: vi.fn(() => false),
}));

import storefrontRouter from "../storefront";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

/* The bump columns are the lane's REPORTED migration (0205) applied
   here so the suite proves the post-migration behaviour end to end.
   job_notifications intentionally absent: createTestDb() creates it. */
const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE events (
  id uuid PRIMARY KEY, title text, rsvp_count integer NOT NULL DEFAULT 0
);
CREATE TABLE store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', price_cents integer NOT NULL,
  compare_at_cents integer, inventory integer NOT NULL DEFAULT -1,
  media_urls jsonb NOT NULL DEFAULT '[]', service_details jsonb,
  event_id uuid, related_links jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0,
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (price_cents >= 0)
, media_alt_texts jsonb NOT NULL DEFAULT '[]', gift_card_denominations_cents jsonb);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL, product_kind text NOT NULL,
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL,
  discount_code text, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text UNIQUE, status text NOT NULL DEFAULT 'completed',
  fulfillment_note text,
  bump_product_id uuid, bump_title text,
  bump_amount_cents integer, bump_platform_fee_cents integer, bump_creator_amount_cents integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_delivery_tokens (
  token text PRIMARY KEY, order_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL,
  code text NOT NULL, percent_off integer NOT NULL,
  max_uses integer NOT NULL DEFAULT -1, used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const CREATOR = randomUUID();
const OTHER_CREATOR = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();
const OTHER_PROFILE_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[order-bumps] unhandled route error:", err?.message ?? err);
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
    /* impure: without it pg-mem memoizes the result and every
       default-generated id in the DB is the same uuid. */
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  h.userId = CREATOR;
  h.userEmail = "creator@example.com";
  h.stripeCreates = [];
  h.sessions = new Map();
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${OTHER_PROFILE_ID}, ${OTHER_CREATOR}, 'other-creator', 'Other Creator')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function createProduct(body: Record<string, unknown>, as: string = CREATOR) {
  h.userId = as;
  return req("POST", "/storefront/products", body);
}

/** Main product: digital, 2000¢, unlimited. */
async function seedMain(): Promise<string> {
  const r = await createProduct({
    kind: "digital", title: "Full Album", description: "",
    priceCents: 2000, mediaUrls: ["https://cdn.example.com/album.zip"],
  });
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

/** Bump candidate: digital, 3000¢, 5 in stock. */
async function seedBump(extra: Record<string, unknown> = {}): Promise<string> {
  const r = await createProduct({
    kind: "digital", title: "Bonus Sample Pack", description: "",
    priceCents: 3000, inventory: 5, mediaUrls: ["https://cdn.example.com/pack.zip"],
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

async function attach(mainId: string, bumpId: string | null, percentOff = 0) {
  h.userId = CREATOR;
  return req("PUT", `/storefront/products/${mainId}/bump`, { bumpProductId: bumpId, percentOff });
}

async function orderRows() {
  const r = await h.db.execute(sql`SELECT * FROM store_orders`);
  return r.rows as Array<Record<string, unknown>>;
}

async function inventoryOf(id: string) {
  const r = await h.db.execute(sql`SELECT inventory FROM store_products WHERE id = ${id}`);
  return Number((r.rows[0] as any).inventory);
}

describe("seller attach — one add-on, own products only", () => {
  it("attaches and the buyer payload resolves the live offer at the seller-set % off", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    const r = await attach(mainId, bumpId, 10);
    expect(r.status).toBe(200);
    expect(r.json.offerLive).toBe(true);
    expect(r.json.product.bumpConfig).toEqual({ bumpProductId: bumpId, percentOff: 10 });
    expect(r.json.product.bump).toMatchObject({
      productId: bumpId, title: "Bonus Sample Pack",
      listPriceCents: 3000, percentOff: 10, priceCents: 2700,
    });

    const detail = await req("GET", `/storefront/product/${mainId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.product.bump).toMatchObject({ productId: bumpId, priceCents: 2700 });
  });

  it("detaching clears the setting and the offer", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    await attach(mainId, bumpId, 10);
    const r = await attach(mainId, null);
    expect(r.status).toBe(200);
    expect(r.json.product.bumpConfig).toBeNull();
    expect(r.json.product.bump).toBeNull();
    expect(r.json.offerLive).toBe(false);
  });

  it("refuses a product as its own add-on", async () => {
    const mainId = await seedMain();
    const r = await attach(mainId, mainId);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BUMP_SELF");
  });

  it("refuses another seller's product", async () => {
    const mainId = await seedMain();
    const foreign = await createProduct({
      kind: "digital", title: "Not Yours", description: "", priceCents: 1500, mediaUrls: [],
    }, OTHER_CREATOR);
    expect(foreign.status).toBe(201);
    const r = await attach(mainId, foreign.json.product.id);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BUMP_NOT_YOURS");
  });

  it("refuses a $0 lead magnet as the add-on", async () => {
    const mainId = await seedMain();
    const free = await createProduct({
      kind: "digital", title: "Freebie", description: "", priceCents: 0, mediaUrls: [],
    });
    expect(free.status).toBe(201);
    const r = await attach(mainId, free.json.product.id);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BUMP_FREE");
  });

  it("refuses a percent off above the 90 ceiling", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    const r = await attach(mainId, bumpId, 91);
    expect(r.status).toBe(400);
  });

  it("an inactive add-on may be attached but shows no live offer", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    h.userId = CREATOR;
    const off = await req("DELETE", `/storefront/products/${bumpId}`);
    expect(off.status).toBe(200);
    const r = await attach(mainId, bumpId, 0);
    expect(r.status).toBe(200);
    expect(r.json.offerLive).toBe(false);
    expect(r.json.product.bump).toBeNull();
    expect(r.json.product.bumpConfig).toEqual({ bumpProductId: bumpId, percentOff: 0 });
  });

  it("a non-owner cannot set another seller's bump", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    h.userId = OTHER_CREATOR;
    const r = await req("PUT", `/storefront/products/${mainId}/bump`, { bumpProductId: bumpId, percentOff: 0 });
    expect(r.status).toBe(404);
  });
});

describe("checkout — server-computed totals, one session", () => {
  it("unticked: legacy totals exactly, one line item, no bump in metadata", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    await attach(mainId, bumpId, 10);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId: mainId, quantity: 2 });
    expect(r.status).toBe(200);
    expect(r.json.totals).toMatchObject({
      lineTotal: 4000, grandTotalCents: 4000,
      platformFeeCents: 200, creatorCents: 3800, bump: null,
    });
    expect(h.stripeCreates).toHaveLength(1);
    expect(h.stripeCreates[0]!.params.line_items).toHaveLength(1);
    expect(h.stripeCreates[0]!.params.metadata).toMatchObject({
      amount_cents: "4000", bump_product_id: "", bump_amount_cents: "0",
    });
  });

  it("ticked: two line items, grand total and per-line fee split on the flat 5%", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    await attach(mainId, bumpId, 10);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId: mainId, quantity: 2, includeBump: true });
    expect(r.status).toBe(200);
    expect(r.json.totals).toMatchObject({
      lineTotal: 4000, grandTotalCents: 6700, grandTotal: "$67.00",
      platformFeeCents: 335, creatorCents: 6365,
      bump: { productId: bumpId, unitCents: 2700, grossCents: 2700, percentOff: 10, feeCents: 135, creatorCents: 2565 },
    });
    expect(h.stripeCreates).toHaveLength(1);
    const items = h.stripeCreates[0]!.params.line_items;
    expect(items).toHaveLength(2);
    expect(items[1].price_data.unit_amount).toBe(2700);
    expect(items[1].quantity).toBe(1);
    expect(h.stripeCreates[0]!.params.metadata).toMatchObject({
      amount_cents: "6700", platform_fee_cents: "335", creator_amount_cents: "6365",
      bump_product_id: bumpId, bump_amount_cents: "2700",
    });
  });

  it("double-charge impossibility: a double-submit reuses ONE idempotency key; ticking changes it", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    await attach(mainId, bumpId, 10);
    h.userId = BUYER;
    await req("POST", "/storefront/checkout", { productId: mainId, quantity: 2, includeBump: true });
    await req("POST", "/storefront/checkout", { productId: mainId, quantity: 2, includeBump: true });
    await req("POST", "/storefront/checkout", { productId: mainId, quantity: 2 });
    expect(h.stripeCreates).toHaveLength(3);
    const [k1, k2, k3] = h.stripeCreates.map((c) => c.options?.idempotencyKey);
    expect(k1).toBeTruthy();
    expect(k2).toBe(k1);
    expect(k3).not.toBe(k1);
  });

  it("a tick with no offer attached refuses — no session, no charge", async () => {
    const mainId = await seedMain();
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId: mainId, quantity: 1, includeBump: true });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BUMP_NOT_OFFERED");
    expect(h.stripeCreates).toHaveLength(0);
  });

  it("a tick whose add-on sold out after attaching refuses — no session", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump({ inventory: 1 });
    await attach(mainId, bumpId, 0);
    await h.db.execute(sql`UPDATE store_products SET inventory = 0 WHERE id = ${bumpId}`);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId: mainId, quantity: 1, includeBump: true });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BUMP_SOLD_OUT");
    expect(h.stripeCreates).toHaveLength(0);
  });

  it("a discount code discounts the MAIN line only — the bump stays at its seller price", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    await attach(mainId, bumpId, 10);
    await h.db.execute(sql`
      INSERT INTO discount_codes (profile_id, code, percent_off) VALUES (${PROFILE_ID}, 'HALF', 50)
    `);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", {
      productId: mainId, quantity: 1, discountCode: "HALF", includeBump: true,
    });
    expect(r.status).toBe(200);
    /* main 2000 → 1000 after the code; bump still 2700; grand 3700;
       fee 185 total = bump 135 + main 50. */
    expect(r.json.totals).toMatchObject({
      lineTotal: 1000, grandTotalCents: 3700, platformFeeCents: 185, creatorCents: 3515,
      bump: { grossCents: 2700, feeCents: 135, creatorCents: 2565 },
    });
  });
});

describe("verify — the bump recorded as its own line, exactly once", () => {
  async function checkoutWithBump(quantity = 2) {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    await attach(mainId, bumpId, 10);
    h.userId = BUYER;
    const co = await req("POST", "/storefront/checkout", { productId: mainId, quantity, includeBump: true });
    expect(co.status).toBe(200);
    return { mainId, bumpId, sessionId: co.json.sessionId as string };
  }

  it("records one order whose bump columns and receipt lines reconcile to the cent", async () => {
    const { mainId, bumpId, sessionId } = await checkoutWithBump();
    h.userId = BUYER;
    const v = await req("POST", "/storefront/verify", { sessionId });
    expect(v.status).toBe(200);
    expect(v.json.duplicate).toBe(false);
    expect(v.json.order).toMatchObject({ amountCents: 6700, platformFeeCents: 335, creatorAmountCents: 6365 });
    expect(v.json.order.lines).toHaveLength(2);
    expect(v.json.order.lines[0]).toMatchObject({
      role: "main", productId: mainId, quantity: 2, grossCents: 4000, platformFeeCents: 200, creatorCents: 3800,
    });
    expect(v.json.order.lines[1]).toMatchObject({
      role: "bump", productId: bumpId, title: "Bonus Sample Pack", quantity: 1,
      grossCents: 2700, platformFeeCents: 135, creatorCents: 2565,
    });
    expect(v.json.delivery?.url).toContain("/api/storefront/deliver/");
    expect(v.json.bumpDelivery?.url).toContain("/api/storefront/deliver/");
    expect(v.json.order.fulfillmentNote).toContain('Add-on "Bonus Sample Pack" delivery ready.');

    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount_cents: 6700, platform_fee_cents: 335, creator_amount_cents: 6365,
      bump_product_id: bumpId, bump_title: "Bonus Sample Pack",
      bump_amount_cents: 2700, bump_platform_fee_cents: 135, bump_creator_amount_cents: 2565,
    });
    expect(await inventoryOf(bumpId)).toBe(4);
    expect(mainId).toBeTruthy();
  });

  it("a duplicate verify is a pure no-op: one order, no second claim, no second discount use", async () => {
    const mainId = await seedMain();
    const bumpId = await seedBump();
    await attach(mainId, bumpId, 10);
    await h.db.execute(sql`
      INSERT INTO discount_codes (profile_id, code, percent_off) VALUES (${PROFILE_ID}, 'HALF', 50)
    `);
    h.userId = BUYER;
    const co = await req("POST", "/storefront/checkout", {
      productId: mainId, quantity: 1, discountCode: "HALF", includeBump: true,
    });
    expect(co.status).toBe(200);
    const first = await req("POST", "/storefront/verify", { sessionId: co.json.sessionId });
    expect(first.status).toBe(200);
    expect(first.json.duplicate).toBe(false);
    const second = await req("POST", "/storefront/verify", { sessionId: co.json.sessionId });
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    expect(second.json.order.id).toBe(first.json.order.id);
    expect(second.json.order.lines).toEqual(first.json.order.lines);

    expect(await orderRows()).toHaveLength(1);
    expect(await inventoryOf(bumpId)).toBe(4);
    const dc = await h.db.execute(sql`SELECT used_count FROM discount_codes WHERE code = 'HALF'`);
    expect(Number((dc.rows[0] as any).used_count)).toBe(1);
  });

  it("no-bump verify is byte-identical to the legacy rail (bump columns NULL, one line)", async () => {
    const mainId = await seedMain();
    h.userId = BUYER;
    const co = await req("POST", "/storefront/checkout", { productId: mainId, quantity: 2 });
    expect(co.status).toBe(200);
    const v = await req("POST", "/storefront/verify", { sessionId: co.json.sessionId });
    expect(v.status).toBe(200);
    expect(v.json.order.lines).toHaveLength(1);
    expect(v.json.order.lines[0]).toMatchObject({ role: "main", grossCents: 4000, platformFeeCents: 200, creatorCents: 3800 });
    expect(v.json.bumpDelivery).toBeNull();
    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!["bump_product_id"]).toBeNull();
    expect(rows[0]!["bump_amount_cents"]).toBeNull();
  });

  it("a bump that sells out between payment and verify still records — with the exact refund owed in the note", async () => {
    const { bumpId, sessionId } = await checkoutWithBump(1);
    await h.db.execute(sql`UPDATE store_products SET inventory = 0 WHERE id = ${bumpId}`);
    h.userId = BUYER;
    const v = await req("POST", "/storefront/verify", { sessionId });
    expect(v.status).toBe(200);
    expect(v.json.duplicate).toBe(false);
    expect(v.json.order.fulfillmentNote).toContain("sold out after payment");
    expect(v.json.order.fulfillmentNote).toContain("$27.00 refund for the add-on");
    expect(v.json.bumpDelivery).toBeNull();
    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bump_amount_cents: 2700 });
    expect(await inventoryOf(bumpId)).toBe(0);
  });

  it("sales and purchases both show the bump as its own receipt line", async () => {
    const { bumpId, sessionId } = await checkoutWithBump(1);
    h.userId = BUYER;
    const v = await req("POST", "/storefront/verify", { sessionId });
    expect(v.status).toBe(200);

    h.userId = CREATOR;
    const sales = await req("GET", "/storefront/orders/sales");
    expect(sales.status).toBe(200);
    expect(sales.json.orders).toHaveLength(1);
    expect(sales.json.orders[0].lines).toHaveLength(2);
    expect(sales.json.orders[0].lines[1]).toMatchObject({
      role: "bump", productId: bumpId, grossCents: 2700, platformFeeCents: 135, netCents: 2565,
    });
    /* Order totals stay the whole-session story. */
    expect(sales.json.totals).toMatchObject({ grossCents: 4700, feeCents: 235, netCents: 4465 });

    h.userId = BUYER;
    const purchases = await req("GET", "/storefront/orders/purchases");
    expect(purchases.status).toBe(200);
    expect(purchases.json.purchases).toHaveLength(1);
    expect(purchases.json.purchases[0].lines[1]).toMatchObject({ role: "bump", productId: bumpId, grossCents: 2700 });
  });
});
