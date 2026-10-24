/**
 * Creator Courses — the storefront rail half (pg-mem, Stripe faked at
 * the lib/stripe-client seam, the lead-magnet harness).
 *
 * Pins what kind='course' changes on the EXISTING storefront flows:
 *  - a course product is created/listed like any other product, with
 *    the creator's own price (no course price is invented anywhere);
 *  - checkout is binary (Paid Series rule): quantity must be 1, and a
 *    buyer with a completed order is refused ALREADY_OWNED with the
 *    learn link — a refunded order does not block buying back in;
 *  - verify records the completed order (the entitlement) with the
 *    course fulfillment note, NO delivery token (a course delivers
 *    access, not a file), and the My Courses learn link;
 *  - a $0 course rides the claim rail: the completed $0 order is the
 *    unlock, with the same fulfillment note + learn link.
 *
 * NOTE: this suite's DDL already allows kind='course'; the real
 * database only accepts it once the held courses migration lands
 * (lane MIGRATION-NEEDED.md) — pre-migration the DB CHECK refuses
 * course rows, which is the intended fail-closed behavior.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-courses";

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
CREATE TABLE store_delivery_tokens (
  token text PRIMARY KEY, order_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0,
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
CREATE TABLE event_rsvps (
  event_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (event_id, user_id)
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const CREATOR = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();
const LIST_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
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
  await h.db.execute(sql`INSERT INTO email_lists (id, user_id, name) VALUES (${LIST_ID}, ${CREATOR}, 'Queen''s List')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function seedCourse(priceCents = 4900) {
  h.userId = CREATOR;
  const r = await req("POST", "/storefront/products", {
    kind: "course", title: "Mix Like a Pro", description: "The full vocal chain.", priceCents,
  });
  expect(r.status).toBe(201);
  expect(r.json.product.kind).toBe("course");
  expect(r.json.product.priceCents).toBe(priceCents);
  return r.json.product.id as string;
}

async function seedOrder(productId: string, status = "completed") {
  await h.db.execute(sql`
    INSERT INTO store_orders (buyer_user_id, profile_id, product_id, product_title, product_kind, quantity, amount_cents, status)
    VALUES (${BUYER}, ${PROFILE_ID}, ${productId}, 'Mix Like a Pro', 'course', 1, 4900, ${status})
  `);
}

describe("storefront course — checkout guards", () => {
  it("a course can't be bought twice over: quantity > 1 is refused before Stripe", async () => {
    const id = await seedCourse();
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId: id, quantity: 2 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("COURSE_SINGLE");
    expect(h.stripeCreates).toHaveLength(0);
  });

  it("a completed order refuses a second checkout with the learn link", async () => {
    const id = await seedCourse();
    await seedOrder(id);
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId: id, quantity: 1 });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("ALREADY_OWNED");
    expect(r.json.learnUrl).toBe("/academy?tab=courses");
    expect(h.stripeCreates).toHaveLength(0);
  });
});

describe("storefront course — verify is the entitlement", () => {
  it("verify records the order with the course note, no delivery token, and the learn link", async () => {
    const id = await seedCourse();
    h.session = {
      id: "cs_test_course_1",
      payment_status: "paid",
      amount_total: 4900,
      metadata: {
        type: "storefront_purchase",
        buyer_user_id: BUYER,
        profile_id: PROFILE_ID,
        product_id: id,
        product_kind: "course",
        quantity: "1",
        discount_code: "",
        amount_cents: "4900",
        platform_fee_cents: "245",
        creator_amount_cents: "4655",
        event_id: "",
      },
    };
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/verify", { sessionId: "cs_test_course_1" });
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.delivery).toBeNull();
    expect(r.json.order.fulfillmentNote).toContain("Course unlocked");
    expect(r.json.links.learnUrl).toBe("/academy?tab=courses");
    /* Flat 5% rail math, unchanged: 4900 → 245 fee / 4655 creator. */
    expect(r.json.order.platformFeeCents).toBe(245);
    expect(r.json.order.creatorAmountCents).toBe(4655);

    const orders = await h.db.execute(sql`SELECT product_kind, status, fulfillment_note FROM store_orders`);
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0]).toMatchObject({ product_kind: "course", status: "completed" });
    const tokens = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM store_delivery_tokens`);
    expect(Number((tokens.rows[0] as any).c)).toBe(0);
  });
});

describe("storefront course — free course claim", () => {
  it("a $0 course claims into a completed order with the course note + learn link", async () => {
    const id = await seedCourse(0);
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/claim", { productId: id, emailConsent: true });
    expect(r.status).toBe(201);
    expect(r.json.order.productKind).toBe("course");
    expect(r.json.order.fulfillmentNote).toContain("Course unlocked");
    expect(r.json.links.learnUrl).toBe("/academy?tab=courses");
    expect(r.json.delivery).toBeNull();
    const orders = await h.db.execute(sql`SELECT amount_cents, status FROM store_orders`);
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0]).toMatchObject({ amount_cents: 0, status: "completed" });
  });
});
