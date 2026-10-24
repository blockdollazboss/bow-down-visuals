/**
 * Paid bookings (lane F5) — slots, checkout holds, verify.
 * Drives the REAL storefront router over pg-mem with Stripe faked at
 * the lib/stripe-client seam and pins:
 *  - the slots endpoint serves real open slots from the creator's
 *    weekly availability, wall-clock-anchored in the creator's timezone
 *    and stored/served as UTC instants;
 *  - a taken slot disappears, an override day-off closes its date, and
 *    an expired hold frees its slot again;
 *  - checkout REQUIRES a slot for a bookable service, places a HOLD
 *    order before the Stripe session exists, and a second buyer racing
 *    the same slot gets 409 SLOT_TAKEN (the double-book rejection);
 *  - off-grid times are refused (SLOT_NOT_OFFERED) and a slot sent for
 *    a non-bookable product is refused (SLOT_NOT_BOOKABLE);
 *  - verify flips the hold into a confirmed booking in place (never a
 *    second order), pings the creator exactly once, and a duplicate
 *    verify is a no-op;
 *  - plain non-booking checkout still works end to end.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-bookings";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  sessions: new Map<string, any>(),
  sessionSeq: 0,
  createCalls: [] as Array<{ params: any; options: any }>,
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
            h.createCalls.push({ params, options });
            return session;
          }),
          retrieve: vi.fn(async (id: string) => {
            const s = h.sessions.get(id);
            if (!s) throw new Error("No such checkout session");
            return s;
          }),
        },
      },
      refunds: { create: vi.fn(async () => ({ id: "re_test", status: "succeeded" })) },
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
import { encodeBookingNote } from "../../lib/booking-note";
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
const PROFILE_ID = randomUUID();
const LIST_ID = randomUUID();

/** Every weekday 09:00–17:00 in New York, 60-minute sessions. */
const NY_AVAILABILITY = {
  timezone: "America/New_York",
  weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })),
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[bookings] unhandled route error:", err?.message ?? err);
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
  /* createTestDb pre-creates job_notifications WITHOUT the id default
     the real table (and the route's inserts) rely on — replace it. */
  mem.public.none("DROP TABLE job_notifications");
  mem.public.none(DDL);
  h.db = db;
  h.userId = CREATOR;
  h.userEmail = "creator@example.com";
  h.sessions = new Map();
  h.sessionSeq = 0;
  h.createCalls = [];
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

async function seedService(opts: {
  priceCents?: number;
  bookable?: boolean;
  availability?: unknown;
  durationMin?: number;
} = {}) {
  const id = randomUUID();
  const sd: Record<string, unknown> = { duration_min: opts.durationMin ?? 60, location: "Zoom" };
  if (opts.bookable !== false) {
    sd["booking_enabled"] = true;
    sd["availability"] = opts.availability ?? NY_AVAILABILITY;
  }
  await h.db.execute(sql`
    INSERT INTO store_products (id, profile_id, kind, title, price_cents, service_details)
    VALUES (${id}, ${PROFILE_ID}, 'service', '1:1 Coaching Call', ${opts.priceCents ?? 5000}, ${JSON.stringify(sd)}::jsonb)
  `);
  return id;
}

async function seedDigital() {
  const id = randomUUID();
  await h.db.execute(sql`
    INSERT INTO store_products (id, profile_id, kind, title, price_cents, media_urls)
    VALUES (${id}, ${PROFILE_ID}, 'digital', 'Full Album', 2000, '["https://cdn.example.com/album.zip"]'::jsonb)
  `);
  return id;
}

async function getSlots(productId: string) {
  const r = await req("GET", `/storefront/product/${productId}/slots`);
  expect(r.status).toBe(200);
  return r.json;
}

async function firstSlot(productId: string): Promise<{ startUtc: string; endUtc: string; date: string }> {
  const j = await getSlots(productId);
  expect(j.bookable).toBe(true);
  const day = j.days[0];
  return { ...day.slots[0], date: day.date };
}

async function orderRows() {
  const r = await h.db.execute(sql`SELECT id, status, fulfillment_note, stripe_session_id, amount_cents FROM store_orders ORDER BY created_at ASC`);
  return r.rows as Array<Record<string, unknown>>;
}

