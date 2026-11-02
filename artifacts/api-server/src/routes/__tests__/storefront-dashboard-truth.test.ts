/**
 * Store Dashboard vs Shop Sales truth (stack1100 lane G5C — Gate #5
 * part 2 finding P2-1). Drives the REAL storefront router AND the REAL
 * shops router over pg-mem and pins the one-truth contract:
 *
 *  - a customer-shop sale (shop_events, event_type='sale') appears in
 *    BOTH seller surfaces — My Shop analytics
 *    (GET /storefronts/:id/analytics) and the Store Dashboard
 *    (GET /storefront/money-checklist earnings + GET
 *    /storefront/orders/sales) — with IDENTICAL gross / fee / net;
 *  - the dashboard's totals cover BOTH sales ledgers (profile-store
 *    store_orders + customer-shop shop_events), so its hero can no
 *    longer show $0.00 to a seller whose shop is selling;
 *  - the pending-payout figure is the unified ledger read (the same
 *    number /api/connect/status serves), and the copy no longer
 *    claims Stripe Connect payouts are "not built yet" — POST
 *    /api/connect/payout exists and the dashboard's own Get Paid card
 *    cashes out through it;
 *  - the empty state is honest: a seller with no sales anywhere reads
 *    zeros and an empty Orders list — and ONLY then;
 *  - unpaid rows never count ('pending_sale' shop lines, 'view'
 *    events), another seller's sales never leak in, and a shop sale
 *    can be logged to the Money Tracker from the dashboard's one
 *    Orders list (the checklist's unlogged count covers both ledgers).
 *
 * stack1200 leftover (G5C named it): the checklist's first two nudges
 * — "first-product" and "activate" — keyed ONLY off profile-store
 * products, so a seller who sells only through a customer shop was
 * falsely nudged to list a storefront product. The second describe
 * block below pins the unified product counts: shop products in
 * shops the caller owns count toward both nudges (status 'active'
 * counts as live; 'paused' counts as listed-but-not-live, the shop
 * vocabulary's draft), the activate detail cites the COMBINED
 * not-live count, another seller's shop products never count, and a
 * seller with nothing anywhere sees the nudges exactly as before.
 * (The "restock" nudge is NOT unified: shop_products carries no
 * inventory column, so it has no sold-out semantics to fold in.)
 *
 * Hand-computed money (both rails charge the flat 5%):
 *  4 shop sales × $5.00 → gross 2000¢, fee 4×25¢ = 100¢, net 1900¢.
 *  1 profile-store order $10.00 → fee 50¢, net 950¢.
 *  Combined: 5 orders, gross 3000¢, fee 150¢, net 2850¢.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

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
            h.sessions.set(id, { id, payment_status: "paid", amount_total: 0, metadata: params.metadata });
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

vi.mock("../../lib/stripe-checkout", () => ({
  getCheckoutStripe: () => ({
    checkout: {
      sessions: {
        create: async (params: any, options: any) => {
          const id = `cs_test_${h.stripeCreates.length + 1}`;
          h.stripeCreates.push({ params, options });
          h.sessions.set(id, { id, payment_status: "paid", amount_total: 0, metadata: params.metadata });
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

/* Rate limiting is orthogonal infra with its own suites. */
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

