/**
 * Creator Product Affiliates (#16) — the STOREFRONT rail end to end.
 * Drives the REAL storefront + affiliates routers over pg-mem with Stripe
 * faked at the lib/stripe-client seam, and pins:
 *  - product create/PATCH carry the creator-set affiliate setting
 *    (enabling without a rate refuses — nobody invents a %);
 *  - a fan claims a code; checkout validates it server-side (bogus or
 *    wrong-product codes refuse), and verify — driven here with sessions
 *    fabricated exactly as checkout mints them, because the base
 *    checkout's count query uses IS NOT DISTINCT FROM, which pg-mem
 *    cannot parse (pre-existing gap, see the lead-magnet suite) —
 *    records the commission owed out of the creator's cut; the fee
 *    stays 5% and the buyer's total never changes;
 *  - verify replays never record a second commission;
 *  - a bogus code refuses checkout, a self-referral records nothing;
 *  - the money desk reads the sale from both chairs.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-affiliates";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  sessions: new Map<string, any>(),
  seq: 0,
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
          create: vi.fn(async (params: any) => {
            h.seq += 1;
            const id = `cs_test_${h.seq}`;
            const session = {
              id,
              url: `https://checkout.example.com/pay/${id}`,
              payment_status: "paid",
              amount_total: Number(params.metadata?.amount_cents ?? 0),
              metadata: params.metadata,
            };
            h.sessions.set(id, session);
            return session;
          }),
          retrieve: vi.fn(async (id: string) => {
            const s = h.sessions.get(id);
            if (!s) throw new Error("no such session");
            return s;
          }),
        },
      },
    })),
  };
});

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

/* The shared 30/min public limiter is not what this suite tests — other
   suites keep the real one; here it's a pass-through so a slow,
   contended box can't 429 the flows under test. */
vi.mock("../../lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, publicApiLimiter: (_req: any, _res: any, next: any) => next() };
});

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  isStorageRef: vi.fn(() => false),
}));

import storefrontRouter from "../storefront";
import affiliatesRouter from "../affiliates";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE profiles (id uuid PRIMARY KEY, email text, plan text);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE events (id uuid PRIMARY KEY, title text, rsvp_count integer NOT NULL DEFAULT 0);
CREATE TABLE store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', price_cents integer NOT NULL,
  compare_at_cents integer, inventory integer NOT NULL DEFAULT -1,
  media_urls jsonb NOT NULL DEFAULT '[]', service_details jsonb,
  event_id uuid, related_links jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (price_cents >= 0)
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL DEFAULT '', product_kind text NOT NULL DEFAULT 'digital',
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL,
  discount_code text, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed',
  fulfillment_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_orders_session_ux ON store_orders (stripe_session_id);
CREATE TABLE store_delivery_tokens (
  token text PRIMARY KEY, order_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL, code text NOT NULL,
  percent_off integer NOT NULL, max_uses integer NOT NULL DEFAULT -1, used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), list_id uuid NOT NULL, email text NOT NULL,
  name text, source text NOT NULL DEFAULT 'landing', confirmed boolean NOT NULL DEFAULT true,
  opens integer NOT NULL DEFAULT 0, unsubscribed_at timestamptz,
  subscribed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE event_rsvps (event_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (event_id, user_id));
CREATE TABLE affiliate_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL, affiliate_user_id uuid NOT NULL, seller_user_id uuid NOT NULL,
  surface text NOT NULL, product_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX affiliate_codes_code_ux ON affiliate_codes (UPPER(code));
CREATE UNIQUE INDEX affiliate_codes_affiliate_product_ux ON affiliate_codes (affiliate_user_id, surface, product_id);
CREATE TABLE affiliate_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code_id uuid NOT NULL, affiliate_user_id uuid NOT NULL, seller_user_id uuid NOT NULL,
  surface text NOT NULL, product_id uuid, product_title text NOT NULL DEFAULT '',
  order_ref text NOT NULL, buyer_user_id uuid, buyer_email text,
  gross_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  seller_net_cents integer NOT NULL DEFAULT 0, commission_bps integer NOT NULL,
  commission_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'owed',
  created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz
);
CREATE UNIQUE INDEX affiliate_sales_once_ux ON affiliate_sales (surface, order_ref, product_id);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const CREATOR = randomUUID();
const FAN = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use("/api", affiliatesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[affiliates-storefront] unhandled route error:", err?.message ?? err);
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
  h.userId = CREATOR;
  h.userEmail = "creator@example.com";
  h.sessions = new Map();
  h.seq = 0;
  await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
  await db.execute(sql`INSERT INTO profiles (id, email) VALUES (${CREATOR}, 'creator@example.com'), (${FAN}, 'fan@example.com'), (${BUYER}, 'buyer@example.com')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function seedAffiliateProduct() {
  h.userId = CREATOR;
  const r = await req("POST", "/storefront/products", {
    kind: "digital", title: "Full Album", description: "", priceCents: 10000,
    mediaUrls: ["https://cdn.example.com/album.zip"],
    affiliateEnabled: true, affiliateCommissionBps: 1000,
  });
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

async function fanClaimsCode(productId: string) {
  h.userId = FAN;
  const r = await req("POST", "/affiliates/codes", { surface: "store_product", productId });
  expect(r.status).toBe(201);
  return r.json.code.code as string;
}

/* The paid checkout's idempotency count query uses IS NOT DISTINCT FROM,
   which pg-mem cannot parse at all — a PRE-EXISTING engine gap in the
   base checkout, documented by the lead-magnet suite and untouched by
   this lane (session creation is pinned by staging E2E). So the sale
   half of this suite drives VERIFY with a session fabricated EXACTLY as
   checkout mints it (same metadata keys checkout writes, affiliate_code
   included) — verify is where the order and the commission record. */
function fabricatePaidSession(args: { productId: string; buyer: string; affiliateCode?: string }) {
  h.seq += 1;
  const id = `cs_test_${h.seq}`;
  h.sessions.set(id, {
    id,
    url: `https://checkout.example.com/pay/${id}`,
    payment_status: "paid",
    amount_total: 10000,
    metadata: {
      type: "storefront_purchase",
      buyer_user_id: args.buyer,
      profile_id: PROFILE_ID,
      product_id: args.productId,
      product_kind: "digital",
      quantity: "1",
      discount_code: "",
      affiliate_code: args.affiliateCode ?? "",
      amount_cents: "10000",
      platform_fee_cents: "500",
      creator_amount_cents: "9500",
      event_id: "",
    },
  });
  return id;
}

