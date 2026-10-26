/**
 * Make-an-offer client law (Wave 4 #43) — the pure half the panels
 * validate against before calling the server (the server re-validates
 * everything in artifacts/api-server/src/lib/product-offers.ts; these
 * pins keep the mirror from drifting):
 *  - offers are 1..list-1 cents; counters narrow between the
 *    countering side's own last price and the other side's standing
 *    price;
 *  - the role/status action table matches the server exactly;
 *  - the price on the table resolves per status;
 *  - dollar parsing is strict (no floats, no junk).
 */
import { describe, it, expect } from "vitest";
import {
  validateOfferAmount,
  validateCounterAmount,
  offerActionAllowed,
  currentOfferPriceCents,
  offerStatusLabel,
  isOpenOffer,
  parseOfferDollars,
  offerMoney,
  type ProductOffer,
} from "./product-offers";

const LIST = 5000;

describe("price law", () => {
  it("accepts a below-list offer and refuses zero, list, above-list and non-whole amounts", () => {
    expect(validateOfferAmount(3000, LIST)).toEqual({ ok: true, amountCents: 3000 });
    expect(validateOfferAmount(1, LIST).ok).toBe(true);
    expect(validateOfferAmount(0, LIST).ok).toBe(false);
    expect(validateOfferAmount(-5, LIST).ok).toBe(false);
    expect(validateOfferAmount(5000, LIST).ok).toBe(false);
    expect(validateOfferAmount(6000, LIST).ok).toBe(false);
    expect(validateOfferAmount(30.5, LIST).ok).toBe(false);
    expect(validateOfferAmount(null, LIST).ok).toBe(false);
  });

  it("counters narrow: above own last price, below the standing price", () => {
    /* Seller countering a 3000 offer on a 5000 list. */
    expect(validateCounterAmount(4000, 3000, 5000)).toEqual({ ok: true, amountCents: 4000 });
    expect(validateCounterAmount(3000, 3000, 5000).ok).toBe(false);
    expect(validateCounterAmount(5000, 3000, 5000).ok).toBe(false);
    /* Buyer countering a 4000 counter, standing offer 3000. */
    expect(validateCounterAmount(3500, 3000, 4000)).toEqual({ ok: true, amountCents: 3500 });
    expect(validateCounterAmount(4000, 3000, 4000).ok).toBe(false);
    expect(validateCounterAmount(3000, 3000, 4000).ok).toBe(false);
  });

  it("parses typed dollars strictly", () => {
    expect(parseOfferDollars("42")).toBe(4200);
    expect(parseOfferDollars("$42.50")).toBe(4250);
    expect(parseOfferDollars(" 1,250.75 ")).toBe(125075);
    expect(parseOfferDollars("42.505")).toBeNull();
    expect(parseOfferDollars("abc")).toBeNull();
    expect(parseOfferDollars("")).toBeNull();
    expect(offerMoney(4250)).toBe("$42.50");
  });
});

describe("the action table (mirrors the server)", () => {
  it("pending: the seller answers, the buyer can only withdraw", () => {
    for (const a of ["accept", "decline", "counter"] as const) {
      expect(offerActionAllowed("pending", "seller", a)).toBe(true);
      expect(offerActionAllowed("pending", "buyer", a)).toBe(false);
    }
    expect(offerActionAllowed("pending", "buyer", "withdraw")).toBe(true);
    expect(offerActionAllowed("pending", "seller", "withdraw")).toBe(false);
  });

  it("countered: the buyer answers, the seller waits", () => {
    for (const a of ["accept", "decline", "counter", "withdraw"] as const) {
      expect(offerActionAllowed("countered", "buyer", a)).toBe(true);
      expect(offerActionAllowed("countered", "seller", a)).toBe(false);
    }
  });

  it("accepted: only the buyer may withdraw; settled statuses allow nothing", () => {
    expect(offerActionAllowed("accepted", "buyer", "withdraw")).toBe(true);
    expect(offerActionAllowed("accepted", "seller", "withdraw")).toBe(false);
    for (const s of ["declined", "withdrawn", "expired", "consumed"] as const) {
      for (const actor of ["buyer", "seller"] as const) {
        for (const a of ["accept", "decline", "counter", "withdraw"] as const) {
          expect(offerActionAllowed(s, actor, a)).toBe(false);
        }
      }
    }
  });
});

describe("the price on the table", () => {
  const base = {
    offer_amount_cents: 3000, counter_amount_cents: null, agreed_amount_cents: null,
  } as unknown as ProductOffer;

  it("resolves per status", () => {
    expect(currentOfferPriceCents({ ...base, status: "pending" })).toBe(3000);
    expect(currentOfferPriceCents({ ...base, status: "countered", counter_amount_cents: 4000 })).toBe(4000);
    expect(currentOfferPriceCents({ ...base, status: "accepted", agreed_amount_cents: 4000, counter_amount_cents: 4000 })).toBe(4000);
    expect(currentOfferPriceCents({ ...base, status: "consumed", agreed_amount_cents: 3000 })).toBe(3000);
  });

  it("labels read from the viewer's side and open means negotiable or buyable", () => {
    expect(offerStatusLabel("pending", "buyer")).toContain("seller");
    expect(offerStatusLabel("pending", "seller")).toContain("you");
    expect(offerStatusLabel("accepted", "buyer")).toContain("check out");
    expect(isOpenOffer({ status: "accepted" })).toBe(true);
    expect(isOpenOffer({ status: "declined" })).toBe(false);
  });
});
