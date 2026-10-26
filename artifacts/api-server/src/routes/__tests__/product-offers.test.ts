/**
 * Make-an-offer (Wave 4 #43) — drives the REAL offers router plus BOTH
 * existing checkout routers (storefront + shops) over pg-mem and pins:
 *  - the negotiation state machine: create → seller accept / decline /
 *    counter; buyer accept / decline / counter a counter; withdraw;
 *    role + status table enforced (a third party 403s, a seller cannot
 *    answer their own counter, settled offers refuse every move);
 *  - the price law: offers are 1..list-1; counters narrow strictly
 *    between the answered amount and list; one open offer per
 *    (buyer, product); own product / unknown / unavailable refused;
 *  - expiry: a stale open offer flips to 'expired' on read;
 *  - checkout integration: an accepted offer prices the EXISTING
 *    storefront checkout at the agreed amount (flat-5% fee split on
 *    that gross); verify records the order at the agreed amount on the
 *    untouched store_orders rail and consumes the offer exactly once;
 *    combos refuse; a pending offer, another buyer's offer, and a
 *    claimed offer all refuse with no session created;
 *  - the shops rail the same way: single-item offer cart at the agreed
 *    amount; the shared paid flip records the sale and consumes it.
 *
 * Hand-computed money: store product list 5000¢, agreed 3000¢ → fee
 * 150¢ (flat 5%), creator 2850¢. Shop product list 8000¢, agreed
 * 6000¢ → fee 300¢, seller net 5700¢.
 *
 * The product_offers DDL below mirrors migration 9999-wave4346.
 */
process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-product-offers";

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<any>,
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

