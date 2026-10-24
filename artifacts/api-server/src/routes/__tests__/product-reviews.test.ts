/**
 * Product reviews & ratings (Stack-100 #3, #14) — verified-purchase
 * social proof. Drives the REAL product-reviews router over pg-mem
 * and pins:
 *  - the verified-purchase gate on BOTH rails: store_orders
 *    status='completed' by buyer user id (refunded/held rows do not
 *    count), and shop_events event_type='sale' by buyer email
 *    ('pending_sale' rows and other buyers' emails do not count);
 *  - one review per buyer per product (409, then edit instead);
 *    author-only edit; rating/body validation; seller can never
 *    review their own product;
 *  - public list + summary math over visible reviews;
 *  - seller moderation the house way: respond works, buyer cannot
 *    respond; flagging REQUIRES an abusive-content reason (a low
 *    rating is not one); flag-without-hide leaves the review public;
 *    flag-with-hide removes it from the public list but DISCLOSES it
 *    in the summary (hiddenPendingCount), keeps it in the seller
 *    queue and the author's own view, and unflag restores it;
 *  - there is no seller delete: sellers get SELLER_CANNOT_DELETE,
 *    strangers get NOT_YOUR_REVIEW, only the author can delete.
 *
 * The product_reviews DDL below mirrors the held migration 0205
 * (.lane/MIGRATION-NEEDED.md) statement for statement.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
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

/* The shared public limiter (30/min/IP) is production abuse control,
   not behavior under test — the established suite pattern mocks it to
   a pass-through so a long suite doesn't 429 itself mid-assertion. */
vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import productReviewsRouter from "../product-reviews";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE profiles (
  id uuid PRIMARY KEY, display_name text, email text
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL
);
CREATE TABLE store_products (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL
, affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer, media_alt_texts jsonb NOT NULL DEFAULT '[]', gift_card_denominations_cents jsonb, bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL DEFAULT '', product_kind text NOT NULL DEFAULT 'digital',
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shops (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL
);
CREATE TABLE shop_products (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL, name text NOT NULL
, affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer, image_alt_text text);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL, user_id uuid NOT NULL, event_type text NOT NULL,
  product_id uuid, amount_cents integer NOT NULL DEFAULT 0,
  buyer_email text, payment_status text,
  created_at timestamptz NOT NULL DEFAULT now()
, affiliate_code text, bump_for_product_id uuid);
CREATE TABLE product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type TEXT NOT NULL,
  product_id UUID NOT NULL,
  product_title TEXT NOT NULL DEFAULT '',
  seller_user_id UUID NOT NULL,
  profile_id UUID,
  shop_id UUID,
  buyer_user_id UUID NOT NULL,
  rating INTEGER NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  purchase_source TEXT NOT NULL,
  purchase_id UUID NOT NULL,
  seller_response TEXT,
  seller_responded_at TIMESTAMPTZ,
  moderation_status TEXT NOT NULL DEFAULT 'visible',
  flag_reason TEXT,
  flag_note TEXT,
  flagged_by_user_id UUID,
  flagged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (product_type IN ('store_product','shop_product')),
  CHECK (rating BETWEEN 1 AND 5),
  CHECK (purchase_source IN ('store_orders','shop_events')),
  CHECK (moderation_status IN ('visible','hidden_pending_review')),
  CHECK (flag_reason IS NULL OR flag_reason IN ('spam','harassment','hate_speech','profanity','sexual_content','violence','fraud','other'))
);
CREATE UNIQUE INDEX product_reviews_buyer_product_ux ON product_reviews (product_type, product_id, buyer_user_id);
CREATE INDEX product_reviews_product_idx ON product_reviews (product_type, product_id, moderation_status, created_at);
CREATE INDEX product_reviews_seller_idx ON product_reviews (seller_user_id, created_at);
`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

const SELLER = randomUUID();
const SHOP_SELLER = randomUUID();
const BUYER_A = randomUUID();
const BUYER_B = randomUUID();
const BUYER_C = randomUUID();
const STRANGER = randomUUID();
const PROFILE_ID = randomUUID();
const STORE_PRODUCT = randomUUID();
const SHOP_ID = randomUUID();
const SHOP_PRODUCT = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", productReviewsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[product-reviews test] unhandled:", err?.message ?? err);
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
  h.userId = STRANGER;
  h.userEmail = "stranger@example.com";
  await h.db.execute(sql`INSERT INTO profiles (id, display_name, email) VALUES (${BUYER_A}, 'Fan A', 'a@example.com')`);
  await h.db.execute(sql`INSERT INTO profiles (id, display_name, email) VALUES (${BUYER_B}, 'Fan B', 'b@example.com')`);
  await h.db.execute(sql`INSERT INTO profiles (id, display_name, email) VALUES (${SELLER}, 'Seller Sam', 'seller@example.com')`);
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${SELLER}, 'seller-sam', 'Seller Sam')`);
  await h.db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title) VALUES (${STORE_PRODUCT}, ${PROFILE_ID}, 'digital', 'Beat Pack Deluxe')`);
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${SHOP_ID}, ${SHOP_SELLER}, 'Sam''s Shop', 'sams-shop')`);
  await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name) VALUES (${SHOP_PRODUCT}, ${SHOP_ID}, ${SHOP_SELLER}, 'Gold Chain Print')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

