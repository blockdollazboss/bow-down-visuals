/**
 * gift-cards — the World's gift-card rails (stack1200 parity
 * leftovers). Pins the parity contract with the website:
 * (a) the buy body is the product page's exact POST
 *     /api/gift-cards/checkout shape — an amount from the SELLER's
 *     denominations (the rail refuses any other), delivery to the
 *     recipient, optional fields only when written, and the
 *     embedded ask only when the device can mount the form;
 * (b) the form's problems speak the product page's own words where
 *     the page has them (the recipient line verbatim);
 * (c) issuance is read from the verify rail alone — the code
 *     exists in the answer exactly once, a duplicate verify parses
 *     code-less, and the three verify states match the rail's
 *     answers (the Crowns stand's discipline);
 * (d) balance + mine parse tolerantly but never invent — garbage
 *     parses to null (the desk's failed state), never to an
 *     invented empty wallet or a zero balance;
 * (e) a gift-paid checkout answer is recognized on all tender
 *     rails: { paid: true, paidWithGiftCard: true } with NO payment
 *     page is a completed purchase, not a missing URL.
 */
import { describe, it, expect } from "vitest";
import {
  emptyGiftCardForm,
  giftCardCheckoutPayload,
  giftCardFormAmount,
  giftCardFormProblem,
  giftCardPendingKey,
  giftCardVerifyState,
  isGiftCardItem,
  paidWithGiftCard,
  parseGiftCardBalance,
  parseGiftCardPending,
  parseGiftCardVerify,
  parseGiftCardsMine,
  type GiftCardFormState,
} from "./gift-cards";
import type { RoomStoreItem } from "./money-desks";

const DENOMS = [1000, 2500, 5000];

function item(over: Partial<RoomStoreItem> = {}): RoomStoreItem {
  return {
    id: "p1",
    kind: "product",
    productKind: "gift_card",
    title: "Gift Card",
    artworkUrl: null,
    priceCents: 1000,
    price: "$10.00",
    buyUrl: "/storefront/product/p1",
    pwyw: null,
    giftCardDenominationsCents: DENOMS,
    ...over,
  };
}

function form(over: Partial<GiftCardFormState> = {}): GiftCardFormState {
  return { ...emptyGiftCardForm(), recipientEmail: "fan@example.com", ...over };
}

describe("the gift rail classification", () => {
  it("only a store product whose own kind is gift_card is a gift card", () => {
    expect(isGiftCardItem(item())).toBe(true);
    expect(isGiftCardItem(item({ productKind: "digital" }))).toBe(false);
    expect(isGiftCardItem(item({ kind: "track", productKind: null }))).toBe(false);
  });
});

describe("the buy form", () => {
  it("the amount defaults to the seller's first offered amount, like the product page", () => {
    expect(giftCardFormAmount(form(), DENOMS)).toBe(1000);
    expect(giftCardFormAmount(form({ amountCents: 2500 }), DENOMS)).toBe(2500);
    expect(giftCardFormAmount(form(), null)).toBeNull();
    expect(giftCardFormAmount(form(), [])).toBeNull();
  });

  it("the problems are the page's own words", () => {
    expect(giftCardFormProblem(form(), DENOMS)).toBeNull();
    expect(giftCardFormProblem(form({ recipientEmail: "  " }), DENOMS)).toBe(
      "Add the recipient's email — the gift card is delivered there, not to you.",
    );
    expect(giftCardFormProblem(form({ amountCents: 777 }), DENOMS)).toBe("Pick one of the offered amounts.");
    expect(giftCardFormProblem(form(), null)).toContain("no amounts to pick from");
  });

  it("the checkout body is the product page's exact shape", () => {
    expect(giftCardCheckoutPayload("p1", form(), DENOMS, false)).toEqual({
      productId: "p1",
      amountCents: 1000,
      recipientEmail: "fan@example.com",
    });
    expect(
      giftCardCheckoutPayload("p1", form({ amountCents: 5000, recipientName: " Jo ", message: " enjoy " }), DENOMS, true),
    ).toEqual({
      productId: "p1",
      amountCents: 5000,
      recipientEmail: "fan@example.com",
      recipientName: "Jo",
      message: "enjoy",
      uiMode: "embedded",
    });
    /* Blank optionals never ride; no recipient or no amounts = no body at all. */
    expect(giftCardCheckoutPayload("p1", form({ recipientName: " ", message: "" }), DENOMS, false)).toEqual({
      productId: "p1",
      amountCents: 1000,
      recipientEmail: "fan@example.com",
    });
    expect(giftCardCheckoutPayload("p1", form({ recipientEmail: "" }), DENOMS, false)).toBeNull();
    expect(giftCardCheckoutPayload("p1", form(), null, false)).toBeNull();
  });
});

