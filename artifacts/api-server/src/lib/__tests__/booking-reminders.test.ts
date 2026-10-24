/**
 * Buyer booking reminders (stack29/more-bookings) — the sweep that
 * pings the BUYER ahead of a confirmed appointment, on the same
 * job_notifications rail the seller pings use.
 *
 * Pins:
 *  - a confirmed booking inside the 24h lead window fires exactly one
 *    reminder, addressed to the buyer, worded in the buyer's timezone;
 *  - repeated sweeps never re-send (job_notifications unique gate +
 *    the codec's rm stamp agree);
 *  - a booking beyond the lead window waits, then fires when due;
 *  - held / cancelled / refunded / past / already-started / legacy
 *    (non-booking) orders never fire;
 *  - a booking cancelled BEFORE its reminder fires is never reminded
 *    (the claim UPDATE re-checks status + note atomically);
 *  - the rm stamp round-trips through the booking-note codec.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "./test-db";
import {
  notifyDueBookingReminders,
  BOOKING_REMINDER_JOB_TYPE,
  BOOKING_REMINDER_LEAD_MS,
} from "../booking-reminders";
import {
  encodeBookingNote,
  decodeBookingNote,
  type BookingRecord,
} from "../booking-note";

const DDL = `
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL, product_kind text NOT NULL,
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  fulfillment_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_notifications (
  id uuid DEFAULT gen_random_uuid(),
  job_type text NOT NULL, job_id text NOT NULL, user_id uuid NOT NULL,
  status text NOT NULL, title text NOT NULL, message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jn_pk PRIMARY KEY (id),
  CONSTRAINT jn_uniq UNIQUE (job_type, job_id)
);`;

const NOW = new Date("2026-11-10T12:00:00.000Z");
const BUYER = randomUUID();
const BUYER2 = randomUUID();
const SELLER_PROFILE = randomUUID();

let h: TestDb;

beforeEach(() => {
  h = createTestDb();
  h.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  /* createTestDb pre-creates job_notifications WITHOUT the id default
     the real table (and the sweep's inserts) rely on — replace it. */
  h.mem.public.none("DROP TABLE job_notifications");
  h.mem.public.none(DDL);
});

function rec(startMs: number, overrides: Partial<BookingRecord> = {}): BookingRecord {
  return {
    v: 1,
    s: new Date(startMs).toISOString(),
    e: new Date(startMs + 3600_000).toISOString(),
    ctz: "America/New_York",
    btz: "America/Chicago",
    st: "confirmed",
    ...overrides,
  };
}

async function seedBooking(args: {
  record: BookingRecord;
  status?: string;
  buyer?: string;
  title?: string;
  note?: string;
}): Promise<string> {
  const id = randomUUID();
  const note = args.note ?? encodeBookingNote(args.record);
  await h.db.execute(sql`
    INSERT INTO store_orders (id, buyer_user_id, profile_id, product_id, product_title,
      product_kind, quantity, amount_cents, status, fulfillment_note)
    VALUES (${id}, ${args.buyer ?? BUYER}, ${SELLER_PROFILE}, ${randomUUID()},
      ${args.title ?? "1:1 Coaching Call"}, 'service', 1, 5000,
      ${args.status ?? "completed"}, ${note})
  `);
  return id;
}

async function notifications(userId?: string) {
  const r = userId
    ? await h.db.execute(sql`SELECT * FROM job_notifications WHERE job_type = ${BOOKING_REMINDER_JOB_TYPE} AND user_id = ${userId}`)
    : await h.db.execute(sql`SELECT * FROM job_notifications WHERE job_type = ${BOOKING_REMINDER_JOB_TYPE}`);
  return r.rows as Array<Record<string, unknown>>;
}

async function noteOf(orderId: string): Promise<string> {
  const r = await h.db.execute(sql`SELECT fulfillment_note FROM store_orders WHERE id = ${orderId}`);
  return String((r.rows[0] as Record<string, unknown>)["fulfillment_note"]);
}

const sweep = (now: Date = NOW) =>
  notifyDueBookingReminders({ runner: h.db as never, now });

