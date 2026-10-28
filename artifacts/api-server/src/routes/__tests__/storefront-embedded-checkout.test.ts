/**
 * Embedded checkout on the profile-storefront rail (stack400 lane 6).
 *
 * Lane 2 proved the SHOPS rail had an embedded mode its 2D page never
 * asked for; this rail (routes/storefront.ts) had no embedded mode at
 * all — POST /storefront/checkout minted hosted-only sessions and the
 * product page redirected every buyer to Stripe's hosted page (owner
 * law 2026-10-26: "we should never have to leave my site"). Drives the
 * REAL storefront router over pg-mem (harness mirrors
 * storefront-gift-tender.test.ts) and pins:
 *  - an embedded ask mints the SAME session in embedded_page ui_mode:
 *    return_url to our own /store/success (fixed server-side — no
 *    client input, no success/cancel URLs), same metadata, and the
 *    response carries the clientSecret + uiMode "embedded";
 *  - no ask (or the EMBEDDED_CHECKOUT kill switch) keeps the legacy
 *    hosted shape byte-for-byte: success/cancel URLs, url to redirect
 *    to, clientSecret null;
 *  - the rail's fee re-pinned from code: FLAT 5% (PLATFORM_FEE_BPS) —
 *    $5.00 → 25¢ platform fee / $4.75 creator, in the response totals,
 *    the session metadata AND the recorded order;
 *  - an embedded session settles through the existing verify exactly
 *    like a hosted one: the order records against the BUYER'S ACCOUNT
 *    (buyer_user_id from the authenticated session — this rail never
 *    had the shops free-text-email disease) and a digital delivery
 *    token is minted for them.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-storefront-embedded";

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
            const n = h.stripeCreates.length;
            return {
              id: `cs_test_${n}`,
              /* Real Stripe answers url: null for embedded sessions;
                 the fake keeps a url so the hosted assertions can tell
                 the two shapes apart by ui_mode, not by the fake. */
              url: "https://checkout.example.com/pay",
              client_secret: `cs_test_${n}_secret_embedded`,
            };
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
  bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0,
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  event_id uuid, related_links jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (price_cents >= 0)
, media_alt_texts jsonb NOT NULL DEFAULT '[]');
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL, product_kind text NOT NULL,
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL,
  discount_code text, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed',
  bump_product_id uuid, bump_title text, bump_amount_cents integer,
  bump_platform_fee_cents integer, bump_creator_amount_cents integer,
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
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[storefront-embedded] unhandled route error:", err?.message ?? err);
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
  delete process.env["EMBEDDED_CHECKOUT"];
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

/** A $5.00 digital download — the exact shape of the Oct 28 gate sale. */
async function seedProduct(priceCents = 500) {
  h.userId = CREATOR;
  const r = await req("POST", "/storefront/products", {
    kind: "digital", title: "TEST Digital Download", description: "", priceCents,
    mediaUrls: ["https://cdn.example.com/test-download.zip"],
  });
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

describe("storefront checkout — embedded presentation", () => {
  it("an embedded ask mints an embedded_page session with our own return_url and answers a clientSecret", async () => {
    const productId = await seedProduct();
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, uiMode: "embedded" });
    expect(r.status).toBe(200);
    expect(r.json.uiMode).toBe("embedded");
    expect(r.json.clientSecret).toBe("cs_test_1_secret_embedded");
    expect(r.json.sessionId).toBe("cs_test_1");

    expect(h.stripeCreates).toHaveLength(1);
    const params = h.stripeCreates[0];
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toContain("/store/success?session_id={CHECKOUT_SESSION_ID}");
    /* An embedded session carries NO hosted redirect URLs. */
    expect(params.success_url).toBeUndefined();
    expect(params.cancel_url).toBeUndefined();
    /* Same purchase, same metadata — only the presentation differs. */
    expect(params.metadata).toMatchObject({
      type: "storefront_purchase",
      buyer_user_id: BUYER,
      profile_id: PROFILE_ID,
      product_id: productId,
      product_kind: "digital",
    });
  });

  it("no ask keeps the legacy hosted shape exactly", async () => {
    const productId = await seedProduct();
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    expect(r.status).toBe(200);
    expect(r.json.uiMode).toBe("hosted");
    expect(r.json.clientSecret).toBeNull();
    expect(r.json.url).toBe("https://checkout.example.com/pay");

    const params = h.stripeCreates[0];
    expect(params.ui_mode).toBeUndefined();
    expect(params.return_url).toBeUndefined();
    expect(params.success_url).toContain("/store/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toContain(`/storefront/product/${productId}`);
  });

  it("the EMBEDDED_CHECKOUT kill switch forces the hosted shape even when embedded is asked", async () => {
    process.env["EMBEDDED_CHECKOUT"] = "off";
    const productId = await seedProduct();
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, uiMode: "embedded" });
    expect(r.status).toBe(200);
    expect(r.json.uiMode).toBe("hosted");
    expect(r.json.clientSecret).toBeNull();
    expect(h.stripeCreates[0].ui_mode).toBeUndefined();
    expect(h.stripeCreates[0].success_url).toContain("/store/success?session_id={CHECKOUT_SESSION_ID}");
  });
});

