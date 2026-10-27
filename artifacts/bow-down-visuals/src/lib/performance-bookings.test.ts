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
  type PerformanceBookingDto,
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
