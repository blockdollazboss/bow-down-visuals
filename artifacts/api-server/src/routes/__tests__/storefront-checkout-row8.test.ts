/**
 * storefront-checkout-row8.test.ts — payments-matrix ROW 8, the legacy
 * storefront checkout rail (POST /storefront/checkout + /verify in
 * routes/storefront.ts). Stack800 Lane 1, items 1–4.
 *
 * INVENTORY (what already existed before this file — not re-tested here):
 *  - storefront-embedded-checkout.test.ts: embedded vs hosted session
 *    SHAPE, a SUBSET of metadata (type/buyer/profile/product/kind), one
 *    fee pin ($5.00 → 25¢/475¢) in totals+metadata+order, verify records
 *    the order + mints one delivery token, duplicate verify keeps ONE
 *    order, verify 403s a different account.
 *  - storefront-order-bumps.test.ts: duplicate verify is a pure no-op
 *    (one order, discount used_count +1 exactly once) on the bump path.
 *  - generate/__tests__/shop-discounts.test.ts: discount rejections on
 *    the SHOPS rail — a different router; the storefront rail had none.
 *
 * THIS FILE pins what was MISSING:
 *  1. The FULL legacy (hosted) session-create argument shape: mode,
 *     the single line item, every metadata key the webhook + verify
 *     paths rely on (exact key set, string values), the deterministic
 *     Stripe idempotency key (same intent → same key until the order
 *     lands, then it advances).
 *  2. Fee math to the cent + the fee MECHANISM. There is NO
 *     application_fee_amount / transfer_data / on_behalf_of anywhere on
 *     this rail — it is NOT a Connect destination charge. The buyer is
 *     charged the full gross on the platform account; the flat 5% fee
 *     is taken as DB accounting: metadata + the recorded order carry
 *     platform_fee_cents = round(gross × 5%) and creator_amount_cents
 *     = gross − fee, and the Connect payout sweep
 *     (routes/stripe-connect.ts pendingPayoutCents) pays the seller
 *     only creator_amount_cents of completed orders — so the platform
 *     keeps exactly the fee. Verify RE-DERIVES the split from the
 *     session total, never from metadata (tampered metadata fees are
 *     ignored — pinned below).
 *  3. Discount-code rejections on the checkout path: expired /
 *     over-cap / wrong-seller / inactive codes refuse with 400
 *     BAD_CODE and Stripe's session create is NEVER called; the public
 *     validate endpoint shares findDiscount + discountUsable and
 *     answers valid:false with the same reasons.
 *  4. Verify/webhook idempotency. TRUTH FROM CODE: the Stripe webhook
 *     (lib/stripe-webhook.ts) has NO storefront_purchase branch — a
 *     checkout.session.completed for this rail falls through to the
 *     credit-pack logic, finds no metadata.user_id (this rail stamps
 *     buyer_user_id) and answers 200 {warning:"Missing user_id in
 *     metadata"} having written NOTHING. Verify is the sole recorder,
 *     guarded by UNIQUE(stripe_session_id) + ON CONFLICT DO NOTHING.
 *     Pinned in both orders (webhook×2 → verify×2, and verify →
 *     webhook×2 → verify): exactly ONE store_orders row and, for a
 *     ticket, exactly ONE entitlement (one event_rsvps row,
 *     rsvp_count = 1).
 *
 * Harness mirrors storefront-embedded-checkout.test.ts (pg-mem via
 * createTestDb, hoisted @workspace/db swap, guarded-Stripe fake) plus
 * the webhook-delivery shape of lib/__tests__/stripe-webhook-sponsor-pi
 * .test.ts (the same fake client answers webhooks.constructEvent).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-storefront-row8";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<{ params: any; options: any }>,
  session: null as any,
  event: null as unknown,
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
            h.stripeCreates.push({ params, options });
            const n = h.stripeCreates.length;
            return {
              id: `cs_test_${n}`,
              url: "https://checkout.example.com/pay",
              client_secret: `cs_test_${n}_secret_row8`,
            };
          }),
          retrieve: vi.fn(async () => h.session),
        },
      },
      webhooks: { constructEvent: () => h.event },
      charges: { retrieve: vi.fn() },
    })),
  };
});

vi.mock("../../lib/supabase-admin", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getSupabaseAdmin: vi.fn(() => ({})) };
});

vi.mock("../referrals", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, awardReferralPayout: vi.fn(async () => ({ awarded: false })) };
});

vi.mock("../../lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, publicApiLimiter: (_req: any, _res: any, next: any) => next() };
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
import { stripeWebhookHandler } from "../../lib/stripe-webhook";
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
  reserved_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active',
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

beforeAll(async () => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_row8";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake_row8";
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[storefront-row8] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  delete process.env["STRIPE_WEBHOOK_SECRET"];
  await new Promise<void>((r) => server.close(() => r()));
});

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
  h.event = null;
  delete process.env["EMBEDDED_CHECKOUT"];
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

async function seedProduct(priceCents = 500, kind = "digital") {
  h.userId = CREATOR;
  const r = await req("POST", "/storefront/products", {
    kind, title: "TEST Digital Download", description: "", priceCents,
    mediaUrls: ["https://cdn.example.com/test-download.zip"],
  });
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

async function seedDiscount(profileId: string, over: Record<string, unknown>) {
  const code = String(over["code"] ?? "CODE10");
  await h.db.execute(sql`
    INSERT INTO discount_codes (profile_id, code, percent_off, max_uses, used_count, expires_at, is_active)
    VALUES (${profileId}, ${code}, ${Number(over["percent_off"] ?? 10)},
            ${Number(over["max_uses"] ?? -1)}, ${Number(over["used_count"] ?? 0)},
            ${(over["expires_at"] as string | null) ?? null}, ${(over["is_active"] as boolean | undefined) ?? true})
  `);
  return code;
}

/** Build the paid-session fixture exactly as Stripe would redeliver it:
    the metadata captured from the real session-create call. */