function as(userId: string, email: string) {
  h.userId = userId;
  h.userEmail = email;
}

async function seedStoreOrder(buyer: string, status = "completed") {
  /* Explicit ids: pg-mem evaluates a repeated prepared statement's
     gen_random_uuid() default once, so seeded rows must bring their
     own ids (the same reason the route mints review ids app-side). */
  await h.db.execute(sql`
    INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id, product_title, amount_cents, status)
    VALUES (${randomUUID()}, ${buyer}, ${PROFILE_ID}, ${STORE_PRODUCT}, 'Beat Pack Deluxe', 2000, ${status})
  `);
}

async function seedShopEvent(email: string | null, eventType = "sale") {
  await h.db.execute(sql`
    INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, buyer_email, payment_status)
    VALUES (${randomUUID()}, ${SHOP_ID}, ${SHOP_SELLER}, ${eventType}, ${SHOP_PRODUCT}, 5000, ${email}, ${eventType === "sale" ? "paid" : "pending"})
  `);
}

async function createStoreReview(buyer: string, email: string, rating: number, body = "Solid product.") {
  as(buyer, email);
  return req("POST", "/product-reviews", {
    productType: "store_product", productId: STORE_PRODUCT, rating, body,
  });
}

/* ══ The verified-purchase gate — store rail ═══════════════════════ */
describe("verified-purchase gate — store_products / store_orders", () => {
  it("refuses a signed-in user with no purchase at all", async () => {
    const r = await createStoreReview(BUYER_A, "a@example.com", 5);
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("NOT_VERIFIED_PURCHASE");
  });

  it("refuses refunded and booking-held orders — only 'completed' counts", async () => {
    await seedStoreOrder(BUYER_A, "refunded");
    expect((await createStoreReview(BUYER_A, "a@example.com", 5)).status).toBe(403);
    await h.db.execute(sql`DELETE FROM store_orders`);
    await seedStoreOrder(BUYER_A, "booking_held");
    expect((await createStoreReview(BUYER_A, "a@example.com", 5)).status).toBe(403);
  });

  it("a completed order opens the gate and the review records its proof", async () => {
    await seedStoreOrder(BUYER_A);
    const r = await createStoreReview(BUYER_A, "a@example.com", 5, "Instant delivery, exactly as described.");
    expect(r.status).toBe(201);
    expect(r.json.review.verifiedPurchase).toBe(true);
    expect(r.json.review.purchaseSource).toBe("store_orders");
    expect(r.json.review.rating).toBe(5);
    expect(r.json.review.buyer.displayName).toBe("Fan A");
    expect(r.json.review.productTitle).toBe("Beat Pack Deluxe");
  });

  it("an order for a DIFFERENT product does not open this product's gate", async () => {
    await h.db.execute(sql`
      INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id, product_title, amount_cents, status)
      VALUES (${randomUUID()}, ${BUYER_A}, ${PROFILE_ID}, ${randomUUID()}, 'Other', 100, 'completed')
    `);
    expect((await createStoreReview(BUYER_A, "a@example.com", 5)).status).toBe(403);
  });

  it("the seller can never review their own product", async () => {
    await seedStoreOrder(SELLER);
    const r = await createStoreReview(SELLER, "seller@example.com", 5);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("CANNOT_REVIEW_OWN_PRODUCT");
  });

  it("validates rating and body before anything else", async () => {
    await seedStoreOrder(BUYER_A);
    for (const rating of [0, 6, 3.5]) {
      expect((await createStoreReview(BUYER_A, "a@example.com", rating)).status).toBe(400);
    }
    as(BUYER_A, "a@example.com");
    expect((await req("POST", "/product-reviews", {
      productType: "store_product", productId: STORE_PRODUCT, rating: 4, body: "   ",
    })).status).toBe(400);
  });

  it("404s an unknown product", async () => {
    as(BUYER_A, "a@example.com");
    const r = await req("POST", "/product-reviews", {
      productType: "store_product", productId: randomUUID(), rating: 4, body: "Hi.",
    });
    expect(r.status).toBe(404);
  });
});