async function verifyAs(buyer: string, sessionId: string) {
  h.userId = buyer;
  const v = await req("POST", "/storefront/verify", { sessionId });
  expect(v.status).toBe(200);
  return v.json;
}

async function affiliateSaleRows() {
  const r = await h.db.execute(sql`SELECT * FROM affiliate_sales`);
  return r.rows as any[];
}

describe("product affiliate settings (creator-set, docked in product CRUD)", () => {
  it("creates a product with affiliates on and presents the setting", async () => {
    const id = await seedAffiliateProduct();
    h.userId = CREATOR;
    const r = await req("GET", `/storefront/product/${id}`);
    expect(r.status).toBe(200);
    expect(r.json.product.affiliatesEnabled).toBe(true);
    expect(r.json.product.affiliateCommissionBps).toBe(1000);
    expect(r.json.product.affiliateCommissionPct).toBe("10%");
  });

  it("refuses to enable affiliates without a creator-set rate", async () => {
    h.userId = CREATOR;
    const r = await req("POST", "/storefront/products", {
      kind: "digital", title: "No Rate", description: "", priceCents: 500, affiliateEnabled: true,
    });
    expect(r.status).toBe(400);
  });

  it("PATCH turns affiliates on/off and changes the rate", async () => {
    h.userId = CREATOR;
    const c = await req("POST", "/storefront/products", {
      kind: "digital", title: "Plain", description: "", priceCents: 500,
    });
    const id = c.json.product.id;
    const on = await req("PATCH", `/storefront/products/${id}`, { affiliateEnabled: true });
    expect(on.status).toBe(400); // no rate stored yet
    const onWithRate = await req("PATCH", `/storefront/products/${id}`, { affiliateEnabled: true, affiliateCommissionBps: 1500 });
    expect(onWithRate.status).toBe(200);
    expect(onWithRate.json.product.affiliatesEnabled).toBe(true);
    expect(onWithRate.json.product.affiliateCommissionBps).toBe(1500);
    const off = await req("PATCH", `/storefront/products/${id}`, { affiliateEnabled: false });
    expect(off.json.product.affiliatesEnabled).toBe(false);
  });
});

describe("checkout-side code validation (runs before the pg-mem-blind count query)", () => {
  it("a bogus code refuses checkout with BAD_AFFILIATE_CODE", async () => {
    const productId = await seedAffiliateProduct();
    h.userId = BUYER;
    const bad = await req("POST", "/storefront/checkout", { productId, quantity: 1, affiliateCode: "AFF-NOPE" });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("BAD_AFFILIATE_CODE");
  });

  it("a code for a DIFFERENT product refuses checkout", async () => {
    const productId = await seedAffiliateProduct();
    h.userId = CREATOR;
    const other = await req("POST", "/storefront/products", {
      kind: "digital", title: "Other", description: "", priceCents: 5000,
      affiliateEnabled: true, affiliateCommissionBps: 1000,
    });
    const code = await fanClaimsCode(other.json.product.id);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, affiliateCode: code });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BAD_AFFILIATE_CODE");
  });

  it("a valid code passes validation (the flow continues into the pre-existing checkout machinery)", async () => {
    const productId = await seedAffiliateProduct();
    const code = await fanClaimsCode(productId);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, affiliateCode: code });
    /* Not BAD_AFFILIATE_CODE: validation passed. The 500 beyond this
       point is pg-mem failing the base checkout's IS NOT DISTINCT FROM
       count query — the documented pre-existing gap (lead-magnet suite),
       not this lane's code. */
    expect(r.json?.error).not.toBe("BAD_AFFILIATE_CODE");
  });
});