import storefrontRouter from "../storefront";
import shopsRouter from "../generate/shops";
import { createTestDb } from "../../lib/__tests__/test-db";
import { __resetSaleSplitProbes } from "../../lib/sale-splits";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
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
  media_alt_texts jsonb NOT NULL DEFAULT '[]', gift_card_denominations_cents jsonb
);
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
  parent_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL,
  code text NOT NULL, percent_off integer NOT NULL,
  max_uses integer NOT NULL DEFAULT -1, used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL,
  is_published boolean NOT NULL DEFAULT false, download_price_cents integer
);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL,
  is_published boolean NOT NULL DEFAULT false, download_price_cents integer
);
CREATE TABLE money_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, entry_type text NOT NULL, category text NOT NULL,
  amount_cents integer NOT NULL, note text, source text,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
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
  image_alt_text text, bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0,
  splits jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid,
  amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0,
  buyer_email text, buyer_user_id uuid,
  stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text,
  discount_code text, affiliate_code text, bump_for_product_id uuid,
  settled_payout_id uuid, settled_at timestamptz, ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE digital_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed'
);
CREATE TABLE beat_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0,
  commission_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_payment', stripe_session_id text
);
CREATE TABLE fan_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE sponsor_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'released', settled_payout_id uuid
);
CREATE TABLE creator_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
);
CREATE TABLE pending_payout_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id uuid NOT NULL,
  seller_profile_id uuid,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  entry_type text NOT NULL,
  gross_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0,
  net_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_kind IN ('digital_sale','store_order','shop_event','beat_license','membership')),
  CHECK (entry_type IN ('accrual','reversal'))
);
CREATE UNIQUE INDEX pending_payout_ledger_source_entry_ux
  ON pending_payout_ledger (source_kind, source_id, entry_type);
CREATE TABLE sale_split_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_kind text NOT NULL, sale_id uuid NOT NULL,
  surface text NOT NULL DEFAULT '', product_id uuid,
  owner_user_id uuid NOT NULL, seller_user_id uuid NOT NULL, seller_profile_id uuid,
  role text NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'earned'
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

const SELLER = randomUUID();
const OTHER_SELLER = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();
const OTHER_PROFILE_ID = randomUUID();
const SHOP_ID = randomUUID();
const SHOP_PRODUCT_ID = randomUUID();
const OTHER_SHOP_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[dashboard-truth] unhandled route error:", err?.message ?? err);
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
  /* pg-mem has no date_trunc; real Postgres does (the analytics
     endpoint's daily-views query uses it and runs live). Register the
     'day' truncation so the REAL analytics route can run unmodified. */
  mem.public.registerFunction({
    name: "date_trunc",
    args: ["text", "timestamptz"],
    returns: "timestamptz" as never,
    implementation: (_unit: string, ts: unknown) => {
      const d = ts instanceof Date ? new Date(ts) : new Date(String(ts));
      d.setUTCHours(0, 0, 0, 0);
      return d;
    },
  });
  mem.public.none(DDL);
  h.db = db;
  h.userId = SELLER;
  h.userEmail = "seller-d@example.com";
  h.stripeCreates = [];
  h.sessions = new Map();
  __resetSaleSplitProbes();
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${SELLER}, 'seller-d', 'Seller D')`);
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${OTHER_PROFILE_ID}, ${OTHER_SELLER}, 'other-seller', 'Other Seller')`);
  await h.db.execute(sql`
    INSERT INTO shops (id, user_id, name, handle)
    VALUES (${SHOP_ID}, ${SELLER}, 'TEST Buyer D Shop', 'test-buyer-d-shop')`);
  await h.db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents)
    VALUES (${SHOP_PRODUCT_ID}, ${SHOP_ID}, ${SELLER}, 'TEST Digital Download — delete pre-launch', 500)`);
  await h.db.execute(sql`
    INSERT INTO shops (id, user_id, name, handle)
    VALUES (${OTHER_SHOP_ID}, ${OTHER_SELLER}, 'Other Shop', 'other-shop')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

/** The Gate #5 basket: four paid $5.00 shop sales (fee 25¢ each). */
async function seedShopSales(): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    ids.push(id);
    await h.db.execute(sql`
      INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id,
        amount_cents, platform_fee_cents, buyer_email, payment_status, quantity, created_at)
      VALUES (${id}, ${SHOP_ID}, ${SELLER}, 'sale', ${SHOP_PRODUCT_ID},
        500, 25, 'buyer@example.com', 'paid', 1, ${new Date(Date.now() - i * 3_600_000)})`);
  }
  /* Noise that must never count: an unpaid checkout line, a view, and
     another seller's sale in their own shop. */
  await h.db.execute(sql`
    INSERT INTO shop_events (shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, payment_status)
    VALUES (${SHOP_ID}, ${SELLER}, 'pending_sale', ${SHOP_PRODUCT_ID}, 500, 25, 'pending')`);
  await h.db.execute(sql`
    INSERT INTO shop_events (shop_id, user_id, event_type, amount_cents)
    VALUES (${SHOP_ID}, ${SELLER}, 'view', 0)`);
  await h.db.execute(sql`
    INSERT INTO shop_events (shop_id, user_id, event_type, amount_cents, platform_fee_cents, payment_status)
    VALUES (${OTHER_SHOP_ID}, ${OTHER_SELLER}, 'sale', 10000, 500, 'paid')`);
  return ids;
}

