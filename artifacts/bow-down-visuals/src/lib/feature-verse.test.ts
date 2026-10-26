/**
 * Feature Verse Market (Stack-200 N7) — client contract tests.
 * Pins the delivery gate in the viewer actions, the lifecycle
 * labels, the paths, and that split feedback rides the shared
 * publishing-splits mirror.
 */
import { describe, it, expect } from "vitest";
import {
  featureSplitValidationError,
  featureVerseActionPath,
  featureVerseListingByCreatorPath,
  featureVerseStatusLabel,
  featureVerseViewerActions,
  type FeatureVerseOrder,
} from "./feature-verse";

function order(over: Partial<FeatureVerseOrder> = {}): FeatureVerseOrder {
  return {
    id: "o1",
    listingId: "l1",
    buyerUserId: "buyer",
    creatorUserId: "creator",
    isBuyer: true,
    isCreator: false,
    priceVb: 2500,
    trackContext: "t",
    usageTerms: "u",
    deadlineAsk: null,
    splits: [{ name: "Buyer", sharePct: 50 }, { name: "Creator", sharePct: 50 }],
    status: "terms_proposed",
    statusLabel: "",
    escrowStatus: "none",
    escrowLabel: "",
    buyerSignedAt: null,
    creatorSignedAt: null,
    bothSigned: false,
    termsFrozen: false,
    canDeliver: false,
    signBy: null,
    deliveryNote: null,
    deliveryUrl: null,
    disputeReason: null,
    termsNotice: "",
    ...over,
  };
}

describe("paths", () => {
  it("builds listing/order/action paths", () => {
    expect(featureVerseListingByCreatorPath("u 1")).toBe("/api/feature-verse/listings/by-creator/u%201");
    expect(featureVerseActionPath("o1", "sign")).toBe("/api/feature-verse/orders/o1/sign");
    expect(featureVerseActionPath("o1", "deliver")).toBe("/api/feature-verse/orders/o1/deliver");
  });
});

describe("viewer actions — the signing/escrow gate", () => {
  it("unsigned: parties can sign, creator can decline, NOBODY can deliver or fund", () => {
    const buyerView = featureVerseViewerActions(order());
    expect(buyerView).toContain("sign");
    expect(buyerView).not.toContain("deliver");
    expect(buyerView).not.toContain("fund");
    const creatorView = featureVerseViewerActions(order({ isBuyer: false, isCreator: true }));
    expect(creatorView).toContain("sign");
    expect(creatorView).toContain("decline");
    expect(creatorView).not.toContain("deliver");
  });

  it("one signature: the unsigned party can still sign; delivery stays hidden", () => {
    const creatorView = featureVerseViewerActions(order({ isBuyer: false, isCreator: true, buyerSignedAt: "2026-10-26T00:00:00Z" }));
    expect(creatorView).toContain("sign");
    expect(creatorView).not.toContain("deliver");
  });

  it("signed: buyer can fund; creator still cannot deliver until escrow is held", () => {
    const signed = order({
      status: "signed",
      buyerSignedAt: "2026-10-26T00:00:00Z",
      creatorSignedAt: "2026-10-26T00:00:00Z",
      bothSigned: true,
    });
    expect(featureVerseViewerActions(signed)).toContain("fund");
    expect(featureVerseViewerActions({ ...signed, isBuyer: false, isCreator: true })).not.toContain("deliver");
  });

  it("escrow held + both signed: the creator's delivery door opens", () => {
    const held = order({
      status: "escrow_held",
      escrowStatus: "held",
      buyerSignedAt: "2026-10-26T00:00:00Z",
      creatorSignedAt: "2026-10-26T00:00:00Z",
      bothSigned: true,
      canDeliver: true,
      isBuyer: false,
      isCreator: true,
    });
    expect(featureVerseViewerActions(held)).toContain("deliver");
    /* refund of a held fee is available to the parties */
    expect(featureVerseViewerActions(held)).toContain("refund");
  });

  it("delivered: buyer confirms/disputes/refunds; released/refunded/declined are terminal", () => {
    const delivered = order({ status: "delivered", escrowStatus: "held" });
    expect(featureVerseViewerActions(delivered)).toEqual(expect.arrayContaining(["confirm", "dispute", "refund"]));
    for (const s of ["released", "refunded", "declined", "expired_unaccepted"]) {
      expect(featureVerseViewerActions(order({ status: s }))).toHaveLength(0);
    }
  });
});

describe("labels + split feedback", () => {
  it("every lifecycle state has a plain-words label", () => {
    for (const s of ["terms_proposed", "signed", "escrow_held", "delivered", "released", "disputed", "refunded", "declined", "expired_unaccepted"]) {
      expect(featureVerseStatusLabel(s)).not.toBe(s);
    }
    expect(featureVerseStatusLabel("refunded")).toMatch(/in full/);
    expect(featureVerseStatusLabel("declined")).toMatch(/no fee was taken/);
  });

  it("split feedback is the publishing-splits mirror", () => {
    expect(featureSplitValidationError([{ name: "A", sharePct: 50 }, { name: "B", sharePct: 50 }])).toBeNull();
    expect(featureSplitValidationError([{ name: "A", sharePct: 60 }])).toMatch(/total 100%/);
    expect(featureSplitValidationError([])).toMatch(/songwriter/);
  });
});
