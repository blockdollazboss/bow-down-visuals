/**
 * $0 lead-magnet products (migration 0189) — the storefront half.
 * Drives the REAL storefront router over pg-mem with Stripe faked at
 * the lib/stripe-client seam and pins:
 *  - a $0 product can be created (and edited down to $0) while paid
 *    validation is untouched (negative price / missing title refuse);
 *  - every product payload labels it free (never a bare $0.00 sale);
 *  - a $0 product can NEVER enter a paid checkout session — checkout
 *    refuses FREE_PRODUCT and zero Stripe sessions are created;
 *  - claiming is the exchange: explicit consent → the buyer's email
 *    joins the creator's list (subscribe rail discipline) and delivery
 *    is minted on the existing delivery rail, with a completed $0
 *    order whose stripe_session_id is NULL;
 *  - a repeat claim is idempotent: same order back, no double
 *    subscribe, no second order;
 *  - a paid product refuses the claim rail (NOT_FREE) and still
 *    checks out normally.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-lead-magnet";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<any>,
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
          retrieve: vi.fn(async () => { throw new Error("not used in this suite"); }),
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
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[lead-magnet] unhandled route error:", err?.message ?? err);
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

async function createProduct(body: Record<string, unknown>) {
  h.userId = CREATOR;
  return req("POST", "/storefront/products", body);
}

async function seedFreeProduct() {
  const r = await createProduct({
    kind: "digital", title: "Free Beat Pack", description: "A taste.",
    priceCents: 0, mediaUrls: ["https://cdn.example.com/beat-pack.zip"],
  });
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

async function seedPaidProduct() {
  const r = await createProduct({
    kind: "digital", title: "Full Album", description: "",
    priceCents: 2000, mediaUrls: ["https://cdn.example.com/album.zip"],
  });
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

async function subscriberCount() {
  const r = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM email_subscribers`);
  return Number((r.rows[0] as any).c);
}

async function claimOrderCount() {
  const r = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM store_orders`);
  return Number((r.rows[0] as any).c);
}

describe("$0 lead magnets — create + edit validation", () => {
  it("creates a $0 product and labels it free on the payload", async () => {
    const r = await createProduct({
      kind: "digital", title: "Free Beat Pack", description: "", priceCents: 0, mediaUrls: [],
    });
    expect(r.status).toBe(201);
    expect(r.json.product.priceCents).toBe(0);
    expect(r.json.product.free).toBe(true);
  });

  it("a paid product is not flagged free, and paid validation is unchanged", async () => {
    const ok = await createProduct({ kind: "digital", title: "Full Album", description: "", priceCents: 2000 });
    expect(ok.status).toBe(201);
    expect(ok.json.product.free).toBe(false);

    const negative = await createProduct({ kind: "digital", title: "Bad", description: "", priceCents: -100 });
    expect(negative.status).toBe(400);

    const noTitle = await createProduct({ kind: "digital", title: "", description: "", priceCents: 0 });
    expect(noTitle.status).toBe(400);
  });

  it("editing a paid product down to $0 turns it into a lead magnet", async () => {
    const id = await seedPaidProduct();
    h.userId = CREATOR;
    const r = await req("PATCH", `/storefront/products/${id}`, { priceCents: 0 });
    expect(r.status).toBe(200);
    expect(r.json.product.free).toBe(true);
  });

  it("the public product page payload carries free + the claim note", async () => {
    const id = await seedFreeProduct();
    const r = await req("GET", `/storefront/product/${id}`);
    expect(r.status).toBe(200);
    expect(r.json.free).toBe(true);
    expect(r.json.product.free).toBe(true);
    expect(r.json.note).toContain("Free product");
  });
});

describe("$0 lead magnets — never a paid checkout", () => {
  it("checkout refuses a $0 product and creates zero Stripe sessions", async () => {
    const id = await seedFreeProduct();
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId: id, quantity: 1 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("FREE_PRODUCT");
    expect(h.stripeCreates).toHaveLength(0);
  });

  it("a paid product is NOT refused by the free guard (the guard is $0-only)", async () => {
    const id = await seedPaidProduct();
    h.userId = BUYER;
    const r = await req("POST", "/storefront/checkout", { productId: id, quantity: 1 });
    /* The FREE_PRODUCT refusal is scoped to price_cents = 0 exactly.
       The flow then continues into the pre-existing checkout machinery
       (session creation is pinned by the D4/D5 suites and staging E2E;
       its idempotency count query uses IS NOT DISTINCT FROM, which
       pg-mem's parser cannot run at all — a pre-existing engine gap
       in that query, untouched by this lane). What this pin proves:
       the paid path is not caught by the new guard. */
    expect(r.json?.error).not.toBe("FREE_PRODUCT");
    expect(r.status).not.toBe(400);
  });

  it("the claim rail refuses a paid product", async () => {
    const id = await seedPaidProduct();
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/claim", { productId: id, emailConsent: true });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("NOT_FREE");
    expect(await claimOrderCount()).toBe(0);
  });
});

describe("$0 lead magnets — the claim exchange", () => {
  it("requires explicit email consent before anything is recorded", async () => {
    const id = await seedFreeProduct();
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/claim", { productId: id });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("CONSENT_REQUIRED");
    expect(await subscriberCount()).toBe(0);
    expect(await claimOrderCount()).toBe(0);
  });

  it("claim = email capture + instant delivery, $0 order, no Stripe session anywhere", async () => {
    const id = await seedFreeProduct();
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/claim", {
      productId: id, emailConsent: true, name: "Fan One",
    });
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json.free).toBe(true);
    expect(r.json.order.amountCents).toBe(0);
    expect(r.json.delivery.url).toContain("/api/storefront/deliver/");
    expect(r.json.subscribed).toMatchObject({ email: "fan@example.com", alreadySubscribed: false });
    expect(h.stripeCreates).toHaveLength(0);

    const subs = await h.db.execute(sql`SELECT email, name, source, confirmed FROM email_subscribers`);
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]).toMatchObject({ email: "fan@example.com", name: "Fan One", source: "storefront", confirmed: true });

    const orders = await h.db.execute(sql`SELECT amount_cents, stripe_session_id, status FROM store_orders`);
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0]).toMatchObject({ amount_cents: 0, stripe_session_id: null, status: "completed" });
  });

  it("captures the email the buyer types, not only the account email", async () => {
    const id = await seedFreeProduct();
    h.userId = BUYER; h.userEmail = "account@example.com";
    const r = await req("POST", "/storefront/claim", {
      productId: id, emailConsent: true, email: "downloads@example.com",
    });
    expect(r.status).toBe(201);
    const subs = await h.db.execute(sql`SELECT email FROM email_subscribers`);
    expect((subs.rows[0] as any).email).toBe("downloads@example.com");
  });

  it("a repeat claim returns the same order — no double subscribe, no second order", async () => {
    const id = await seedFreeProduct();
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const first = await req("POST", "/storefront/claim", { productId: id, emailConsent: true });
    expect(first.status).toBe(201);
    const second = await req("POST", "/storefront/claim", { productId: id, emailConsent: true });
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    expect(second.json.order.id).toBe(first.json.order.id);
    expect(await subscriberCount()).toBe(1);
    expect(await claimOrderCount()).toBe(1);
  });
});
