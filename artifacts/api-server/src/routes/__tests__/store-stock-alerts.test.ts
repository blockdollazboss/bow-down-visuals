/**
 * Back-in-stock alerts (Wave 4 #37, migration 0236) — the storefront
 * half. Drives the REAL storefront router over pg-mem (harness mirrors
 * storefront-drop-pages.test.ts; the email rail is captured at the
 * lib/email seam) and pins:
 *  - a signed-in fan's one tap on a sold-out product subscribes once
 *    (second tap = alreadyWaiting, still one row); guests get 401;
 *    in-stock / missing / inactive products refuse honestly;
 *  - the seller's waiting count rides the public payloads and the
 *    state read, and is accurate before and after the firing;
 *  - a seller restock (PATCH inventory 0 → in-stock) fires ONCE: one
 *    in-app notification per waiting fan, rows consumed, and an email
 *    ONLY to the fan who already subscribes to the seller's list;
 *  - unrelated edits (price-only) never fire; a second sell-out +
 *    restock never re-fires a consumed alert; a fresh tap re-arms;
 *  - a non-owner PATCH cannot fire (or touch) anything;
 *  - graceful degradation with the table absent (migration held):
 *    subscribe answers 503, counts read 0, products behave as before.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-stock-alerts";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  emails: [] as Array<any>,
  withAlerts: true,
}));

/* The mock keeps the real middleware's contract: no signed-in user →
   401 { error: "Unauthorized" }; otherwise req.userId is set. */
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!h.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
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
      checkout: { sessions: { create: vi.fn(async () => ({ id: "cs_unused", url: "https://checkout.example.com/pay" })) } },
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

/* Capture the email rail; every other export (shell, buttons, escaping)
   stays real so the restock email renders exactly as production. */
vi.mock("../../lib/email", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    sendEmail: vi.fn(async (mail: any) => {
      h.emails.push(mail);
      return { sent: true, id: "msg_test" };
    }),
  };
});

