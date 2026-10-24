/**
 * Post-purchase one-click upsell (Stack-100 #3, Wave 3) — the
 * storefront rail. Drives the REAL storefront router over pg-mem with
 * Stripe faked at the lib/stripe-client seam and pins:
 *  - checkout now asks Stripe to save the card (customer_creation +
 *    setup_future_usage: off_session) with totals/metadata untouched;
 *  - after verify, the buyer is offered the designated add-on ONCE:
 *    a snapshot at the seller-set price / % off with the flat-5%
 *    split and the saved-card hint; exactly one offer row per order
 *    no matter how many times verify replays;
 *  - accept = one click → ONE PaymentIntent (off_session, confirm,
 *    saved customer + method, snapshot amount, deterministic
 *    idempotency key = the parent order id) → the upsell records as
 *    its own order with the bump-style receipt, inventory claimed,
 *    digital delivery minted;
 *  - exactly-once: a second accept (double-click / duplicate /
 *    retry-after-timeout) returns the recorded order with ZERO new
 *    Stripe calls and ZERO new rows; a declined card fails the offer
 *    terminally (no silent re-charge path); requires_action never
 *    records a charge;
 *  - refusals: no reusable payment method → 409 before Stripe is
 *    touched; sold-out/inactive at accept → 409, no charge; already
 *    bought at checkout → never offered; decline → never shown again.
 *
 * Hand-computed money (fee = round(gross × 5%)):
 *  main 2000 · add-on 3000 @10% off = 2700 → fee 135 / creator 2565
 *  odd-cent add-on 1999 @0% → fee 100 / creator 1899
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-upsell";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<{ params: any; options: any }>,
  sessions: new Map<string, any>(),
  piCreates: [] as Array<{ params: any; options: any }>,
  piByKey: new Map<string, any>(),
  /* How the completed checkout's PaymentIntent looks at verify:
     "card" = a saved reusable method exists; "none" = Stripe kept
     nothing reusable (e.g. a non-reusable wallet). */
  savedMethod: "card" as "card" | "none",
  /* What the upsell PaymentIntent does at accept. */
  piBehavior: "succeed" as "succeed" | "decline" | "requires_action",
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
            const n = h.stripeCreates.length + 1;
            const id = `cs_test_${n}`;
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
              payment_intent: `pi_main_${n}`,
              customer: h.savedMethod === "card" ? "cus_buyer_1" : null,
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
      paymentIntents: {
        retrieve: vi.fn(async (id: string) => {
          if (!String(id).startsWith("pi_main_")) throw new Error("No such payment intent");
          if (h.savedMethod === "none") {
            return { id, status: "succeeded", customer: null, payment_method: null };
          }
          return {
            id,
            status: "succeeded",
            customer: "cus_buyer_1",
            payment_method: { id: "pm_saved_1", card: { brand: "visa", last4: "4242" } },
          };
        }),
        create: vi.fn(async (params: any, options: any) => {
          const key = options?.idempotencyKey as string | undefined;
          if (key && h.piByKey.has(key)) return h.piByKey.get(key);
          h.piCreates.push({ params, options });
          if (h.piBehavior === "decline") {
            const err: any = new Error("Your card was declined.");
            err.type = "StripeCardError";
            err.code = "card_declined";
            throw err;
          }
          const pi = {
            id: `pi_upsell_${h.piCreates.length}`,
            status: h.piBehavior === "requires_action" ? "requires_action" : "succeeded",
            amount: params.amount,
            customer: params.customer,
            payment_method: params.payment_method,
          };
          if (key) h.piByKey.set(key, pi);
          return pi;
        }),
      },
    })),
  };
});

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

/* Post-migration DDL: the bumps lane's 0205 columns plus this lane's
   reported 0206 (store_upsell_offers + the two store_orders columns).
   job_notifications intentionally absent: createTestDb() creates it. */
