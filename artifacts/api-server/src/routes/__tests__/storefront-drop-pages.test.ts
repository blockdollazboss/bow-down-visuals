/**
 * Timed product drops (Stack-100 #3 #25) — the storefront half.
 * Drives the REAL storefront router over pg-mem with Stripe faked at
 * the lib/stripe-client seam and pins:
 *  - a creator schedules a future drop from the product's own surface
 *    (PUT …/drop); past moments and non-owner writes refuse;
 *  - before the moment, the public product page IS the drop page: the
 *    payload carries the UTC drop instant + upcoming state, checkout
 *    and free-claim both refuse DROP_NOT_LIVE (never publish early),
 *    and the capture door joins the fan to product_drop_captures AND
 *    the creator's existing email list (source 'drop') — no parallel
 *    list, idempotent on re-join;
 *  - capture refuses once the moment passes (DROP_LIVE) and checkout
 *    opens at/after the moment WITHOUT any sweeper flip (read-time
 *    gating), while the sweeper lib flips + notifies separately;
 *  - cancel returns the product to a normal listing; a live drop can't
 *    be cancelled or rescheduled;
 *  - graceful degradation: with the drop tables absent (migration held),
 *    products behave exactly as before and scheduling answers 503.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-drops";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<any>,
  withDrops: true,
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

const BASE_DDL = `
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
);`;

const DROP_DDL = `
CREATE TABLE product_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  drop_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'cancelled')),
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_drops_product_ux ON product_drops (product_id);
CREATE TABLE product_drop_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES product_drops(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  email text NOT NULL, name text, source text NOT NULL DEFAULT 'drop',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_drop_captures_drop_email_ux ON product_drop_captures (drop_id, email);
CREATE TABLE product_drop_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES product_drops(id) ON DELETE CASCADE,
  capture_id uuid REFERENCES product_drop_captures(id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0, provider_id text, last_error text, sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_drop_deliveries_drop_email_idx ON product_drop_deliveries (drop_id, email);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const CREATOR = randomUUID();
const OTHER = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[drops] unhandled route error:", err?.message ?? err);
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
    /* impure: pg-mem otherwise simplifies the call to one constant for
       the whole statement/session and every default id collides. */
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(BASE_DDL + (h.withDrops ? DROP_DDL : ""));
  h.db = db;
  h.userId = CREATOR;
  h.userEmail = "creator@example.com";
  h.stripeCreates = [];
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
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
    kind: "digital", title: "Midnight Pack", description: "Drops soon.",
    priceCents: 1999, inventory: -1, mediaUrls: [], relatedLinks: [], isActive: true,
    ...body,
  });
  expect(r.status).toBe(201);
  return r.json.product.id as string;
}

const futureIso = (ms = 60 * 60 * 1000) => new Date(Date.now() + ms).toISOString();

async function scheduleDrop(productId: string, dropAt: string) {
  h.userId = CREATOR;
  return req("PUT", `/storefront/products/${productId}/drop`, { dropAt });
}

describe("scheduling a drop", () => {
  it("schedules a future drop; the owner read carries it with an empty capture list", async () => {
    const productId = await createProduct();
    const at = futureIso();
    const r = await scheduleDrop(productId, at);
    expect(r.status).toBe(200);
    expect(r.json.drop.state).toBe("upcoming");
    expect(r.json.drop.isUpcoming).toBe(true);
    expect(r.json.drop.dropAt).toBe(new Date(at).toISOString());
    expect(r.json.drop.captureCount).toBe(0);

    h.userId = CREATOR;
    const owner = await req("GET", `/storefront/products/${productId}/drop`);
    expect(owner.status).toBe(200);
    expect(owner.json.drop.dropAt).toBe(new Date(at).toISOString());
    expect(owner.json.captures).toEqual([]);
  });

  it("refuses a past moment, a junk date, and a non-owner", async () => {
    const productId = await createProduct();
    const past = await scheduleDrop(productId, new Date(Date.now() - 60_000).toISOString());
    expect(past.status).toBe(400);
    expect(past.json.error).toBe("DROP_DATE_PAST");

    const junk = await scheduleDrop(productId, "next friday lol");
    expect(junk.status).toBe(400);
    expect(junk.json.error).toBe("DROP_DATE_INVALID");

    h.userId = OTHER;
    const stranger = await req("PUT", `/storefront/products/${productId}/drop`, { dropAt: futureIso() });
    expect(stranger.status).toBe(404);
  });

  it("rescheduling moves the moment and keeps the capture list", async () => {
    const productId = await createProduct();
    await scheduleDrop(productId, futureIso(30 * 60 * 1000));
    const cap = await req("POST", `/storefront/products/${productId}/drop/capture`, { email: "fan@test.dev", name: "Fan" });
    expect(cap.status).toBe(200);

    const moved = futureIso(2 * 60 * 60 * 1000);
    const r = await scheduleDrop(productId, moved);
    expect(r.status).toBe(200);
    expect(r.json.drop.dropAt).toBe(new Date(moved).toISOString());
    expect(r.json.drop.captureCount).toBe(1);
  });
});