/* ══ The verified-purchase gate — shop rail ════════════════════════ */
describe("verified-purchase gate — shop_products / shop_events", () => {
  it("refuses when there is only a pending_sale (never paid)", async () => {
    await seedShopEvent("a@example.com", "pending_sale");
    as(BUYER_A, "a@example.com");
    const r = await req("POST", "/product-reviews", {
      productType: "shop_product", productId: SHOP_PRODUCT, rating: 5, body: "Great print.",
    });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("NOT_VERIFIED_PURCHASE");
  });

  it("refuses when the sale's buyer email belongs to someone else", async () => {
    await seedShopEvent("someone-else@example.com", "sale");
    as(BUYER_A, "a@example.com");
    const r = await req("POST", "/product-reviews", {
      productType: "shop_product", productId: SHOP_PRODUCT, rating: 5, body: "Great print.",
    });
    expect(r.status).toBe(403);
  });

  it("a 'sale' row whose buyer email matches the account email opens the gate (case-insensitive)", async () => {
    await seedShopEvent("A@Example.com", "sale");
    as(BUYER_A, "a@example.com");
    const r = await req("POST", "/product-reviews", {
      productType: "shop_product", productId: SHOP_PRODUCT, rating: 4, body: "Great print, fast shipping.",
    });
    expect(r.status).toBe(201);
    expect(r.json.review.purchaseSource).toBe("shop_events");
    expect(r.json.review.verifiedPurchase).toBe(true);
  });

  it("a view event is not a purchase", async () => {
    await seedShopEvent("a@example.com", "view");
    as(BUYER_A, "a@example.com");
    const r = await req("POST", "/product-reviews", {
      productType: "shop_product", productId: SHOP_PRODUCT, rating: 5, body: "Saw it.",
    });
    expect(r.status).toBe(403);
  });
});

