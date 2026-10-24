/**
 * service-bookings.ts — the HARDENED booking store (Stack-100 #3, wave 3).
 *
 * Paid bookings v1 (lib/booking-note.ts + routes/storefront.ts) rides the
 * store_orders trailer (`⟦bk1:…⟧` in fulfillment_note) with a product-row
 * lock as its only double-book guard. This module is the code side of the
 * v1 report's hardening design: a real `service_bookings` table whose
 * Postgres exclusion constraint is the FINAL guard —
 *
 *   EXCLUDE USING gist (product_id WITH =, tstzrange(slot_start, slot_end) WITH &&)
 *   WHERE (status IN ('held','confirmed'))
 *
 * The migration itself belongs to the stack join (the exact idempotent
 * SQL lives in .lane/MIGRATION-NEEDED.md; this module exports the same
 * strings so the test harness and the join can never drift apart).
 *
 * FAIL-HONEST CONTRACT (pre-migration): every entry point first probes
 * for the table via information_schema (works on real Postgres AND in
 * the pg-mem test harness). Absent → the helpers are no-ops / empty and
 * bookings keep working on the v1 trailer rails exactly as before.
 * Present → holds/confirms/cancels dual-write through this table, the
 * trailer stays in sync as the display + fallback record, and an
 * exclusion-constraint violation (SQLSTATE 23P01) is translated into
 * BookingSlotConflictError, which the routes turn into the existing
 * 409 SLOT_TAKEN honesty — never a 500, never a silent double-book.
 *
 * Expired holds: an exclusion predicate cannot call now() (predicates
 * must be immutable), so 'held' rows carry hold_expires_at and the
 * write path lazily flips stale holds to 'expired' (which leaves the
 * predicate) before inserting — an expired hold never blocks a new one.
 *
 * All access is raw SQL, like every store_orders access in
 * routes/storefront.ts. Deliberately NO drizzle schema for this table:
 * pre-migration the table does not exist, and a schema entry would make
 * any future full-row select against it crash the pre-migration tree.
 * The join adds the schema alongside the migration if it wants it.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { decodeBookingNote, bookingBlocksSlot, type BookingRecord } from "./booking-note";

type SqlRunner = Pick<typeof db, "execute">;

/* ═══════════════ Migration SQL (single source; see MIGRATION-NEEDED) ═══ */

export const SERVICE_BOOKINGS_EXTENSION_SQL = `CREATE EXTENSION IF NOT EXISTS btree_gist;`;

/** Table DDL WITHOUT the extension + exclusion clause — this exact text
 *  is what the pg-mem harness applies (pg-mem 3.0.14 cannot parse
 *  CREATE EXTENSION / tstzrange / EXCLUDE USING gist — probed, see
 *  .lane/logs/probe-excl.log). Real Postgres gets this PLUS the two
 *  statements below, concatenated in MIGRATION-NEEDED.md. */
