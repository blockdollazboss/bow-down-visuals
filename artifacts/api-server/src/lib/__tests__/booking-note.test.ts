/**
 * booking-note codec — the booking record that rides in a store order's
 * fulfillment_note. Round-trip integrity is money-critical: slot blocking,
 * the bookings list, and cancellation all read through decodeBookingNote.
 */
import { describe, it, expect } from "vitest";
import {
  encodeBookingNote,
  decodeBookingNote,
  withBookingState,
  deriveBookingStatus,
  bookingBlocksSlot,
  bookingsOverlap,
  type BookingRecord,
} from "../booking-note";

const REC: BookingRecord = {
  v: 1,
  s: "2026-01-05T14:00:00.000Z",
  e: "2026-01-05T14:30:00.000Z",
  ctz: "America/New_York",
  btz: "America/Chicago",
  st: "confirmed",
};

describe("booking-note codec", () => {
  it("round-trips a record and keeps the note human-readable", () => {
    const note = encodeBookingNote(REC);
    expect(note).toContain("Booked:");
    expect(note).toContain("Jan 5, 2026");
    expect(note).toContain("9:00 AM"); // creator wall time (EST)
    expect(decodeBookingNote(note)).toEqual(REC);
  });

  it("legacy notes and junk decode to null, never throw", () => {
    expect(decodeBookingNote("Booking request received — the creator confirms your slot.")).toBeNull();
    expect(decodeBookingNote(null)).toBeNull();
    expect(decodeBookingNote(undefined)).toBeNull();
    expect(decodeBookingNote("text ⟦bk1:not-base64-json!!!⟧")).toBeNull();
    expect(decodeBookingNote("text ⟦bk1:aGVsbG8⟧")).toBeNull(); // valid b64, not a record
  });

  it("withBookingState swaps state and preserves a human prefix", () => {
    const held = encodeBookingNote({ ...REC, st: "held" }, "Payment pending");
    expect(held).toContain("Payment pending");
    expect(decodeBookingNote(held)?.st).toBe("held");
    const cancelled = withBookingState(held, {
      ...REC, st: "cancelled", ca: "buyer", cx: "2026-01-02T00:00:00.000Z", rf: "refunded",
    });
    const rec = decodeBookingNote(cancelled);
    expect(rec?.st).toBe("cancelled");
    expect(rec?.ca).toBe("buyer");
    expect(rec?.rf).toBe("refunded");
    expect(cancelled).toContain("Payment pending");
    expect(cancelled).toContain("Booking cancelled:");
  });

  it("deriveBookingStatus: held → upcoming → done; cancelled is terminal", () => {
    const before = new Date("2026-01-01T00:00:00.000Z");
    const after = new Date("2026-01-06T00:00:00.000Z");
    expect(deriveBookingStatus({ ...REC, st: "held" }, "booking_held", before)).toBe("held");
    expect(deriveBookingStatus(REC, "completed", before)).toBe("upcoming");
    expect(deriveBookingStatus(REC, "completed", after)).toBe("done");
    expect(deriveBookingStatus({ ...REC, st: "cancelled" }, "refunded", before)).toBe("cancelled");
    expect(deriveBookingStatus(REC, "cancelled", before)).toBe("cancelled");
  });

  it("blocking + overlap math", () => {
    expect(bookingBlocksSlot({ ...REC, st: "held" })).toBe(true);
    expect(bookingBlocksSlot(REC)).toBe(true);
    expect(bookingBlocksSlot({ ...REC, st: "cancelled" })).toBe(false);
    expect(bookingsOverlap(
      { s: "2026-01-05T14:00:00.000Z", e: "2026-01-05T14:30:00.000Z" },
      { s: "2026-01-05T14:15:00.000Z", e: "2026-01-05T14:45:00.000Z" },
    )).toBe(true);
    expect(bookingsOverlap(
      { s: "2026-01-05T14:00:00.000Z", e: "2026-01-05T14:30:00.000Z" },
      { s: "2026-01-05T14:30:00.000Z", e: "2026-01-05T15:00:00.000Z" },
    )).toBe(false); // back-to-back is not an overlap
  });
});

describe("booking-note codec — Office Hours fields (#167)", () => {
  const OH: BookingRecord = {
    ...REC,
    md: "messages_call",
    vb: 750,
    ck: "office-hours:order-123",
  };

  it("round-trips the office-hours fields", () => {
    expect(decodeBookingNote(encodeBookingNote(OH))).toEqual(OH);
  });

  it("rejects records with malformed office-hours fields", () => {
    const bad1 = { ...REC, md: "carrier_pigeon" };
    const bad2 = { ...REC, vb: -5 };
    const bad3 = { ...REC, vb: "750" };
    const bad4 = { ...REC, ck: "" };
    for (const bad of [bad1, bad2, bad3, bad4]) {
      const payload = Buffer.from(JSON.stringify(bad), "utf8").toString("base64url");
      expect(decodeBookingNote(`x ⟦bk1:${payload}⟧`)).toBeNull();
    }
  });

  it("dollar bookings without the new fields still decode (backward compatible)", () => {
    expect(decodeBookingNote(encodeBookingNote(REC))).toEqual(REC);
  });
});
