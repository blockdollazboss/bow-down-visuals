/**
 * Office Hours 2D door (stack1300 #167) — the two OLD doors refuse.
 *
 * The Office Hours server rail (lib/office-hours.ts) is complete, but
 * until this lane the only product shape the new 2D door creates —
 * price_cents 0, bookable, flagged office_hours — was ALSO reachable
 * through the two pre-existing doors, and neither consulted the flag:
 *   - POST /storefront/claim treats a bookable $0 service's claim AS
 *     its booking: an Office Hours session could be claimed FREE,
 *     no Visual Bucs charged, slot confirmed.
 *   - POST /storefront/checkout on an office-hours product carrying a
 *     dollar price would sell the VB session for dollars through
 *     Stripe, writing a dollar booking with no messages_call trailer.
 * Both now refuse with OFFICE_HOURS_VB and point at the VB door.
 * The VB door itself (slots naming it + the book endpoint) is pinned
 * here too, with the credits charge stubbed at the lib/office-hours
 * seam — the charge's own behaviour is lib-tested in office-hours.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-office-hours-door";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  sessions: new Map<string, any>(),
  sessionSeq: 0,
  createCalls: [] as Array<{ params: any; options: any }>,
  chargeCalls: [] as Array<{ buyerUserId: string; priceVb: number; chargeKey: string }>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
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
            h.sessionSeq += 1;
            const id = `cs_test_${h.sessionSeq}`;
            const session = {
              id,
              url: "https://checkout.example.com/pay",
              payment_status: "paid",
              payment_intent: `pi_test_${h.sessionSeq}`,
              amount_total: 0,
              metadata: params.metadata ?? {},
            };
            h.sessions.set(id, session);
            h.createCalls.push({ params, options });
            return session;
          }),
          retrieve: vi.fn(async (id: string) => h.sessions.get(id)),
        },
      },
    })),
  };
});

/* The VB charge is stubbed at the office-hours seam: the route's job
   is routing + the booking record, and the charge's idempotency /
   refund behaviour is pinned by lib/__tests__/office-hours.test.ts. */
vi.mock("../../lib/office-hours", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    chargeOfficeHoursBooking: vi.fn(async (args: { buyerUserId: string; priceVb: number; chargeKey: string }) => {
      h.chargeCalls.push(args);
      return { ok: true as const, balanceAfter: 900 };
    }),
    refundOfficeHoursBooking: vi.fn(async () => true),
    officeHoursChargeLanded: vi.fn(async () => false),
  };
});

import storefrontRouter from "../storefront";
import { createTestDb } from "../../lib/__tests__/test-db";
import { decodeBookingNote } from "../../lib/booking-note";
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
, affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer, media_alt_texts jsonb NOT NULL DEFAULT '[]', gift_card_denominations_cents jsonb, bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0);
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
CREATE TABLE discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL,
  code text NOT NULL, percent_off integer NOT NULL,
  max_uses integer NOT NULL DEFAULT -1, used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
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
);
CREATE TABLE job_notifications (
  id uuid DEFAULT gen_random_uuid(),
  job_type text NOT NULL, job_id text NOT NULL, user_id uuid NOT NULL,
  status text NOT NULL, title text NOT NULL, message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jn_pk PRIMARY KEY (id),
  CONSTRAINT jn_uniq UNIQUE (job_type, job_id)
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const CREATOR = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();
const LIST_ID = randomUUID();

const NY_AVAILABILITY = {
  timezone: "America/New_York",
  weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })),
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[office-hours-door] unhandled route error:", err?.message ?? err);
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
  mem.public.none("DROP TABLE job_notifications");
  mem.public.none(DDL);
  h.db = db;
  h.userId = CREATOR;
  h.userEmail = "creator@example.com";
  h.sessions = new Map();
  h.sessionSeq = 0;
  h.createCalls = [];
  h.chargeCalls = [];
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

function asBuyer() { h.userId = BUYER; h.userEmail = "buyer@example.com"; }

async function seedOfficeHours(opts: { priceCents?: number; priceVb?: number } = {}) {
  const id = randomUUID();
  const sd = {
    duration_min: 60,
    location: "Messages video call",
    booking_enabled: true,
    availability: NY_AVAILABILITY,
    office_hours: true,
    price_vb: opts.priceVb ?? 500,
  };
  await h.db.execute(sql`
    INSERT INTO store_products (id, profile_id, kind, title, price_cents, service_details)
    VALUES (${id}, ${PROFILE_ID}, 'service', 'Office Hours: Song Review', ${opts.priceCents ?? 0}, ${JSON.stringify(sd)}::jsonb)
  `);
  return id;
}

