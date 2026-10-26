/**
 * Feature Verse Market (Stack-200 N7) — pure machine tests.
 * Pins: splits ride the publishing-splits validator, the delivery
 * gate (BOTH signatures + held escrow), terms freeze, escrow keys,
 * expiry, and creator-entered price validation (no platform default).
 */
import { describe, it, expect } from "vitest";
import {
  bothSigned,
  canConfirmRelease,
  canDeliver,
  canDispute,
  canFund,
  escrowLedgerKey,
  featureVerseEscrowLabel,
  featureVerseStatusLabel,
  holdChargeKey,
  isExpired,
  refundOwed,
  signByFrom,
  termsFrozen,
  validateFeatureSplits,
  validateListingPrice,
  FEATURE_VERSE_SIGN_WINDOW_DAYS,
} from "../feature-verse";

const NOW = new Date("2026-10-26T12:00:00Z");
const FUTURE = new Date(NOW.getTime() + 24 * 3600 * 1000);
const PAST = new Date(NOW.getTime() - 1000);

function order(over: Record<string, unknown> = {}) {
  return {
    status: "terms_proposed",
    escrowStatus: "none",
    buyerSignedAt: null,
    creatorSignedAt: null,
    signBy: FUTURE,
    ...over,
  } as any;
}

describe("splits validation (publishing-splits rail)", () => {
  it("accepts splits summing to 100", () => {
    const out = validateFeatureSplits([
      { name: " Buyer ", sharePct: 50 },
      { name: "Creator", sharePct: 50 },
    ]);
    expect(out[0]!.name).toBe("Buyer");
    expect(out).toHaveLength(2);
  });

  it("rejects splits that do not sum to 100", () => {
    expect(() => validateFeatureSplits([{ name: "A", sharePct: 60 }])).toThrow(/total 100%/);
  });

  it("rejects empty, zero, and over-precise shares", () => {
    expect(() => validateFeatureSplits([])).toThrow();
    expect(() => validateFeatureSplits([{ name: "A", sharePct: 0 }, { name: "B", sharePct: 100 }])).toThrow();
    expect(() => validateFeatureSplits([{ name: "A", sharePct: 33.333 }, { name: "B", sharePct: 66.667 }])).toThrow();
  });
});

describe("signing gate + delivery door", () => {
  it("no signatures: no fund, no delivery", () => {
    const o = order();
    expect(bothSigned(o)).toBe(false);
    expect(canFund(o)).toBe(false);
    expect(canDeliver(o)).toBe(false);
  });

  it("one signature: still no fund, no delivery; terms already frozen", () => {
    const o = order({ buyerSignedAt: NOW });
    expect(canFund(o)).toBe(false);
    expect(canDeliver(o)).toBe(false);
    expect(termsFrozen(o)).toBe(true);
  });

  it("both signed but unfunded: fund opens, delivery stays shut", () => {
    const o = order({ status: "signed", buyerSignedAt: NOW, creatorSignedAt: NOW });
    expect(canFund(o)).toBe(true);
    expect(canDeliver(o)).toBe(false);
  });

  it("both signed + escrow held: delivery door opens", () => {
    const o = order({ status: "escrow_held", escrowStatus: "held", buyerSignedAt: NOW, creatorSignedAt: NOW });
    expect(canDeliver(o)).toBe(true);
    expect(canFund(o)).toBe(false);
  });

  it("delivered + held: confirm-release and dispute open, delivery closes", () => {
    const o = order({ status: "delivered", escrowStatus: "held", buyerSignedAt: NOW, creatorSignedAt: NOW });
    expect(canConfirmRelease(o)).toBe(true);
    expect(canDispute(o)).toBe(true);
    expect(canDeliver(o)).toBe(false);
  });
});

describe("escrow exactly-once keys + refunds", () => {
  it("keys are deterministic and distinct per kind", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(escrowLedgerKey(id, "hold")).toBe(holdChargeKey(id));
    expect(escrowLedgerKey(id, "hold")).not.toBe(escrowLedgerKey(id, "release"));
    expect(escrowLedgerKey(id, "release")).not.toBe(escrowLedgerKey(id, "refund"));
  });

  it("a refund is owed only while a fee is held — and it is the full fee path", () => {
    expect(refundOwed(order({ escrowStatus: "held" }))).toBe(true);
    expect(refundOwed(order({ escrowStatus: "none" }))).toBe(false);
    expect(refundOwed(order({ escrowStatus: "released" }))).toBe(false);
  });
});

describe("expiry + price + labels", () => {
  it("only a proposed order past its window expires", () => {
    expect(isExpired(order({ signBy: PAST }), NOW)).toBe(true);
    expect(isExpired(order({ signBy: FUTURE }), NOW)).toBe(false);
    expect(isExpired(order({ status: "signed", signBy: PAST }), NOW)).toBe(false);
  });

  it("the signing window is the lane constant", () => {
    const by = signByFrom(NOW);
    expect(by.getTime() - NOW.getTime()).toBe(FEATURE_VERSE_SIGN_WINDOW_DAYS * 24 * 3600 * 1000);
  });

  it("price must be a creator-entered positive whole number", () => {
    expect(validateListingPrice(2500)).toBe(2500);
    expect(() => validateListingPrice(0)).toThrow(/your own feature price/);
    expect(() => validateListingPrice(-5)).toThrow();
    expect(() => validateListingPrice(10.5)).toThrow();
    expect(() => validateListingPrice(undefined)).toThrow();
  });

  it("labels are plain words for every lifecycle state", () => {
    for (const s of ["terms_proposed", "signed", "escrow_held", "delivered", "released", "disputed", "refunded", "declined", "expired_unaccepted"]) {
      expect(featureVerseStatusLabel(s)).not.toBe(s);
    }
    expect(featureVerseEscrowLabel("refunded")).toMatch(/in full/);
  });
});
