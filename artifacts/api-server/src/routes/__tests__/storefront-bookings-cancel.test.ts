/**
 * Paid bookings (lane F5) — bookings list, cancellation, free bookings,
 * and the legacy request/confirm guard. Drives the REAL storefront
 * router over pg-mem with Stripe faked at the lib/stripe-client seam:
 *  - both sides see the booking (buyer role / seller role), strangers
 *    see nothing, and statuses derive upcoming → done → cancelled;
 *  - either side can cancel: a paid booking refunds IN FULL through
 *    Stripe with the store rail's idempotency shape, exactly once, the
 *    order reads 'refunded' only when the refund really happened, the
 *    slot returns to the calendar, and the other side is notified;
 *  - a failed refund still cancels but the record says refund_failed —
 *    never a lie about money;
 *  - a held (unpaid) booking cancels with no Stripe call at all;
 *  - a $0 bookable service books through the claim rail: confirmed
 *    instantly, same-slot re-claim is the same booking, a second buyer
 *    racing the slot 409s, and cancelling frees the slot;
 *  - legacy (non-calendar) services keep the old confirm/decline flow,
 *    and service-confirm REFUSES to touch a calendar booking (its note
 *    overwrite would wipe the slot record).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-bookings-cancel";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  sessions: new Map<string, any>(),
  sessionSeq: 0,
  refundCalls: [] as Array<{ params: any; options: any }>,
  refundFails: false,
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
            h.sessionSeq += 1;
            const id = `cs_test_${h.sessionSeq}`;
            const unit = params.line_items?.[0]?.price_data?.unit_amount ?? 0;
            const qty = params.line_items?.[0]?.quantity ?? 1;
            const session = {
              id,
              url: "https://checkout.example.com/pay",
              payment_status: "paid",
              payment_intent: `pi_test_${h.sessionSeq}`,
              amount_total: unit * qty,
              metadata: params.metadata ?? {},
            };
            h.sessions.set(id, session);
            return session;
          }),
          retrieve: vi.fn(async (id: string) => {
            const s = h.sessions.get(id);
            if (!s) throw new Error("No such checkout session");
            return s;
          }),
        },
      },
      refunds: {
        create: vi.fn(async (params: any, options: any) => {
          h.refundCalls.push({ params, options });
          if (h.refundFails) throw new Error("card network refused the refund");
          return { id: "re_test_1", status: "succeeded" };
        }),
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
import { encodeBookingNote, decodeBookingNote, type BookingRecord } from "../../lib/booking-note";
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
const BUYER2 = randomUUID();
const STRANGER = randomUUID();
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
    console.error("[bookings-cancel] unhandled route error:", err?.message ?? err);
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
  mem.public.none("DROP TABLE job_notifications");
  mem.public.none(DDL);
  h.db = db;
  h.userId = CREATOR;
  h.userEmail = "creator@example.com";
  h.sessions = new Map();
  h.sessionSeq = 0;
  h.refundCalls = [];
  h.refundFails = false;
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

async function seedService(opts: { priceCents?: number; bookable?: boolean } = {}) {
  const id = randomUUID();
  const sd: Record<string, unknown> = { duration_min: 60, location: "Zoom" };
  if (opts.bookable !== false) {
    sd["booking_enabled"] = true;
    sd["availability"] = NY_AVAILABILITY;
  }
  await h.db.execute(sql`
    INSERT INTO store_products (id, profile_id, kind, title, price_cents, service_details)
    VALUES (${id}, ${PROFILE_ID}, 'service', '1:1 Coaching Call', ${opts.priceCents ?? 5000}, ${JSON.stringify(sd)}::jsonb)
  `);
  return id;
}

/** Seed an order row directly (explicit id — pg-mem caches registered
 *  function results, so seeded rows never rely on the uuid default). */
async function seedOrder(args: {
  buyer: string;
  productId: string;
  status?: string;
  note: string | null;
  amountCents?: number;
  sessionId?: string | null;
}) {
  const id = randomUUID();
  await h.db.execute(sql`
    INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id, product_title, product_kind,
      quantity, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status, fulfillment_note)
    VALUES (${id}, ${args.buyer}, ${PROFILE_ID}, ${args.productId}, '1:1 Coaching Call', 'service',
      1, ${args.amountCents ?? 5000}, 250, 4750, ${args.sessionId ?? null}, ${args.status ?? "completed"}, ${args.note})
  `);
  return id;
}