function paidSession(sessionId: string, amountTotal: number) {
  return {
    id: sessionId,
    payment_status: "paid",
    amount_total: amountTotal,
    metadata: { ...lastCreate().params.metadata },
  };
}

function lastCreate() {
  return h.stripeCreates[h.stripeCreates.length - 1]!;
}

async function orderCount(): Promise<number> {
  const r = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM store_orders`);
  return Number((r.rows[0] as any).c);
}

/* ── Webhook delivery (sponsor-pi pattern: fake req/res, real handler) ── */
function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
}

async function deliverCompleted(session: Record<string, unknown>) {
  h.event = {
    id: `evt_${randomUUID().slice(0, 8)}`,
    type: "checkout.session.completed",
    data: { object: session },
  };
  const res = makeRes();
  await stripeWebhookHandler(
    { headers: { "stripe-signature": "sig_test" }, body: Buffer.from("{}") } as never,
    res as never,
  );
  return res;
}

/* ══ Item 1 — legacy session creation + full metadata shape ══════════ */
describe("row8 item 1 — legacy checkout session creation + metadata shape", () => {
  it("hosted checkout: mode, line item, and the EXACT metadata key set verify relies on", async () => {
    const productId = await seedProduct(1250);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 2 });
    expect(r.status).toBe(200);
    expect(r.json.sessionId).toBe("cs_test_1");
    expect(r.json.url).toBe("https://checkout.example.com/pay");

    expect(h.stripeCreates).toHaveLength(1);
    const { params } = h.stripeCreates[0]!;
    expect(params.mode).toBe("payment");
    expect(params.customer_creation).toBe("always");
    expect(params.payment_intent_data).toEqual({ setup_future_usage: "off_session" });
    expect(params.success_url).toContain("/store/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toContain(`/storefront/product/${productId}`);

    expect(params.line_items).toHaveLength(1);
    const li = params.line_items[0];
    expect(li.quantity).toBe(2);
    expect(li.price_data.currency).toBe("usd");
    expect(li.price_data.unit_amount).toBe(1250);
    expect(li.price_data.product_data.name).toBe("TEST Digital Download — Queen Creator");
    expect(li.price_data.product_data.description).toBe("digital · Bow Down Visuals");
    expect(li.price_data.product_data.images).toEqual(["https://cdn.example.com/test-download.zip"]);

    /* The exact key set — verify + webhook classification read these
       and nothing else; a dropped or renamed key breaks settlement. */
    expect(Object.keys(params.metadata).sort()).toEqual([
      "affiliate_code", "amount_cents", "bump_amount_cents", "bump_product_id",
      "buyer_user_id", "creator_amount_cents", "discount_code", "event_id",
      "gift_card_applied_cents", "gift_card_reservation_id", "offer_id",
      "platform_fee_cents", "product_id", "product_kind", "profile_id",
      "quantity", "type",
    ]);
    expect(params.metadata).toEqual({
      type: "storefront_purchase",
      buyer_user_id: BUYER,
      profile_id: PROFILE_ID,
      product_id: productId,
      product_kind: "digital",
      quantity: "2",
      discount_code: "",
      affiliate_code: "",
      amount_cents: "2500",
      platform_fee_cents: "125",
      creator_amount_cents: "2375",
      event_id: "",
      bump_product_id: "",
      bump_amount_cents: "0",
      gift_card_reservation_id: "",
      gift_card_applied_cents: "0",
      offer_id: "",
    });
    /* Every metadata value is a string — Stripe metadata is string-only
       and verify parseInts them; a number here would be a lie. */
    for (const v of Object.values(params.metadata)) expect(typeof v).toBe("string");
  });

  it("the Stripe idempotency key is deterministic per intent and advances once the order lands", async () => {
    const productId = await seedProduct(500);
    h.userId = BUYER;
    const r1 = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    expect(r1.status).toBe(200);
    const r2 = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    expect(r2.status).toBe(200);
    const k1 = h.stripeCreates[0]!.options?.idempotencyKey;
    const k2 = h.stripeCreates[1]!.options?.idempotencyKey;
    expect(typeof k1).toBe("string");
    expect(k1.length).toBeGreaterThan(0);
    /* Double-submit before settlement: same key → Stripe reuses the
       original session instead of minting a second charge. */
    expect(k2).toBe(k1);

    /* Settle the first session; a repeat purchase is a NEW intent. */
    h.session = paidSession(r1.json.sessionId, 500);
    const v = await req("POST", "/storefront/verify", { sessionId: r1.json.sessionId });
    expect(v.status).toBe(200);
    const r3 = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    expect(r3.status).toBe(200);
    expect(h.stripeCreates[2]!.options?.idempotencyKey).not.toBe(k1);
  });
});

/* ══ Item 2 — flat 5% fee: math to the cent + the real mechanism ═════ */
describe("row8 item 2 — flat 5% fee math, to the cent", () => {
  const cases: Array<[number, number, number]> = [
    // gross, fee = round(gross × 5%), creator = gross − fee
    [500, 25, 475],
    [999, 50, 949],   // 49.95 rounds to 50
    [1999, 100, 1899], // 99.95 rounds to 100
    [101, 5, 96],     // 5.05 rounds to 5
    [30, 2, 28],      // 1.50 rounds half-up to 2
    [10, 1, 9],       // 0.50 rounds half-up to 1
  ];
  for (const [gross, fee, creator] of cases) {
    it(`$${(gross / 100).toFixed(2)} gross → ${fee}¢ fee / ${creator}¢ creator in totals + metadata`, async () => {
      const productId = await seedProduct(gross);
      h.userId = BUYER;
      const r = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
      expect(r.status).toBe(200);
      expect(r.json.totals.grandTotalCents).toBe(gross);
      expect(r.json.totals.platformFeeCents).toBe(fee);
      expect(r.json.totals.creatorCents).toBe(creator);
      expect(lastCreate().params.metadata.platform_fee_cents).toBe(String(fee));
      expect(lastCreate().params.metadata.creator_amount_cents).toBe(String(creator));
      expect(lastCreate().params.metadata.amount_cents).toBe(String(gross));
    });
  }

  it("quantity scales the gross BEFORE the fee: 333¢ × 3 = 999¢ → 50¢ fee", async () => {
    const productId = await seedProduct(333);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 3 });
    expect(r.status).toBe(200);
    expect(r.json.totals.lineTotal).toBe(999);
    expect(r.json.totals.platformFeeCents).toBe(50);
    expect(r.json.totals.creatorCents).toBe(949);
    expect(lastCreate().params.line_items[0].quantity).toBe(3);
    expect(lastCreate().params.line_items[0].price_data.unit_amount).toBe(333);
  });

  it("the discount comes off FIRST, then the 5% fee splits the discounted gross", async () => {
    const productId = await seedProduct(1000);
    await seedDiscount(PROFILE_ID, { code: "SAVE10", percent_off: 10 });
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, discountCode: "SAVE10" });
    expect(r.status).toBe(200);
    expect(r.json.totals.unitCents).toBe(900);
    expect(r.json.totals.platformFeeCents).toBe(45);
    expect(r.json.totals.creatorCents).toBe(855);
    const li = lastCreate().params.line_items[0];
    expect(li.price_data.unit_amount).toBe(900);
    expect(li.price_data.product_data.description).toBe("digital · 10% off with code SAVE10");
    expect(lastCreate().params.metadata.discount_code).toBe("SAVE10");
    expect(lastCreate().params.metadata.amount_cents).toBe("900");
  });

  it("MECHANISM: no fee is taken on the Stripe charge itself — the split is metadata + order accounting", async () => {
    const productId = await seedProduct(500);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    expect(r.status).toBe(200);
    const { params } = lastCreate();
    /* Not a Connect destination charge: Stripe is told to collect the
       FULL gross on the platform account. The 5% exists only as the
       recorded split the payout sweep honors (it pays sellers
       creator_amount_cents of completed orders, never the gross). */
    expect(params.payment_intent_data.application_fee_amount).toBeUndefined();
    expect(params.payment_intent_data.transfer_data).toBeUndefined();
    expect(params.payment_intent_data.on_behalf_of).toBeUndefined();
    expect(params.transfer_data).toBeUndefined();
    expect(params.line_items[0].price_data.unit_amount).toBe(500);
  });

  it("verify RE-DERIVES the split from the session total — tampered metadata fees are ignored", async () => {
    const productId = await seedProduct(999);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    expect(r.status).toBe(200);
    const session = paidSession(r.json.sessionId, 999);
    /* Attacker-shaped metadata: fee 1¢, creator keeps almost all. */
    session.metadata = { ...session.metadata, platform_fee_cents: "1", creator_amount_cents: "998" };
    h.session = session;
    const v = await req("POST", "/storefront/verify", { sessionId: r.json.sessionId });
    expect(v.status).toBe(200);
    expect(v.json.order.platformFeeCents).toBe(50);
    expect(v.json.order.creatorAmountCents).toBe(949);
    const orders = await h.db.execute(sql`SELECT platform_fee_cents, creator_amount_cents FROM store_orders`);
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0]).toMatchObject({ platform_fee_cents: 50, creator_amount_cents: 949 });
  });
});

/* ══ Item 3 — discount-code rejections create NO session / NO charge ═ */
describe("row8 item 3 — discount-code rejections on the storefront checkout path", () => {
  const rejections: Array<{
    name: string; seed: () => Promise<string>; reason: RegExp;
  }> = [
    {
      name: "an expired code",
      seed: async () => seedDiscount(PROFILE_ID, { code: "OLD10", expires_at: new Date(Date.now() - 60_000).toISOString() }),
      reason: /expired/i,
    },
    {
      name: "an over-cap code (max uses reached)",
      seed: async () => seedDiscount(PROFILE_ID, { code: "MAXED10", max_uses: 2, used_count: 2 }),
      reason: /usage limit/i,
    },
    {
      name: "a wrong-seller code (exists, but for another creator)",
      seed: async () => seedDiscount(OTHER_PROFILE_ID, { code: "THEIRS10" }),
      reason: /doesn't exist for this creator/i,
    },
    {
      name: "a deactivated code",
      seed: async () => seedDiscount(PROFILE_ID, { code: "DEAD10", is_active: false }),
      reason: /no longer active/i,
    },
  ];
  for (const c of rejections) {
    it(`${c.name} refuses checkout with 400 BAD_CODE and Stripe create is never called`, async () => {
      const productId = await seedProduct(1000);
      const code = await c.seed();
      const before = await h.db.execute(sql`SELECT used_count FROM discount_codes WHERE UPPER(code) = ${code.toUpperCase()}`);
      const usedBefore = Number((before.rows[0] as any).used_count);
      h.userId = BUYER;
      const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, discountCode: code });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("BAD_CODE");
      expect(String(r.json.message)).toMatch(c.reason);
      /* No session, no charge, no order, and the code is NOT consumed. */
      expect(h.stripeCreates).toHaveLength(0);
      expect(await orderCount()).toBe(0);
      const dc = await h.db.execute(sql`SELECT used_count FROM discount_codes WHERE UPPER(code) = ${code.toUpperCase()}`);
      expect(Number((dc.rows[0] as any).used_count)).toBe(usedBefore);
    });

    it(`${c.name} also fails the shared validate endpoint with valid:false and the same reason`, async () => {
      await seedProduct(1000);
      const code = await c.seed();
      const r = await req("GET", `/storefront/discounts/validate?code=${code}&profileId=${PROFILE_ID}`);
      expect(r.status).toBe(200);
      expect(r.json.valid).toBe(false);
      expect(String(r.json.reason)).toMatch(c.reason);
      expect(h.stripeCreates).toHaveLength(0);
    });
  }

  it("positive control: a live code still validates and discounts — the refusals are not over-refusal", async () => {
    const productId = await seedProduct(1000);
    await seedDiscount(PROFILE_ID, { code: "LIVE10", percent_off: 10 });
    const val = await req("GET", `/storefront/discounts/validate?code=LIVE10&profileId=${PROFILE_ID}`);
    expect(val.json).toMatchObject({ valid: true, code: "LIVE10", percentOff: 10 });
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1, discountCode: "live10" });
    expect(r.status).toBe(200);
    expect(h.stripeCreates).toHaveLength(1);
    expect(r.json.totals.unitCents).toBe(900);
  });
});

/* ══ Item 4 — verify + webhook racing: exactly one row, one entitlement */
describe("row8 item 4 — verify/webhook race idempotency", () => {
  async function checkoutDigital(price = 500) {
    const productId = await seedProduct(price);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    expect(r.status).toBe(200);
    return { productId, sessionId: r.json.sessionId as string };
  }

  it("webhook delivered TWICE before verify, then verify TWICE: one order, webhook writes nothing", async () => {
    const { sessionId } = await checkoutDigital();
    const session = paidSession(sessionId, 500);

    for (let i = 0; i < 2; i++) {
      const res = await deliverCompleted(session);
      expect(res.statusCode).toBe(200);
      /* The webhook has no storefront branch: it acknowledges and
         records nothing (credit-pack fall-through, missing user_id). */
      expect(res.body).toMatchObject({ received: true, warning: "Missing user_id in metadata" });
      expect(await orderCount()).toBe(0);
    }

    h.session = session;
    const v1 = await req("POST", "/storefront/verify", { sessionId });
    expect(v1.status).toBe(200);
    expect(v1.json.duplicate).toBe(false);
    const v2 = await req("POST", "/storefront/verify", { sessionId });
    expect(v2.status).toBe(200);
    expect(v2.json.duplicate).toBe(true);
    expect(v2.json.order.id).toBe(v1.json.order.id);
    expect(await orderCount()).toBe(1);
  });

  it("verify first, webhook TWICE between verifies: still exactly one order", async () => {
    const { sessionId } = await checkoutDigital();
    const session = paidSession(sessionId, 500);
    h.session = session;

    const v1 = await req("POST", "/storefront/verify", { sessionId });
    expect(v1.status).toBe(200);
    expect(await orderCount()).toBe(1);

    for (let i = 0; i < 2; i++) {
      const res = await deliverCompleted(session);
      expect(res.statusCode).toBe(200);
      expect(await orderCount()).toBe(1);
    }

    const v2 = await req("POST", "/storefront/verify", { sessionId });
    expect(v2.status).toBe(200);
    expect(v2.json.duplicate).toBe(true);
    expect(await orderCount()).toBe(1);
  });

  it("ticket entitlement: verify×2 + webhook×2 in mixed order → one order, ONE rsvp, rsvp_count stays 1", async () => {
    const eventId = randomUUID();
    const productId = randomUUID();
    await h.db.execute(sql`INSERT INTO events (id, title, rsvp_count) VALUES (${eventId}, 'Launch Night', 0)`);
    await h.db.execute(sql`
      INSERT INTO store_products (id, profile_id, kind, title, price_cents, inventory, media_urls, event_id, is_active)
      VALUES (${productId}, ${PROFILE_ID}, 'ticket', 'Launch Night Ticket', 2000, -1, '[]'::jsonb, ${eventId}, true)
    `);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    expect(r.status).toBe(200);
    const sessionId = r.json.sessionId as string;
    const session = paidSession(sessionId, 2000);
    h.session = session;

    const w1 = await deliverCompleted(session);
    expect(w1.statusCode).toBe(200);
    const v1 = await req("POST", "/storefront/verify", { sessionId });
    expect(v1.status).toBe(200);
    expect(v1.json.duplicate).toBe(false);
    const w2 = await deliverCompleted(session);
    expect(w2.statusCode).toBe(200);
    const v2 = await req("POST", "/storefront/verify", { sessionId });
    expect(v2.status).toBe(200);
    expect(v2.json.duplicate).toBe(true);

    expect(await orderCount()).toBe(1);
    const rsvps = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM event_rsvps WHERE event_id = ${eventId} AND user_id = ${BUYER}`);
    expect(Number((rsvps.rows[0] as any).c)).toBe(1);
    const ev = await h.db.execute(sql`SELECT rsvp_count FROM events WHERE id = ${eventId}`);
    expect(Number((ev.rows[0] as any).rsvp_count)).toBe(1);
    /* The one order carries the re-derived 5% split of the $20 gross. */
    const orders = await h.db.execute(sql`SELECT platform_fee_cents, creator_amount_cents FROM store_orders`);
    expect(orders.rows[0]).toMatchObject({ platform_fee_cents: 100, creator_amount_cents: 1900 });
  });
});