/** One completed profile-store order: $10.00, fee 50¢, net 950¢. */
async function seedStoreOrder(): Promise<string> {
  const id = randomUUID();
  await h.db.execute(sql`
    INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id,
      product_title, product_kind, quantity, amount_cents,
      platform_fee_cents, creator_amount_cents, status, created_at)
    VALUES (${id}, ${BUYER}, ${PROFILE_ID}, ${randomUUID()},
      'Profile Song', 'digital', 1, 1000, 50, 950, 'completed', NOW() - INTERVAL '30 minutes')`);
  return id;
}

describe("Gate #5 P2-1 — one seller, one truth", () => {
  it("My Shop analytics and the Store Dashboard agree to the cent on shop sales", async () => {
    const saleIds = await seedShopSales();

    h.userId = SELLER;
    const analytics = await req("GET", `/storefronts/${SHOP_ID}/analytics`);
    expect(analytics.status).toBe(200);
    expect(analytics.json.totals).toMatchObject({
      sales: 4, gross_cents: 2000, platform_fee_cents: 100, seller_net_cents: 1900,
    });
    expect(analytics.json.sales).toHaveLength(4);

    const checklist = await req("GET", "/storefront/money-checklist");
    expect(checklist.status).toBe(200);
    expect(checklist.json.earnings).toMatchObject({
      orderCount: 4,
      grossCents: 2000, feeCents: 100, netCents: 1900,
      gross: "$20.00", fee: "$1.00", net: "$19.00",
      platformFeePct: 5,
    });

    const sales = await req("GET", "/storefront/orders/sales");
    expect(sales.status).toBe(200);
    expect(sales.json.orders).toHaveLength(4);
    expect(sales.json.totals).toMatchObject({
      grossCents: 2000, feeCents: 100, netCents: 1900, platformFeePct: 5,
    });
    /* Row-for-row identical to the analytics' own rows. */
    const analyticsById = new Map(
      (analytics.json.sales as Array<any>).map((s) => [String(s.id), s]),
    );
    for (const o of sales.json.orders as Array<any>) {
      expect(o.source).toBe("shop");
      const a = analyticsById.get(o.id);
      expect(a).toBeDefined();
      expect(o.grossCents).toBe(a.amount_cents);
      expect(o.platformFeeCents).toBe(a.platform_fee_cents);
      expect(o.netCents).toBe(a.seller_net_cents);
      expect(o.productTitle).toBe("TEST Digital Download — delete pre-launch");
      expect(o.links.productUrl).toBe("/shop/test-buyer-d-shop");
    }
    expect(new Set(sales.json.orders.map((o: any) => o.id))).toEqual(new Set(saleIds));
  });

  it("the pending figure is the unified ledger read, and the Connect copy tells the truth", async () => {
    await seedShopSales();
    h.userId = SELLER;
    const checklist = await req("GET", "/storefront/money-checklist");
    expect(checklist.status).toBe(200);
    /* 4 shop accruals × 475¢, nothing settled — the same figure
       /api/connect/status serves from readPendingPayoutForSeller. */
    expect(checklist.json.earnings.pendingPayoutCents).toBe(1900);
    expect(checklist.json.earnings.pendingPayout).toBe("$19.00");
    expect(checklist.json.earnings.pendingPayoutNote).toContain("Stripe Connect");
    expect(checklist.json.earnings.pendingPayoutNote).not.toContain("not built yet");

    const sales = await req("GET", "/storefront/orders/sales");
    expect(sales.json.note).not.toContain("Payouts need Stripe Connect");
    expect(sales.json.note).toContain("Stripe Connect");
  });

  it("both ledgers combine: hero totals equal the Orders tab totals", async () => {
    await seedShopSales();
    await seedStoreOrder();
    h.userId = SELLER;

    const checklist = await req("GET", "/storefront/money-checklist");
    expect(checklist.json.earnings).toMatchObject({
      orderCount: 5, grossCents: 3000, feeCents: 150, netCents: 2850,
      pendingPayoutCents: 2850,
    });

    const sales = await req("GET", "/storefront/orders/sales");
    expect(sales.json.orders).toHaveLength(5);
    expect(sales.json.totals).toMatchObject({ grossCents: 3000, feeCents: 150, netCents: 2850 });
    const sources = (sales.json.orders as Array<any>).map((o) => o.source).sort();
    expect(sources).toEqual(["shop", "shop", "shop", "shop", "storefront"]);
    /* Newest first across BOTH ledgers (the store order is 30 min old,
       the newest shop sale is 'now'). */
    expect(sales.json.orders[0].source).toBe("shop");
  });

  it("empty state only when truly empty — a seller with no sales anywhere", async () => {
    h.userId = OTHER_SELLER;
    const checklist = await req("GET", "/storefront/money-checklist");
    expect(checklist.status).toBe(200);
    expect(checklist.json.earnings).toMatchObject({
      orderCount: 0, grossCents: 0, feeCents: 0, netCents: 0, pendingPayoutCents: 0,
    });
    const sales = await req("GET", "/storefront/orders/sales");
    expect(sales.status).toBe(200);
    expect(sales.json.orders).toEqual([]);
    expect(sales.json.totals).toMatchObject({ grossCents: 0, feeCents: 0, netCents: 0 });
  });

  it("a shop sale logs to the Money Tracker from the one Orders list — exactly once", async () => {
    const saleIds = await seedShopSales();
    h.userId = SELLER;

    /* The checklist counts unlogged sales across BOTH ledgers. */
    const before = await req("GET", "/storefront/money-checklist");
    const logItem = (before.json.checklist as Array<any>).find((c) => c.id === "log-tracker");
    expect(logItem.done).toBe(false);
    expect(logItem.detail).toContain("4 sale(s)");

    const target = saleIds[0]!;
    const logged = await req("POST", `/storefront/orders/${target}/log-to-tracker`, {});
    expect(logged.status).toBe(201);
    expect(logged.json.entry.amountCents).toBe(475);

    const entries = await h.db.execute(sql`
      SELECT amount_cents, note, source FROM money_entries WHERE user_id = ${SELLER}`);
    expect(entries.rows).toHaveLength(1);
    expect(entries.rows[0]).toMatchObject({
      amount_cents: 475, note: `Shop sale ${target}`, source: "Shop — TEST Digital Download — delete pre-launch",
    });

    const again = await req("POST", `/storefront/orders/${target}/log-to-tracker`, {});
    expect(again.status).toBe(409);

    const after = await req("GET", "/storefront/money-checklist");
    const logItemAfter = (after.json.checklist as Array<any>).find((c) => c.id === "log-tracker");
    expect(logItemAfter.detail).toContain("3 sale(s)");

    /* Another seller cannot log this sale. */
    h.userId = OTHER_SELLER;
    const foreign = await req("POST", `/storefront/orders/${saleIds[1]}/log-to-tracker`, {});
    expect(foreign.status).toBe(404);
  });
});