function bookingRec(start: Date, hoursFromStart = 1, st: BookingRecord["st"] = "confirmed"): BookingRecord {
  return {
    v: 1,
    s: start.toISOString(),
    e: new Date(start.getTime() + hoursFromStart * 3_600_000).toISOString(),
    ctz: "America/New_York",
    btz: "America/Chicago",
    st,
  };
}

/** Full happy path over HTTP: pick the first open slot, pay, verify. */
async function bookPaidSlot(productId: string, buyer: string, email: string) {
  const slots = await req("GET", `/storefront/product/${productId}/slots`);
  expect(slots.status).toBe(200);
  const slot = slots.json.days[0].slots[0];
  h.userId = buyer; h.userEmail = email;
  const co = await req("POST", "/storefront/checkout", {
    productId, quantity: 1, bookingStartUtc: slot.startUtc, buyerTimezone: "America/Chicago",
  });
  expect(co.status).toBe(200);
  const v = await req("POST", "/storefront/verify", { sessionId: co.json.sessionId });
  expect(v.status).toBe(200);
  return { orderId: v.json.order.id as string, sessionId: co.json.sessionId as string, slot };
}

async function orderRow(orderId: string) {
  const r = await h.db.execute(sql`SELECT status, fulfillment_note FROM store_orders WHERE id = ${orderId}`);
  return r.rows[0] as Record<string, unknown>;
}

async function notificationsFor(userId: string, jobType: string) {
  const r = await h.db.execute(sql`
    SELECT COUNT(*)::int AS c FROM job_notifications WHERE user_id = ${userId} AND job_type = ${jobType}
  `);
  return Number((r.rows[0] as any).c);
}

describe("bookings list — both sides, honest statuses", () => {
  it("buyer and seller see the booking; a stranger sees nothing; statuses derive", async () => {
    const productId = await seedService();
    const future = new Date(Date.now() + 3 * 86_400_000);
    const past = new Date(Date.now() - 2 * 86_400_000);
    await seedOrder({ buyer: BUYER, productId, note: encodeBookingNote(bookingRec(future)) });
    await seedOrder({ buyer: BUYER, productId, note: encodeBookingNote(bookingRec(past)) });
    const cancelledRec = { ...bookingRec(future), st: "cancelled" as const, ca: "buyer" as const, rf: "refunded" as const };
    await seedOrder({ buyer: BUYER, productId, status: "refunded", note: encodeBookingNote(cancelledRec) });
    /* A legacy service order (no trailer) is NOT a booking. */
    await seedOrder({ buyer: BUYER, productId, note: "Booking request received — the creator confirms your slot from their dashboard." });

    h.userId = BUYER; h.userEmail = "fan@example.com";
    const asBuyer = await req("GET", "/storefront/bookings");
    expect(asBuyer.status).toBe(200);
    expect(asBuyer.json.bookings).toHaveLength(3);
    expect(asBuyer.json.bookings.map((b: any) => b.status)).toEqual(["upcoming", "done", "cancelled"]);
    expect(asBuyer.json.bookings[0].role).toBe("buyer");
    expect(asBuyer.json.bookings[0].creatorTimezone).toBe("America/New_York");
    expect(asBuyer.json.bookings[0].buyerTimezone).toBe("America/Chicago");
    expect(asBuyer.json.counts).toEqual({ upcoming: 1, done: 1, cancelled: 1 });

    h.userId = CREATOR; h.userEmail = "creator@example.com";
    const asSeller = await req("GET", "/storefront/bookings");
    expect(asSeller.json.bookings).toHaveLength(3);
    expect(asSeller.json.bookings[0].role).toBe("seller");

    h.userId = STRANGER; h.userEmail = "stranger@example.com";
    const asStranger = await req("GET", "/storefront/bookings");
    expect(asStranger.json.bookings).toHaveLength(0);
  });
});

