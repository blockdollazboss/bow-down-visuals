/**
 * service-bookings (hardening, Stack-100 #3) — the dual-path store.
 *
 * Runs against pg-mem WITH the migration's table DDL applied
 * (SERVICE_BOOKINGS_TABLE_SQL — the exact text in MIGRATION-NEEDED.md).
 * pg-mem 3.0.14 cannot parse CREATE EXTENSION btree_gist / tstzrange /
 * EXCLUDE USING gist (probed: .lane/logs/probe-excl.log), so the
 * exclusion CLAUSE itself is only executable on real Postgres; what is
 * proven here is everything the code controls:
 *  - pre-migration (table absent): every helper degrades to v1 — no-ops,
 *    empty reads, "absent" confirm — and never throws;
 *  - post-migration: place/confirm/cancel/expire move real rows, the
 *    taken-range read honors hold expiry, and reconcile backfills
 *    trailer-only v1 bookings without double-counting;
 *  - the DB-violation translation: a runner that raises the real
 *    Postgres exclusion SQLSTATE (23P01) — as the constraint will —
 *    surfaces as BookingSlotConflictError from place, and as a
 *    "conflict" outcome (never a throw) from confirm.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "./test-db";
import { encodeBookingNote, type BookingRecord } from "../booking-note";
import {
  BookingSlotConflictError,
  SERVICE_BOOKINGS_TABLE_SQL,
  cancelServiceBooking,
  confirmServiceBooking,
  expireStaleServiceBookingHolds,
  fetchServiceBookingRanges,
  isBookingConflictError,
  placeServiceBooking,
  reconcileServiceBookings,
  serviceBookingsAvailable,
  __resetServiceBookingsProbe,
} from "../service-bookings";

const STORE_DDL = `
CREATE TABLE store_products (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, kind text NOT NULL DEFAULT 'service',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY, buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL DEFAULT '1:1 Coaching Call', product_kind text NOT NULL DEFAULT 'service',
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL DEFAULT 5000,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed',
  fulfillment_note text, created_at timestamptz NOT NULL DEFAULT now()
);`;

const PROFILE = randomUUID();
const PRODUCT = randomUUID();
const BUYER = randomUUID();
const BUYER2 = randomUUID();

let t: TestDb;

function rec(startIso: string, st: BookingRecord["st"] = "held"): BookingRecord {
  const s = new Date(startIso);
  return {
    v: 1,
    s: s.toISOString(),
    e: new Date(s.getTime() + 3_600_000).toISOString(),
    ctz: "America/New_York",
    btz: "UTC",
    st,
  };
}

const SLOT = "2026-11-02T14:00:00.000Z"; // a Monday 09:00 in New York (EST)

async function seedOrderWithTrailer(args: {
  record: BookingRecord;
  status: string;
  buyer?: string;
  createdAt?: string;
}): Promise<string> {
  const id = randomUUID();
  await t.db.execute(sql`
    INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id, status, fulfillment_note, created_at)
    VALUES (${id}, ${args.buyer ?? BUYER}, ${PROFILE}, ${PRODUCT}, ${args.status},
            ${encodeBookingNote(args.record)}, ${args.createdAt ?? new Date().toISOString()})
  `);
  return id;
}

async function sbRows() {
  const r = await t.db.execute(sql`SELECT order_id, status, hold_expires_at FROM service_bookings ORDER BY created_at ASC`);
  return r.rows as Array<Record<string, unknown>>;
}

function freshDb(withTable: boolean) {
  t = createTestDb();
  t.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  t.mem.public.none(STORE_DDL);
  if (withTable) t.mem.public.none(SERVICE_BOOKINGS_TABLE_SQL);
  __resetServiceBookingsProbe();
}

beforeEach(() => freshDb(true));

describe("pre-migration: the hardened store is absent and everything degrades to v1", () => {
  beforeEach(() => freshDb(false));

  it("probe says absent; writes are no-ops; reads are empty; nothing throws", async () => {
    expect(await serviceBookingsAvailable(t.db)).toBe(false);
    const r = rec(SLOT);
    expect(await placeServiceBooking(t.db, {
      orderId: randomUUID(), productId: PRODUCT, profileId: PROFILE, buyerUserId: BUYER, record: r,
    })).toBe(false);
    expect(await confirmServiceBooking(t.db, randomUUID())).toBe("absent");
    expect(await cancelServiceBooking(t.db, randomUUID())).toBe(false);
    expect(await fetchServiceBookingRanges(t.db, PRODUCT, new Date())).toEqual([]);
    expect(await reconcileServiceBookings(t.db, { productId: PRODUCT })).toBeNull();
  });
});

describe("post-migration: rows move with the booking lifecycle", () => {
  it("place held → blocks; confirm → still blocks; cancel → frees", async () => {
    const orderId = await seedOrderWithTrailer({ record: rec(SLOT), status: "booking_held" });
    const placed = await placeServiceBooking(t.db, {
      orderId, productId: PRODUCT, profileId: PROFILE, buyerUserId: BUYER,
      record: rec(SLOT), holdExpiresAt: new Date(Date.now() + 30 * 60_000),
    });
    expect(placed).toBe(true);
    let rows = await sbRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("held");
    expect(await fetchServiceBookingRanges(t.db, PRODUCT, new Date())).toHaveLength(1);

    expect(await confirmServiceBooking(t.db, orderId)).toBe("confirmed");
    rows = await sbRows();
    expect(rows[0]!["status"]).toBe("confirmed");
    expect(rows[0]!["hold_expires_at"]).toBeNull();
    expect(await fetchServiceBookingRanges(t.db, PRODUCT, new Date())).toHaveLength(1);

    expect(await cancelServiceBooking(t.db, orderId)).toBe(true);
    rows = await sbRows();
    expect(rows[0]!["status"]).toBe("cancelled");
    expect(await fetchServiceBookingRanges(t.db, PRODUCT, new Date())).toHaveLength(0);
    /* Idempotent: a second cancel is a no-op, not an error. */
    expect(await cancelServiceBooking(t.db, orderId)).toBe(true);
  });

  it("confirm of an order with no hardened row reports missing (pre-migration order)", async () => {
    expect(await confirmServiceBooking(t.db, randomUUID())).toBe("missing");
  });

  it("an expired hold does not block: the range read skips it and the next place expires it", async () => {
    const staleOrder = await seedOrderWithTrailer({
      record: rec(SLOT), status: "booking_held", createdAt: new Date(Date.now() - 31 * 60_000).toISOString(),
    });
    await placeServiceBooking(t.db, {
      orderId: staleOrder, productId: PRODUCT, profileId: PROFILE, buyerUserId: BUYER,
      record: rec(SLOT), holdExpiresAt: new Date(Date.now() - 60_000),
    });
    expect(await fetchServiceBookingRanges(t.db, PRODUCT, new Date())).toHaveLength(0);

    const freshOrder = await seedOrderWithTrailer({ record: rec(SLOT), status: "booking_held", buyer: BUYER2 });
    await placeServiceBooking(t.db, {
      orderId: freshOrder, productId: PRODUCT, profileId: PROFILE, buyerUserId: BUYER2,
      record: rec(SLOT), holdExpiresAt: new Date(Date.now() + 30 * 60_000),
    });
    const rows = await sbRows();
    const byOrder = new Map(rows.map((r) => [String(r["order_id"]), String(r["status"])]));
    expect(byOrder.get(staleOrder)).toBe("expired");
    expect(byOrder.get(freshOrder)).toBe("held");
    expect(await fetchServiceBookingRanges(t.db, PRODUCT, new Date())).toHaveLength(1);
  });

  it("expireStaleServiceBookingHolds only flips lapsed holds for the product", async () => {
    const a = await seedOrderWithTrailer({ record: rec(SLOT), status: "booking_held" });
    const b = await seedOrderWithTrailer({ record: rec("2026-11-03T14:00:00.000Z"), status: "booking_held", buyer: BUYER2 });
    await placeServiceBooking(t.db, { orderId: a, productId: PRODUCT, profileId: PROFILE, buyerUserId: BUYER, record: rec(SLOT), holdExpiresAt: new Date(Date.now() - 1000) });
    await placeServiceBooking(t.db, { orderId: b, productId: PRODUCT, profileId: PROFILE, buyerUserId: BUYER2, record: rec("2026-11-03T14:00:00.000Z"), holdExpiresAt: new Date(Date.now() + 60_000) });
    const flipped = await expireStaleServiceBookingHolds(t.db, { productId: PRODUCT, now: new Date() });
    expect(flipped).toBe(1);
  });
});

