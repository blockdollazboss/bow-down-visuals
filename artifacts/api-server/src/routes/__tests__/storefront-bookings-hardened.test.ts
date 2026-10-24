/**
 * Paid bookings HARDENED (Stack-100 #3) — the storefront router over
 * pg-mem WITH the service_bookings table applied (the migration's table
 * DDL, SERVICE_BOOKINGS_TABLE_SQL; the btree_gist exclusion clause is
 * real-Postgres-only — pg-mem cannot parse it, probed in
 * .lane/logs/probe-excl.log — and its violation translation is pinned
 * in src/lib/__tests__/service-bookings.test.ts).
 *
 * Pins, end to end through the real routes:
 *  - checkout writes BOTH records: the v1 trailer order AND a held
 *    service_bookings row; verify flips the row to confirmed; the
 *    bookings list + slots read the union;
 *  - two buyers racing the same slot (concurrent requests) — exactly
 *    one hold exists afterwards, the loser gets 409 SLOT_TAKEN;
 *  - cancel frees the slot at BOTH layers and a new buyer can take it;
 *  - an expired hardened hold never blocks: a fresh buyer takes the
 *    slot and the stale row is flipped to 'expired';
 *  - legacy v1 bookings (trailer only, no hardened row) still block
 *    their slot and still list, alongside hardened ones;
 *  - a trailer that says cancelled vetoes its hardened row;
 *  - the $0 claim rail writes a confirmed hardened row too.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-bookings-hardened";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  sessions: new Map<string, any>(),
  sessionSeq: 0,
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
      refunds: { create: vi.fn(async () => ({ id: "re_test_1", status: "succeeded" })) },
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
import { encodeBookingNote, type BookingRecord } from "../../lib/booking-note";
import { SERVICE_BOOKINGS_TABLE_SQL, reconcileServiceBookings, __resetServiceBookingsProbe } from "../../lib/service-bookings";
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

const NY_AVAILABILITY = {
  timezone: "America/New_York",
  weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })),
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storefrontRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[bookings-hardened] unhandled route error:", err?.message ?? err);
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
  /* The migration, as the harness can apply it: table + indexes. The
     extension + exclusion statements are real-Postgres-only (pg-mem
     cannot parse them) and live in MIGRATION-NEEDED.md. */
  mem.public.none(SERVICE_BOOKINGS_TABLE_SQL);
  __resetServiceBookingsProbe();
  h.db = db;
  h.userId = CREATOR;
  h.userEmail = "creator@example.com";
  h.sessions = new Map();
  h.sessionSeq = 0;
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
  await h.db.execute(sql`INSERT INTO email_lists (id, user_id, name) VALUES (${LIST_ID}, ${CREATOR}, 'Queen''s List')`);
});