/* ══ One per buyer, author edit, summary ═══════════════════════════ */
describe("one review per buyer per product + author edit + summary", () => {
  beforeEach(async () => {
    await seedStoreOrder(BUYER_A);
    await seedStoreOrder(BUYER_B);
    await seedStoreOrder(BUYER_C);
  });

  it("a second create from the same buyer is a 409 pointing at the edit path", async () => {
    expect((await createStoreReview(BUYER_A, "a@example.com", 5)).status).toBe(201);
    const dup = await createStoreReview(BUYER_A, "a@example.com", 1, "Changed my mind, awful.");
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe("ALREADY_REVIEWED");
    expect(dup.json.reviewId).toBeTruthy();
  });

  it("the author can edit rating and body; nobody else can", async () => {
    const created = await createStoreReview(BUYER_A, "a@example.com", 2, "Meh at first.");
    const id = created.json.review.id;
    as(BUYER_B, "b@example.com");
    expect((await req("PATCH", `/product-reviews/${id}`, { rating: 5 })).status).toBe(403);
    as(SELLER, "seller@example.com");
    expect((await req("PATCH", `/product-reviews/${id}`, { rating: 5 })).status).toBe(403);
    as(BUYER_A, "a@example.com");
    const edited = await req("PATCH", `/product-reviews/${id}`, { rating: 4, body: "Grew on me — updated." });
    expect(edited.status).toBe(200);
    expect(edited.json.review.rating).toBe(4);
    expect(edited.json.review.body).toContain("Grew on me");
  });

  it("public list + summary: visible reviews, honest average and distribution", async () => {
    await createStoreReview(BUYER_A, "a@example.com", 5);
    await createStoreReview(BUYER_B, "b@example.com", 4);
    await createStoreReview(BUYER_C, "c@example.com", 1);
    const r = await req("GET", `/product-reviews?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(r.status).toBe(200);
    expect(r.json.reviews).toHaveLength(3);
    expect(r.json.summary.count).toBe(3);
    expect(r.json.summary.totalCount).toBe(3);
    expect(r.json.summary.average).toBe(3.3);
    expect(r.json.summary.distribution).toEqual({ "1": 1, "2": 0, "3": 0, "4": 1, "5": 1 });
    expect(r.json.summary.hiddenPendingCount).toBe(0);
    expect(r.json.reviews.every((x: any) => x.verifiedPurchase === true)).toBe(true);

    const s = await req("GET", `/product-reviews/summary?productType=shop_product&productId=${SHOP_PRODUCT}`);
    expect(s.json.summary).toMatchObject({ count: 0, average: null, hiddenPendingCount: 0 });
  });

  it("eligibility walks a buyer through the states honestly", async () => {
    as(BUYER_A, "a@example.com");
    const before = await req("GET", `/product-reviews/eligibility?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(before.json).toMatchObject({ eligible: true, reason: null });
    await createStoreReview(BUYER_A, "a@example.com", 5);
    as(BUYER_A, "a@example.com");
    const after = await req("GET", `/product-reviews/eligibility?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(after.json.eligible).toBe(false);
    expect(after.json.reason).toBe("already_reviewed");
    expect(after.json.review.rating).toBe(5);
    as(STRANGER, "stranger@example.com");
    const none = await req("GET", `/product-reviews/eligibility?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(none.json).toMatchObject({ eligible: false, reason: "no_completed_purchase" });
    as(SELLER, "seller@example.com");
    const own = await req("GET", `/product-reviews/eligibility?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(own.json).toMatchObject({ eligible: false, reason: "own_product" });
  });

  it("rejects a malformed public query", async () => {
    expect((await req("GET", "/product-reviews")).status).toBe(400);
    expect((await req("GET", `/product-reviews?productType=bogus&productId=${STORE_PRODUCT}`)).status).toBe(400);
  });
});

/* ══ Seller moderation: respond, flag/hide, never delete ════════════ */
describe("seller moderation — respond, flag/hide with disclosure, no delete", () => {
  let reviewId = "";
  beforeEach(async () => {
    await seedStoreOrder(BUYER_A);
    await seedStoreOrder(BUYER_B);
    const created = await createStoreReview(BUYER_A, "a@example.com", 1, "Honestly? Not for me.");
    reviewId = created.json.review.id;
    await createStoreReview(BUYER_B, "b@example.com", 5, "Loved it.");
  });

  it("the seller can respond and the response shows publicly; a buyer cannot respond", async () => {
    as(BUYER_B, "b@example.com");
    expect((await req("POST", `/product-reviews/${reviewId}/respond`, { response: "Sorry!" })).status).toBe(403);
    as(SELLER, "seller@example.com");
    const r = await req("POST", `/product-reviews/${reviewId}/respond`, { response: "Thanks for the honest take — v2 fixes this." });
    expect(r.status).toBe(200);
    expect(r.json.review.sellerResponse).toContain("honest take");
    const pub = await req("GET", `/product-reviews?productType=store_product&productId=${STORE_PRODUCT}`);
    const withResponse = pub.json.reviews.find((x: any) => x.id === reviewId);
    expect(withResponse.sellerResponse).toContain("honest take");
    /* The seller can withdraw their OWN words — never the review. */
    as(SELLER, "seller@example.com");
    const cleared = await req("POST", `/product-reviews/${reviewId}/respond`, { response: null });
    expect(cleared.json.review.sellerResponse).toBeNull();
  });

  it("flagging demands an abusive-content reason — 'negative' is not one", async () => {
    as(SELLER, "seller@example.com");
    const bad = await req("POST", `/product-reviews/${reviewId}/flag`, { reason: "negative", hide: true });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("INVALID_FLAG_REASON");
    const bad2 = await req("POST", `/product-reviews/${reviewId}/flag`, { reason: "unfair", hide: true });
    expect(bad2.status).toBe(400);
    /* And the review is untouched in public either way. */
    const pub = await req("GET", `/product-reviews?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(pub.json.reviews.some((x: any) => x.id === reviewId)).toBe(true);
  });

  it("a flag WITHOUT hide keeps the review public and records the flag", async () => {
    as(SELLER, "seller@example.com");
    const r = await req("POST", `/product-reviews/${reviewId}/flag`, { reason: "spam", note: "Looks like a bot post.", hide: false });
    expect(r.status).toBe(200);
    expect(r.json.review.moderation.status).toBe("visible");
    const pub = await req("GET", `/product-reviews?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(pub.json.reviews.some((x: any) => x.id === reviewId)).toBe(true);
    expect(pub.json.summary.hiddenPendingCount).toBe(0);
  });

  it("flag + hide: leaves the public list, is DISCLOSED in the summary, stays in seller queue and author view, unflag restores", async () => {
    as(SELLER, "seller@example.com");
    const r = await req("POST", `/product-reviews/${reviewId}/flag`, { reason: "harassment", note: "Slurs in the text.", hide: true });
    expect(r.status).toBe(200);
    expect(r.json.review.moderation.status).toBe("hidden_pending_review");
    expect(r.json.moderationNote).toContain("NOT deleted");

    const pub = await req("GET", `/product-reviews?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(pub.json.reviews.some((x: any) => x.id === reviewId)).toBe(false);
    /* Disclosure: count drops to the visible 5★ only, average follows,
       and the hidden one is counted in the open. */
    expect(pub.json.summary.count).toBe(1);
    expect(pub.json.summary.average).toBe(5);
    expect(pub.json.summary.hiddenPendingCount).toBe(1);
    expect(pub.json.summary.totalCount).toBe(2);

    as(SELLER, "seller@example.com");
    const queue = await req("GET", "/product-reviews/seller?productType=store_product");
    expect(queue.json.counts).toMatchObject({ total: 2, visible: 1, hiddenPendingReview: 1, flagged: 1 });
    const hidden = queue.json.reviews.find((x: any) => x.id === reviewId);
    expect(hidden.moderation.flagReason).toBe("harassment");
    expect(hidden.body).toContain("Not for me");

    /* The author still sees their own review and its state. */
    as(BUYER_A, "a@example.com");
    const mine = await req("GET", `/product-reviews/eligibility?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(mine.json.review.id).toBe(reviewId);
    expect(mine.json.review.moderation.status).toBe("hidden_pending_review");

    as(SELLER, "seller@example.com");
    const un = await req("POST", `/product-reviews/${reviewId}/unflag`);
    expect(un.status).toBe(200);
    expect(un.json.review.moderation.status).toBe("visible");
    const pub2 = await req("GET", `/product-reviews?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(pub2.json.reviews.some((x: any) => x.id === reviewId)).toBe(true);
    expect(pub2.json.summary.hiddenPendingCount).toBe(0);
  });

  it("only the seller can flag/unflag", async () => {
    as(BUYER_B, "b@example.com");
    expect((await req("POST", `/product-reviews/${reviewId}/flag`, { reason: "spam", hide: true })).status).toBe(403);
    expect((await req("POST", `/product-reviews/${reviewId}/unflag`)).status).toBe(403);
  });

  it("the seller CANNOT delete a review — only its author can", async () => {
    as(SELLER, "seller@example.com");
    const del = await req("DELETE", `/product-reviews/${reviewId}`);
    expect(del.status).toBe(403);
    expect(del.json.error).toBe("SELLER_CANNOT_DELETE");
    as(STRANGER, "stranger@example.com");
    expect((await req("DELETE", `/product-reviews/${reviewId}`)).status).toBe(403);
    /* Still there after both attempts. */
    const pub = await req("GET", `/product-reviews?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(pub.json.reviews.some((x: any) => x.id === reviewId)).toBe(true);
    as(BUYER_A, "a@example.com");
    expect((await req("DELETE", `/product-reviews/${reviewId}`)).status).toBe(200);
    const pub2 = await req("GET", `/product-reviews?productType=store_product&productId=${STORE_PRODUCT}`);
    expect(pub2.json.reviews.some((x: any) => x.id === reviewId)).toBe(false);
  });

  it("the seller queue is scoped to the caller — another seller sees none of it", async () => {
    as(SHOP_SELLER, "shop@example.com");
    const queue = await req("GET", "/product-reviews/seller");
    expect(queue.json.reviews).toHaveLength(0);
    expect(queue.json.counts.total).toBe(0);
  });
});