describe("the drop page (public product page before the moment)", () => {
  it("carries the upcoming drop + capture count, and checkout/claim refuse DROP_NOT_LIVE with zero Stripe sessions", async () => {
    const productId = await createProduct();
    const at = futureIso();
    await scheduleDrop(productId, at);
    await req("POST", `/storefront/products/${productId}/drop/capture`, { email: "one@test.dev" });
    await req("POST", `/storefront/products/${productId}/drop/capture`, { email: "two@test.dev" });

    const detail = await req("GET", `/storefront/product/${productId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.product.drop.isUpcoming).toBe(true);
    expect(detail.json.drop.state).toBe("upcoming");
    expect(detail.json.drop.dropAt).toBe(new Date(at).toISOString());
    expect(detail.json.drop.captureCount).toBe(2);

    h.userId = BUYER; h.userEmail = "buyer@test.dev";
    const checkout = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    expect(checkout.status).toBe(400);
    expect(checkout.json.error).toBe("DROP_NOT_LIVE");
    expect(checkout.json.dropAt).toBe(new Date(at).toISOString());
    expect(h.stripeCreates).toHaveLength(0);
  });

  it("a free product on an upcoming drop refuses the claim rail too", async () => {
    const productId = await createProduct({ priceCents: 0, title: "Free Taste" });
    await scheduleDrop(productId, futureIso());
    h.userId = BUYER; h.userEmail = "buyer@test.dev";
    const claim = await req("POST", "/storefront/claim", { productId, emailConsent: true, email: "buyer@test.dev" });
    expect(claim.status).toBe(400);
    expect(claim.json.error).toBe("DROP_NOT_LIVE");
  });

  it("capture joins the creator's existing email list (source 'drop'), auto-provisions it, and is idempotent", async () => {
    const productId = await createProduct();
    await scheduleDrop(productId, futureIso());

    const first = await req("POST", `/storefront/products/${productId}/drop/capture`, { email: "Fan@Test.dev", name: "Fan One" });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ ok: true, alreadyCaptured: false, captureCount: 1 });

    const second = await req("POST", `/storefront/products/${productId}/drop/capture`, { email: "fan@test.dev", name: "" });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ ok: true, alreadyCaptured: true, captureCount: 1 });

    const lists = await h.db.execute(sql`SELECT id, name, handle FROM email_lists WHERE user_id = ${CREATOR}`);
    expect(lists.rows).toHaveLength(1);
    expect((lists.rows[0] as any).name).toBe("Queen Creator fans");
    const subs = await h.db.execute(sql`SELECT email, source FROM email_subscribers`);
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0]).toMatchObject({ email: "fan@test.dev", source: "drop" });

    const bad = await req("POST", `/storefront/products/${productId}/drop/capture`, { email: "not-an-email" });
    expect(bad.status).toBe(400);
  });
});

describe("the drop moment (read-time gating — no sweeper needed)", () => {
  it("at the moment: capture refuses DROP_LIVE and checkout opens", async () => {
    const productId = await createProduct();
    await scheduleDrop(productId, futureIso(60_000));
    /* Move the moment into the past directly — the sweeper has NOT run;
       the status row still says 'scheduled'. Reads must already agree
       the drop is live: never early, never late. */
    await h.db.execute(sql`UPDATE product_drops SET drop_at = now() - interval '1 minute' WHERE product_id = ${productId}`);

    const cap = await req("POST", `/storefront/products/${productId}/drop/capture`, { email: "late@test.dev" });
    expect(cap.status).toBe(409);
    expect(cap.json.error).toBe("DROP_LIVE");

    const detail = await req("GET", `/storefront/product/${productId}`);
    expect(detail.json.product.drop.state).toBe("live");
    expect(detail.json.product.drop.isUpcoming).toBe(false);

    h.userId = BUYER; h.userEmail = "buyer@test.dev";
    const checkout = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    /* The gate is open: the request is NOT refused as DROP_NOT_LIVE and
       proceeds into the pre-existing checkout machinery. (A full
       session can't complete under pg-mem — the machinery's
       idempotency count query uses IS NOT DISTINCT FROM, which
       pg-mem's parser cannot run; the lead-magnet suite documents the
       same pre-existing engine gap. Session creation itself is pinned
       by the D4/D5 suites and staging E2E.) */
    expect(checkout.json?.error).not.toBe("DROP_NOT_LIVE");
    expect(checkout.status).not.toBe(400);
  });
});

describe("cancel", () => {
  it("cancelling returns the product to a normal listing (no drop, buyable, capture 404s)", async () => {
    const productId = await createProduct();
    await scheduleDrop(productId, futureIso());

    h.userId = CREATOR;
    const cancel = await req("DELETE", `/storefront/products/${productId}/drop`);
    expect(cancel.status).toBe(200);
    expect(cancel.json.drop).toBeNull();

    const detail = await req("GET", `/storefront/product/${productId}`);
    expect(detail.json.product.drop).toBeNull();
    expect(detail.json.drop).toBeNull();

    const cap = await req("POST", `/storefront/products/${productId}/drop/capture`, { email: "fan@test.dev" });
    expect(cap.status).toBe(404);
    expect(cap.json.error).toBe("NO_DROP");

    h.userId = BUYER; h.userEmail = "buyer@test.dev";
    const checkout = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
    /* Not gated anymore (see the drop-moment test for the pg-mem
       IS NOT DISTINCT FROM caveat on full session creation). */
    expect(checkout.json?.error).not.toBe("DROP_NOT_LIVE");
  });

  it("a live drop can be neither cancelled nor rescheduled", async () => {
    const productId = await createProduct();
    await scheduleDrop(productId, futureIso(60_000));
    await h.db.execute(sql`UPDATE product_drops SET status = 'live' WHERE product_id = ${productId}`);

    h.userId = CREATOR;
    const cancel = await req("DELETE", `/storefront/products/${productId}/drop`);
    expect(cancel.status).toBe(409);
    expect(cancel.json.error).toBe("DROP_ALREADY_LIVE");

    const again = await scheduleDrop(productId, futureIso());
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("DROP_ALREADY_LIVE");
  });
});

describe("graceful degradation (migration held — no drop tables)", () => {
  it("products behave exactly as before; scheduling answers 503 drop_unavailable", async () => {
    /* Rebuild this test's DB without the drop tables (beforeEach built
       it with them — the held-migration world has none at all). */
    const bare = createTestDb();
    bare.mem.public.registerFunction({
      name: "gen_random_uuid",
      args: [],
      returns: "uuid" as never,
      impure: true,
      implementation: () => randomUUID(),
    });
    bare.mem.public.none(BASE_DDL);
    h.db = bare.db;
    await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
    {
      const productId = await createProduct();
      const detail = await req("GET", `/storefront/product/${productId}`);
      expect(detail.status).toBe(200);
      expect(detail.json.product.drop).toBeNull();
      expect(detail.json.drop).toBeNull();

      h.userId = BUYER; h.userEmail = "buyer@test.dev";
      const checkout = await req("POST", "/storefront/checkout", { productId, quantity: 1 });
      /* No drop gate interferes (full session creation hits the same
         pre-existing pg-mem IS NOT DISTINCT FROM gap documented in
         the drop-moment test). */
      expect(checkout.json?.error).not.toBe("DROP_NOT_LIVE");
      expect(checkout.json?.error).not.toBe("drop_unavailable");

      const sched = await scheduleDrop(productId, futureIso());
      expect(sched.status).toBe(503);
      expect(sched.json.error).toBe("drop_unavailable");
    }
  });
});