describe("issuance — the verify rail is the only truth", () => {
  const issued = {
    success: true,
    duplicate: false,
    card: {
      id: "c1",
      codeLast4: "WXYZ",
      status: "active",
      initialCents: 2500,
      balanceCents: 2500,
      reservedCents: 0,
      recipientEmail: "fan@example.com",
      storeName: "Thy Store",
      createdAt: "2026-11-01T00:00:00.000Z",
    },
    code: "BDV-AAAA-BBBB-WXYZ",
    codeNote: "Save this code — it is shown here once.",
  };

  it("a fresh issuance carries the code, exactly once shape", () => {
    const parsed = parseGiftCardVerify(issued);
    expect(parsed?.duplicate).toBe(false);
    expect(parsed?.code).toBe("BDV-AAAA-BBBB-WXYZ");
    expect(parsed?.card?.availableCents).toBe(2500);
    expect(parsed?.card?.storeName).toBe("Thy Store");
  });

  it("a duplicate verify parses code-less — the code is never re-shown", () => {
    const parsed = parseGiftCardVerify({ ...issued, duplicate: true, code: null });
    expect(parsed?.duplicate).toBe(true);
    expect(parsed?.code).toBeNull();
  });

  it("a non-success answer is not an issuance", () => {
    expect(parseGiftCardVerify({ success: false })).toBeNull();
    expect(parseGiftCardVerify(null)).toBeNull();
    expect(parseGiftCardVerify("paid")).toBeNull();
  });

  it("the three verify states match the rail's answers", () => {
    expect(giftCardVerifyState(200, issued)).toBe("issued");
    expect(giftCardVerifyState(400, { error: "Payment has not been completed." })).toBe("pending");
    expect(giftCardVerifyState(400, { error: "This gift-card purchase belongs to a different account." })).toBe("dead");
    expect(giftCardVerifyState(403, { error: "nope" })).toBe("dead");
    expect(giftCardVerifyState(200, { success: false })).toBe("dead");
  });
});

describe("balance + mine — tolerant, never inventing", () => {
  it("the balance answer parses with its store", () => {
    const parsed = parseGiftCardBalance({
      card: { codeLast4: "WXYZ", status: "active", balanceCents: 1200, balance: "$12.00", availableCents: 1200, initialCents: 2500 },
      store: { name: "Thy Store", url: "/artist/thy" },
      note: "…",
    });
    expect(parsed).toEqual({
      codeLast4: "WXYZ",
      status: "active",
      balanceCents: 1200,
      balance: "$12.00",
      availableCents: 1200,
      initialCents: 2500,
      storeName: "Thy Store",
      storeUrl: "/artist/thy",
    });
    expect(parseGiftCardBalance({})).toBeNull();
    expect(parseGiftCardBalance(null)).toBeNull();
  });

  it("mine keeps honest rows, drops malformed ones, and refuses whole-answer garbage", () => {
    const parsed = parseGiftCardsMine({
      bought: [{ id: "c1", codeLast4: "AAAA", status: "active", initialCents: 1000, balanceCents: 400, recipientEmail: "a@b.c" }, { nope: true }, null],
      received: [],
    });
    expect(parsed?.bought).toHaveLength(1);
    expect(parsed?.bought[0]?.availableCents).toBe(400);
    expect(parsed?.received).toEqual([]);
    expect(parseGiftCardsMine({ hello: "world" })).toBeNull();
    expect(parseGiftCardsMine(null)).toBeNull();
  });
});

describe("gift-paid checkout answers", () => {
  it("paid + paidWithGiftCard is a completed purchase on every tender rail", () => {
    expect(paidWithGiftCard({ paid: true, paidWithGiftCard: true, url: null, sessionId: null })).toBe(true);
    expect(paidWithGiftCard({ status: "paid", paid: true, paidWithGiftCard: true })).toBe(true);
    /* A normal session answer is NOT gift-paid, and neither is a bare flag. */
    expect(paidWithGiftCard({ status: "pending", paid: false, url: "https://checkout.example" })).toBe(false);
    expect(paidWithGiftCard({ paidWithGiftCard: true })).toBe(false);
    expect(paidWithGiftCard(null)).toBe(false);
  });
});

describe("the pending receipt", () => {
  it("the stash key is per-room and the stash round-trips", () => {
    expect(giftCardPendingKey("thy-store")).toBe("bdv-gift-card-pending-thy-store");
    const raw = JSON.stringify({ sessionId: "cs_1", productId: "p1", title: "Gift Card" });
    expect(parseGiftCardPending(raw)).toEqual({ sessionId: "cs_1", productId: "p1", title: "Gift Card" });
    expect(parseGiftCardPending(null)).toBeNull();
    expect(parseGiftCardPending("not json")).toBeNull();
    expect(parseGiftCardPending(JSON.stringify({ productId: "p1" }))).toBeNull();
  });
});
