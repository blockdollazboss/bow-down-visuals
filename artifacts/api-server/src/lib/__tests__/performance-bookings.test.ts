/**
 * Book the Artist (#158) — the pure escrow core.
 * Pins: the fee split at the sponsors escrow rate (15%, fee out of
 * the gross, promoter never pays extra), the lifecycle state machine
 * (every step's guard + who can take it), the cancel escrow outcome,
 * the plain-words summary (deterministic, complete, generated from
 * the same facts the money moves on), and the funding idempotency
 * key (same intent = same key, different booking/fee = different key).
 */
import { describe, it, expect } from "vitest";
import {
  PERFORMANCE_BOOKING_FEE_BPS,
  performanceFeeSplit,
  moneyCents,
  canTakeAction,
  escrowStatusAfterCancel,
  ACTION_ACTOR,
  buildPlainWordsTerms,
  buildPerformanceEscrowCheckoutKey,
  type PlainWordsFacts,
} from "../performance-bookings";

describe("performanceFeeSplit", () => {
  it("uses the sponsors escrow rate: 15% out of the fee", () => {
    expect(PERFORMANCE_BOOKING_FEE_BPS).toBe(1500);
    expect(performanceFeeSplit(100_00)).toEqual({ feeCents: 15_00, netCents: 85_00 });
    expect(performanceFeeSplit(250_00)).toEqual({ feeCents: 37_50, netCents: 212_50 });
  });
  it("fee + net always equals the gross, rounding to whole cents", () => {
    for (const gross of [1, 99, 101, 3333, 999_99]) {
      const { feeCents, netCents } = performanceFeeSplit(gross);
      expect(feeCents + netCents).toBe(gross);
      expect(Number.isInteger(feeCents)).toBe(true);
    }
  });
});

describe("moneyCents", () => {
  it("formats dollars with cents", () => {
    expect(moneyCents(100_00)).toBe("$100.00");
    expect(moneyCents(123456)).toBe("$1,234.56");
  });
});

describe("canTakeAction — the booking lifecycle", () => {
  it("walks the happy path: proposed → accepted → funded → completed → paid", () => {
    expect(canTakeAction("proposed", "accept")).toEqual({ ok: true, to: "accepted" });
    expect(canTakeAction("accepted", "fund")).toEqual({ ok: true, to: "funded" });
    expect(canTakeAction("funded", "complete")).toEqual({ ok: true, to: "completed" });
    expect(canTakeAction("completed", "release")).toEqual({ ok: true, to: "paid" });
  });
  it("decline only from proposed", () => {
    expect(canTakeAction("proposed", "decline")).toEqual({ ok: true, to: "declined" });
    expect(canTakeAction("accepted", "decline").ok).toBe(false);
  });
  it("refuses out-of-order steps with an honest message", () => {
    for (const [status, action] of [
      ["proposed", "fund"],
      ["proposed", "complete"],
      ["accepted", "complete"],
      ["accepted", "release"],
      ["funded", "release"],
      ["funded", "accept"],
      ["paid", "release"],
      ["paid", "cancel"],
      ["cancelled", "accept"],
      ["declined", "fund"],
    ] as const) {
      const r = canTakeAction(status, action);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain(status);
    }
  });
  it("cancel is open until the money is released", () => {
    for (const s of ["proposed", "accepted", "funded"]) {
      expect(canTakeAction(s, "cancel")).toEqual({ ok: true, to: "cancelled" });
    }
    expect(canTakeAction("completed", "cancel").ok).toBe(false);
  });
  it("names who takes each step", () => {
    expect(ACTION_ACTOR).toEqual({
      accept: "artist", decline: "artist", fund: "promoter",
      complete: "artist", release: "promoter", cancel: "either",
    });
  });
});

describe("escrowStatusAfterCancel", () => {
  it("money that never moved stays unfunded; escrowed money reads refunded", () => {
    expect(escrowStatusAfterCancel("unfunded")).toBe("unfunded");
    expect(escrowStatusAfterCancel("funding")).toBe("refunded");
    expect(escrowStatusAfterCancel("funded")).toBe("refunded");
  });
});

const FACTS: PlainWordsFacts = {
  artistName: "Thy Cheat Code",
  promoterName: "Harbor Lights Venue",
  eventTitle: "Harbor Nights Live",
  eventDate: "2026-11-14T01:00:00.000Z",
  venueName: "The Harbor Room",
  venueAddress: "12 Pier Street",
  venueCity: "Norfolk",
  feeCents: 250_00,
  terms: {
    performance: "a 45-minute headline set",
    setLengthMin: 45,
    productionNotes: "the venue provides sound and lights",
    cancellationTerms: null,
  },
};

describe("buildPlainWordsTerms", () => {
  it("says who, what, when, where, and how much — in plain words", () => {
    const words = buildPlainWordsTerms(FACTS);
    expect(words).toContain("Harbor Lights Venue is booking Thy Cheat Code to perform at Harbor Nights Live.");
    expect(words).toContain("The Harbor Room, 12 Pier Street, Norfolk");
    expect(words).toContain("The performance: a 45-minute headline set.");
    expect(words).toContain("The set runs about 45 minutes.");
    expect(words).toContain("Sound, lights, and setup: the venue provides sound and lights.");
    expect(words).toContain("The fee is $250.00.");
    expect(words).toContain("Thy Cheat Code receives $212.50");
    expect(words).toContain("Bow Down Visuals keeps $37.50");
    expect(words).toContain("never pays more than the agreed fee");
  });
  it("uses the agreed cancellation terms when given, the full-refund default when not", () => {
    expect(buildPlainWordsTerms(FACTS)).toContain("the full fee goes back to Harbor Lights Venue");
    const custom = buildPlainWordsTerms({
      ...FACTS,
      terms: { ...FACTS.terms, cancellationTerms: "the promoter keeps 20% if they cancel within a week of the show" },
    });
    expect(custom).toContain("If the show is cancelled: the promoter keeps 20% if they cancel within a week of the show.");
    expect(custom).not.toContain("the full fee goes back");
  });
  it("is deterministic and omits optional lines that were never agreed", () => {
    const bare: PlainWordsFacts = {
      ...FACTS,
      terms: { performance: "a DJ set" },
    };
    expect(buildPlainWordsTerms(bare)).toBe(buildPlainWordsTerms(bare));
    expect(buildPlainWordsTerms(bare)).not.toContain("The set runs about");
    expect(buildPlainWordsTerms(bare)).not.toContain("Sound, lights, and setup:");
  });
  it("renders the show date from the record, never a guessed one", () => {
    expect(buildPlainWordsTerms(FACTS)).toContain("November 14, 2026");
  });
});

describe("buildPerformanceEscrowCheckoutKey", () => {
  const base = { promoterUserId: "promo-1", bookingId: "bk-1", feeCents: 250_00 };
  it("is deterministic for the same funding intent", () => {
    expect(buildPerformanceEscrowCheckoutKey(base)).toBe(buildPerformanceEscrowCheckoutKey({ ...base }));
    expect(buildPerformanceEscrowCheckoutKey(base)).toContain("performance-escrow");
  });
  it("differs across promoter, booking, and fee", () => {
    const k = buildPerformanceEscrowCheckoutKey(base);
    expect(buildPerformanceEscrowCheckoutKey({ ...base, promoterUserId: "promo-2" })).not.toBe(k);
    expect(buildPerformanceEscrowCheckoutKey({ ...base, bookingId: "bk-2" })).not.toBe(k);
    expect(buildPerformanceEscrowCheckoutKey({ ...base, feeCents: 300_00 })).not.toBe(k);
  });
});