import storefrontRouter from "../storefront";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const BASE_DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profiles (
  id uuid PRIMARY KEY, email text
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
  bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0,
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  is_active boolean NOT NULL DEFAULT true,
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
  stripe_session_id text, status text NOT NULL DEFAULT 'completed',
  bump_product_id uuid, bump_title text, bump_amount_cents integer,
  bump_platform_fee_cents integer, bump_creator_amount_cents integer,
  fulfillment_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_delivery_tokens (
  token text PRIMARY KEY, order_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
  handle text UNIQUE, description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), list_id uuid NOT NULL, email text NOT NULL,
  name text, source text NOT NULL DEFAULT 'landing', confirmed boolean NOT NULL DEFAULT true,
  opens integer NOT NULL DEFAULT 0, clicks integer NOT NULL DEFAULT 0,
  unsubscribe_token text, unsubscribed_at timestamptz,
  subscribed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE event_rsvps (
  event_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (event_id, user_id)
);
CREATE TABLE discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL, code text NOT NULL,
  percent_off integer NOT NULL, max_uses integer NOT NULL DEFAULT -1, used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  body text NOT NULL DEFAULT '', link text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

/* Migration 0236, verbatim shape. */
const ALERTS_DDL = `
CREATE TABLE stock_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  product_id  uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'waiting',
  created_at  timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  CHECK (status IN ('waiting', 'notified'))
);
CREATE UNIQUE INDEX stock_alerts_user_product_ux ON stock_alerts (user_id, product_id);
CREATE INDEX stock_alerts_product_status_idx ON stock_alerts (product_id, status);
CREATE INDEX stock_alerts_user_idx ON stock_alerts (user_id);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const CREATOR = randomUUID();
const OTHER = randomUUID();
const FAN_A = randomUUID();
const FAN_B = randomUUID();
const PROFILE_ID = randomUUID();
const OTHER_PROFILE_ID = randomUUID();
const LIST_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[stock-alerts] unhandled route error:", err?.message ?? err);
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
  mem.public.none(BASE_DDL + (h.withAlerts ? ALERTS_DDL : ""));
  h.db = db;
  h.userId = CREATOR;
  h.userEmail = "creator@example.com";
  h.emails = [];
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${OTHER_PROFILE_ID}, ${OTHER}, 'other-creator', 'Other Creator')`);
  await h.db.execute(sql`INSERT INTO profiles (id, email) VALUES (${FAN_A}, 'fan-a@example.com')`);
  await h.db.execute(sql`INSERT INTO profiles (id, email) VALUES (${FAN_B}, 'fan-b@example.com')`);
  /* FAN_A already subscribes to the seller's email list; FAN_B doesn't. */
  await h.db.execute(sql`INSERT INTO email_lists (id, user_id, name, handle) VALUES (${LIST_ID}, ${CREATOR}, 'Queen List', 'queen-list')`);
  await h.db.execute(sql`INSERT INTO email_subscribers (list_id, email, name) VALUES (${LIST_ID}, 'fan-a@example.com', 'Fan A')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function createProduct(body: Record<string, unknown> = {}) {
  h.userId = CREATOR;
  const r = await req("POST", "/storefront/products", {
    kind: "merch", title: "Crown Hoodie", description: "Limited run.",
    priceCents: 4900, inventory: 0, mediaUrls: [], relatedLinks: [], isActive: true,
    ...body,
  });
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

async function as(userId: string) { h.userId = userId; }
async function notificationCount(): Promise<number> {
  const r = await h.db.execute(sql`SELECT COUNT(*) AS n FROM notifications`);
  return Number((r.rows[0] as any)["n"]);
}
async function waitingRows(productId: string): Promise<number> {
  const r = await h.db.execute(sql`SELECT COUNT(*) AS n FROM stock_alerts WHERE product_id = ${productId} AND status = 'waiting'`);
  return Number((r.rows[0] as any)["n"]);
}

describe("subscribing", () => {
  it("one tap subscribes; the second tap is already-waiting and still one row", async () => {
    const productId = await createProduct();
    await as(FAN_A);
    const first = await req("POST", `/storefront/products/${productId}/stock-alert`);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ subscribed: true, alreadyWaiting: false, waitingCount: 1 });

    const second = await req("POST", `/storefront/products/${productId}/stock-alert`);
    expect(second.json).toMatchObject({ subscribed: true, alreadyWaiting: true, waitingCount: 1 });
    expect(await waitingRows(productId)).toBe(1);

    const state = await req("GET", `/storefront/products/${productId}/stock-alert`);
    expect(state.json).toMatchObject({ subscribed: true, waitingCount: 1, soldOut: true });
  });

  it("guests are refused 401 — the tap needs an account", async () => {
    const productId = await createProduct();
    h.userId = "";
    const r = await req("POST", `/storefront/products/${productId}/stock-alert`);
    expect(r.status).toBe(401);
    expect(await waitingRows(productId)).toBe(0);
  });

  it("refuses in-stock (409), missing (404) and inactive (404) products", async () => {
    const inStock = await createProduct({ inventory: 2 });
    const draft = await createProduct({ inventory: 0, isActive: false });
    await as(FAN_A);
    const stocked = await req("POST", `/storefront/products/${inStock}/stock-alert`);
    expect(stocked.status).toBe(409);
    expect(stocked.json.error).toBe("NOT_SOLD_OUT");
    const missing = await req("POST", `/storefront/products/${randomUUID()}/stock-alert`);
    expect(missing.status).toBe(404);
    const inactive = await req("POST", `/storefront/products/${draft}/stock-alert`);
    expect(inactive.status).toBe(404);
  });

  it("cancel removes the wait; the state read and count follow", async () => {
    const productId = await createProduct();
    await as(FAN_B);
    await req("POST", `/storefront/products/${productId}/stock-alert`);
    const cancel = await req("DELETE", `/storefront/products/${productId}/stock-alert`);
    expect(cancel.json).toMatchObject({ subscribed: false, wasWaiting: true });
    const again = await req("DELETE", `/storefront/products/${productId}/stock-alert`);
    expect(again.json).toMatchObject({ subscribed: false, wasWaiting: false });
    const state = await req("GET", `/storefront/products/${productId}/stock-alert`);
    expect(state.json).toMatchObject({ subscribed: false, waitingCount: 0 });
  });
});

describe("the waiting count (seller demand signal)", () => {
  it("rides the public detail + list payloads and tracks subscriptions exactly", async () => {
    const productId = await createProduct();
    await as(FAN_A);
    await req("POST", `/storefront/products/${productId}/stock-alert`);
    await as(FAN_B);
    await req("POST", `/storefront/products/${productId}/stock-alert`);

    const detail = await req("GET", `/storefront/product/${productId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.product.stockAlertWaiting).toBe(2);
    expect(detail.json.product.soldOut).toBe(true);

    const list = await req("GET", `/storefront/products?slug=queen-creator`);
    const row = (list.json.products as any[]).find((p) => p.id === productId);
    expect(row.stockAlertWaiting).toBe(2);
  });
});

