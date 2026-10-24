/**
 * Post-purchase upsell — pure-module pins (Stack-100 #3, Wave 3).
 *
 * The properties that keep a one-click charge honest:
 *  - the idempotency key is a pure function of the parent order id
 *    (double-click / duplicate accept / retry-after-timeout all
 *    derive the SAME key; a different order never collides);
 *  - the snapshot freezes the seller-set price (or % off) and the
 *    flat-5% split to the cent — the accept charges the snapshot;
 *  - eligibility never re-offers what the order already bought and
 *    defers to the bump rail's live-offer rules;
 *  - the state machine only moves pending → terminal, once.
 *
 * Hand-computed money (fee = round(gross × 5%)):
 *  2700 → fee 135 / creator 2565 · 1999 → fee 100 / creator 1899
 *  3000 @10% off = 2700 · 1¢ floor: 100 @90% off = 10; 5 @90% = 1 (floor)
 */
import { describe, it, expect } from "vitest";
import {
  upsellIdempotencyKey,
  buildUpsellSnapshot,
  upsellEligibility,
  upsellAcceptBlocker,
  canTransitionUpsell,
  isUpsellTerminal,
} from "../post-purchase-upsell";

const ORDER_A = "11111111-1111-4111-8111-111111111111";
const ORDER_B = "22222222-2222-4222-8222-222222222222";
const MAIN = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", profileId: "profile-1" };
const TARGET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("upsellIdempotencyKey — exactly-once by construction", () => {
  it("is deterministic for the same order (double-click, duplicates, retries)", () => {
    expect(upsellIdempotencyKey(ORDER_A)).toBe(upsellIdempotencyKey(ORDER_A));
    expect(upsellIdempotencyKey(ORDER_A)).toBe(`storefront-upsell:${ORDER_A}`);
  });

  it("never collides across orders", () => {
    expect(upsellIdempotencyKey(ORDER_A)).not.toBe(upsellIdempotencyKey(ORDER_B));
  });

  it("refuses an empty order id rather than minting a shared key", () => {
    expect(() => upsellIdempotencyKey("")).toThrow();
    expect(() => upsellIdempotencyKey("   ")).toThrow();
  });
});

describe("buildUpsellSnapshot — seller price, flat 5%, to the cent", () => {
  it("no % off: the seller-set price stands; fee 135 on 2700", () => {
    const s = buildUpsellSnapshot(
      { bumpProductId: TARGET_ID, percentOff: 0 },
      { id: TARGET_ID, title: "Bonus Pack", kind: "digital", priceCents: 2700 },
    );
    expect(s).toMatchObject({
      upsellProductId: TARGET_ID, listPriceCents: 2700, percentOff: 0,
      grossCents: 2700, feeCents: 135, creatorCents: 2565, feeBps: 500,
    });
    expect(s.grossCents).toBe(s.feeCents + s.creatorCents);
  });

  it("seller-set % off: 3000 at 10% off snapshots 2700", () => {
    const s = buildUpsellSnapshot(
      { bumpProductId: TARGET_ID, percentOff: 10 },
      { id: TARGET_ID, title: "Bonus Pack", kind: "digital", priceCents: 3000 },
    );
    expect(s.grossCents).toBe(2700);
    expect(s.feeCents).toBe(135);
    expect(s.creatorCents).toBe(2565);
  });

  it("odd cents round the fee half-up and still reconcile: 1999 → 100 / 1899", () => {
    const s = buildUpsellSnapshot(
      { bumpProductId: TARGET_ID, percentOff: 0 },
      { id: TARGET_ID, title: "Odd Price", kind: "digital", priceCents: 1999 },
    );
    expect(s.grossCents).toBe(1999);
    expect(s.feeCents).toBe(100);
    expect(s.creatorCents).toBe(1899);
    expect(s.grossCents).toBe(s.feeCents + s.creatorCents);
  });

  it("a deep seller discount floors the price at 1¢, never $0", () => {
    const s = buildUpsellSnapshot(
      { bumpProductId: TARGET_ID, percentOff: 90 },
      { id: TARGET_ID, title: "Tiny", kind: "digital", priceCents: 5 },
    );
    expect(s.grossCents).toBe(1);
    expect(s.feeCents).toBe(0);
    expect(s.creatorCents).toBe(1);
  });
});