async function notificationCount(jobType: string) {
  const r = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM job_notifications WHERE job_type = ${jobType}`);
  return Number((r.rows[0] as any).c);
}

describe("slots endpoint — a real calendar, in UTC", () => {
  it("serves open slots anchored to the creator's wall clock, stored as UTC", async () => {
    const id = await seedService();
    const j = await getSlots(id);
    expect(j.bookable).toBe(true);
    expect(j.timezone).toBe("America/New_York");
    expect(j.durationMin).toBe(60);
    expect(j.days.length).toBeGreaterThan(0);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    let checked = 0;
    for (const day of j.days) {
      /* Day buckets are creator-local dates. */
      const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
      for (const s of day.slots) {
        const start = new Date(s.startUtc);
        /* The same instant rendered in the creator's zone is on the
           09:00–17:00 hourly grid; in UTC it is shifted by the offset —
           proof the instant is stored in UTC, not in either wall clock. */
        const [hh, mm] = fmt.format(start).split(":").map(Number);
        expect(mm).toBe(0);
        expect(hh!).toBeGreaterThanOrEqual(9);
        expect(hh!).toBeLessThanOrEqual(16);
        expect(dayFmt.format(start)).toBe(day.date);
        expect(new Date(s.endUtc).getTime() - start.getTime()).toBe(60 * 60_000);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a non-bookable service says so instead of inventing slots", async () => {
    const id = await seedService({ bookable: false });
    const j = await getSlots(id);
    expect(j.bookable).toBe(false);
    expect(j.days).toBeUndefined();
  });

  it("a confirmed booking removes its slot from the calendar", async () => {
    const id = await seedService();
    const slot = await firstSlot(id);
    const rec = {
      v: 1 as const, s: slot.startUtc, e: slot.endUtc,
      ctz: "America/New_York", btz: "UTC", st: "confirmed" as const,
    };
    await h.db.execute(sql`
      INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id, product_title, product_kind,
        quantity, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status, fulfillment_note)
      VALUES (${randomUUID()}, ${BUYER}, ${PROFILE_ID}, ${id}, '1:1 Coaching Call', 'service',
        1, 5000, 250, 4750, 'cs_seed_taken', 'completed', ${encodeBookingNote(rec)})
    `);
    const j = await getSlots(id);
    const all = (j.days as Array<any>).flatMap((d) => d.slots.map((s: any) => s.startUtc));
    expect(all).not.toContain(slot.startUtc);
    expect(all.length).toBeGreaterThan(0);
  });

  it("a per-date override day-off closes that creator-local date", async () => {
    /* Tomorrow in New York, closed. */
    const tomorrowNy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
      .format(new Date(Date.now() + 86_400_000));
    const availability = {
      ...NY_AVAILABILITY,
      overrides: [{ date: tomorrowNy, windows: null }],
    };
    const id = await seedService({ availability });
    const j = await getSlots(id);
    const dates = (j.days as Array<any>).map((d) => d.date);
    expect(dates).not.toContain(tomorrowNy);
    expect(dates.length).toBeGreaterThan(0);
  });

  it("an expired hold (older than the 30-minute TTL) frees its slot", async () => {
    const id = await seedService();
    const slot = await firstSlot(id);
    const rec = {
      v: 1 as const, s: slot.startUtc, e: slot.endUtc,
      ctz: "America/New_York", btz: "UTC", st: "held" as const,
    };
    await h.db.execute(sql`
      INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id, product_title, product_kind,
        quantity, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status, fulfillment_note, created_at)
      VALUES (${randomUUID()}, ${BUYER2}, ${PROFILE_ID}, ${id}, '1:1 Coaching Call', 'service',
        1, 5000, 250, 4750, NULL, 'booking_held', ${encodeBookingNote(rec)}, now() - interval '31 minutes')
    `);
    const j = await getSlots(id);
    const all = (j.days as Array<any>).flatMap((d) => d.slots.map((s: any) => s.startUtc));
    expect(all).toContain(slot.startUtc);
    /* …and a fresh buyer can actually take it. */
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const co = await req("POST", "/storefront/checkout", {
      productId: id, quantity: 1, bookingStartUtc: slot.startUtc, buyerTimezone: "America/Chicago",
    });
    expect(co.status).toBe(200);
    expect(co.json.booking.startUtc).toBe(slot.startUtc);
  });
});

describe("checkout — the hold is the double-book lock", () => {
  it("a bookable service refuses checkout without a picked slot", async () => {
    const id = await seedService();
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/checkout", { productId: id, quantity: 1 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BOOKING_REQUIRED");
    expect(h.createCalls).toHaveLength(0);
    expect(await orderRows()).toHaveLength(0);
  });

  it("checkout places the hold first, then the session (expiry + booking metadata)", async () => {
    const id = await seedService();
    const slot = await firstSlot(id);
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/checkout", {
      productId: id, quantity: 1, bookingStartUtc: slot.startUtc, buyerTimezone: "Europe/London",
    });
    expect(r.status).toBe(200);
    expect(r.json.booking.startUtc).toBe(slot.startUtc);
    expect(r.json.booking.timezone).toBe("America/New_York");
    expect(h.createCalls).toHaveLength(1);
    const { params } = h.createCalls[0]!;
    expect(params.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(params.metadata.booking_start_utc).toBe(slot.startUtc);
    expect(params.metadata.buyer_timezone).toBe("Europe/London");
    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("booking_held");
    expect(rows[0]!["stripe_session_id"]).toBe(r.json.sessionId);
    expect(String(rows[0]!["fulfillment_note"])).toContain("⟦bk1:");
  });

  it("the same slot cannot be sold twice — second buyer 409s, holder is told it's theirs", async () => {
    const id = await seedService();
    const slot = await firstSlot(id);
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const first = await req("POST", "/storefront/checkout", {
      productId: id, quantity: 1, bookingStartUtc: slot.startUtc,
    });
    expect(first.status).toBe(200);

    h.userId = BUYER2; h.userEmail = "fan2@example.com";
    const second = await req("POST", "/storefront/checkout", {
      productId: id, quantity: 1, bookingStartUtc: slot.startUtc,
    });
    expect(second.status).toBe(409);
    expect(second.json.error).toBe("SLOT_TAKEN");

    h.userId = BUYER; h.userEmail = "fan@example.com";
    const again = await req("POST", "/storefront/checkout", {
      productId: id, quantity: 1, bookingStartUtc: slot.startUtc,
    });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("SLOT_HELD_BY_YOU");
    /* Only the one hold + one session exist. */
    expect(await orderRows()).toHaveLength(1);
    expect(h.createCalls).toHaveLength(1);
  });

  it("an off-grid time is refused — buyers pick from the grid, not arbitrary minutes", async () => {
    const id = await seedService();
    const slot = await firstSlot(id);
    const offGrid = new Date(new Date(slot.startUtc).getTime() + 30 * 60_000).toISOString();
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/checkout", {
      productId: id, quantity: 1, bookingStartUtc: offGrid,
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("SLOT_NOT_OFFERED");
    expect(await orderRows()).toHaveLength(0);
  });

  it("a slot sent for a non-bookable product is refused, not silently ignored", async () => {
    const id = await seedService({ bookable: false });
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/checkout", {
      productId: id, quantity: 1, bookingStartUtc: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("SLOT_NOT_BOOKABLE");
  });

  it("plain non-booking checkout still works end to end", async () => {
    const id = await seedDigital();
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const r = await req("POST", "/storefront/checkout", { productId: id, quantity: 1 });
    expect(r.status).toBe(200);
    expect(r.json.sessionId).toBeTruthy();
    expect(r.json.booking).toBeUndefined();
    expect(await orderRows()).toHaveLength(0);
  });
});

describe("verify — the hold becomes the booking", () => {
  it("verify confirms the hold in place, pings the creator once, and a repeat verify is a no-op", async () => {
    const id = await seedService();
    const slot = await firstSlot(id);
    h.userId = BUYER; h.userEmail = "fan@example.com";
    const co = await req("POST", "/storefront/checkout", {
      productId: id, quantity: 1, bookingStartUtc: slot.startUtc, buyerTimezone: "Europe/London",
    });
    expect(co.status).toBe(200);
    const sessionId = co.json.sessionId as string;

    const v1 = await req("POST", "/storefront/verify", { sessionId });
    expect(v1.status).toBe(200);
    expect(v1.json.success).toBe(true);
    expect(v1.json.duplicate).toBe(false);
    expect(v1.json.order.booking).toMatchObject({ s: slot.startUtc, st: "confirmed", btz: "Europe/London" });

    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("completed");
    expect(await notificationCount("storefront_service_booking")).toBe(1);

    const v2 = await req("POST", "/storefront/verify", { sessionId });
    expect(v2.status).toBe(200);
    expect(v2.json.duplicate).toBe(true);
    expect(await orderRows()).toHaveLength(1);
    expect(await notificationCount("storefront_service_booking")).toBe(1);

    /* And the booked slot is off the public calendar now. */
    const j = await getSlots(id);
    const all = (j.days as Array<any>).flatMap((d) => d.slots.map((s: any) => s.startUtc));
    expect(all).not.toContain(slot.startUtc);
  });
});