describe("reconciliation: trailer-only v1 bookings gain hardened rows", () => {
  it("backfills live bookings, skips lapsed holds and cancelled records, never double-inserts", async () => {
    const live = await seedOrderWithTrailer({ record: rec(SLOT, "confirmed"), status: "completed" });
    await seedOrderWithTrailer({
      record: rec("2026-11-04T14:00:00.000Z"), status: "booking_held",
      createdAt: new Date(Date.now() - 31 * 60_000).toISOString(),
    });
    const cancelled = await seedOrderWithTrailer({
      record: { ...rec("2026-11-05T14:00:00.000Z"), st: "cancelled" }, status: "cancelled",
    });
    const first = await reconcileServiceBookings(t.db, { productId: PRODUCT, now: new Date() });
    expect(first).toEqual({ inserted: 1, conflicts: 0, scanned: 1 });
    const rows = await sbRows();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!["order_id"])).toBe(live);
    expect(rows[0]!["status"]).toBe("confirmed");
    expect(String(rows[0]!["order_id"])).not.toBe(cancelled);
    const second = await reconcileServiceBookings(t.db, { productId: PRODUCT, now: new Date() });
    expect(second).toEqual({ inserted: 0, conflicts: 0, scanned: 1 });
  });
});

describe("the exclusion-violation translation (the real Postgres guard, simulated at the seam)", () => {
  const violation = Object.assign(
    new Error('conflicting key value violates exclusion constraint "service_bookings_no_overlap"'),
    { code: "23P01" },
  );

  it("isBookingConflictError recognizes 23P01 (incl. nested cause) and rejects lookalikes", () => {
    expect(isBookingConflictError(violation)).toBe(true);
    expect(isBookingConflictError(new Error("outer", { cause: violation }))).toBe(true);
    expect(isBookingConflictError(Object.assign(new Error("dup key"), { code: "23505" }))).toBe(false);
    expect(isBookingConflictError(Object.assign(
      new Error('duplicate key value violates unique constraint "service_bookings_order_ux"'), { code: "23505" },
    ))).toBe(true);
    expect(isBookingConflictError(new Error("some other failure"))).toBe(false);
  });

  function violatingRunner(mode: "insert" | "update") {
    return {
      execute: async (q: unknown) => {
        const raw = JSON.stringify(q);
        if (raw.includes("information_schema")) return { rows: [{ x: 1 }] };
        /* The lazy-expire UPDATE always succeeds; only the guarded
           write (insert / confirm-flip) raises the violation. */
        if (raw.includes("status = 'expired'")) return { rows: [] };
        if (mode === "insert" && raw.includes("INSERT INTO service_bookings")) throw violation;
        if (mode === "update" && raw.includes("status = 'confirmed'")) throw violation;
        return { rows: [] };
      },
    } as never;
  }

  it("place translates a 23P01 from the insert into BookingSlotConflictError", async () => {
    __resetServiceBookingsProbe();
    await expect(placeServiceBooking(violatingRunner("insert"), {
      orderId: randomUUID(), productId: PRODUCT, profileId: PROFILE, buyerUserId: BUYER,
      record: rec(SLOT), holdExpiresAt: new Date(Date.now() + 60_000),
    })).rejects.toBeInstanceOf(BookingSlotConflictError);
  });

  it("confirm translates a 23P01 into a 'conflict' outcome instead of throwing", async () => {
    __resetServiceBookingsProbe();
    await expect(confirmServiceBooking(violatingRunner("update"), randomUUID())).resolves.toBe("conflict");
  });
});