describe("cancellation — either side, refund through Stripe", () => {
  it("buyer cancels: full Stripe refund exactly once, order refunded, slot freed, seller notified", async () => {
    const productId = await seedService();
    const { orderId, sessionId, slot } = await bookPaidSlot(productId, BUYER, "fan@example.com");
    const pi = h.sessions.get(sessionId).payment_intent;

    h.userId = BUYER; h.userEmail = "fan@example.com";
    const c = await req("POST", `/storefront/orders/${orderId}/booking-cancel`, {});
    expect(c.status).toBe(200);
    expect(c.json.refunded).toBe(true);
    expect(c.json.refundState).toBe("refunded");
    expect(h.refundCalls).toHaveLength(1);
    expect(h.refundCalls[0]!.params).toEqual({ payment_intent: pi });
    expect(h.refundCalls[0]!.options).toEqual({ idempotencyKey: `refund:${sessionId}` });

    const row = await orderRow(orderId);
    expect(row["status"]).toBe("refunded");
    const rec = decodeBookingNote(row["fulfillment_note"] as string);
    expect(rec).toMatchObject({ st: "cancelled", ca: "buyer", rf: "refunded" });
    expect(await notificationsFor(CREATOR, "storefront_booking_cancelled")).toBe(1);

    /* The slot is back on the calendar. */
    const slots = await req("GET", `/storefront/product/${productId}/slots`);
    const all = (slots.json.days as Array<any>).flatMap((d) => d.slots.map((s: any) => s.startUtc));
    expect(all).toContain(slot.startUtc);

    /* A second cancel is a truthful no-op — no second refund. */
    const c2 = await req("POST", `/storefront/orders/${orderId}/booking-cancel`, {});
    expect(c2.status).toBe(200);
    expect(c2.json.alreadyCancelled).toBe(true);
    expect(h.refundCalls).toHaveLength(1);
  });

  it("seller cancels: buyer is refunded and notified", async () => {
    const productId = await seedService();
    const { orderId } = await bookPaidSlot(productId, BUYER, "fan@example.com");
    h.userId = CREATOR; h.userEmail = "creator@example.com";
    const c = await req("POST", `/storefront/orders/${orderId}/booking-cancel`, {});
    expect(c.status).toBe(200);
    expect(c.json.refunded).toBe(true);
    expect(h.refundCalls).toHaveLength(1);
    const rec = decodeBookingNote((await orderRow(orderId))["fulfillment_note"] as string);
    expect(rec).toMatchObject({ st: "cancelled", ca: "creator", rf: "refunded" });
    expect(await notificationsFor(BUYER, "storefront_booking_cancelled")).toBe(1);
  });

  it("a failed refund still cancels — but the record says refund_failed, never 'refunded'", async () => {
    const productId = await seedService();
    const { orderId } = await bookPaidSlot(productId, BUYER, "fan@example.com");
    h.refundFails = true;
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const c = await req("POST", `/storefront/orders/${orderId}/booking-cancel`, {});
    expect(c.status).toBe(200);
    expect(c.json.refunded).toBe(false);
    expect(c.json.refundState).toBe("refund_failed");
    const row = await orderRow(orderId);
    expect(row["status"]).toBe("cancelled");
    expect(decodeBookingNote(row["fulfillment_note"] as string)).toMatchObject({ st: "cancelled", rf: "refund_failed" });
  });

  it("a third party cannot cancel someone else's booking", async () => {
    const productId = await seedService();
    const { orderId } = await bookPaidSlot(productId, BUYER, "fan@example.com");
    h.userId = STRANGER; h.userEmail = "stranger@example.com";
    const c = await req("POST", `/storefront/orders/${orderId}/booking-cancel`, {});
    expect(c.status).toBe(403);
    expect(h.refundCalls).toHaveLength(0);
    expect((await orderRow(orderId))["status"]).toBe("completed");
  });

  it("a held (unpaid) booking cancels with no Stripe call", async () => {
    const productId = await seedService();
    const future = new Date(Date.now() + 2 * 86_400_000);
    const orderId = await seedOrder({
      buyer: BUYER, productId, status: "booking_held",
      note: encodeBookingNote(bookingRec(future, 1, "held")), sessionId: null,
    });
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const c = await req("POST", `/storefront/orders/${orderId}/booking-cancel`, {});
    expect(c.status).toBe(200);
    expect(c.json.refundState).toBe("not_required");
    expect(h.refundCalls).toHaveLength(0);
    expect((await orderRow(orderId))["status"]).toBe("cancelled");
  });

  it("a booking that already happened cannot be cancelled", async () => {
    const productId = await seedService();
    const past = new Date(Date.now() - 86_400_000);
    const orderId = await seedOrder({ buyer: BUYER, productId, note: encodeBookingNote(bookingRec(past)) });
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const c = await req("POST", `/storefront/orders/${orderId}/booking-cancel`, {});
    expect(c.status).toBe(400);
    expect(c.json.error).toBe("BOOKING_DONE");
    expect(h.refundCalls).toHaveLength(0);
  });

  it("a non-booking order refuses booking-cancel with NOT_A_BOOKING", async () => {
    const productId = await seedService({ bookable: false });
    const orderId = await seedOrder({
      buyer: BUYER, productId,
      note: "Booking request received — the creator confirms your slot from their dashboard.",
    });
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const c = await req("POST", `/storefront/orders/${orderId}/booking-cancel`, {});
    expect(c.status).toBe(400);
    expect(c.json.error).toBe("NOT_A_BOOKING");
  });
});

