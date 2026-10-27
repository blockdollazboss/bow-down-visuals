/**
 * office-hours.ts — Office Hours (#167), the VB-priced shape of Paid
 * Bookings.
 *
 * An Office Hours service is an ordinary bookable storefront service
 * (same availability grid, same slot guard, same store_orders trailer
 * record) with two differences, both owned here:
 *
 *   1. It is paid in Visual Bucs, not dollars. The buyer is charged at
 *      booking time through lib/credits (chargeCredits, personal
 *      balance only) under a deterministic idempotency key derived
 *      from the booking intent (buyer + product + slot) — so a retry,
 *      double-tap, or lost-response re-book of the SAME session can
 *      never charge twice. The
 *      dollar columns on the order row stay 0: the two economies are
 *      never mixed on one record. The key is stored on the booking
 *      record (BookingRecord.ck) so a cancellation can refund AND
 *      void it (a refunded charge whose key still stands would
 *      suppress the buyer's next legitimate charge as a "replay").
 *
 *   2. The session is held as a video call inside Messages. The
 *      booking record carries md: 'messages_call'; surfaces deep-link
 *      both parties to /messages?to=<otherUserId>, where the existing
 *      DM + video-call rails live. This module builds NO call
 *      machinery — it only names the door.
 *
 * The slot math, hold/confirm/cancel state machine, and hardened
 * service_bookings dual-write are NOT re-implemented here: the book
 * endpoint in routes/storefront.ts runs the exact same rails as a
 * dollar booking, with the Stripe session swapped for this charge.
 */
import { eq } from "drizzle-orm";
import { db, creditUsageTable } from "@workspace/db";
import {
  chargeCredits,
  refundCredits,
  voidChargeIdempotencyKey,
  OutOfCreditsError,
  CreditsDisabledError,
  LedgerWriteError,
} from "./credits";
import { logger } from "./logger";

/* ═══════════════ Service shape ══════════════════════════════════════ */

export interface OfficeHoursInfo {
  /** True when the service is an Office Hours service. */
  officeHours: boolean;
  /** The VB price when officeHours is true and valid, else null. A
   *  service flagged office_hours WITHOUT a valid price is not
   *  bookable as Office Hours — the book endpoint refuses it rather
   *  than guessing a price. */
  priceVb: number | null;
}

export function officeHoursInfo(
  serviceDetails: Record<string, unknown> | null | undefined,
): OfficeHoursInfo {
  const sd = (serviceDetails ?? {}) as Record<string, unknown>;
  if (sd["office_hours"] !== true) return { officeHours: false, priceVb: null };
  const raw = sd["price_vb"];
  const priceVb =
    typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;
  return { officeHours: true, priceVb };
}

/** The deterministic VB charge key for one Office Hours booking
 *  intent: one buyer, one service, one slot = one charge. The key is
 *  derived from the intent (never raw client input), so two different
 *  bookings can never collide and a retry of the same booking always
 *  lands on the same key. A cancellation voids the key (see
 *  refundOfficeHoursBooking), so re-booking the same slot after a
 *  cancel charges fresh — the intent is the same, the booking is new. */
export function officeHoursChargeKey(args: {
  buyerUserId: string;
  productId: string;
  startUtc: string;
}): string {
  return `office-hours:${args.buyerUserId}:${args.productId}:${args.startUtc}`;
}

/** The Messages door for a booking's session: both parties land in
 *  their DM thread with each other, where the video-call rails live. */
export function officeHoursMessagesPath(otherUserId: string): string {
  return `/messages?to=${encodeURIComponent(otherUserId)}`;
}

/* ═══════════════ Money steps (credits-rail wrappers) ════════════════ */

export type OfficeHoursChargeResult =
  | { ok: true; balanceAfter: number }
  | { ok: false; status: number; code: string; message: string };

/**
 * Charge the buyer for an Office Hours booking. Idempotent on the
 * order-derived key: re-running this for the same order is a no-op
 * success (chargeCredits dedupes), which is what makes the book
 * endpoint's crash-resume safe. Typed credits failures map to the
 * honest answers the route returns — the booking hold is released by
 * the caller on any failure, so a refused charge never strands a slot.
 */
export async function chargeOfficeHoursBooking(args: {
  buyerUserId: string;
  priceVb: number;
  chargeKey: string;
}): Promise<OfficeHoursChargeResult> {
  try {
    const balanceAfter = await chargeCredits(
      args.buyerUserId,
      args.priceVb,
      { action: "Office Hours Booking" },
      { personalOnly: true, idempotencyKey: args.chargeKey },
    );
    return { ok: true, balanceAfter };
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        ok: false, status: 402, code: "INSUFFICIENT_BALANCE",
        message: "Not enough Visual Bucs for this session — your balance hasn't changed.",
      };
    }
    if (err instanceof CreditsDisabledError) {
      return {
        ok: false, status: 403, code: "CREDITS_DISABLED",
        message: "Bookings aren't available on your account right now.",
      };
    }
    if (err instanceof LedgerWriteError) {
      return {
        ok: false, status: 500, code: "LEDGER_FAILED",
        message: "That booking couldn't be recorded safely, so it wasn't charged. Try again.",
      };
    }
    throw err;
  }
}

/** True when a charge carrying this key actually landed in the
 *  ledger. The cancel path uses it for bookings still in 'held': a
 *  hold whose charge never landed (refused at phase 2, then released)
 *  must NOT be "refunded" — that would print Bucs from nothing —
 *  while a hold whose charge landed just before a crash owes the
 *  buyer a real refund even though it never confirmed. A failed read
 *  answers false; the confirmed path never depends on this probe. */
export async function officeHoursChargeLanded(chargeKey: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: creditUsageTable.id })
      .from(creditUsageTable)
      .where(eq(creditUsageTable.idempotencyKey, chargeKey))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Refund one Office Hours booking in full and void its charge key, so
 * the buyer can book again (even the identical slot) without the
 * refunded charge suppressing the new one as a replay. Returns true
 * only when the balance was actually restored; the caller records
 * refund_failed honestly when this returns false.
 */
export async function refundOfficeHoursBooking(args: {
  buyerUserId: string;
  priceVb: number;
  chargeKey: string;
}): Promise<boolean> {
  try {
    await refundCredits(args.buyerUserId, args.priceVb, {
      action: "Office Hours Booking — Refund (cancelled)",
    });
  } catch (err) {
    logger.error(
      { err, buyerUserId: args.buyerUserId, chargeKey: args.chargeKey },
      "[office-hours] VB refund failed — booking cancel must record refund_failed",
    );
    return false;
  }
  await voidChargeIdempotencyKey(args.chargeKey);
  return true;
}