describe("booking-reminders sweep", () => {
  it("lead constant is the named 24 hours", () => {
    expect(BOOKING_REMINDER_LEAD_MS).toBe(24 * 3600_000);
  });

  it("fires once for a confirmed booking inside the lead window — to the buyer, in the buyer's timezone", async () => {
    /* NOW + 12h = 2026-11-11T00:00Z = 6:00 PM in Chicago (buyer). */
    const id = await seedBooking({ record: rec(NOW.getTime() + 12 * 3600_000) });
    expect(await sweep()).toBe(1);
    const rows = await notifications();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!["user_id"])).toBe(BUYER);
    expect(String(rows[0]!["job_id"])).toBe(id);
    expect(String(rows[0]!["title"])).toBe("Reminder: 1:1 Coaching Call");
    expect(String(rows[0]!["message"])).toContain("1:1 Coaching Call");
    expect(String(rows[0]!["message"])).toContain("6:00 PM");
    expect(String(rows[0]!["message"])).toContain("(America/Chicago)");
    /* The codec stamp landed and names the sweep instant. */
    expect(decodeBookingNote(await noteOf(id))?.rm).toBe(NOW.toISOString());
  });

  it("fires at the exact lead boundary (start = now + 24h)", async () => {
    await seedBooking({ record: rec(NOW.getTime() + BOOKING_REMINDER_LEAD_MS) });
    expect(await sweep()).toBe(1);
  });

  it("exactly once across repeated sweeps", async () => {
    await seedBooking({ record: rec(NOW.getTime() + 2 * 3600_000) });
    expect(await sweep()).toBe(1);
    expect(await sweep()).toBe(0);
    expect(await sweep(new Date(NOW.getTime() + 3600_000))).toBe(0);
    expect(await notifications()).toHaveLength(1);
  });

  it("a booking beyond the lead window waits, then fires when it enters the window", async () => {
    const id = await seedBooking({ record: rec(NOW.getTime() + 48 * 3600_000) });
    expect(await sweep()).toBe(0);
    expect(await notifications()).toHaveLength(0);
    expect(decodeBookingNote(await noteOf(id))?.rm).toBeUndefined();
    /* 25h later the slot is 23h out — due. */
    expect(await sweep(new Date(NOW.getTime() + 25 * 3600_000))).toBe(1);
    expect(await notifications()).toHaveLength(1);
  });

  it("multiple due bookings each get their own reminder, addressed to their own buyer", async () => {
    await seedBooking({ record: rec(NOW.getTime() + 3 * 3600_000) });
    await seedBooking({ record: rec(NOW.getTime() + 5 * 3600_000), buyer: BUYER2 });
    expect(await sweep()).toBe(2);
    expect(await notifications(BUYER)).toHaveLength(1);
    expect(await notifications(BUYER2)).toHaveLength(1);
  });

  it("never fires for a held booking", async () => {
    await seedBooking({
      record: rec(NOW.getTime() + 2 * 3600_000, { st: "held" }),
      status: "booking_held",
    });
    expect(await sweep()).toBe(0);
    expect(await notifications()).toHaveLength(0);
  });

  it("never fires for cancelled or refunded bookings", async () => {
    await seedBooking({
      record: rec(NOW.getTime() + 2 * 3600_000, {
        st: "cancelled", ca: "buyer", cx: NOW.toISOString(), rf: "refunded",
      }),
      status: "refunded",
    });
    await seedBooking({
      record: rec(NOW.getTime() + 3 * 3600_000, {
        st: "cancelled", ca: "creator", cx: NOW.toISOString(), rf: "refund_failed",
      }),
      status: "cancelled",
      buyer: BUYER2,
    });
    expect(await sweep()).toBe(0);
    expect(await notifications()).toHaveLength(0);
  });

  it("a booking cancelled after seeding but BEFORE the sweep fires is never reminded", async () => {
    const id = await seedBooking({ record: rec(NOW.getTime() + 2 * 3600_000) });
    /* The cancel rail lands first: status flips + trailer rewritten. */
    const cancelled = rec(NOW.getTime() + 2 * 3600_000, {
      st: "cancelled", ca: "buyer", cx: NOW.toISOString(), rf: "refunded",
    });
    await h.db.execute(sql`
      UPDATE store_orders SET status = 'refunded', fulfillment_note = ${encodeBookingNote(cancelled)} WHERE id = ${id}
    `);
    expect(await sweep()).toBe(0);
    expect(await notifications()).toHaveLength(0);
  });

  it("never fires for past or already-started bookings", async () => {
    /* Done: ended an hour ago. */
    await seedBooking({ record: rec(NOW.getTime() - 2 * 3600_000) });
    /* Already started: began 30 min ago, ends in 30 min. */
    await seedBooking({ record: rec(NOW.getTime() - 30 * 60_000), buyer: BUYER2 });
    expect(await sweep()).toBe(0);
    expect(await notifications()).toHaveLength(0);
  });

  it("legacy service orders without a booking trailer are ignored, not crashed on", async () => {
    await seedBooking({
      record: rec(NOW.getTime() + 2 * 3600_000),
      note: "Booking request received — the creator confirms your slot.",
    });
    expect(await sweep()).toBe(0);
    expect(await notifications()).toHaveLength(0);
  });

  it("the seller receives nothing from this sweep — buyer only", async () => {
    await seedBooking({ record: rec(NOW.getTime() + 2 * 3600_000) });
    await sweep();
    const all = await h.db.execute(sql`SELECT user_id FROM job_notifications`);
    expect(all.rows).toHaveLength(1);
    expect(String((all.rows[0] as Record<string, unknown>)["user_id"])).toBe(BUYER);
  });

  it("codec: the rm stamp round-trips, and a record without one still decodes", () => {
    const stamped = rec(NOW.getTime() + 3600_000, { rm: NOW.toISOString() });
    expect(decodeBookingNote(encodeBookingNote(stamped))).toEqual(stamped);
    const plain = rec(NOW.getTime() + 3600_000);
    expect(decodeBookingNote(encodeBookingNote(plain))?.rm).toBeUndefined();
    /* A malformed rm invalidates the record rather than crashing. */
    const bad = { ...plain, rm: "not-a-date" } as unknown as BookingRecord;
    expect(decodeBookingNote(encodeBookingNote(bad))).toBeNull();
  });
});
