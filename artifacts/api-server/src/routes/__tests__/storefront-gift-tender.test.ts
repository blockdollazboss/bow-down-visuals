/**
 * Gift-card tender on the storefront rail (Stack-100 #3 #26).
 * Drives the REAL storefront router + REAL lib/gift-cards over pg-mem
 * (harness mirrors storefront-lead-magnet.test.ts) and pins:
 *  - a gift_card product is created with seller-set denominations and
 *    the listing price becomes the smallest denomination;
 *  - gift-card products refuse the normal product checkout (they are
 *    bought on the recipient-delivery gift-card checkout);
 *  - a card from ANOTHER store refuses (WRONG_STORE);
 *  - full tender: the order records at checkout with the fee on the
 *    FULL gross, no Stripe session exists, the card debits exactly
 *    once and keeps its remainder;
 *  - partial tender at verify: the session paid only the due amount,
 *    yet the order carries gross + full fee, and a duplicate verify
 *    debits nothing twice.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-gift-tender";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<any>,
  session: null as any,
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
            h.stripeCreates.push(params);
            return { id: `cs_test_${h.stripeCreates.length}`, url: "https://checkout.example.com/pay" };
          }),
          retrieve: vi.fn(async () => h.session),
        },
      },
    })),
  };
});

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
import { hashGiftCardCode, reserveGiftCard } from "../../lib/gift-cards";
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', price_cents integer NOT NULL,
  compare_at_cents integer, inventory integer NOT NULL DEFAULT -1,
  media_urls jsonb NOT NULL DEFAULT '[]', service_details jsonb,
  gift_card_denominations_cents jsonb,
  event_id uuid, related_links jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (price_cents >= 0)
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL, product_kind text NOT NULL,
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL,
  discount_code text, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed',
  fulfillment_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_orders_session_ux ON store_orders (stripe_session_id);
CREATE TABLE discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, code text NOT NULL, percent_off integer NOT NULL,
  max_uses integer NOT NULL DEFAULT -1, used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_delivery_tokens (
  token text PRIMARY KEY, order_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL, code_last4 text NOT NULL,
  profile_id uuid NOT NULL, product_id uuid,
  buyer_user_id uuid, recipient_email text NOT NULL,
  recipient_name text, message text,
  initial_cents integer NOT NULL, balance_cents integer NOT NULL,
  reserved_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gift_card_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id uuid NOT NULL, kind text NOT NULL,
  amount_cents integer NOT NULL, balance_after_cents integer NOT NULL,
  ref text, idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gift_card_ledger_idem_ux ON gift_card_ledger (idempotency_key);
CREATE TABLE gift_card_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id uuid NOT NULL, rail text NOT NULL, ref text NOT NULL,
  amount_cents integer NOT NULL, status text NOT NULL DEFAULT 'reserved',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gift_card_reservations_rail_ref_ux ON gift_card_reservations (rail, ref);
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
CREATE TABLE event_rsvps (
  event_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (event_id, user_id)
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const CREATOR = randomUUID();
const OTHER_CREATOR = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();
const OTHER_PROFILE_ID = randomUUID();
const CARD_CODE = "BDV-AAAA-BBBB-CCCC-DDDD";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[gift-tender] unhandled route error:", err?.message ?? err);
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
  h.stripeCreates = [];
  h.session = null;
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

async function seedPaidProduct(priceCents = 2000) {
  h.userId = CREATOR;
  const r = await req("POST", "/storefront/products", {
    kind: "digital", title: "Full Album", description: "", priceCents,
    mediaUrls: ["https://cdn.example.com/album.zip"],
  });
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

async function seedCard(balanceCents: number, profileId = PROFILE_ID) {
  const id = randomUUID();
  await h.db.execute(sql`
    INSERT INTO gift_cards (id, code_hash, code_last4, profile_id, buyer_user_id, recipient_email, initial_cents, balance_cents, status, stripe_session_id)
    VALUES (${id}, ${hashGiftCardCode(CARD_CODE)}, 'DDDD', ${profileId}, ${BUYER}, 'friend@example.com', ${balanceCents}, ${balanceCents}, 'active', ${`cs_seed_${id}`})
  `);
  return id;
}

async function cardRow(id: string) {
  const r = await h.db.execute(sql`SELECT balance_cents, reserved_cents, status FROM gift_cards WHERE id = ${id}`);
  return r.rows[0] as any;
}

describe("gift_card products: seller-set denominations", () => {
  it("creates with denominations; listing price is the smallest; payload carries the amounts", async () => {
    h.userId = CREATOR;
    const r = await req("POST", "/storefront/products", {
      kind: "gift_card", title: "Queen Gift Card", description: "", priceCents: 0,
      giftCardDenominationsCents: [5000, 2500, 10000],
    });
    expect(r.status).toBe(201);
    expect(r.json.product.kind).toBe("gift_card");
    expect(r.json.product.priceCents).toBe(2500);
    expect(r.json.product.giftCardDenominationsCents).toEqual([2500, 5000, 10000]);
  });

  it("refuses a gift card with no denominations", async () => {
    h.userId = CREATOR;
    const r = await req("POST", "/storefront/products", {
      kind: "gift_card", title: "No Amounts", description: "", priceCents: 2500,
    });
    expect(r.status).toBe(400);
  });

  it("refuses the normal product checkout for a gift card (recipient checkout is the door)", async () => {
    h.userId = CREATOR;
    const created = await req("POST", "/storefront/products", {
      kind: "gift_card", title: "Queen Gift Card", description: "", priceCents: 0,
      giftCardDenominationsCents: [2500, 5000],
    });
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId: created.json.product.id, quantity: 1 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("GIFT_CARD_CHECKOUT");
    expect(h.stripeCreates).toHaveLength(0);
  });
});

describe("full tender at checkout", () => {
  it("records the order with fee on the FULL gross, debits the card once, keeps the remainder", async () => {
    const productId = await seedPaidProduct(2000);
    const cardId = await seedCard(5000);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, giftCardCode: CARD_CODE });
    expect(r.status).toBe(200);
    expect(r.json.paidWithGiftCard).toBe(true);
    expect(r.json.totals.giftCardAppliedCents).toBe(2000);
    expect(r.json.totals.amountDueCents).toBe(0);
    expect(h.stripeCreates).toHaveLength(0);

    const orders = await h.db.execute(sql`SELECT amount_cents, platform_fee_cents, creator_amount_cents, status FROM store_orders`);
    expect(orders.rows).toHaveLength(1);
    /* 5% of the full $20 gross — tender never shrinks the fee base. */
    expect(orders.rows[0]).toMatchObject({ amount_cents: 2000, platform_fee_cents: 100, creator_amount_cents: 1900, status: "completed" });

    const card = await cardRow(cardId);
    expect(card).toMatchObject({ balance_cents: 3000, reserved_cents: 0, status: "active" });

    const ledger = await h.db.execute(sql`SELECT kind, amount_cents, balance_after_cents FROM gift_card_ledger`);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ kind: "redeem", amount_cents: 2000, balance_after_cents: 3000 });
  });

  it("a card from another creator's store refuses", async () => {
    const productId = await seedPaidProduct(2000);
    await seedCard(5000, OTHER_PROFILE_ID);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, giftCardCode: CARD_CODE });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("WRONG_STORE");
    const orders = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM store_orders`);
    expect(Number((orders.rows[0] as any).c)).toBe(0);
  });

  it("a malformed code refuses before any money moves", async () => {
    const productId = await seedPaidProduct(2000);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, giftCardCode: "HELLO" });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BAD_GIFT_CARD");
  });
});

describe("partial tender at verify: session pays the due, order carries the gross", () => {
  it("verify records gross + full fee and debits only the tender; duplicate verify debits nothing twice", async () => {
    const productId = await seedPaidProduct(2000);
    const cardId = await seedCard(5000);
    /* Simulate the checkout-time hold for $12 of the $20 album. */
    const reservation = await reserveGiftCard({ cardId, rail: "storefront", ref: "sf-test", amountCents: 1200 });
    expect(reservation).not.toBeNull();
    h.session = {
      id: "cs_test_partial",
      payment_status: "paid",
      amount_total: 800, // Stripe charged only what was still due
      metadata: {
        type: "storefront_purchase",
        buyer_user_id: BUYER,
        profile_id: PROFILE_ID,
        product_id: productId,
        product_kind: "digital",
        quantity: "1",
        discount_code: "",
        amount_cents: "2000",
        platform_fee_cents: "100",
        creator_amount_cents: "1900",
        event_id: "",
        gift_card_reservation_id: reservation!.id,
        gift_card_applied_cents: "1200",
      },
    };
    h.userId = BUYER;
    const r = await req("POST", "/storefront/verify", { sessionId: "cs_test_partial" });
    expect(r.status).toBe(200);
    expect(r.json.order.amountCents).toBe(2000);
    expect(r.json.order.platformFeeCents).toBe(100);
    expect(r.json.order.creatorAmountCents).toBe(1900);
    expect(r.json.order.giftCardAppliedCents).toBe(1200);
    expect((await cardRow(cardId)).balance_cents).toBe(3800);

    const again = await req("POST", "/storefront/verify", { sessionId: "cs_test_partial" });
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect((await cardRow(cardId)).balance_cents).toBe(3800);
    const ledger = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM gift_card_ledger WHERE kind = 'redeem'`);
    expect(Number((ledger.rows[0] as any).c)).toBe(1);
  });
});