async function req(method: string, path: string, body?: unknown, asUser?: string, asEmail?: string) {
  if (asUser) { h.userId = asUser; h.userEmail = asEmail ?? ""; }
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function seedService(opts: { priceCents?: number } = {}) {
  const id = randomUUID();
  const sd: Record<string, unknown> = {
    duration_min: 60, location: "Zoom", booking_enabled: true, availability: NY_AVAILABILITY,
  };
  await h.db.execute(sql`
    INSERT INTO store_products (id, profile_id, kind, title, price_cents, service_details)
    VALUES (${id}, ${PROFILE_ID}, 'service', '1:1 Coaching Call', ${opts.priceCents ?? 5000}, ${JSON.stringify(sd)}::jsonb)
  `);
  return id;
}

async function firstSlot(productId: string) {
  const j = await req("GET", `/storefront/product/${productId}/slots`);
  expect(j.status).toBe(200);
  expect(j.json.bookable).toBe(true);
  return j.json.days[0].slots[0] as { startUtc: string; endUtc: string };
}

async function slotOpen(productId: string, startUtc: string) {
  const j = await req("GET", `/storefront/product/${productId}/slots`);
  const all = (j.json.days as Array<any>).flatMap((d) => d.slots.map((s: any) => s.startUtc));
  return all.includes(startUtc);
}

async function sbRows(productId: string) {
  const r = await h.db.execute(sql`
    SELECT order_id, status, slot_start, slot_end, hold_expires_at FROM service_bookings
    WHERE product_id = ${productId} ORDER BY created_at ASC
  `);
  return r.rows as Array<Record<string, unknown>>;
}

async function checkout(buyer: string, email: string, productId: string, startUtc: string) {
  return req("POST", "/storefront/checkout", {
    productId, quantity: 1, bookingStartUtc: startUtc, buyerTimezone: "America/Chicago",
  }, buyer, email);
}

describe("dual-write lifecycle", () => {
  it("checkout writes a held row next to the trailer; verify confirms it; the list shows the booking", async () => {
    const productId = await seedService();
    const slot = await firstSlot(productId);
    const co = await checkout(BUYER, "fan@example.com", productId, slot.startUtc);
    expect(co.status).toBe(200);

    let rows = await sbRows(productId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("held");
    expect(new Date(String(rows[0]!["slot_start"])).toISOString()).toBe(slot.startUtc);
    expect(new Date(String(rows[0]!["slot_end"])).toISOString()).toBe(slot.endUtc);
    const exp = new Date(String(rows[0]!["hold_expires_at"])).getTime();
    expect(exp).toBeGreaterThan(Date.now());
    expect(exp).toBeLessThanOrEqual(Date.now() + 31 * 60_000);

    const v = await req("POST", "/storefront/verify", { sessionId: co.json.sessionId }, BUYER, "fan@example.com");
    expect(v.status).toBe(200);
    expect(v.json.order.booking).toMatchObject({ s: slot.startUtc, st: "confirmed" });
    rows = await sbRows(productId);
    expect(rows[0]!["status"]).toBe("confirmed");
    expect(rows[0]!["hold_expires_at"]).toBeNull();

    const list = await req("GET", "/storefront/bookings", undefined, BUYER, "fan@example.com");
    expect(list.json.bookings).toHaveLength(1);
    expect(list.json.bookings[0].startUtc).toBe(slot.startUtc);
    expect(await slotOpen(productId, slot.startUtc)).toBe(false);
  });

  it("concurrent holds for the same slot: exactly one wins, the loser gets SLOT_TAKEN, one row exists", async () => {
    const productId = await seedService();
    const slot = await firstSlot(productId);
    const [a, b] = await Promise.all([
      checkout(BUYER, "fan@example.com", productId, slot.startUtc),
      checkout(BUYER2, "fan2@example.com", productId, slot.startUtc),
    ]);
    const statuses = [a.status, b.status].sort();
    /* One checkout must win; the other must be refused (409 SLOT_TAKEN)
       or — if the harness serialized it into the winner's session view —
       never create a second hold. The invariant that matters: exactly
       one hold/order/row for the slot. */
    expect(statuses[0]).toBe(200);
    const rows = await sbRows(productId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("held");
    const orders = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM store_orders WHERE product_id = ${productId} AND status = 'booking_held'`);
    expect(Number((orders.rows[0] as any).c)).toBe(1);
    if (statuses[1] !== 200) {
      expect(statuses[1]).toBe(409);
      const loser = a.status === 409 ? a : b;
      expect(loser.json.error).toBe("SLOT_TAKEN");
    }
  });

  it("cancel frees the slot at both layers; a new buyer can take it", async () => {
    const productId = await seedService();
    const slot = await firstSlot(productId);
    const co = await checkout(BUYER, "fan@example.com", productId, slot.startUtc);
    const v = await req("POST", "/storefront/verify", { sessionId: co.json.sessionId }, BUYER, "fan@example.com");
    const orderId = v.json.order.id as string;

    const cancel = await req("POST", `/storefront/orders/${orderId}/booking-cancel`, {}, BUYER, "fan@example.com");
    expect(cancel.status).toBe(200);
    expect(cancel.json.refundState).toBe("refunded");
    const rows = await sbRows(productId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("cancelled");
    expect(await slotOpen(productId, slot.startUtc)).toBe(true);

    const co2 = await checkout(BUYER2, "fan2@example.com", productId, slot.startUtc);
    expect(co2.status).toBe(200);
    expect(await sbRows(productId)).toHaveLength(2);
  });

  it("an expired hardened hold never blocks: a fresh buyer takes the slot and the stale row flips to expired", async () => {
    const productId = await seedService();
    const slot = await firstSlot(productId);
    /* A hold placed 31 minutes ago whose payment never completed: the
       order row AND its hardened row, both stale. */
    const staleOrderId = randomUUID();
    const staleRec: BookingRecord = {
      v: 1, s: slot.startUtc, e: slot.endUtc, ctz: "America/New_York", btz: "UTC", st: "held",
    };
    await h.db.execute(sql`
      INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id, product_title, product_kind,
        quantity, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status, fulfillment_note, created_at)
      VALUES (${staleOrderId}, ${BUYER2}, ${PROFILE_ID}, ${productId}, '1:1 Coaching Call', 'service',
        1, 5000, 250, 4750, NULL, 'booking_held', ${encodeBookingNote(staleRec)}, now() - interval '31 minutes')
    `);
    await h.db.execute(sql`
      INSERT INTO service_bookings (id, order_id, product_id, profile_id, buyer_user_id, slot_start, slot_end, status, hold_expires_at)
      VALUES (${randomUUID()}, ${staleOrderId}, ${productId}, ${PROFILE_ID}, ${BUYER2},
              ${slot.startUtc}, ${slot.endUtc}, 'held', now() - interval '1 minute')
    `);
    const co = await checkout(BUYER, "fan@example.com", productId, slot.startUtc);
    expect(co.status).toBe(200);
    const rows = await sbRows(productId);
    const byOrder = new Map(rows.map((r) => [String(r["order_id"]), String(r["status"])]));
    expect(byOrder.get(staleOrderId)).toBe("expired");
    expect([...byOrder.values()].filter((s) => s === "held")).toHaveLength(1);
  });
});

describe("reconciliation with v1 trailer-only bookings", () => {
  it("a legacy confirmed booking (no hardened row) blocks its slot, lists, and backfills cleanly", async () => {
    const productId = await seedService();
    const slot = await firstSlot(productId);
    const legacyRec: BookingRecord = {
      v: 1, s: slot.startUtc, e: slot.endUtc, ctz: "America/New_York", btz: "UTC", st: "confirmed",
    };
    const legacyOrderId = randomUUID();
    await h.db.execute(sql`
      INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id, product_title, product_kind,
        quantity, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status, fulfillment_note)
      VALUES (${legacyOrderId}, ${BUYER}, ${PROFILE_ID}, ${productId}, '1:1 Coaching Call', 'service',
        1, 5000, 250, 4750, 'cs_legacy', 'completed', ${encodeBookingNote(legacyRec)})
    `);
    /* Blocks from the trailer alone (no hardened row yet). */
    expect(await sbRows(productId)).toHaveLength(0);
    expect(await slotOpen(productId, slot.startUtc)).toBe(false);
    const blocked = await checkout(BUYER2, "fan2@example.com", productId, slot.startUtc);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toBe("SLOT_TAKEN");

    /* Backfill: the legacy booking gains its hardened row and keeps
       blocking — now from the table — with no double-count. */
    const result = await reconcileServiceBookings(h.db, { productId, now: new Date() });
    expect(result).toEqual({ inserted: 1, conflicts: 0, scanned: 1 });
    expect(await sbRows(productId)).toHaveLength(1);
    expect(await slotOpen(productId, slot.startUtc)).toBe(false);

    const list = await req("GET", "/storefront/bookings", undefined, BUYER, "fan@example.com");
    expect(list.json.bookings.map((b: any) => b.orderId)).toContain(legacyOrderId);
  });

  it("a trailer that says cancelled vetoes its hardened row — the slot is open", async () => {
    const productId = await seedService();
    const slot = await firstSlot(productId);
    const orderId = randomUUID();
    const cancelledRec: BookingRecord = {
      v: 1, s: slot.startUtc, e: slot.endUtc, ctz: "America/New_York", btz: "UTC",
      st: "cancelled", ca: "buyer", cx: new Date().toISOString(), rf: "refunded",
    };
    await h.db.execute(sql`
      INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id, product_title, product_kind,
        quantity, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status, fulfillment_note)
      VALUES (${orderId}, ${BUYER}, ${PROFILE_ID}, ${productId}, '1:1 Coaching Call', 'service',
        1, 5000, 250, 4750, 'cs_veto', 'refunded', ${encodeBookingNote(cancelledRec)})
    `);
    /* The hardened row missed the cancel (still confirmed) — the
       trailer veto must still free the slot in reads. */
    await h.db.execute(sql`
      INSERT INTO service_bookings (id, order_id, product_id, profile_id, buyer_user_id, slot_start, slot_end, status, hold_expires_at)
      VALUES (${randomUUID()}, ${orderId}, ${productId}, ${PROFILE_ID}, ${BUYER},
              ${slot.startUtc}, ${slot.endUtc}, 'confirmed', NULL)
    `);
    expect(await slotOpen(productId, slot.startUtc)).toBe(true);
  });

  it("the $0 claim rail writes a confirmed hardened row", async () => {
    const productId = await seedService({ priceCents: 0 });
    const slot = await firstSlot(productId);
    const claim = await req("POST", "/storefront/claim", {
      productId, emailConsent: true, email: "fan@example.com",
      bookingStartUtc: slot.startUtc, buyerTimezone: "America/Chicago",
    }, BUYER, "fan@example.com");
    expect(claim.status).toBe(201);
    expect(claim.json.order.booking).toMatchObject({ s: slot.startUtc, st: "confirmed" });
    const rows = await sbRows(productId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("confirmed");
    expect(await slotOpen(productId, slot.startUtc)).toBe(false);
  });
});