describe("money-checklist shop-product nudges (stack1200 — G5C leftover)", () => {
  async function checklistFor(userId: string) {
    h.userId = userId;
    const r = await req("GET", "/storefront/money-checklist");
    expect(r.status).toBe(200);
    return r.json as any;
  }
  function item(json: any, id: string) {
    const found = (json.checklist as Array<any>).find((c) => c.id === id);
    expect(found).toBeDefined();
    return found;
  }

  it("(a) shops-only seller with an active shop product: first-product + activate are done", async () => {
    /* The beforeEach seed is exactly this seller: ONE active shop
       product in their own shop, ZERO profile-store products. */
    const json = await checklistFor(SELLER);
    expect(item(json, "first-product").done).toBe(true);
    expect(item(json, "activate").done).toBe(true);
    expect(json.nextMove?.id).not.toBe("first-product");
    expect(json.nextMove?.id).not.toBe("activate");
  });

  it("(b) shops-only seller with only paused shop products: first-product done, activate open, detail counts it", async () => {
    await h.db.execute(sql`
      UPDATE shop_products SET status = 'paused' WHERE id = ${SHOP_PRODUCT_ID}`);
    const json = await checklistFor(SELLER);
    expect(item(json, "first-product").done).toBe(true);
    const activate = item(json, "activate");
    expect(activate.done).toBe(false);
    expect(activate.detail).toContain("1 product(s) sitting in draft.");
    expect(json.nextMove?.id).toBe("activate");
  });

  it("(c) seller with nothing anywhere: both nudges still present and unchanged", async () => {
    /* Literally nothing anywhere: no shop products for anyone, no
       profile-store products at all. OTHER_SELLER's shop exists but
       is empty. Base behaviour is preserved: first-product is the
       open top nudge; activate reads 0 drafts (with zero products
       there is nothing to activate, so the base marks it done). */
    await h.db.execute(sql`DELETE FROM shop_products`);
    const json = await checklistFor(OTHER_SELLER);
    const first = item(json, "first-product");
    expect(first.done).toBe(false);
    const activate = item(json, "activate");
    expect(activate.detail).toContain("0 product(s) sitting in draft.");
    expect(activate.done).toBe(true);
    expect(json.nextMove?.id).toBe("first-product");
  });

  it("(d) another seller's shop products never count", async () => {
    /* Both seeded/other sellers hold shop products: SELLER has the
       active seeded one, and OTHER_SELLER gets an active one in
       their own shop. A third seller with a profile but no products
       anywhere must still be nudged as if neither existed. */
    await h.db.execute(sql`
      INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, status)
      VALUES (${randomUUID()}, ${OTHER_SHOP_ID}, ${OTHER_SELLER}, 'Other Seller Active', 900, 'active')`);
    const THIRD = randomUUID();
    const THIRD_PROFILE = randomUUID();
    await h.db.execute(sql`
      INSERT INTO creator_profiles (id, user_id, slug, display_name)
      VALUES (${THIRD_PROFILE}, ${THIRD}, 'third-seller', 'Third Seller')`);
    const json = await checklistFor(THIRD);
    expect(item(json, "first-product").done).toBe(false);
    expect(item(json, "activate").detail).toContain("0 product(s) sitting in draft.");
    expect(json.nextMove?.id).toBe("first-product");
  });

  it("(e) mixed seller: the activate detail cites the combined true not-live count", async () => {
    /* SELLER: 1 active shop product (seeded) + 1 paused shop product
       + 2 inactive profile-store products = 4 listed, 3 not live,
       at least one live. Pre-fix the detail cited only the 2
       profile-store drafts. */
    await h.db.execute(sql`
      INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, status)
      VALUES (${randomUUID()}, ${SHOP_ID}, ${SELLER}, 'Paused Shop Print', 700, 'paused')`);
    for (const title of ["Draft Store Song", "Draft Store Poster"]) {
      await h.db.execute(sql`
        INSERT INTO store_products (profile_id, kind, title, price_cents, is_active)
        VALUES (${PROFILE_ID}, 'digital', ${title}, 1200, false)`);
    }
    const json = await checklistFor(SELLER);
    expect(item(json, "first-product").done).toBe(true);
    const activate = item(json, "activate");
    expect(activate.done).toBe(true);
    expect(activate.detail).toContain("3 product(s) sitting in draft.");
  });
});
