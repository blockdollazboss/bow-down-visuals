/**
 * booking-reminders.ts — buyer reminders for paid calendar bookings.
 *
 * The seller side of a booking already pings through job_notifications
 * (booking + cancellation, routes/storefront.ts). This is the buyer
 * side the bookings lane left as an honest follow-up: one reminder to
 * the BUYER ahead of a confirmed appointment, on the SAME rail
 * (job_notifications via the relay) — no new notification system, no
 * email (no booking-adjacent pattern sends one).
 *
 * Lead time: BOOKING_REMINDER_LEAD_MS = 24h before the slot start.
 * The codebase's only other reminder lead is the operator duties'
 * HOST_REMINDER_LEAD_MS (15 min, lib/operator-duties.ts) — sized for
 * palace live events whose audience is already in the world. A paid
 * 1:1 session is booked days out and needs prep/travel time, so the
 * 15-minute palace lead does not transfer; 24h is the named constant
 * here instead. A booking confirmed inside the lead window (booked
 * less than 24h ahead) is reminded on the first sweep after it
 * confirms — still ahead of the slot, never after it starts.
 *
 * Trigger: the job poller (lib/job-poller.ts, 30s tick) calls
 * notifyDueBookingReminders() every tick, alongside the export
 * notification backfill, the scheduled-post publisher, and the email
 * queue drain — the codebase's existing in-process periodic path.
 * DB-backed and restart-safe: no in-memory state, so a deploy can
 * neither lose nor double-fire a reminder.
 *
 * Exactly-once, two gates that agree:
 *  1. job_notifications UNIQUE(job_type, job_id) — the rail's own
 *     one-shot gate (INSERT … ON CONFLICT DO NOTHING), with
 *     job_type='storefront_booking_reminder' and job_id=<order id>,
 *     the same (type, order-id) shape the other booking pings use.
 *  2. The booking record's `rm` stamp in the note trailer
 *     (lib/booking-note.ts owns the format): the sweep claims a
 *     booking by stamping rm in the SAME transaction as the insert,
 *     with the claim UPDATE guarded on the order still being
 *     status='completed' and the note unchanged — so a booking
 *     cancelled (or refunded) before its reminder fires can never be
 *     claimed, and a stamped record is never re-sent even if its
 *     notification row were ever removed.
 *
 * Only CONFIRMED bookings (record st='confirmed', order status
 * 'completed', derived status 'upcoming') with a slot start inside
 * (now, now + lead] are reminded. Held, expired, cancelled, refunded,
 * already-started, and done bookings never are.
 */

import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import {
  bookingHumanLine,
  decodeBookingNote,
  deriveBookingStatus,
  withBookingState,
  type BookingRecord,
} from "./booking-note";

/** The buyer is reminded this long before the slot start. */
export const BOOKING_REMINDER_LEAD_MS = 24 * 3600_000;

/** job_notifications job_type for buyer booking reminders — the
 *  storefront_* family the other booking pings already use. */
export const BOOKING_REMINDER_JOB_TYPE = "storefront_booking_reminder";

/** Max bookings claimed per sweep; the poller ticks every 30s, so a
 *  backlog drains quickly without one tick doing unbounded work. */
export const BOOKING_REMINDER_BATCH = 100;

/* Minimal structural runner — the real @workspace/db and the pg-mem
   test db both satisfy it (same raw-SQL convention as storefront.ts). */
export interface BookingReminderRunner {
  execute: (query: SQL) => Promise<{ rows: unknown[] }>;
  transaction?: <T>(fn: (tx: BookingReminderRunner) => Promise<T>) => Promise<T>;
}

export interface BookingReminderDeps {
  runner?: BookingReminderRunner;
  now?: Date;
}

/** The appointment line for the BUYER's copy, rendered in the buyer's
 *  own timezone (the record's btz) — the seller-facing note line stays
 *  in the creator's zone; the buyer thinks in theirs. */
function buyerReminderWhen(rec: BookingRecord): string {
  try {
    const start = new Date(rec.s);
    const end = new Date(rec.e);
    const dayFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: rec.btz, weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
    const timeFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: rec.btz, hour: "numeric", minute: "2-digit",
    });
    return `${dayFmt.format(start)}, ${timeFmt.format(start)} – ${timeFmt.format(end)} (${rec.btz})`;
  } catch {
    return bookingHumanLine(rec);
  }
}