async function seedFreeBookableService() {
  const id = randomUUID();
  const sd = { duration_min: 60, booking_enabled: true, availability: NY_AVAILABILITY };
  await h.db.execute(sql`
    INSERT INTO store_products (id, profile_id, kind, title, price_cents, service_details)
    VALUES (${id}, ${PROFILE_ID}, 'service', 'Free Intro Call', 0, ${JSON.stringify(sd)}::jsonb)
  `);
  return id;
}

async function firstSlot(productId: string) {
  const r = await req("GET", `/storefront/product/${productId}/slots`);
  expect(r.status).toBe(200);
  expect(r.json.bookable).toBe(true);
  return r.json.days[0].slots[0] as { startUtc: string; endUtc: string };
}

async function orderCount() {
  const r = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM store_orders`);
  return Number((r.rows[0] as any).c);
}

describe("the slots read names the VB door", () => {
  it("an Office Hours service serves officeHours, priceVb and its book endpoint", async () => {
    const id = await seedOfficeHours();
    const r = await req("GET", `/storefront/product/${id}/slots`);
    expect(r.status).toBe(200);
    expect(r.json.bookable).toBe(true);
    expect(r.json.officeHours).toBe(true);
    expect(r.json.priceVb).toBe(500);
    expect(r.json.bookEndpoint).toBe(`/api/storefront/product/${id}/office-hours/book`);
  });
});

describe("the old doors refuse Office Hours", () => {
  it("claim refuses: a VB session is never claimed free", async () => {
    const id = await seedOfficeHours();
    const slot = await firstSlot(id);
    asBuyer();
    const r = await req("POST", "/storefront/claim", {
      productId: id, emailConsent: true, bookingStartUtc: slot.startUtc, buyerTimezone: "UTC",
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("OFFICE_HOURS_VB");
    expect(await orderCount()).toBe(0);
    expect(h.chargeCalls).toHaveLength(0);
  });

  it("checkout refuses a dollar-priced Office Hours product before any Stripe session exists", async () => {
    const id = await seedOfficeHours({ priceCents: 5000 });
    asBuyer();
    const r = await req("POST", "/storefront/checkout", { productId: id, quantity: 1 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("OFFICE_HOURS_VB");
    expect(h.createCalls).toHaveLength(0);
    expect(await orderCount()).toBe(0);
  });

  it("checkout refuses a $0 Office Hours product as OFFICE_HOURS_VB, not as a free claim", async () => {
    const id = await seedOfficeHours();
    asBuyer();
    const r = await req("POST", "/storefront/checkout", { productId: id, quantity: 1 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("OFFICE_HOURS_VB");
  });

  it("the guard does not overreach: a genuine free bookable service still claims", async () => {
    const id = await seedFreeBookableService();
    const slot = await firstSlot(id);
    asBuyer();
    const r = await req("POST", "/storefront/claim", {
      productId: id, emailConsent: true, bookingStartUtc: slot.startUtc, buyerTimezone: "UTC",
    });
    expect(r.status).toBe(201);
    expect(await orderCount()).toBe(1);
  });
});

describe("the VB door itself", () => {
  it("books: 201, dollar columns stay 0, the record carries the Messages trailer, the answer names the Messages door", async () => {
    const id = await seedOfficeHours();
    const slot = await firstSlot(id);
    asBuyer();
    const r = await req("POST", `/storefront/product/${id}/office-hours/book`, {
      bookingStartUtc: slot.startUtc, buyerTimezone: "UTC",
    });
    expect(r.status).toBe(201);
    expect(r.json.booked).toBe(true);
    expect(r.json.priceVb).toBe(500);
    expect(r.json.balanceAfter).toBe(900);
    expect(r.json.messagesUrl).toBe(`/messages?to=${CREATOR}`);
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.chargeCalls[0]!.priceVb).toBe(500);
    const rows = await h.db.execute(sql`SELECT amount_cents, fulfillment_note FROM store_orders`);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as any;
    expect(Number(row.amount_cents)).toBe(0);
    const rec = decodeBookingNote(String(row.fulfillment_note));
    expect(rec?.md).toBe("messages_call");
    expect(rec?.vb).toBe(500);
  });
});