const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE events (
  id uuid PRIMARY KEY, title text, rsvp_count integer NOT NULL DEFAULT 0
);
CREATE TABLE event_rsvps (
  event_id uuid NOT NULL, user_id uuid NOT NULL, UNIQUE (event_id, user_id)
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
  parent_order_id uuid, stripe_payment_intent_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_upsell_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id uuid NOT NULL UNIQUE,
  buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL,
  product_id uuid NOT NULL, upsell_product_id uuid NOT NULL,
  upsell_title text NOT NULL, upsell_kind text NOT NULL,
  list_price_cents integer NOT NULL, percent_off integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL, platform_fee_cents integer NOT NULL,
  creator_amount_cents integer NOT NULL,
  stripe_customer_id text, stripe_payment_method_id text,
  payment_method_brand text, payment_method_last4 text,
  status text NOT NULL DEFAULT 'pending', failure_reason text,
  stripe_payment_intent_id text, upsell_order_id uuid,
  shown_at timestamptz, decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
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
const BUYER = randomUUID();
const STRANGER = randomUUID();
const PROFILE_ID = randomUUID();
const EVENT_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[upsell] unhandled route error:", err?.message ?? err);
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
  mem.public.none(DDL);
  h.db = db;
  h.userId = CREATOR;
  h.userEmail = "creator@example.com";
  h.stripeCreates = [];
  h.sessions = new Map();
  h.piCreates = [];
  h.piByKey = new Map();
  h.savedMethod = "card";
  h.piBehavior = "succeed";
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
  await h.db.execute(sql`INSERT INTO events (id, title) VALUES (${EVENT_ID}, 'Palace Show')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function createProduct(body: Record<string, unknown>) {
  h.userId = CREATOR;
  const r = await req("POST", "/storefront/products", body);
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

/** Main product: digital, 2000¢, unlimited. */
const seedMain = () => createProduct({
  kind: "digital", title: "Full Album", description: "",
  priceCents: 2000, mediaUrls: ["https://cdn.example.com/album.zip"],
});

/** Add-on candidate: digital, 3000¢, 5 in stock. */
const seedAddon = (extra: Record<string, unknown> = {}) => createProduct({
  kind: "digital", title: "Bonus Sample Pack", description: "",
  priceCents: 3000, inventory: 5, mediaUrls: ["https://cdn.example.com/pack.zip"],
  ...extra,
});

async function attach(mainId: string, addonId: string, percentOff = 10) {
  h.userId = CREATOR;
  const r = await req("PUT", `/storefront/products/${mainId}/bump`, { bumpProductId: addonId, percentOff });
  expect(r.status).toBe(200);
  return r;
}

/** Buy the main product (no bump tick) and verify — the moment the
    post-purchase offer is made. */
async function buyAndVerify(mainId: string, checkoutBody: Record<string, unknown> = {}) {
  h.userId = BUYER;
  const co = await req("POST", "/storefront/checkout", { productId: mainId, quantity: 1, ...checkoutBody });
  expect(co.status).toBe(200);
  const v = await req("POST", "/storefront/verify", { sessionId: co.json.sessionId });
  expect(v.status).toBe(200);
  return { sessionId: co.json.sessionId as string, verify: v.json, orderId: v.json.order.id as string };
}

async function offerRows() {
  const r = await h.db.execute(sql`SELECT * FROM store_upsell_offers`);
  return r.rows as Array<Record<string, unknown>>;
}
async function orderRows() {
  const r = await h.db.execute(sql`SELECT * FROM store_orders ORDER BY created_at ASC, amount_cents ASC`);
  return r.rows as Array<Record<string, unknown>>;
}
async function inventoryOf(id: string) {
  const r = await h.db.execute(sql`SELECT inventory FROM store_products WHERE id = ${id}`);
  return Number((r.rows[0] as any).inventory);
}

describe("checkout — the card is saved for the one-click offer", () => {
  it("requests customer creation + off-session saving; totals and metadata untouched", async () => {
    const mainId = await seedMain();
    h.userId = BUYER;
    const co = await req("POST", "/storefront/checkout", { productId: mainId, quantity: 1 });
    expect(co.status).toBe(200);
    expect(co.json.totals).toMatchObject({ grandTotalCents: 2000, platformFeeCents: 100, creatorCents: 1900 });
    expect(h.stripeCreates).toHaveLength(1);
    expect(h.stripeCreates[0]!.params.customer_creation).toBe("always");
    expect(h.stripeCreates[0]!.params.payment_intent_data).toEqual({ setup_future_usage: "off_session" });
    expect(h.stripeCreates[0]!.params.metadata).toMatchObject({ amount_cents: "2000", type: "storefront_purchase" });
  });
});

describe("verify — the offer is made once, at the snapshot price", () => {
  it("presents the designated add-on with seller price, % off, flat-5% split and the saved-card hint", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon();
    await attach(mainId, addonId, 10);
    const { verify, orderId } = await buyAndVerify(mainId);
    expect(verify.upsell).toMatchObject({
      orderId, productId: addonId, title: "Bonus Sample Pack",
      listPriceCents: 3000, percentOff: 10,
      priceCents: 2700, price: "$27.00",
      platformFeeCents: 135, creatorCents: 2565, platformFeePct: 5,
      paymentMethod: { brand: "visa", last4: "4242" },
    });
    const offers = await offerRows();
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      parent_order_id: orderId, status: "pending",
      amount_cents: 2700, platform_fee_cents: 135, creator_amount_cents: 2565,
      stripe_customer_id: "cus_buyer_1", stripe_payment_method_id: "pm_saved_1",
    });
    expect(offers[0]!["shown_at"]).toBeTruthy();
  });

  it("a duplicate verify never mints a second offer (one row per order)", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon();
    await attach(mainId, addonId, 10);
    const { sessionId, verify } = await buyAndVerify(mainId);
    h.userId = BUYER;
    const again = await req("POST", "/storefront/verify", { sessionId });
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(again.json.upsell).toMatchObject({ productId: addonId, priceCents: 2700 });
    expect(verify.upsell.priceCents).toBe(2700);
    expect(await offerRows()).toHaveLength(1);
    expect(await orderRows()).toHaveLength(1);
  });

  it("no designation → no offer, and the purchase is exactly as before", async () => {
    const mainId = await seedMain();
    const { verify } = await buyAndVerify(mainId);
    expect(verify.upsell).toBeNull();
    expect(await offerRows()).toHaveLength(0);
  });

  it("the buyer who already took the add-on at checkout is never re-offered it", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon();
    await attach(mainId, addonId, 10);
    const { verify } = await buyAndVerify(mainId, { includeBump: true });
    expect(verify.order.amountCents).toBe(4700);
    expect(verify.upsell).toBeNull();
    expect(await offerRows()).toHaveLength(0);
  });
});

describe("accept — one click, one PaymentIntent, its own order", () => {
  async function offeredOrder() {
    const mainId = await seedMain();
    const addonId = await seedAddon();
    await attach(mainId, addonId, 10);
    const bought = await buyAndVerify(mainId);
    expect(bought.verify.upsell).toBeTruthy();
    return { mainId, addonId, ...bought };
  }

  it("charges the snapshot off-session on the saved method and records its own order", async () => {
    const { addonId, orderId } = await offeredOrder();
    h.userId = BUYER;
    const a = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(a.status).toBe(200);
    expect(a.json.success).toBe(true);
    expect(a.json.duplicate).toBe(false);

    expect(h.piCreates).toHaveLength(1);
    expect(h.piCreates[0]!.params).toMatchObject({
      amount: 2700, currency: "usd",
      customer: "cus_buyer_1", payment_method: "pm_saved_1",
      off_session: true, confirm: true,
    });
    expect(h.piCreates[0]!.params.metadata).toMatchObject({
      type: "storefront_upsell", parent_order_id: orderId, upsell_product_id: addonId,
    });
    expect(h.piCreates[0]!.options.idempotencyKey).toBe(`storefront-upsell:${orderId}`);

    expect(a.json.order).toMatchObject({
      parentOrderId: orderId, isUpsell: true,
      amountCents: 2700, platformFeeCents: 135, creatorAmountCents: 2565,
    });
    expect(a.json.order.lines).toHaveLength(1);
    expect(a.json.order.lines[0]).toMatchObject({
      role: "upsell", productId: addonId, grossCents: 2700, platformFeeCents: 135, creatorCents: 2565,
    });
    expect(a.json.delivery?.url).toContain("/api/storefront/deliver/");

    const rows = await orderRows();
    expect(rows).toHaveLength(2);
    const upsellRow = rows.find((r) => r["parent_order_id"])!;
    expect(upsellRow).toMatchObject({
      parent_order_id: orderId, product_id: addonId,
      amount_cents: 2700, platform_fee_cents: 135, creator_amount_cents: 2565,
      stripe_payment_intent_id: "pi_upsell_1", stripe_session_id: null,
    });
    expect(String(upsellRow["fulfillment_note"])).toContain("Add-on delivery ready.");
    expect(await inventoryOf(addonId)).toBe(4);

    const offers = await offerRows();
    expect(offers[0]).toMatchObject({ status: "accepted", upsell_order_id: upsellRow["id"], stripe_payment_intent_id: "pi_upsell_1" });
  });

  it("exactly-once: a second accept (double-click / retry) replays the order — zero new Stripe calls, zero new rows", async () => {
    const { addonId, orderId } = await offeredOrder();
    h.userId = BUYER;
    const first = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(first.status).toBe(200);
    const second = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    expect(second.json.order.id).toBe(first.json.order.id);
    expect(h.piCreates).toHaveLength(1);
    expect(await orderRows()).toHaveLength(2);
    expect(await inventoryOf(addonId)).toBe(4);

    const offer = await req("GET", `/storefront/orders/${orderId}/upsell`);
    expect(offer.json.upsell).toBeNull();
  });

  it("odd cents: a 1999¢ add-on charges exactly 1999 with fee 100 / creator 1899", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon({ priceCents: 1999 });
    await attach(mainId, addonId, 0);
    const { verify, orderId } = await buyAndVerify(mainId);
    expect(verify.upsell).toMatchObject({ priceCents: 1999, platformFeeCents: 100, creatorCents: 1899 });
    h.userId = BUYER;
    const a = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(a.status).toBe(200);
    expect(h.piCreates[0]!.params.amount).toBe(1999);
    expect(a.json.order).toMatchObject({ amountCents: 1999, platformFeeCents: 100, creatorAmountCents: 1899 });
  });

  it("a ticket add-on fulfills as an RSVP on the same rail", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon({ kind: "ticket", eventId: EVENT_ID, inventory: -1, mediaUrls: [] });
    await attach(mainId, addonId, 0);
    const { orderId } = await buyAndVerify(mainId);
    h.userId = BUYER;
    const a = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(a.status).toBe(200);
    expect(String(a.json.order.fulfillmentNote)).toContain("Add-on ticket secured");
    const rsvps = await h.db.execute(sql`SELECT * FROM event_rsvps WHERE event_id = ${EVENT_ID} AND user_id = ${BUYER}`);
    expect(rsvps.rows).toHaveLength(1);
  });

  it("sales and purchases carry the upsell as its own linked order", async () => {
    const { orderId } = await offeredOrder();
    h.userId = BUYER;
    await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});

    const purchases = await req("GET", "/storefront/orders/purchases");
    expect(purchases.status).toBe(200);
    expect(purchases.json.purchases).toHaveLength(2);
    const upsellPurchase = purchases.json.purchases.find((p: any) => p.isUpsell);
    expect(upsellPurchase).toMatchObject({ parentOrderId: orderId, grossCents: 2700, platformFeeCents: 135, netCents: 2565 });

    h.userId = CREATOR;
    const sales = await req("GET", "/storefront/orders/sales");
    expect(sales.status).toBe(200);
    expect(sales.json.orders).toHaveLength(2);
    expect(sales.json.totals).toMatchObject({ grossCents: 4700, feeCents: 235, netCents: 4465 });
  });
});

describe("refusals — no charge, stated honestly", () => {
  it("no reusable payment method: verify presents nothing and accept refuses BEFORE Stripe", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon();
    await attach(mainId, addonId, 10);
    h.savedMethod = "none";
    const { verify, orderId } = await buyAndVerify(mainId);
    expect(verify.upsell).toBeNull();
    /* The offer row honestly records that no method was saved. */
    const offers = await offerRows();
    expect(offers).toHaveLength(1);
    expect(offers[0]!["stripe_payment_method_id"]).toBeNull();

    h.userId = BUYER;
    const a = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(a.status).toBe(409);
    expect(a.json.error).toBe("UPSELL_NO_PAYMENT_METHOD");
    expect(h.piCreates).toHaveLength(0);
    expect(await orderRows()).toHaveLength(1);
  });

  it("an add-on that sells out after the offer refuses at accept — no charge, offer stays pending", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon();
    await attach(mainId, addonId, 10);
    const { orderId } = await buyAndVerify(mainId);
    await h.db.execute(sql`UPDATE store_products SET inventory = 0 WHERE id = ${addonId}`);
    h.userId = BUYER;
    const a = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(a.status).toBe(409);
    expect(a.json.error).toBe("UPSELL_SOLD_OUT");
    expect(h.piCreates).toHaveLength(0);
    expect((await offerRows())[0]!["status"]).toBe("pending");
  });

  it("a declined card fails the offer terminally: no order, inventory restored, no second attempt ever", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon();
    await attach(mainId, addonId, 10);
    const { orderId } = await buyAndVerify(mainId);
    h.piBehavior = "decline";
    h.userId = BUYER;
    const a = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(a.status).toBe(402);
    expect(a.json.error).toBe("UPSELL_CARD_DECLINED");
    expect(await orderRows()).toHaveLength(1);
    expect(await inventoryOf(addonId)).toBe(5);
    expect((await offerRows())[0]).toMatchObject({ status: "failed", failure_reason: "card_declined" });

    h.piBehavior = "succeed";
    const retry = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(retry.status).toBe(409);
    expect(retry.json.error).toBe("UPSELL_FAILED");
    expect(h.piCreates).toHaveLength(1);
    expect(await orderRows()).toHaveLength(1);
  });

  it("requires_action never records a charge — the buyer is told the bank needs them present", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon();
    await attach(mainId, addonId, 10);
    const { orderId } = await buyAndVerify(mainId);
    h.piBehavior = "requires_action";
    h.userId = BUYER;
    const a = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(a.status).toBe(402);
    expect(a.json.error).toBe("UPSELL_REQUIRES_ACTION");
    expect(await orderRows()).toHaveLength(1);
    expect(await inventoryOf(addonId)).toBe(5);
    expect((await offerRows())[0]).toMatchObject({ status: "failed", failure_reason: "pi_requires_action" });
  });

  it("accept/decline/GET on someone else's order read as not-found", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon();
    await attach(mainId, addonId, 10);
    const { orderId } = await buyAndVerify(mainId);
    h.userId = STRANGER;
    expect((await req("GET", `/storefront/orders/${orderId}/upsell`)).status).toBe(404);
    expect((await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {})).status).toBe(404);
    expect((await req("POST", `/storefront/orders/${orderId}/upsell/decline`, {})).status).toBe(404);
    expect(h.piCreates).toHaveLength(0);
    expect((await offerRows())[0]!["status"]).toBe("pending");
  });

  it("accept on an order with no offer is a clean 404", async () => {
    const mainId = await seedMain();
    const { orderId } = await buyAndVerify(mainId);
    h.userId = BUYER;
    const a = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(a.status).toBe(404);
    expect(a.json.error).toBe("UPSELL_NOT_OFFERED");
    expect(h.piCreates).toHaveLength(0);
  });
});

describe("decline — decided once, never shown again", () => {
  it("decline is idempotent, blocks accept, and the offer never reappears", async () => {
    const mainId = await seedMain();
    const addonId = await seedAddon();
    await attach(mainId, addonId, 10);
    const { sessionId, orderId } = await buyAndVerify(mainId);
    h.userId = BUYER;

    const d1 = await req("POST", `/storefront/orders/${orderId}/upsell/decline`, {});
    expect(d1.status).toBe(200);
    expect(d1.json).toMatchObject({ ok: true, status: "declined" });
    const d2 = await req("POST", `/storefront/orders/${orderId}/upsell/decline`, {});
    expect(d2.status).toBe(200);
    expect(d2.json.duplicate).toBe(true);

    const offer = await req("GET", `/storefront/orders/${orderId}/upsell`);
    expect(offer.json.upsell).toBeNull();
    const replay = await req("POST", "/storefront/verify", { sessionId });
    expect(replay.status).toBe(200);
    expect(replay.json.upsell).toBeNull();

    const a = await req("POST", `/storefront/orders/${orderId}/upsell/accept`, {});
    expect(a.status).toBe(409);
    expect(a.json.error).toBe("UPSELL_DECLINED");
    expect(h.piCreates).toHaveLength(0);
    expect(await orderRows()).toHaveLength(1);
  });
});