/**
 * One reminder sweep: claim + notify every due buyer. Returns how many
 * NEW notifications were created. Never throws — a missing table on a
 * fresh database or one bad row degrades to a log line, not a dead
 * poller tick (same posture as notifyTerminalExportJobs).
 */
export async function notifyDueBookingReminders(
  deps: BookingReminderDeps = {},
): Promise<number> {
  const now = deps.now ?? new Date();
  const runner = deps.runner ?? (db as unknown as BookingReminderRunner);

  let rows: Array<Record<string, unknown>>;
  try {
    const res = await runner.execute(sql`
      SELECT o.id, o.buyer_user_id, o.product_title, o.status, o.fulfillment_note
      FROM store_orders o
      WHERE o.product_kind = 'service'
        AND o.status = 'completed'
        AND o.fulfillment_note LIKE '%⟦bk1:%'
      ORDER BY o.created_at ASC
      LIMIT ${BOOKING_REMINDER_BATCH}
    `);
    rows = res.rows as Array<Record<string, unknown>>;
  } catch (err) {
    // store_orders may not exist yet on a fresh database — non-fatal.
    logger.warn({ err }, "[booking-reminders] candidate select failed; skipping");
    return 0;
  }

  const leadEnd = now.getTime() + BOOKING_REMINDER_LEAD_MS;
  let created = 0;
  for (const row of rows) {
    try {
      if (await remindOne(runner, row, now, leadEnd)) created++;
    } catch (err) {
      logger.warn(
        { err, orderId: String(row["id"] ?? "") },
        "[booking-reminders] reminder failed for one booking; continuing",
      );
    }
  }
  return created;
}

/** Claim + notify one candidate row. Returns true only when this call
 *  created the notification. */
async function remindOne(
  runner: BookingReminderRunner,
  row: Record<string, unknown>,
  now: Date,
  leadEnd: number,
): Promise<boolean> {
  const note = (row["fulfillment_note"] as string | null) ?? null;
  const rec = decodeBookingNote(note);
  if (!rec || !note) return false;
  /* Confirmed only — held/expired holds, cancellations, and refunds
     are filtered by the record state AND the order status, here and
     again in the claim UPDATE's guard below. */
  if (rec.st !== "confirmed") return false;
  if (rec.rm) return false; // already reminded — the trailer says so
  if (deriveBookingStatus(rec, String(row["status"]), now) !== "upcoming") return false;
  const startMs = Date.parse(rec.s);
  if (startMs <= now.getTime() || startMs > leadEnd) return false; // future, inside the lead window

  const orderId = String(row["id"]);
  const buyerUserId = String(row["buyer_user_id"]);
  const productTitle = String(row["product_title"] ?? "Service");
  const reminded: BookingRecord = { ...rec, rm: now.toISOString() };
  const claimedNote = withBookingState(note, reminded);

  const claimAndNotify = async (run: BookingReminderRunner): Promise<boolean> => {
    /* The claim: stamp rm only if the order is STILL the exact
       confirmed booking we read — a cancel/refund that landed after
       the SELECT flips status and rewrites the note, so this matches
       zero rows and no reminder fires for it. */
    const upd = await run.execute(sql`
      UPDATE store_orders
      SET fulfillment_note = ${claimedNote}
      WHERE id = ${orderId} AND status = 'completed' AND fulfillment_note = ${note}
      RETURNING id
    `);
    if (upd.rows.length === 0) return false;
    const ins = await run.execute(sql`
      INSERT INTO job_notifications (job_type, job_id, user_id, status, title, message)
      VALUES (${BOOKING_REMINDER_JOB_TYPE}, ${orderId}, ${buyerUserId}, 'completed',
              ${`Reminder: ${productTitle}`},
              ${`Your session "${productTitle}" is coming up — ${buyerReminderWhen(rec)}.`})
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    return ins.rows.length > 0;
  };

  /* Atomic when the runner supports it (the real db does): claim and
     insert commit together, so no crash window can stamp a booking
     without its notification existing. */
  const created = runner.transaction
    ? await runner.transaction(claimAndNotify)
    : await claimAndNotify(runner);
  if (created) {
    logger.info({ orderId }, "[booking-reminders] buyer reminder recorded");
  }
  return created;
}