describe("storefront checkout — fee re-pinned from code (flat 5%)", () => {
  it("$5.00 → 25¢ platform fee / $4.75 creator in totals, session metadata and the recorded order", async () => {
    const productId = await seedProduct(500);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, uiMode: "embedded" });
    expect(r.status).toBe(200);
    expect(r.json.totals.platformFeeCents).toBe(25);
    expect(r.json.totals.creatorCents).toBe(475);
    expect(r.json.totals.grandTotalCents).toBe(500);
    expect(h.stripeCreates[0].metadata.platform_fee_cents).toBe("25");
    expect(h.stripeCreates[0].metadata.creator_amount_cents).toBe("475");

    /* Settle it through verify — the recorded order carries the same split. */
    h.session = {
      id: r.json.sessionId,
      payment_status: "paid",
      amount_total: 500,
      metadata: { ...h.stripeCreates[0].metadata },
    };
    const v = await req("POST", "/storefront/verify", { sessionId: r.json.sessionId });
    expect(v.status).toBe(200);
    const orders = await h.db.execute(sql`SELECT buyer_user_id, amount_cents, platform_fee_cents, creator_amount_cents, status FROM store_orders`);
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0]).toMatchObject({
      buyer_user_id: BUYER, amount_cents: 500,
      platform_fee_cents: 25, creator_amount_cents: 475, status: "completed",
    });
  });
});

describe("storefront checkout — embedded settles + delivers to the buyer's account", () => {
  it("verify on an embedded session records the order and mints the digital delivery token", async () => {
    const productId = await seedProduct(500);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, uiMode: "embedded" });
    expect(r.status).toBe(200);

    h.session = {
      id: r.json.sessionId,
      payment_status: "paid",
      amount_total: 500,
      metadata: { ...h.stripeCreates[0].metadata },
    };
    const v = await req("POST", "/storefront/verify", { sessionId: r.json.sessionId });
    expect(v.status).toBe(200);
    /* Delivery rides the verify response and a token row exists,
       keyed to the order — findable by the buyer's account alone. */
    expect(v.json.delivery?.url).toContain("/api/storefront/deliver/");
    const tokens = await h.db.execute(sql`SELECT file_url FROM store_delivery_tokens`);
    expect(tokens.rows).toHaveLength(1);
    expect((tokens.rows[0] as any).file_url).toBe("https://cdn.example.com/test-download.zip");

    /* A duplicate verify records NO second order (the session id is
       the idempotency key) and still hands the buyer a delivery link —
       verify doubles as the buyer's "get my download" door. */
    const v2 = await req("POST", "/storefront/verify", { sessionId: r.json.sessionId });
    expect(v2.status).toBe(200);
    expect(v2.json.delivery?.url).toContain("/api/storefront/deliver/");
    const orders = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM store_orders`);
    expect(Number((orders.rows[0] as any).c)).toBe(1);
  });

  it("verify refuses a session that belongs to a different account", async () => {
    const productId = await seedProduct(500);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, uiMode: "embedded" });
    expect(r.status).toBe(200);
    h.session = {
      id: r.json.sessionId,
      payment_status: "paid",
      amount_total: 500,
      metadata: { ...h.stripeCreates[0].metadata },
    };
    h.userId = CREATOR; // someone else tries to claim the purchase
    const v = await req("POST", "/storefront/verify", { sessionId: r.json.sessionId });
    expect(v.status).toBe(403);
    const orders = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM store_orders`);
    expect(Number((orders.rows[0] as any).c)).toBe(0);
  });
});