describe("upsellEligibility — offered once, never re-sold", () => {
  const cfg = { bumpProductId: TARGET_ID, percentOff: 10 };
  const liveTarget = {
    id: TARGET_ID, profileId: "profile-1", priceCents: 3000, isActive: true, inventory: 5,
  };

  it("a designated, live add-on the order didn't buy is eligible", () => {
    expect(upsellEligibility({ cfg, main: MAIN, boughtBumpProductId: null, target: liveTarget }).ok).toBe(true);
  });

  it("no designation → no offer", () => {
    const v = upsellEligibility({ cfg: null, main: MAIN, boughtBumpProductId: null, target: liveTarget });
    expect(v).toMatchObject({ ok: false, code: "UPSELL_NONE_DESIGNATED" });
  });

  it("the buyer already took it as the checkout bump → never re-offered", () => {
    const v = upsellEligibility({ cfg, main: MAIN, boughtBumpProductId: TARGET_ID, target: liveTarget });
    expect(v).toMatchObject({ ok: false, code: "UPSELL_ALREADY_BOUGHT" });
  });

  it("a vanished target → no offer", () => {
    const v = upsellEligibility({ cfg, main: MAIN, boughtBumpProductId: null, target: null });
    expect(v).toMatchObject({ ok: false, code: "UPSELL_TARGET_GONE" });
  });

  it("the bump rail's rules govern: sold out / inactive / free / other seller all refuse", () => {
    expect(upsellEligibility({ cfg, main: MAIN, boughtBumpProductId: null, target: { ...liveTarget, inventory: 0 } }))
      .toMatchObject({ ok: false, code: "BUMP_SOLD_OUT" });
    expect(upsellEligibility({ cfg, main: MAIN, boughtBumpProductId: null, target: { ...liveTarget, isActive: false } }))
      .toMatchObject({ ok: false, code: "BUMP_INACTIVE" });
    expect(upsellEligibility({ cfg, main: MAIN, boughtBumpProductId: null, target: { ...liveTarget, priceCents: 0 } }))
      .toMatchObject({ ok: false, code: "BUMP_FREE" });
    expect(upsellEligibility({ cfg, main: MAIN, boughtBumpProductId: null, target: { ...liveTarget, profileId: "someone-else" } }))
      .toMatchObject({ ok: false, code: "BUMP_OTHER_SELLER" });
  });
});

describe("upsellAcceptBlocker — live revalidation at accept time", () => {
  it("a live, stocked add-on proceeds", () => {
    expect(upsellAcceptBlocker({ isActive: true, inventory: -1 })).toBeNull();
    expect(upsellAcceptBlocker({ isActive: true, inventory: 3 })).toBeNull();
  });
  it("gone / inactive / sold out each block with an honest no-charge reason", () => {
    expect(upsellAcceptBlocker(null)?.code).toBe("UPSELL_TARGET_GONE");
    expect(upsellAcceptBlocker({ isActive: false, inventory: 3 })?.code).toBe("UPSELL_INACTIVE");
    expect(upsellAcceptBlocker({ isActive: true, inventory: 0 })?.code).toBe("UPSELL_SOLD_OUT");
  });
});

describe("offer state machine — decided once, terminal forever", () => {
  it("pending may move to any terminal state", () => {
    expect(canTransitionUpsell("pending", "accepted")).toBe(true);
    expect(canTransitionUpsell("pending", "declined")).toBe(true);
    expect(canTransitionUpsell("pending", "failed")).toBe(true);
  });
  it("no terminal state ever moves again", () => {
    for (const from of ["accepted", "declined", "failed"]) {
      for (const to of ["accepted", "declined", "failed"] as const) {
        expect(canTransitionUpsell(from, to)).toBe(false);
      }
    }
    expect(isUpsellTerminal("accepted")).toBe(true);
    expect(isUpsellTerminal("pending")).toBe(false);
    expect(isUpsellTerminal(null)).toBe(false);
  });
});
