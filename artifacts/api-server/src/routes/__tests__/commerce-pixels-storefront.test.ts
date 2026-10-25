/**
 * Commerce tracking pixels (wave-4 #41, migration 0240) — the
 * STOREFRONT rail (routes/storefront.ts; pixels live on the creator
 * profile). Drives the REAL storefront router over pg-mem with Stripe
 * faked at the lib/stripe-client seam and pins:
 *  - GET/PATCH /storefront/pixels round-trips the owner's IDs
 *    (persistence), refuses a bent ID with 400 and writes nothing,
 *    clears on "", and 404s without a creator profile;
 *  - the public listing + product payloads carry the sanitized pixels
 *    (all null when none are set — silence by default);
 *  - POST /storefront/verify — the existing checkout-success path —
 *    carries the seller's pixels with the recorded order, and a
 *    pixel-less seller's verify carries all-null pixels.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-pixels";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  session: null as any,
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
          retrieve: vi.fn(async () => h.session),
        },
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

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  meta_pixel_id text, tiktok_pixel_id text, google_tag_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
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
const NO_PROFILE_USER = randomUUID();
const PROFILE_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[commerce-pixels-storefront] unhandled route error:", err?.message ?? err);
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
  h.session = null;
  h.stripeCreates = [];
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
});

async function req(method: string, path: string, body?: unknown, as?: string) {
  if (as) h.userId = as;
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function setPixels(patch: Record<string, string>) {
  return req("PATCH", "/storefront/pixels", patch, CREATOR);
}

describe("storefront pixels — settings endpoints", () => {
  it("GET starts ready with all-null pixels; PATCH persists; GET reads back", async () => {
    const before = await req("GET", "/storefront/pixels", undefined, CREATOR);
    expect(before.status).toBe(200);
    expect(before.json).toMatchObject({
      ready: true,
      pixels: { metaPixelId: null, tiktokPixelId: null, googleTagId: null },
    });

    const saved = await setPixels({
      metaPixelId: "123456789012345",
      tiktokPixelId: "C9ABCDEFGHIJKLMN12",
      googleTagId: "G-ABC123XYZ9",
    });
    expect(saved.status).toBe(200);
    expect(saved.json.pixels).toEqual({
      metaPixelId: "123456789012345",
      tiktokPixelId: "C9ABCDEFGHIJKLMN12",
      googleTagId: "G-ABC123XYZ9",
    });

    const after = await req("GET", "/storefront/pixels", undefined, CREATOR);
    expect(after.json.pixels).toEqual(saved.json.pixels);
    const row = await h.db.execute(sql`SELECT meta_pixel_id, google_tag_id FROM creator_profiles WHERE id = ${PROFILE_ID}`);
    expect(row.rows[0]).toMatchObject({ meta_pixel_id: "123456789012345", google_tag_id: "G-ABC123XYZ9" });
  });

  it("a bent ID is refused (400) and nothing is written", async () => {
    await setPixels({ metaPixelId: "123456789012345" });
    const bad = await setPixels({ metaPixelId: "123456789012345", tiktokPixelId: "has spaces!" });
    expect(bad.status).toBe(400);
    expect(String(bad.json.error)).toContain("TikTok Pixel");
    const after = await req("GET", "/storefront/pixels", undefined, CREATOR);
    expect(after.json.pixels).toEqual({ metaPixelId: "123456789012345", tiktokPixelId: null, googleTagId: null });
  });

  it('"" clears one field and leaves the others', async () => {
    await setPixels({ metaPixelId: "123456789012345", googleTagId: "G-ABC123XYZ9" });
    const cleared = await setPixels({ metaPixelId: "" });
    expect(cleared.json.pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: "G-ABC123XYZ9" });
  });

  it("no creator profile → 404 on both verbs", async () => {
    expect((await req("GET", "/storefront/pixels", undefined, NO_PROFILE_USER)).status).toBe(404);
    expect((await req("PATCH", "/storefront/pixels", { metaPixelId: "123456" }, NO_PROFILE_USER)).status).toBe(404);
  });
});

describe("storefront pixels — public payloads", () => {
  it("listing + product payloads carry the sanitized pixels", async () => {
    await setPixels({ metaPixelId: "123456789012345" });
    h.userId = CREATOR;
    const created = await req("POST", "/storefront/products", {
      kind: "digital", title: "Full Album", description: "", priceCents: 2000,
      mediaUrls: ["https://cdn.example.com/album.zip"],
    });
    expect(created.status).toBe(201);
    const productId = created.json.product.id as string;

    const listing = await req("GET", "/storefront/products?slug=queen-creator");
    expect(listing.status).toBe(200);
    expect(listing.json.pixels).toEqual({ metaPixelId: "123456789012345", tiktokPixelId: null, googleTagId: null });

    const detail = await req("GET", `/storefront/product/${productId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.pixels.metaPixelId).toBe("123456789012345");
  });

  it("no IDs set → public payloads are all null", async () => {
    const listing = await req("GET", "/storefront/products?slug=queen-creator");
    expect(listing.json.pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: null });
  });
});

describe("storefront pixels — checkout-success (verify) payload", () => {
  async function paidSession(productId: string) {
    h.session = {
      id: "cs_test_pixels",
      payment_status: "paid",
      amount_total: 2000,
      metadata: {
        type: "storefront_purchase",
        buyer_user_id: BUYER,
        profile_id: PROFILE_ID,
        product_id: productId,
        product_kind: "digital",
        quantity: "1",
        discount_code: "",
        amount_cents: "2000",
        event_id: "",
      },
    };
  }

  it("verify carries the seller's pixels with the recorded order", async () => {
    await setPixels({ metaPixelId: "123456789012345", googleTagId: "G-ABC123XYZ9" });
    h.userId = CREATOR;
    const created = await req("POST", "/storefront/products", {
      kind: "digital", title: "Full Album", description: "", priceCents: 2000,
      mediaUrls: ["https://cdn.example.com/album.zip"],
    });
    const productId = created.json.product.id as string;
    await paidSession(productId);
    const v = await req("POST", "/storefront/verify", { sessionId: "cs_test_pixels" }, BUYER);
    expect(v.status).toBe(200);
    expect(v.json.success).toBe(true);
    expect(v.json.order.amountCents).toBe(2000);
    expect(v.json.pixels).toEqual({
      metaPixelId: "123456789012345",
      tiktokPixelId: null,
      googleTagId: "G-ABC123XYZ9",
    });
  });

  it("a pixel-less seller's verify carries all-null pixels", async () => {
    h.userId = CREATOR;
    const created = await req("POST", "/storefront/products", {
      kind: "digital", title: "Full Album", description: "", priceCents: 2000,
      mediaUrls: ["https://cdn.example.com/album.zip"],
    });
    const productId = created.json.product.id as string;
    await paidSession(productId);
    const v = await req("POST", "/storefront/verify", { sessionId: "cs_test_pixels" }, BUYER);
    expect(v.status).toBe(200);
    expect(v.json.pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: null });
  });
});
