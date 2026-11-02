/**
 * gift-cards-components — stack1200 parity-leftovers source-contract
 * pins. The World's gift-card surfaces must ride the SITE's real
 * gift-card rails (the product page + shop page are the reference
 * implementations), never a parallel invention:
 * - the Creator Room store sells the creator's gift-card product on
 *   POST /api/gift-cards/checkout (embedded-first, hosted tab only
 *   as the fallback), confirms issuance on POST /api/gift-cards/
 *   verify, and carries the gift tender on BOTH of its checkouts
 *   (product buys + the Marketplace cart) — recognizing a
 *   gift-paid answer as a completed purchase;
 * - the Marketplace stand carries the same tender beside its
 *   receipt email and recognizes the same gift-paid answer;
 * - the GiftCardsDesk at the square reads the balance rail (the
 *   code is the capability) and the mine rail — the two reads no
 *   surface consumed before.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const rooms = read("../../components/world/native/CreatorRooms.tsx");
const stands = read("../../components/world/native/ShopStands.tsx");
const desk = read("../../components/world/native/GiftCardsDesk.tsx");

describe("the room store's gift rail", () => {
  it("sells on the gift-card checkout and confirms issuance on verify", () => {
    expect(rooms).toContain('fetch("/api/gift-cards/checkout"');
    expect(rooms).toContain('fetch("/api/gift-cards/verify"');
    expect(rooms).toContain("giftCardCheckoutPayload(");
    expect(rooms).toContain("giftCardVerifyState(");
    /* The payment mounts in the room first; the hosted tab is the fallback. */
    expect(rooms).toContain("clientSecret={giftEmbedded.clientSecret}");
    expect(rooms).toContain('data-testid="world-room-store-gift"');
    expect(rooms).toContain('data-testid="world-room-store-gift-form"');
    expect(rooms).toContain('data-testid="world-room-store-gift-issued"');
  });

  it("the tender rides both room checkouts and a gift-paid answer completes them", () => {
    expect(rooms).toContain("giftCardCode: giftCode.trim() || undefined");
    expect(rooms).toContain("storefrontCheckoutPayload(item, qtyInputs[item.id] ?? 1, giftCode)");
    expect(rooms).toContain("checkoutCompletedInWorld(data) || paidWithGiftCard(data)");
    expect(rooms).toContain("if (paidWithGiftCard(data))");
    expect(rooms).toContain('data-testid="world-room-store-gift-code-input"');
  });
});

describe("the Marketplace stand's tender", () => {
  it("the code box rides beside the receipt email and the answer completes the order", () => {
    expect(stands).toContain('data-testid="world-shop-gift-card-input"');
    expect(stands).toContain("giftCardCode: giftCardInput.trim() || undefined");
    expect(stands).toContain("checkoutCompletedInWorld(data) || paidWithGiftCard(data)");
  });
});

describe("the square's gift-card desk", () => {
  it("reads the balance rail and the mine rail — nothing invented, no full code shown", () => {
    expect(stands).toContain("<GiftCardsDesk");
    expect(desk).toContain("/api/gift-cards/balance?code=");
    expect(desk).toContain('fetch("/api/gift-cards/mine"');
    expect(desk).toContain("parseGiftCardBalance");
    expect(desk).toContain("parseGiftCardsMine");
    expect(desk).toContain('data-testid="world-gift-cards-desk"');
    expect(desk).toContain('data-testid="world-gift-card-balance"');
  });
});