export const SERVICE_BOOKINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS service_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  buyer_user_id uuid NOT NULL,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'held',
  hold_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_bookings_slot_sane CHECK (slot_end > slot_start),
  CONSTRAINT service_bookings_status_sane CHECK (status IN ('held', 'confirmed', 'cancelled', 'expired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS service_bookings_order_ux ON service_bookings (order_id);
CREATE INDEX IF NOT EXISTS service_bookings_product_idx ON service_bookings (product_id, status, slot_start);
`.trim();

export const SERVICE_BOOKINGS_EXCLUSION_SQL = `
ALTER TABLE service_bookings DROP CONSTRAINT IF EXISTS service_bookings_no_overlap;
ALTER TABLE service_bookings ADD CONSTRAINT service_bookings_no_overlap
  EXCLUDE USING gist (
    product_id WITH =,
    tstzrange(slot_start, slot_end) WITH &&
  ) WHERE (status IN ('held', 'confirmed'));
`.trim();

/* ═══════════════════════ Errors + detection ══════════════════════════ */

/** The DB said no: an active booking already overlaps this slot for this
 *  product. Routes translate this into 409 SLOT_TAKEN. */
export class BookingSlotConflictError extends Error {
  readonly code = "SLOT_TAKEN";
  constructor(message = "That slot was just taken — pick another open time.") {
    super(message);
    this.name = "BookingSlotConflictError";
  }
}

/** True when an error is the exclusion constraint (or a unique index in
 *  the pg-mem harness) rejecting an overlapping booking write. Real
 *  Postgres reports exclusion violations as SQLSTATE 23P01; drizzle/pg
 *  surface the code on the error (sometimes nested under .cause). */
export function isBookingConflictError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur != null; depth++) {
    const e = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === "23P01" || e.code === "23505") {
      /* 23505 (unique) only counts when it names one of our guards —
         other unique violations (e.g. stripe_session_id) are not slot
         conflicts and must not be relabelled. */
      if (e.code === "23P01") return true;
      const msg = typeof e.message === "string" ? e.message : "";
      if (msg.includes("service_bookings")) return true;
    }
    const msg = typeof e.message === "string" ? e.message : "";
    if (
      msg.includes("service_bookings_no_overlap") ||
      msg.includes("violates exclusion constraint")
    ) {
      return true;
    }
    cur = e.cause;
  }
  return false;
}

/** Does the hardened table exist in this database? Probed per call (one
 *  indexed information_schema lookup) so a process that boots
 *  pre-migration lights up the moment the join's migration lands — and
 *  so the test harness can swap databases freely. Any probe failure
 *  degrades to v1 behavior, never to a crash. */
export async function serviceBookingsAvailable(run: SqlRunner): Promise<boolean> {
  try {
    const r = await run.execute(sql`
      SELECT 1 AS x FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'service_bookings'
      LIMIT 1
    `);
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/* ═══════════════════════ Write path ══════════════════════════════════ */

export interface ServiceBookingWrite {
  orderId: string;
  productId: string;
  profileId: string;
  buyerUserId: string;
  record: BookingRecord;
  /** For status 'held': when the hold lapses (order created_at + TTL). */
  holdExpiresAt?: Date | null;
}

/** Lazily expire stale holds for one product (optionally only those
 *  overlapping a candidate range). 'expired' leaves the exclusion
 *  predicate, freeing the slot at the DB level. Returns rows flipped. */
export async function expireStaleServiceBookingHolds(
  run: SqlRunner,
  args: { productId: string; now: Date; range?: { startUtc: string; endUtc: string } },
): Promise<number> {
  const rangeClause = args.range
    ? sql`AND slot_start < ${args.range.endUtc} AND ${args.range.startUtc} < slot_end`
    : sql``;
  const r = await run.execute(sql`
    UPDATE service_bookings
    SET status = 'expired', updated_at = now()
    WHERE product_id = ${args.productId} AND status = 'held'
      AND hold_expires_at IS NOT NULL AND hold_expires_at <= ${args.now.toISOString()}
      ${rangeClause}
    RETURNING id
  `);
  return r.rows.length;
}

/**
 * Insert (or refresh) the hardened row for a booking whose store_orders
 * row was just written from `record`. The caller MUST have already
 * written the order + trailer (the trailer stays the fallback record).
 * Throws BookingSlotConflictError when the DB exclusion constraint
 * rejects the write — the caller rolls back / answers SLOT_TAKEN.
 * Returns false (no-op) when the table does not exist yet.
 */
export async function placeServiceBooking(
  run: SqlRunner,
  args: ServiceBookingWrite & { now?: Date },
): Promise<boolean> {
  if (!(await serviceBookingsAvailable(run))) return false;
  const now = args.now ?? new Date();
  const status = args.record.st === "cancelled" ? "cancelled" : args.record.st;
  if (status !== "cancelled") {
    await expireStaleServiceBookingHolds(run, {
      productId: args.productId,
      now,
      range: { startUtc: args.record.s, endUtc: args.record.e },
    });
  }
  try {
    await run.execute(sql`
      INSERT INTO service_bookings
        (order_id, product_id, profile_id, buyer_user_id, slot_start, slot_end, status, hold_expires_at)
      VALUES (${args.orderId}, ${args.productId}, ${args.profileId}, ${args.buyerUserId},
              ${args.record.s}, ${args.record.e}, ${status},
              ${status === "held" ? (args.holdExpiresAt?.toISOString() ?? null) : null})
      ON CONFLICT (order_id) DO UPDATE
        SET slot_start = EXCLUDED.slot_start, slot_end = EXCLUDED.slot_end,
            status = EXCLUDED.status, hold_expires_at = EXCLUDED.hold_expires_at,
            updated_at = now()
    `);
  } catch (err) {
    if (isBookingConflictError(err)) throw new BookingSlotConflictError();
    throw err;
  }
  return true;
}

/**
 * Flip a held booking to confirmed at payment verify. Returns:
 *  - "confirmed": the row now reads confirmed;
 *  - "conflict":  the hold had lapsed and another active booking took
 *    the slot meanwhile — the row is left 'expired' (the paid order is
 *    still honored by the route; the clash is surfaced, never silent);
 *  - "missing":   no hardened row (pre-migration order) — nothing to do;
 *  - "absent":    the table does not exist yet (v1 rails).
 */
export async function confirmServiceBooking(
  run: SqlRunner,
  orderId: string,
): Promise<"confirmed" | "conflict" | "missing" | "absent"> {
  if (!(await serviceBookingsAvailable(run))) return "absent";
  try {
    const r = await run.execute(sql`
      UPDATE service_bookings
      SET status = 'confirmed', hold_expires_at = NULL, updated_at = now()
      WHERE order_id = ${orderId} AND status IN ('held', 'expired')
      RETURNING id
    `);
    return r.rows.length > 0 ? "confirmed" : "missing";
  } catch (err) {
    if (isBookingConflictError(err)) {
      /* Re-assert the truth: this booking no longer owns the slot. */
      await run.execute(sql`
        UPDATE service_bookings SET status = 'expired', updated_at = now()
        WHERE order_id = ${orderId} AND status = 'held'
      `).catch(() => undefined);
      return "conflict";
    }
    throw err;
  }
}

/** Free a booking's slot at cancel time. Idempotent; returns false only
 *  when the table is absent. */
export async function cancelServiceBooking(run: SqlRunner, orderId: string): Promise<boolean> {
  if (!(await serviceBookingsAvailable(run))) return false;
  await run.execute(sql`
    UPDATE service_bookings
    SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
    WHERE order_id = ${orderId} AND status IN ('held', 'confirmed', 'expired')
  `);
  return true;
}

/* ═══════════════════════ Read / reconciliation ═══════════════════════ */

export interface ServiceBookingRange {
  orderId: string;
  startUtc: string;
  endUtc: string;
}

/** Active (slot-blocking) hardened ranges for a product: confirmed
 *  bookings plus holds that have not lapsed as of `now`. */
export async function fetchServiceBookingRanges(
  run: SqlRunner,
  productId: string,
  now: Date,
): Promise<ServiceBookingRange[]> {
  if (!(await serviceBookingsAvailable(run))) return [];
  const r = await run.execute(sql`
    SELECT order_id, slot_start, slot_end FROM service_bookings
    WHERE product_id = ${productId}
      AND (status = 'confirmed'
           OR (status = 'held' AND (hold_expires_at IS NULL OR hold_expires_at > ${now.toISOString()})))
  `);
  return (r.rows as Array<Record<string, unknown>>).map((row) => ({
    orderId: String(row["order_id"]),
    startUtc: new Date(String(row["slot_start"])).toISOString(),
    endUtc: new Date(String(row["slot_end"])).toISOString(),
  }));
}

/**
 * Reconciliation: backfill hardened rows for live trailer bookings that
 * don't have one yet (every v1 booking, on first touch post-migration —
 * the migration ships the same backfill in SQL; this is the code-side
 * twin the routes/tests can call). A legacy booking whose slot is
 * already owned by a hardened row is counted as a conflict and skipped
 * — reported, never silently double-booked. Cancelled trailer records
 * are skipped (they block nothing). Returns honest counts.
 */
export async function reconcileServiceBookings(
  run: SqlRunner,
  args: { productId?: string; now?: Date } = {},
): Promise<{ inserted: number; conflicts: number; scanned: number } | null> {
  if (!(await serviceBookingsAvailable(run))) return null;
  const now = args.now ?? new Date();
  const productClause = args.productId ? sql`AND product_id = ${args.productId}` : sql``;
  const r = await run.execute(sql`
    SELECT id, product_id, profile_id, buyer_user_id, status, fulfillment_note, created_at
    FROM store_orders
    WHERE product_kind = 'service' AND fulfillment_note LIKE '%⟦bk1:%'
      AND status IN ('booking_held', 'completed') ${productClause}
  `);
  let inserted = 0;
  let conflicts = 0;
  let scanned = 0;
  for (const row of r.rows as Array<Record<string, unknown>>) {
    const rec = decodeBookingNote(row["fulfillment_note"] as string | null);
    if (!rec || !bookingBlocksSlot(rec)) continue;
    scanned += 1;
    const orderStatus = String(row["status"]);
    const created = new Date(String(row["created_at"]));
    const holdExpiresAt =
      orderStatus === "booking_held" && !Number.isNaN(created.getTime())
        ? new Date(created.getTime() + 30 * 60_000)
        : null;
    if (orderStatus === "booking_held" && holdExpiresAt && holdExpiresAt.getTime() <= now.getTime()) {
      continue; // a lapsed hold blocks nothing; don't resurrect it
    }
    try {
      const ins = await run.execute(sql`
        INSERT INTO service_bookings
          (order_id, product_id, profile_id, buyer_user_id, slot_start, slot_end, status, hold_expires_at)
        VALUES (${String(row["id"])}, ${String(row["product_id"])}, ${String(row["profile_id"])},
                ${String(row["buyer_user_id"])}, ${rec.s}, ${rec.e},
                ${orderStatus === "booking_held" ? "held" : "confirmed"},
                ${holdExpiresAt?.toISOString() ?? null})
        ON CONFLICT (order_id) DO NOTHING
        RETURNING id
      `);
      if (ins.rows.length > 0) inserted += 1;
    } catch (err) {
      if (isBookingConflictError(err)) {
        conflicts += 1;
        continue;
      }
      throw err;
    }
  }
  return { inserted, conflicts, scanned };
}
