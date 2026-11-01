import { logger } from "./logger";
import { notifyUserEvent, type UserEventInput } from "./push-events";

/* ── Storefront booking fan-out (fan-out truth, stack1100 Y3) ──────────
   Booking tells (new booking, clash, cancellation, buyer reminder)
   were recorded ONLY as job_notifications rows — a queue whose sole
   consumer is the owner's chat relay — so the booking parties never
   received a bell or a device ping; the sellers' own comments claimed
   the rail "pings", and it did, but only ever toward the owner's chat.
   The job_notifications row stays (it is the exactly-once claim and
   the ops record); when a row actually LANDS, the party is told
   through the one event door — money category, the paid-work rail,
   same title/message the row carries. Callers fire this only on a
   landed insert, so replays and conflict-loser writes stay silent. */

type BookingEventNotifier = (input: UserEventInput) => Promise<unknown>;
let _bookingEventNotifier: BookingEventNotifier = notifyUserEvent;
/** Test seam — never used outside tests. */
export function __setBookingEventNotifier(fn: BookingEventNotifier | null): void {
  _bookingEventNotifier = fn ?? notifyUserEvent;
}

export interface BookingEventInput {
  userId: string;
  /** The job_notifications job_type doubles as the bell kind. */
  kind: string;
  title: string;
  body: string;
  link: string;
}

/** Fire the bell + gated device ping for a landed booking tell.
 *  Best-effort: never throws into a booking write path. */
export async function notifyBookingEvent(input: BookingEventInput): Promise<void> {
  try {
    await _bookingEventNotifier({
      userId: input.userId,
      category: "money",
      kind: input.kind,
      title: input.title,
      body: input.body,
      link: input.link,
    });
  } catch (err) {
    logger.warn({ err, userId: input.userId, kind: input.kind }, "[booking-notify] event failed (booking stands)");
  }
}