describe("free ($0) bookable services — the claim rail books too", () => {
  it("claim confirms instantly, re-claim is the same booking, racers 409, cancel frees the slot", async () => {
    const productId = await seedService({ priceCents: 0 });
    const slots = await req("GET", `/storefront/product/${productId}/slots`);
    const slotA = slots.json.days[0].slots[0];
    const slotB = slots.json.days[0].slots[1];

    h.userId = BUYER; h.userEmail = "fan@example.com";
    const c1 = await req("POST", "/storefront/claim", {
      productId, emailConsent: true, bookingStartUtc: slotA.startUtc, buyerTimezone: "Europe/London",
    });
    expect(c1.status).toBe(201);
    expect(c1.json.order.booking).toMatchObject({ s: slotA.startUtc, st: "confirmed", btz: "Europe/London" });
    const orderId = c1.json.order.id as string;

    const again = await req("POST", "/storefront/claim", {
      productId, emailConsent: true, bookingStartUtc: slotA.startUtc,
    });
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(again.json.order.id).toBe(orderId);

    h.userId = BUYER2; h.userEmail = "fan2@example.com";
    const race = await req("POST", "/storefront/claim", {
      productId, emailConsent: true, bookingStartUtc: slotA.startUtc,
    });
    expect(race.status).toBe(409);
    expect(race.json.error).toBe("SLOT_TAKEN");

    const other = await req("POST", "/storefront/claim", {
      productId, emailConsent: true, bookingStartUtc: slotB.startUtc,
    });
    expect(other.status).toBe(201);

    h.userId = BUYER; h.userEmail = "fan@example.com";
    const cancel = await req("POST", `/storefront/orders/${orderId}/booking-cancel`, {});
    expect(cancel.status).toBe(200);
    expect(cancel.json.refundState).toBe("not_required");
    expect(h.refundCalls).toHaveLength(0);

    const slots2 = await req("GET", `/storefront/product/${productId}/slots`);
    const all = (slots2.json.days as Array<any>).flatMap((d) => d.slots.map((s: any) => s.startUtc));
    expect(all).toContain(slotA.startUtc);
    expect(all).not.toContain(slotB.startUtc);
  });

  it("a bookable $0 service refuses a claim with no slot picked", async () => {
    const productId = await seedService({ priceCents: 0 });
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/claim", { productId, emailConsent: true });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BOOKING_REQUIRED");
  });
});

describe("legacy services — the old flow survives, and can't corrupt a booking", () => {
  it("service-confirm still confirms a legacy booking request", async () => {
    const productId = await seedService({ bookable: false });
    const orderId = await seedOrder({
      buyer: BUYER, productId,
      note: "Booking request received — the creator confirms your slot from their dashboard.",
    });
    h.userId = CREATOR; h.userEmail = "creator@example.com";
    const r = await req("POST", `/storefront/orders/${orderId}/service-confirm`, { confirmed: true });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });

  it("service-confirm refuses a calendar booking (USE_BOOKING_CANCEL) — the trailer survives", async () => {
    const productId = await seedService();
    const future = new Date(Date.now() + 2 * 86_400_000);
    const note = encodeBookingNote(bookingRec(future));
    const orderId = await seedOrder({ buyer: BUYER, productId, note });
    h.userId = CREATOR; h.userEmail = "creator@example.com";
    const r = await req("POST", `/storefront/orders/${orderId}/service-confirm`, { confirmed: true });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("USE_BOOKING_CANCEL");
    expect((await orderRow(orderId))["fulfillment_note"]).toBe(note);
  });
});
