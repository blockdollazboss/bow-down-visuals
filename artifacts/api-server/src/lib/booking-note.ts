/**
 * booking-note.ts — the booking record codec for storefront service orders.
 *
 * A booking IS a store_orders row (kind='service'): the money record and
 * the booking record are one row, created as a hold at checkout and flipped
 * to confirmed at verify (see routes/storefront.ts). There is no bookings
 * table in the current schema, so the slot payload rides in the order's
 * fulfillment_note behind this codec — the note stays human-readable, with
 * a machine trailer appended:
 *
 *   Booked: Sat, Nov 1, 2026, 2:00 PM – 2:30 PM (America/New_York) ⟦bk1:<b64>⟧
 *
 * This module is the ONLY owner of that format. Every writer of a booked
 * service order's fulfillment_note goes through encodeBookingNote /
 * withBookingState; every reader goes through decodeBookingNote. Legacy
 * notes (pre-booking flow) decode to null and keep working untouched.
 *
 * The codec is pure and total: encode never throws on a valid BookingRecord,
 * decode returns null (never throws) on anything that isn't a well-formed
 * bk1 trailer.
 */

export type BookingState = "held" | "confirmed" | "cancelled";
export type BookingRefundState = "refunded" | "refund_failed" | "not_required";

export interface BookingRecord {
  v: 1;
  /** Slot start, UTC ISO. */
  s: string;
  /** Slot end, UTC ISO. */
  e: string;
  /** Creator's IANA timezone (availability is defined in it). */
  ctz: string;
  /** Buyer's IANA timezone at booking time (display truth for the buyer). */
  btz: string;
  st: BookingState;
  /** Who cancelled: 'buyer' | 'creator'. Present only when st='cancelled'. */
  ca?: "buyer" | "creator";
  /** Cancellation instant, UTC ISO. Present only when st='cancelled'. */
  cx?: string;
  /** Refund outcome for a cancelled booking. */
  rf?: BookingRefundState;
}

const TRAILER_RE = /⟦bk1:([A-Za-z0-9_-]+)⟧\s*$/;

function isValidRecord(x: unknown): x is BookingRecord {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  if (r["v"] !== 1) return false;
  if (typeof r["s"] !== "string" || Number.isNaN(Date.parse(r["s"]))) return false;
  if (typeof r["e"] !== "string" || Number.isNaN(Date.parse(r["e"]))) return false;
  if (typeof r["ctz"] !== "string" || r["ctz"].length === 0) return false;
  if (typeof r["btz"] !== "string" || r["btz"].length === 0) return false;
  if (r["st"] !== "held" && r["st"] !== "confirmed" && r["st"] !== "cancelled") return false;
  if (r["ca"] !== undefined && r["ca"] !== "buyer" && r["ca"] !== "creator") return false;
  if (r["cx"] !== undefined && (typeof r["cx"] !== "string" || Number.isNaN(Date.parse(r["cx"])))) return false;
  if (
    r["rf"] !== undefined &&
    r["rf"] !== "refunded" && r["rf"] !== "refund_failed" && r["rf"] !== "not_required"
  ) return false;
  return true;
}

/** Human line for a booking, rendered in the CREATOR's timezone — the note
 *  is read in dashboards by both sides, and the creator's wall clock is the
 *  availability truth. Clients render their own localized line from the
 *  decoded record; this text is the durable fallback. */
export function bookingHumanLine(rec: BookingRecord): string {
  const start = new Date(rec.s);
  const end = new Date(rec.e);
  const dayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: rec.ctz, weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: rec.ctz, hour: "numeric", minute: "2-digit",
  });
  const stateWord =
    rec.st === "held" ? "Reserved" : rec.st === "cancelled" ? "Booking cancelled" : "Booked";
  return `${stateWord}: ${dayFmt.format(start)}, ${timeFmt.format(start)} – ${timeFmt.format(end)} (${rec.ctz})`;
}

export function encodeBookingNote(rec: BookingRecord, extraHuman?: string): string {
  const payload = Buffer.from(JSON.stringify(rec), "utf8").toString("base64url");
  const human = bookingHumanLine(rec);
  return `${extraHuman ? `${extraHuman} · ` : ""}${human} ⟦bk1:${payload}⟧`;
}

/** Decode the booking record from a fulfillment note. Returns null for
 *  legacy notes, non-booking orders, and malformed trailers. */
export function decodeBookingNote(note: string | null | undefined): BookingRecord | null {
  if (!note) return null;
  const m = TRAILER_RE.exec(note);
  if (!m || !m[1]) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
    return isValidRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Re-encode a note with an updated record, preserving any human prefix the
 *  previous writer put before the booking line. If the note had no trailer,
 *  the record is appended fresh. */
export function withBookingState(note: string | null | undefined, rec: BookingRecord): string {
  const payload = Buffer.from(JSON.stringify(rec), "utf8").toString("base64url");
  const human = bookingHumanLine(rec);
  if (note && TRAILER_RE.test(note)) {
    const head = note.replace(TRAILER_RE, "").trimEnd();
    /* The previous booking line is the LAST sentence of the head; keep any
       earlier human text (e.g. a seller note) and swap the booking line. */
    const prevHuman = bookingHumanLine(decodeBookingNote(note) ?? rec);
    const kept = head.endsWith(prevHuman) ? head.slice(0, head.length - prevHuman.length).trimEnd() : head;
    const prefix = kept ? `${kept.replace(/·\s*$/, "").trimEnd()} · ` : "";
    return `${prefix}${human} ⟦bk1:${payload}⟧`;
  }
  return `${note ? `${note} · ` : ""}${human} ⟦bk1:${payload}⟧`;
}

/** Derived, display-grade booking status for lists. 'held' rows are
 *  checkout-in-flight; a confirmed booking is 'upcoming' until its end
 *  passes, then 'done'. Cancelled stays cancelled regardless of the clock. */
export type BookingStatus = "held" | "upcoming" | "done" | "cancelled";

export function deriveBookingStatus(
  rec: BookingRecord,
  orderStatus: string,
  now: Date = new Date(),
): BookingStatus {
  if (rec.st === "cancelled" || orderStatus === "cancelled" || orderStatus === "refunded") {
    return "cancelled";
  }
  if (rec.st === "held" || orderStatus === "booking_held") return "held";
  return new Date(rec.e).getTime() <= now.getTime() ? "done" : "upcoming";
}

/** Does this record currently BLOCK its slot for other buyers? A live hold
 *  or a confirmed booking blocks; a cancelled one never does. Hold expiry
 *  itself is judged by the caller (it needs the order's created_at). */
export function bookingBlocksSlot(rec: BookingRecord): boolean {
  return rec.st === "held" || rec.st === "confirmed";
}

export function bookingsOverlap(
  a: { s: string; e: string },
  b: { s: string; e: string },
): boolean {
  return Date.parse(a.s) < Date.parse(b.e) && Date.parse(b.s) < Date.parse(a.e);
}