describe("the restock firing", () => {
  it("PATCH 0 → in-stock fires once: in-app ping per fan, email only to the list subscriber, rows consumed", async () => {
    const productId = await createProduct();
    await as(FAN_A);
    await req("POST", `/storefront/products/${productId}/stock-alert`);
    await as(FAN_B);
    await req("POST", `/storefront/products/${productId}/stock-alert`);

    /* An unrelated edit (price) must NOT fire — and must not move the
       stock either (the PATCH schema's defaults once leaked inventory
       -1 into every partial edit; the handler now honors only sent
       keys, and this pin keeps it that way). */
    await as(CREATOR);
    const priceEdit = await req("PATCH", `/storefront/products/${productId}`, { priceCents: 4500 });
    expect(priceEdit.status).toBe(200);
    expect(priceEdit.json.product.inventory).toBe(0);
    expect(priceEdit.json.product.soldOut).toBe(true);
    expect(await notificationCount()).toBe(0);
    expect(await waitingRows(productId)).toBe(2);

    /* The restock. */
    const restock = await req("PATCH", `/storefront/products/${productId}`, { inventory: 3 });
    expect(restock.status).toBe(200);

    const notes = await h.db.execute(sql`SELECT user_id, kind, title, link FROM notifications ORDER BY user_id`);
    expect(notes.rows).toHaveLength(2);
    for (const n of notes.rows as any[]) {
      expect(n["kind"]).toBe("back_in_stock");
      expect(n["title"]).toBe("Back in stock: Crown Hoodie");
      expect(n["link"]).toBe(`/storefront/product/${productId}`);
    }
    expect((notes.rows as any[]).map((n) => n["user_id"]).sort()).toEqual([FAN_A, FAN_B].sort());

    /* Email: exactly one — FAN_A, the seller's existing list subscriber. */
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe("fan-a@example.com");
    expect(h.emails[0].subject).toContain("Crown Hoodie");

    /* Consumed: nothing waiting, payload count back to 0. */
    expect(await waitingRows(productId)).toBe(0);
    const detail = await req("GET", `/storefront/product/${productId}`);
    expect(detail.json.product.stockAlertWaiting).toBe(0);
  });

  it("a second sell-out + restock never re-fires a consumed alert; a fresh tap re-arms it", async () => {
    const productId = await createProduct();
    await as(FAN_A);
    await req("POST", `/storefront/products/${productId}/stock-alert`);
    await as(CREATOR);
    await req("PATCH", `/storefront/products/${productId}`, { inventory: 2 });
    expect(await notificationCount()).toBe(1);
    expect(h.emails).toHaveLength(1);

    /* Sells out, restocks — FAN_A never tapped again: silence. */
    await req("PATCH", `/storefront/products/${productId}`, { inventory: 0 });
    await req("PATCH", `/storefront/products/${productId}`, { inventory: 4 });
    expect(await notificationCount()).toBe(1);
    expect(h.emails).toHaveLength(1);

    /* Sell out again; FAN_A taps again; restock fires for FAN_A once more. */
    await req("PATCH", `/storefront/products/${productId}`, { inventory: 0 });
    await as(FAN_A);
    const re = await req("POST", `/storefront/products/${productId}/stock-alert`);
    expect(re.json).toMatchObject({ subscribed: true, alreadyWaiting: false });
    await as(CREATOR);
    await req("PATCH", `/storefront/products/${productId}`, { inventory: 1 });
    expect(await notificationCount()).toBe(2);
    expect(h.emails).toHaveLength(2);
  });

  it("restocking to unlimited (-1) also fires", async () => {
    const productId = await createProduct();
    await as(FAN_B);
    await req("POST", `/storefront/products/${productId}/stock-alert`);
    await as(CREATOR);
    await req("PATCH", `/storefront/products/${productId}`, { inventory: -1 });
    expect(await notificationCount()).toBe(1);
    expect(h.emails).toHaveLength(0); // FAN_B is not a list subscriber
  });

  it("a non-owner PATCH is refused and fires nothing", async () => {
    const productId = await createProduct();
    await as(FAN_A);
    await req("POST", `/storefront/products/${productId}/stock-alert`);
    await as(OTHER);
    const r = await req("PATCH", `/storefront/products/${productId}`, { inventory: 9 });
    expect(r.status).toBe(404);
    expect(await notificationCount()).toBe(0);
    expect(await waitingRows(productId)).toBe(1);
  });

  it("stocking a draft does not consume waits; taking the stocked product live fires them", async () => {
    const productId = await createProduct();
    await as(FAN_A);
    await req("POST", `/storefront/products/${productId}/stock-alert`);
    await as(CREATOR);
    /* Restock while simultaneously drafting the product: not buyable. */
    await req("PATCH", `/storefront/products/${productId}`, { inventory: 5, isActive: false });
    expect(await notificationCount()).toBe(0);
    expect(await waitingRows(productId)).toBe(1);
    /* Go live with the stock in place: the fans fire now. */
    await req("PATCH", `/storefront/products/${productId}`, { isActive: true });
    expect(await notificationCount()).toBe(1);
    expect(await waitingRows(productId)).toBe(0);
  });
});

describe("graceful degradation (migration held)", () => {
  it("subscribe answers 503, counts read 0, products behave as before", async () => {
    h.withAlerts = false;
    /* Recreate the world without the alerts table. */
    const { db, mem } = createTestDb();
    mem.public.registerFunction({
      name: "gen_random_uuid", args: [], returns: "uuid" as never, impure: true,
      implementation: () => randomUUID(),
    });
    mem.public.none(BASE_DDL);
    h.db = db;
    await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);

    const productId = await createProduct();
    await as(FAN_A);
    const r = await req("POST", `/storefront/products/${productId}/stock-alert`);
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("stock_alerts_unavailable");

    const detail = await req("GET", `/storefront/product/${productId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.product.stockAlertWaiting).toBe(0);
  });
});