/* Storefront rail seam: createGuardedStripeClient. */
vi.mock("../../lib/stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: vi.fn(() => ({
      checkout: {
        sessions: {
          create: vi.fn(async (params: any) => {
            const id = `cs_test_${h.stripeCreates.length + 1}`;
            h.stripeCreates.push(params);
            const amount_total = (params.line_items as Array<any>).reduce(
              (sum: number, li: any) => sum + li.price_data.unit_amount * (li.quantity ?? 1),
              0,
            );
            h.sessions.set(id, { id, payment_status: "paid", amount_total, metadata: params.metadata });
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

/* Shops rail seam: lib/stripe-checkout. */
vi.mock("../../lib/stripe-checkout", () => ({
  getCheckoutStripe: () => ({
    checkout: {
      sessions: {
        create: async (params: any, options: any) => {
          const id = `cs_test_${h.stripeCreates.length + 1}`;
          h.stripeCreates.push({ params, options });
          const amount_total = (params.line_items as Array<any>).reduce(
            (sum: number, li: any) => sum + li.price_data.unit_amount * (li.quantity ?? 1),
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

import offersRouter from "../product-offers";
import storefrontRouter from "../storefront";
import shopsRouter from "../generate/shops";
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
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL DEFAULT '', product_kind text NOT NULL DEFAULT 'digital',
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL,
  discount_code text, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text UNIQUE, status text NOT NULL DEFAULT 'completed',
  fulfillment_note text,
  bump_product_id uuid, bump_title text,
  bump_amount_cents integer, bump_platform_fee_cents integer, bump_creator_amount_cents integer,
  parent_order_id uuid, stripe_payment_intent_id text UNIQUE,
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
CREATE TABLE product_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL,
  seller_user_id uuid NOT NULL,
  item_kind text NOT NULL,
  item_id uuid NOT NULL,
  profile_id uuid,
  shop_id uuid,
  list_price_cents integer NOT NULL,
  offer_amount_cents integer NOT NULL,
  counter_amount_cents integer,
  agreed_amount_cents integer,
  status text NOT NULL DEFAULT 'pending',
  message text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  claimed_ref text,
  claimed_at timestamptz,
  consumed_ref text,
  consumed_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_offers_item_kind_check CHECK (item_kind IN ('store_product', 'shop_product')),
  CONSTRAINT product_offers_status_check CHECK (status IN ('pending', 'countered', 'accepted', 'declined', 'withdrawn', 'expired', 'consumed')),
  CONSTRAINT product_offers_list_nonneg CHECK (list_price_cents > 0),
  CONSTRAINT product_offers_amount_range CHECK (offer_amount_cents > 0 AND offer_amount_cents < list_price_cents),
  CONSTRAINT product_offers_counter_range CHECK (counter_amount_cents IS NULL OR (counter_amount_cents > offer_amount_cents AND counter_amount_cents < list_price_cents)),
  CONSTRAINT product_offers_agreed_range CHECK (agreed_amount_cents IS NULL OR (agreed_amount_cents > 0 AND agreed_amount_cents < list_price_cents))
);
CREATE INDEX product_offers_buyer_idx ON product_offers (buyer_user_id);
CREATE INDEX product_offers_seller_idx ON product_offers (seller_user_id);
CREATE INDEX product_offers_item_idx ON product_offers (item_kind, item_id);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const BUYER = randomUUID();
const BUYER_B = randomUUID();
const SELLER = randomUUID();
const PROFILE_ID = randomUUID();
const STORE_PRODUCT = randomUUID();
const INACTIVE_PRODUCT = randomUUID();
const SHOP_SELLER = randomUUID();
const SHOP_ID = randomUUID();
const SHOP_PRODUCT = randomUUID();
const SHOP_PRODUCT_B = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", offersRouter);
  app.use("/api", storefrontRouter);
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[product-offers test] unhandled:", err?.message ?? err);
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
  h.userId = BUYER;
  h.userEmail = "buyer@example.com";
  h.stripeCreates = [];
  h.sessions = new Map();
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${SELLER}, 'seller-sam', 'Seller Sam')`);
  await h.db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents, media_urls) VALUES (${STORE_PRODUCT}, ${PROFILE_ID}, 'digital', 'Beat Pack Deluxe', 5000, ${JSON.stringify(["https://cdn.example.com/pack.zip"])}::jsonb)`);
  await h.db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents, is_active, media_urls) VALUES (${INACTIVE_PRODUCT}, ${PROFILE_ID}, 'digital', 'Retired Pack', 3000, false, ${JSON.stringify([])}::jsonb)`);
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${SHOP_ID}, ${SHOP_SELLER}, 'Sam''s Shop', 'sams-shop')`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${SHOP_PRODUCT}, ${SHOP_ID}, ${SHOP_SELLER}, 'Gold Chain Print', 8000)`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents) VALUES (${SHOP_PRODUCT_B}, ${SHOP_ID}, ${SHOP_SELLER}, 'Second Print', 4000)`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

function as(userId: string) { h.userId = userId; }

async function makeOffer(amountCents = 3000, itemKind = "store_product", itemId: string = STORE_PRODUCT) {
  as(BUYER);
  return req("POST", "/product-offers", { itemKind, itemId, amountCents });
}

async function offerRow(id: string) {
  const r = await h.db.execute(sql`SELECT * FROM product_offers WHERE id = ${id}::uuid`);
  return r.rows[0] as Record<string, unknown> | undefined;
}

/** Buyer offers 3000 on the store product; seller accepts. */
async function acceptedStoreOffer(): Promise<string> {
  const created = await makeOffer(3000);
  expect(created.status).toBe(201);
  const id = created.json.offer.id as string;
  as(SELLER);
  const accepted = await req("POST", `/product-offers/${id}/act`, { action: "accept" });
  expect(accepted.status).toBe(200);
  expect(accepted.json.offer.status).toBe("accepted");
  expect(Number(accepted.json.offer.agreed_amount_cents)).toBe(3000);
  return id;
}

describe("negotiation — create + price law", () => {
  it("creates a pending offer with the list snapshot and notifies the seller", async () => {
    const res = await makeOffer(3000);
    expect(res.status).toBe(201);
    expect(res.json.offer.status).toBe("pending");
    expect(Number(res.json.offer.list_price_cents)).toBe(5000);
    expect(Number(res.json.offer.offer_amount_cents)).toBe(3000);
    expect(res.json.offer.seller_user_id).toBe(SELLER);

    const notes = await h.db.execute(sql`SELECT kind FROM notifications WHERE user_id = ${SELLER}::uuid`);
    expect(notes.rows.map((r: any) => r.kind)).toContain("product_offer_received");

    const mine = await req("GET", "/product-offers/mine");
    expect(mine.json.offers).toHaveLength(1);
    expect(mine.json.offers[0].title).toBe("Beat Pack Deluxe");
    expect(mine.json.offers[0].currentPriceCents).toBe(3000);

    as(SELLER);
    expect((await req("GET", "/product-offers/received")).json.offers).toHaveLength(1);
    as(BUYER_B);
    expect((await req("GET", "/product-offers/received")).json.offers).toHaveLength(0);
    expect((await req("GET", "/product-offers/mine")).json.offers).toHaveLength(0);
  });

  it("refuses bad amounts, own products, unknown and unavailable products", async () => {
    expect((await makeOffer(0)).status).toBe(400);
    expect((await makeOffer(-100)).status).toBe(400);
    expect((await makeOffer(5000)).status).toBe(400);
    expect((await makeOffer(6000)).status).toBe(400);
    expect((await req("POST", "/product-offers", { itemKind: "store_product", itemId: STORE_PRODUCT, amountCents: 30.5 })).status).toBe(400);
    expect((await req("POST", "/product-offers", { itemKind: "store_product", itemId: randomUUID(), amountCents: 100 })).status).toBe(404);
    expect((await makeOffer(100, "store_product", INACTIVE_PRODUCT)).status).toBe(409);
    as(SELLER);
    expect((await req("POST", "/product-offers", { itemKind: "store_product", itemId: STORE_PRODUCT, amountCents: 100 })).status).toBe(409);
  });

  it("one open offer per buyer + product; a settled offer frees the slot", async () => {
    const first = await makeOffer(3000);
    expect(first.status).toBe(201);
    expect((await makeOffer(3200)).status).toBe(409);
    as(BUYER);
    const withdrawn = await req("POST", `/product-offers/${first.json.offer.id}/act`, { action: "withdraw" });
    expect(withdrawn.json.offer.status).toBe("withdrawn");
    expect((await makeOffer(3200)).status).toBe(201);
  });

  it("shop product offers resolve the shop seller", async () => {
    const res = await makeOffer(6000, "shop_product", SHOP_PRODUCT);
    expect(res.status).toBe(201);
    expect(res.json.offer.seller_user_id).toBe(SHOP_SELLER);
    expect(res.json.offer.shop_id).toBe(SHOP_ID);
    as(SHOP_SELLER);
    expect((await req("GET", "/product-offers/received")).json.offers).toHaveLength(1);
  });
});

describe("negotiation — the state machine", () => {
  it("seller counters, buyer accepts the counter at the counter price", async () => {
    const created = await makeOffer(3000);
    const id = created.json.offer.id as string;
    as(SELLER);
    const countered = await req("POST", `/product-offers/${id}/act`, { action: "counter", amountCents: 4000 });
    expect(countered.json.offer.status).toBe("countered");
    expect(Number(countered.json.offer.counter_amount_cents)).toBe(4000);

    /* The seller cannot answer their own counter. */
    expect((await req("POST", `/product-offers/${id}/act`, { action: "accept" })).status).toBe(409);

    as(BUYER);
    const accepted = await req("POST", `/product-offers/${id}/act`, { action: "accept" });
    expect(accepted.json.offer.status).toBe("accepted");
    expect(Number(accepted.json.offer.agreed_amount_cents)).toBe(4000);

    const notes = await h.db.execute(sql`SELECT kind FROM notifications WHERE user_id = ${SELLER}::uuid`);
    expect(notes.rows.map((r: any) => r.kind)).toContain("product_offer_accepted");
  });

  it("buyer counter-counters: the new price becomes the standing offer and the seller can accept it", async () => {
    const created = await makeOffer(3000);
    const id = created.json.offer.id as string;
    as(SELLER);
    await req("POST", `/product-offers/${id}/act`, { action: "counter", amountCents: 4000 });
    as(BUYER);
    /* Buyer counters narrow too: at/above the seller's counter or
       at/below their own standing offer both refuse. */
    expect((await req("POST", `/product-offers/${id}/act`, { action: "counter", amountCents: 4000 })).status).toBe(400);
    expect((await req("POST", `/product-offers/${id}/act`, { action: "counter", amountCents: 3000 })).status).toBe(400);
    const back = await req("POST", `/product-offers/${id}/act`, { action: "counter", amountCents: 3500 });
    expect(back.json.offer.status).toBe("pending");
    expect(Number(back.json.offer.offer_amount_cents)).toBe(3500);
    expect(back.json.offer.counter_amount_cents).toBeNull();
    as(SELLER);
    const accepted = await req("POST", `/product-offers/${id}/act`, { action: "accept" });
    expect(Number(accepted.json.offer.agreed_amount_cents)).toBe(3500);
  });

  it("counters must narrow: at/below the answered amount or at/above list refuses", async () => {
    const created = await makeOffer(3000);
    const id = created.json.offer.id as string;
    as(SELLER);
    expect((await req("POST", `/product-offers/${id}/act`, { action: "counter", amountCents: 3000 })).status).toBe(400);
    expect((await req("POST", `/product-offers/${id}/act`, { action: "counter", amountCents: 2500 })).status).toBe(400);
    expect((await req("POST", `/product-offers/${id}/act`, { action: "counter", amountCents: 5000 })).status).toBe(400);
    expect((await offerRow(id))!["status"]).toBe("pending");
  });

  it("decline settles the offer for everyone; a third party can never act", async () => {
    const created = await makeOffer(3000);
    const id = created.json.offer.id as string;
    as(BUYER_B);
    expect((await req("POST", `/product-offers/${id}/act`, { action: "accept" })).status).toBe(403);
    as(SELLER);
    const declined = await req("POST", `/product-offers/${id}/act`, { action: "decline" });
    expect(declined.json.offer.status).toBe("declined");
    as(BUYER);
    expect((await req("POST", `/product-offers/${id}/act`, { action: "withdraw" })).status).toBe(409);
    expect((await req("POST", `/product-offers/${randomUUID()}/act`, { action: "accept" })).status).toBe(404);
  });

  it("an expired offer flips on read and frees the buyer to offer again", async () => {
    const created = await makeOffer(3000);
    const id = created.json.offer.id as string;
    await h.db.execute(sql`UPDATE product_offers SET expires_at = now() - interval '1 hour' WHERE id = ${id}::uuid`);
    as(BUYER);
    const forItem = await req("GET", `/product-offers/for-item?itemKind=store_product&itemId=${STORE_PRODUCT}`);
    expect(forItem.json.offer).toBeNull();
    expect((await offerRow(id))!["status"]).toBe("expired");
    expect((await makeOffer(3100)).status).toBe(201);
  });
});

describe("storefront checkout — the accepted offer is the price", () => {
  it("session, totals, order and fee split all land at the agreed price; the offer is consumed once", async () => {
    const offerId = await acceptedStoreOffer();
    as(BUYER);
    const checkout = await req("POST", "/storefront/checkout", { productId: STORE_PRODUCT, offerId });
    expect(checkout.status).toBe(200);
    expect(checkout.json.totals.unitCents).toBe(3000);
    expect(checkout.json.totals.lineTotal).toBe(3000);
    expect(checkout.json.totals.platformFeeCents).toBe(150);
    expect(checkout.json.totals.creatorCents).toBe(2850);
    expect(checkout.json.offer).toMatchObject({ offerId, agreedCents: 3000 });
    const sessionId = checkout.json.sessionId as string;
    const create = h.stripeCreates[0];
    expect(create.line_items[0].price_data.unit_amount).toBe(3000);
    expect(create.metadata.offer_id).toBe(offerId);
    expect((await offerRow(offerId))!["claimed_ref"]).toBe(sessionId);

    const verify = await req("POST", "/storefront/verify", { sessionId });
    expect(verify.status).toBe(200);
    const orders = await h.db.execute(sql`SELECT amount_cents, platform_fee_cents, creator_amount_cents FROM store_orders`);
    expect(orders.rows).toHaveLength(1);
    expect(Number((orders.rows[0] as any).amount_cents)).toBe(3000);
    expect(Number((orders.rows[0] as any).platform_fee_cents)).toBe(150);
    expect(Number((orders.rows[0] as any).creator_amount_cents)).toBe(2850);
    expect((await offerRow(offerId))!["status"]).toBe("consumed");

    /* A consumed offer can never price a second checkout. */
    const again = await req("POST", "/storefront/checkout", { productId: STORE_PRODUCT, offerId });
    expect(again.status).toBe(409);
    expect(h.stripeCreates).toHaveLength(1);
  });

  it("a pending offer and another buyer's offer refuse with no session", async () => {
    const created = await makeOffer(3000);
    const pendingId = created.json.offer.id as string;
    as(BUYER);
    expect((await req("POST", "/storefront/checkout", { productId: STORE_PRODUCT, offerId: pendingId })).status).toBe(409);
    as(BUYER_B);
    expect((await req("POST", "/storefront/checkout", { productId: STORE_PRODUCT, offerId: pendingId })).status).toBe(404);
    expect(h.stripeCreates).toHaveLength(0);
  });

  it("discount-code and quantity combos with an accepted offer refuse as OFFER_EXCLUSIVE and do not burn it", async () => {
    const offerId = await acceptedStoreOffer();
    as(BUYER);
    const withCode = await req("POST", "/storefront/checkout", { productId: STORE_PRODUCT, offerId, discountCode: "SAVE10" });
    expect(withCode.status).toBe(400);
    expect(withCode.json.error).toBe("OFFER_EXCLUSIVE");
    const withQty = await req("POST", "/storefront/checkout", { productId: STORE_PRODUCT, offerId, quantity: 2 });
    expect(withQty.status).toBe(400);
    expect(h.stripeCreates).toHaveLength(0);
    expect((await offerRow(offerId))!["status"]).toBe("accepted");
    expect((await offerRow(offerId))!["claimed_ref"]).toBeNull();
  });

  it("a live checkout claim by another session refuses a second checkout", async () => {
    const offerId = await acceptedStoreOffer();
    await h.db.execute(sql`UPDATE product_offers SET claimed_ref = 'cs_other', claimed_at = now() WHERE id = ${offerId}::uuid`);
    as(BUYER);
    const res = await req("POST", "/storefront/checkout", { productId: STORE_PRODUCT, offerId });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("OFFER_CLAIMED");
    expect(h.stripeCreates).toHaveLength(0);
  });

  it("a legacy checkout without an offer is untouched (list price, no offer in metadata)", async () => {
    as(BUYER);
    const checkout = await req("POST", "/storefront/checkout", { productId: STORE_PRODUCT });
    expect(checkout.status).toBe(200);
    expect(checkout.json.totals.unitCents).toBe(5000);
    expect(checkout.json.offer).toBeNull();
    expect(h.stripeCreates[0].metadata.offer_id).toBe("");
  });
});

describe("shops checkout — the accepted offer is the price", () => {
  async function acceptedShopOffer(): Promise<string> {
    const created = await makeOffer(6000, "shop_product", SHOP_PRODUCT);
    expect(created.status).toBe(201);
    const id = created.json.offer.id as string;
    as(SHOP_SELLER);
    const accepted = await req("POST", `/product-offers/${id}/act`, { action: "accept" });
    expect(Number(accepted.json.offer.agreed_amount_cents)).toBe(6000);
    return id;
  }

  it("single-item offer cart prices at the agreed amount; verify records the sale and consumes the offer", async () => {
    const offerId = await acceptedShopOffer();
    const checkout = await req("POST", "/storefronts/checkout", {
      shopId: SHOP_ID, productId: SHOP_PRODUCT, offerId, buyerEmail: "buyer@example.com",
    });
    expect(checkout.status).toBe(201);
    expect(checkout.json.gross_cents).toBe(6000);
    expect(checkout.json.platform_fee_cents).toBe(300);
    expect(checkout.json.seller_net_cents).toBe(5700);
    expect(checkout.json.lines[0].unit_cents).toBe(6000);
    const sessionId = checkout.json.sessionId as string;
    expect((await offerRow(offerId))!["claimed_ref"]).toBeTruthy();

    const verify = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(verify.status).toBe(200);
    expect(verify.json.paid).toBe(true);
    const sales = await h.db.execute(sql`SELECT amount_cents, platform_fee_cents FROM shop_events WHERE event_type = 'sale'`);
    expect(sales.rows).toHaveLength(1);
    expect(Number((sales.rows[0] as any).amount_cents)).toBe(6000);
    expect(Number((sales.rows[0] as any).platform_fee_cents)).toBe(300);
    expect((await offerRow(offerId))!["status"]).toBe("consumed");

    const dup = await req("POST", "/storefronts/checkout/verify", { sessionId });
    expect(dup.json.duplicate).toBe(true);
    expect((await h.db.execute(sql`SELECT * FROM shop_events WHERE event_type = 'sale'`)).rows).toHaveLength(1);
  });

  it("an offer cart with a second product or a discount code refuses", async () => {
    const offerId = await acceptedShopOffer();
    const twoItems = await req("POST", "/storefronts/checkout", {
      shopId: SHOP_ID, offerId, buyerEmail: "buyer@example.com",
      items: [
        { productId: SHOP_PRODUCT, quantity: 1 },
        { productId: SHOP_PRODUCT_B, quantity: 1 },
      ],
    });
    expect(twoItems.status).toBe(400);
    expect(twoItems.json.error).toBe("OFFER_EXCLUSIVE");
    const withCode = await req("POST", "/storefronts/checkout", {
      shopId: SHOP_ID, productId: SHOP_PRODUCT, offerId, discountCode: "SAVE10", buyerEmail: "buyer@example.com",
    });
    expect(withCode.status).toBe(400);
    expect((await h.db.execute(sql`SELECT * FROM shop_events`)).rows).toHaveLength(0);
  });

  it("a pending shop offer cannot price a checkout", async () => {
    const created = await makeOffer(6000, "shop_product", SHOP_PRODUCT);
    const res = await req("POST", "/storefronts/checkout", {
      shopId: SHOP_ID, productId: SHOP_PRODUCT, offerId: created.json.offer.id, buyerEmail: "buyer@example.com",
    });
    expect(res.status).toBe(409);
    expect((await h.db.execute(sql`SELECT * FROM shop_events`)).rows).toHaveLength(0);
  });
});