describe("sale through an affiliate link (verify records the order)", () => {
  it("records the commission owed out of the creator's cut — fee and buyer total untouched", async () => {
    const productId = await seedAffiliateProduct();
    const code = await fanClaimsCode(productId);
    const sessionId = fabricatePaidSession({ productId, buyer: BUYER, affiliateCode: code });
    const verify = await verifyAs(BUYER, sessionId);
    /* $100 sale: 5% fee = $5, creator cut $95, fan commission 10% of $95 = $9.50 */
    expect(verify.order.amountCents).toBe(10000);
    expect(verify.order.platformFeeCents).toBe(500);
    expect(verify.order.creatorAmountCents).toBe(9500);
    expect(verify.order.affiliate).toEqual({ code, commissionRecorded: true, commissionCents: 950 });
    const rows = await affiliateSaleRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].commission_cents)).toBe(950);
    expect(rows[0].status).toBe("owed");
    expect(String(rows[0].affiliate_user_id)).toBe(FAN);
    expect(String(rows[0].seller_user_id)).toBe(CREATOR);
  });

  it("verify replays never record a second commission", async () => {
    const productId = await seedAffiliateProduct();
    const code = await fanClaimsCode(productId);
    const sessionId = fabricatePaidSession({ productId, buyer: BUYER, affiliateCode: code });
    await verifyAs(BUYER, sessionId);
    const replay = await verifyAs(BUYER, sessionId);
    expect(replay.duplicate).toBe(true);
    expect(await affiliateSaleRows()).toHaveLength(1);
  });

  it("a sale with no code records nothing", async () => {
    const productId = await seedAffiliateProduct();
    const sessionId = fabricatePaidSession({ productId, buyer: BUYER });
    const verify = await verifyAs(BUYER, sessionId);
    expect(verify.order.affiliate).toBeNull();
    expect(await affiliateSaleRows()).toHaveLength(0);
  });

  it("self-referral: the affiliate buying through their own link earns nothing", async () => {
    const productId = await seedAffiliateProduct();
    const code = await fanClaimsCode(productId);
    const sessionId = fabricatePaidSession({ productId, buyer: FAN, affiliateCode: code });
    const verify = await verifyAs(FAN, sessionId);
    expect(verify.order.affiliate.commissionRecorded).toBe(false);
    expect(await affiliateSaleRows()).toHaveLength(0);
  });
});

describe("money desk + public resolve", () => {
  it("desk shows the sale from the seller's chair and the fan's chair", async () => {
    const productId = await seedAffiliateProduct();
    const code = await fanClaimsCode(productId);
    const sessionId = fabricatePaidSession({ productId, buyer: BUYER, affiliateCode: code });
    await verifyAs(BUYER, sessionId);

    h.userId = CREATOR;
    const sellerDesk = await req("GET", "/affiliates/desk");
    expect(sellerDesk.status).toBe(200);
    expect(sellerDesk.json.asSeller.totals).toMatchObject({ salesCount: 1, owedCents: 950, paidCents: 0 });
    expect(sellerDesk.json.asSeller.affiliates[0].affiliateUserId).toBe(FAN);
    expect(sellerDesk.json.recentSales[0].mine).toBe("owed");

    h.userId = FAN;
    const fanDesk = await req("GET", "/affiliates/desk");
    expect(fanDesk.json.asAffiliate.totals).toMatchObject({ salesCount: 1, owedCents: 950, paidCents: 0 });
    expect(fanDesk.json.asAffiliate.products[0].productTitle).toBe("Full Album");
    expect(fanDesk.json.recentSales[0].mine).toBe("earned");

    const mine = await req("GET", "/affiliates/codes/mine");
    expect(mine.json.codes).toHaveLength(1);
    expect(mine.json.codes[0].shareLink).toContain(`?ref=${code}`);
    expect(mine.json.codes[0].salesCount).toBe(1);
    expect(mine.json.codes[0].owedCents).toBe(950);
  });

  it("resolve shows what a share link points at; unknown codes 404", async () => {
    const productId = await seedAffiliateProduct();
    const code = await fanClaimsCode(productId);
    const ok = await req("GET", `/affiliates/resolve/${code}`);
    expect(ok.status).toBe(200);
    expect(ok.json.productTitle).toBe("Full Album");
    expect(ok.json.commissionPct).toBe("10%");
    expect(ok.json.productPath).toBe(`/storefront/product/${productId}`);
    const bad = await req("GET", "/affiliates/resolve/AFF-WHATEVER");
    expect(bad.status).toBe(404);
  });

  it("offers list the product for other fans, never for its own seller", async () => {
    await seedAffiliateProduct();
    h.userId = FAN;
    const fanOffers = await req("GET", "/affiliates/offers");
    expect(fanOffers.json.offers).toHaveLength(1);
    expect(fanOffers.json.offers[0].commissionPct).toBe("10%");
    h.userId = CREATOR;
    const ownOffers = await req("GET", "/affiliates/offers");
    expect(ownOffers.json.offers).toHaveLength(0);
  });
});
