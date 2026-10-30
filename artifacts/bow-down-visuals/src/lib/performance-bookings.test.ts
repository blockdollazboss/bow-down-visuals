/**
 * Book the Artist (#158) — FE presentation rules.
 * Pins the client twin of the server's state machine: each side sees
 * exactly the steps it can take at each status (and no step exists on
 * a closed booking), plus the status/escrow words and money format.
 */
import { describe, it, expect } from "vitest";
import {
  bookingNextActions,
  bookingMoney,
  BOOKING_STATUS_LABEL,
  ESCROW_STATUS_LABEL,
  validateBookingInput,
  BOOKING_LIMITS,
  type PerformanceBookingDto,
  type CreatePerformanceBookingInput,
} from "./performance-bookings";

function booking(over: Partial<PerformanceBookingDto> = {}): PerformanceBookingDto {
  return {
    id: "b1",
    profileId: "p1",
    artistUserId: "artist-1",
    artistName: "Thy Cheat Code",
    promoterUserId: "promo-1",
    promoterName: "Harbor Lights Venue",
    eventTitle: "Harbor Nights Live",
    eventDate: "2026-11-14T01:00:00.000Z",
    venueName: "The Harbor Room",
    venueAddress: "12 Pier Street",
    venueCity: "Norfolk",
    feeCents: 250_00,
    terms: { performance: "a 45-minute headline set" },
    plainWords: "…",
    notes: null,
    status: "proposed",
    escrowStatus: "unfunded",
    platformFeeCents: null,
    artistPayoutCents: null,
    paidAt: null,
    feePreview: { feeCents: 37_50, netCents: 212_50 },
    role: "promoter",
    createdAt: "2026-10-27T00:00:00.000Z",
    updatedAt: "2026-10-27T00:00:00.000Z",
    ...over,
  };
}

const ids = (b: PerformanceBookingDto) => bookingNextActions(b).map((a) => a.id);

describe("bookingNextActions", () => {
  it("the artist answers a proposal; the promoter can only cancel", () => {
    expect(ids(booking({ role: "artist" }))).toEqual(["accept", "decline", "cancel"]);
    expect(ids(booking({ role: "promoter" }))).toEqual(["cancel"]);
  });
  it("an accepted, unfunded booking offers the promoter the fund step", () => {
    expect(ids(booking({ status: "accepted" }))).toEqual(["fund", "cancel"]);
    expect(ids(booking({ status: "accepted", escrowStatus: "funding" }))).toEqual(["cancel"]);
    expect(ids(booking({ status: "accepted", role: "artist" }))).toEqual(["cancel"]);
  });
  it("a funded booking offers the artist the complete step", () => {
    expect(ids(booking({ status: "funded", escrowStatus: "funded", role: "artist" }))).toEqual(["complete", "cancel"]);
    expect(ids(booking({ status: "funded", escrowStatus: "funded", role: "promoter" }))).toEqual(["cancel"]);
  });
  it("a completed booking offers the promoter the release step — and no cancel", () => {
    expect(ids(booking({ status: "completed", escrowStatus: "funded" }))).toEqual(["release"]);
    expect(ids(booking({ status: "completed", escrowStatus: "funded", role: "artist" }))).toEqual([]);
  });
  it("closed bookings offer nothing, and neither do strangers", () => {
    for (const status of ["paid", "declined", "cancelled"] as const) {
      expect(ids(booking({ status }))).toEqual([]);
    }
    expect(ids(booking({ role: null }))).toEqual([]);
  });
});

/* ── validateBookingInput — the mirror of createPerformanceBookingSchema.
   The client must refuse exactly what the server refuses, at the same
   boundary values, before the request is made. */
describe("validateBookingInput (server schema mirror)", () => {
  const good: CreatePerformanceBookingInput = {
    profileId: "p1",
    promoterName: "Harbor Lights Venue",
    eventTitle: "Harbor Nights Live",
    eventDate: "2026-11-14T01:00:00.000Z",
    venueName: "The Harbor Room",
    venueAddress: "12 Pier Street",
    venueCity: "Norfolk",
    feeCents: 250_00,
    terms: { performance: "A 45-minute headline set" },
  };

  it("accepts a complete booking", () => {
    expect(validateBookingInput(good)).toBeNull();
  });

  it("caps every text field at the server's limit, at the boundary", () => {
    const fields = [
      ["promoterName", BOOKING_LIMITS.promoterName],
      ["eventTitle", BOOKING_LIMITS.eventTitle],
      ["venueName", BOOKING_LIMITS.venueName],
      ["venueAddress", BOOKING_LIMITS.venueAddress],
      ["venueCity", BOOKING_LIMITS.venueCity],
    ] as const;
    for (const [key, max] of fields) {
      expect(validateBookingInput({ ...good, [key]: "x".repeat(max) })).toBeNull();
      expect(validateBookingInput({ ...good, [key]: "x".repeat(max + 1) })).toContain(String(max));
    }
    expect(validateBookingInput({ ...good, terms: { performance: "x".repeat(501) } })).toContain("500");
    expect(validateBookingInput({ ...good, terms: { performance: "ok", productionNotes: "x".repeat(1001) } })).toContain("1000");
    expect(validateBookingInput({ ...good, terms: { performance: "ok", cancellationTerms: "x".repeat(1001) } })).toContain("1000");
    expect(validateBookingInput({ ...good, notes: "x".repeat(2001) })).toContain("2000");
    expect(validateBookingInput({ ...good, notes: "x".repeat(2000) })).toBeNull();
  });

  it("fee: $0.99 fails, $1 passes, $1,000,000 passes, $1,000,000.01 fails", () => {
    expect(validateBookingInput({ ...good, feeCents: 99 })).toContain("$1");
    expect(validateBookingInput({ ...good, feeCents: 100 })).toBeNull();
    expect(validateBookingInput({ ...good, feeCents: 100_000_000 })).toBeNull();
    expect(validateBookingInput({ ...good, feeCents: 100_000_001 })).toContain("$1,000,000");
  });

  it("set length: absent is fine, 0 and 1441 fail, 1440 passes", () => {
    expect(validateBookingInput({ ...good, terms: { performance: "ok", setLengthMin: null } })).toBeNull();
    expect(validateBookingInput({ ...good, terms: { performance: "ok", setLengthMin: 0 } })).toContain("1440");
    expect(validateBookingInput({ ...good, terms: { performance: "ok", setLengthMin: 1440 } })).toBeNull();
    expect(validateBookingInput({ ...good, terms: { performance: "ok", setLengthMin: 1441 } })).toContain("1440");
  });
});

describe("labels + money", () => {
  it("every status and escrow state has words", () => {
    expect(Object.keys(BOOKING_STATUS_LABEL)).toHaveLength(7);
    expect(Object.keys(ESCROW_STATUS_LABEL)).toHaveLength(5);
    expect(BOOKING_STATUS_LABEL.funded).toContain("escrow");
    expect(ESCROW_STATUS_LABEL.released).toContain("artist");
  });
  it("formats money like the server", () => {
    expect(bookingMoney(250_00)).toBe("$250.00");
    expect(bookingMoney(123456)).toBe("$1,234.56");
  });
});
