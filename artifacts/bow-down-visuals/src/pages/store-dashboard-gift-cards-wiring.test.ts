/**
 * store-dashboard-gift-cards-wiring.test.ts — stack1200 giftcard-complete
 * lane: source contracts for the two gift-card surfaces the World
 * parity lane left noted-but-unbuilt on the World side.
 *
 * Census verdict this test exists to protect: both surfaces were
 * ALREADY BUILT on the website side and simply unpinned —
 *  - the seller's liability view is the Store Dashboard "Gift Cards"
 *    tab reading GET /api/gift-cards/sold (issued vs outstanding);
 *  - the buyer's refund rail is the same tab's "Cards you bought"
 *    table posting POST /api/gift-cards/:id/refund (unspent-only
 *    clawback, exactly-once on the API side — behavior-pinned by
 *    artifacts/api-server gift-cards.test.ts).
 * Nothing here re-implements them; these pins exist so a future edit
 * cannot silently unwire either surface (the failure mode this family
 * has already suffered elsewhere).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const dashboard = read("pages/store-dashboard.tsx");
const storefrontApi = read("lib/storefront-api.ts");

/* The GiftCardsTab function body only — assertions below must not be
   satisfied by lookalike strings elsewhere in the 3,900-line page. */
const tabStart = dashboard.indexOf("function GiftCardsTab()");
const tabEnd = dashboard.indexOf("/* ── Discounts tab", tabStart);
const tab = dashboard.slice(tabStart, tabEnd);

describe("gift cards — API client endpoints (lib/storefront-api.ts)", () => {
  it("points every gift call at the one gift-cards base", () => {
    expect(storefrontApi).toContain('const GIFT_BASE = "/api/gift-cards"');
  });

  it("sold view reads the seller liability endpoint", () => {
    expect(storefrontApi).toContain("export const soldGiftCards");
    expect(storefrontApi).toContain('>("/sold", token)');
  });

  it("mine reads the buyer + recipient endpoint", () => {
    expect(storefrontApi).toContain("export const myGiftCards");
    expect(storefrontApi).toContain('>("/mine", token)');
  });

  it("refund posts to the per-card refund endpoint", () => {
    expect(storefrontApi).toContain("export const refundGiftCard");
    expect(storefrontApi).toContain("`/${id}/refund`, token, { method: \"POST\"");
  });

  it("balance lookup carries the code as the capability", () => {
    expect(storefrontApi).toContain("export const giftCardBalance");
    expect(storefrontApi).toContain("`/balance?code=${encodeURIComponent(code)}`");
  });
});

describe("gift cards — the dashboard tab docks in the seller's store desk", () => {
  it("is a real tab: type, nav entry, deep-link parse, and mount", () => {
    expect(dashboard).toContain('"giftcards"');
    expect(dashboard).toContain('{ id: "giftcards", label: "Gift Cards", icon: Gift }');
    expect(dashboard).toContain('t === "giftcards" ? t : "overview"');
    expect(dashboard).toContain('{tab === "giftcards" && <GiftCardsTab />}');
  });

  it("the tab function exists and is the slice under test", () => {
    expect(tabStart).toBeGreaterThan(-1);
    expect(tabEnd).toBeGreaterThan(tabStart);
    expect(tab.length).toBeGreaterThan(1000);
  });
});

describe("gift cards — seller liability view", () => {
  it("loads the sold view alongside the buyer's own cards", () => {
    expect(tab).toContain("soldGiftCards(token)");
    expect(tab).toContain("myGiftCards(token)");
  });

  it("renders issued vs outstanding liability from the API answer", () => {
    expect(tab).toContain("sold.liability.issued");
    expect(tab).toContain("sold.liability.outstanding");
    expect(tab).toContain("sold.liability.cardCount");
    expect(tab).toContain("Still out there (liability)");
    expect(tab).toContain("sold.liability.note");
  });

  it("lists the cards sold against the store with balance + status", () => {
    expect(tab).toContain("Sold against your store");
    expect(tab).toContain("sold.cards.map((c) => cardRow(c, false))");
  });
});

describe("gift cards — buyer refund rail", () => {
  it("lists the cards the buyer bought, with the refund action enabled", () => {
    expect(tab).toContain("Cards you bought");
    expect(tab).toContain("mine.bought.map((c) => cardRow(c, true))");
  });

  it("the refund button fires only on a live card with unspent balance", () => {
    expect(tab).toContain('c.status === "active" && c.balanceCents > 0');
    expect(tab).toContain('"Refund unspent"');
  });

  it("the action posts through the refund client and reports the server's own note", () => {
    expect(tab).toContain("await refundGiftCard(token, card.id)");
    expect(tab).toContain("r.note || `${r.refunded} refunded to your original payment method.`");
  });
});

describe("gift cards — honest states (failure is not empty)", () => {
  it("a failed load gets its own error state with a working retry", () => {
    expect(tab).toContain("Couldn't load gift cards.");
    expect(tab).toContain("Your cards are safe — this tab just couldn't load them.");
    expect(tab).toContain("onClick={load}");
  });

  it("the empty state renders only for a loaded, genuinely empty desk", () => {
    expect(tab).toContain("No gift cards yet. List one from the Products tab");
  });

  it("received cards are acknowledged without exposing a code", () => {
    expect(tab).toContain("mine.received.length");
    expect(tab).toContain("the codes live in those emails");
  });
});
