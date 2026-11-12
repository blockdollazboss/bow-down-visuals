/**
 * Creator Rooms i18n pins (stack100 locale unit 48, manifest item 48).
 *
 * The World's Creator Rooms desk family — CreatorRooms (the
 * Courtyard directory, the room invites, the host's dressing
 * picker, the office-hours card, the Front Row / Music / Screen
 * stations and the room store with its cart + gift cards),
 * CreatorProfileCreate, CrownsChamber and IdentitySetsDesk —
 * rendered hard-coded English inside a 10-locale product. Their
 * own copy now lives in the locale catalogs under
 * worldCreatorRooms.*, extracted key-for-key (the en values are
 * the desks' original wording, verbatim). These pins hold:
 *
 *  - extraction: every family component renders through
 *    useTranslation, and every catalog key in the namespace is
 *    actually referenced by the components or their seams (no
 *    orphan keys, no unextracted remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set,
 *    values non-empty, with identical interpolation-token sets
 *    per key;
 *  - the MONEY LAW: every line that states a specific price, fee,
 *    charge, payout or no-charge fact (enumerated in MONEY_KEYS
 *    below — the room store's 95/5 fee line, the gift-card
 *    no-fee/honesty lines, the checkout no-charge lines, the paid
 *    confirmation line, the pending-order honesty lines, the
 *    crowns no-money line, the free-profile lines, the identity
 *    set's free line) carries the English source VERBATIM in
 *    every catalog. Money copy is never agent-drafted; figures
 *    reach the line by interpolation;
 *  - formatting: numbers/dates in the family format with
 *    i18n.language — no hard-coded "en-US", no bare toLocale*()
 *    calls in the family components.
 *
 * Deliberately NOT extracted (documented in the unit report):
 * the dressing catalog's rung names, style labels and variant
 * names (ladder DATA pinned against the server's list on both
 * sides — they ride the lock-reason template as tokens); the
 * office-hours default session title "Office hours" (stored
 * DATA — the booked event's title on the palace calendar); the
 * crowns seam's `The Crowns of ${year}` fallback name, the shared
 * CHECKOUT_TRANSFER_LABEL and the gift-cards seam's
 * giftCardFormProblem strings (all three extracted by Stack 200
 * Lane E1 item E-3: worldCreatorRooms.crownsYearFallback threaded
 * through the crowns parser, worldCommerceStands.checkoutTransfer
 * via the shop-stands seam, worldCreatorRooms.giftProblem* via
 * the gift-cards strings table); the profile slug placeholder
 * "your-handle" (a pure handle SHAPE, not copy); rail/enum
 * tokens, server-formatted prices and rail-provided words
 * (coverage summaries, pick reasons, storeName, code notes) —
 * data, not copy; NativeStates primitives (unit 51).
 *
 * GAME-LAYER SCOPE: the Creator Rooms game-layer scope question
 * is blocked on an owner ruling and is NOT this unit's. Copy
 * describing the Ring 4 game layer (the dressing picker, the
 * room evolution lines) was extracted VERBATIM and flagged in
 * the unit report; no behavior was built, extended or
 * re-scoped. The store panel's "Buy on the website" anchor (an
 * existing pull-up door for a kind no rail sells) was likewise
 * extracted verbatim and flagged, not changed.
 *
 * TRANSLATION STATUS: en is final. The other nine catalogs'
 * values are AGENT-DRAFTED and UNREVIEWED (standing stack600
 * practice); the MONEY_KEYS values are exempt from drafting by
 * the money law — they are the English source in every catalog.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const NS = "worldCreatorRooms";

const COMPONENTS: Record<string, string> = {
  CreatorRooms: read("../../components/world/native/CreatorRooms.tsx"),
  CreatorProfileCreate: read("../../components/world/native/CreatorProfileCreate.tsx"),
  CrownsChamber: read("../../components/world/native/CrownsChamber.tsx"),
  IdentitySetsDesk: read("../../components/world/native/IdentitySetsDesk.tsx"),
};
const SEAMS: Record<string, string> = {
  creatorRooms: read("./creator-rooms.ts"),
  creatorRoomTier: read("./creator-room-tier.ts"),
  creatorRoomDressing: read("./creator-room-dressing.ts"),
  officeHours: read("./office-hours.ts"),
  creatorProfileCreate: read("./creator-profile-create.ts"),
  identitySetsDesk: read("./identity-sets-desk.ts"),
};
const ALL_SOURCES = { ...COMPONENTS, ...SEAMS };
const JOINED = Object.values(ALL_SOURCES).join("\n");

const en = readJson("../../locales/en.json");
const enNs = (en[NS] ?? {}) as Record<string, string>;
const enKeys = Object.keys(enNs).sort();
const CATALOGS: Record<string, Record<string, string>> = {};
for (const loc of LOCALES) {
  CATALOGS[loc] = (readJson(`../../locales/${loc}.json`)[NS] ?? {}) as Record<string, string>;
}

const MONEY_KEYS = [
  "buyCheckoutFailed",
  "cartCheckoutFailedCart",
  "cartCheckoutNoStart",
  "crownsNoMoney",
  "embeddedCloseNote",
  "giftCheckoutNoPage",
  "giftCheckoutNoStart",
  "giftIntro",
  "giftIssuedDuplicate",
  "giftIssuedFor",
  "giftPayNote",
  "giftTenderLine",
  "giftVerifyClosed",
  "giftVerifyPending",
  "identityFreeLine",
  "orderExpired",
  "orderPendingHonest",
  "orderPendingRefresh",
  "profileCreateSubmit",
  "profileIntro",
  "profileIntroCompact",
  "storeFeeLine",
  "storePaidFullGift",
  "storePaidLine",
  "storefrontPaidFullGift",
];

const tokensOf = (value: string): string[] =>
  [...value.matchAll(/\{\{\s*[^{}]+?\s*\}\}/g)].map((m) => m[0].replace(/\s+/g, "")).sort();

describe("Creator Rooms extraction (unit 48)", () => {
  it("every family component renders through useTranslation", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).toContain('import { useTranslation } from "react-i18next"');
      expect(src, name).toContain("useTranslation()");
    }
  });

  it("the namespace holds the family's full extracted key set", () => {
    // 325 at unit 48; +5 for Stack 200 E-3 (crownsYearFallback +
    // the four giftProblem* sentences, extracted); +2 for B-25
    // (dirConnectionsOne + dirConnectionsMany — the Creator Rooms
    // directory pill's guest-connections labels, join21).
    expect(enKeys.length).toBe(332);
  });

  it("every catalog key is referenced by a component or seam (no orphans, no remainder)", () => {
    const referenced = new Set<string>();
    for (const m of JOINED.matchAll(/worldCreatorRooms\.([A-Za-z0-9_]+)/g)) {
      referenced.add(m[1]!);
    }
    expect([...referenced].sort()).toEqual(enKeys);
  });

  it("numbers and dates format in the walker's language — never hard-coded en-US, never bare", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).not.toContain('toLocaleDateString("en-US"');
      expect(src, name).not.toContain('toLocaleString("en-US"');
      expect(src, name).not.toContain('toLocaleTimeString("en-US"');
      expect(src, name).not.toContain(".toLocaleDateString()");
      expect(src, name).not.toContain(".toLocaleTimeString()");
      expect(src, name).not.toContain(".toLocaleString()");
    }
    expect(COMPONENTS.CreatorRooms).toContain("i18n.language");
    expect(COMPONENTS.CrownsChamber).toContain("toLocaleString(i18n.language)");
    /* CreatorProfileCreate and IdentitySetsDesk format no numbers
       locale-side: their figures ride seam values and raw counts. */
  });

  it("en copy is the desks' original wording, verbatim (representative pins)", () => {
    expect(enNs.storeFeeLine).toBe(
      "Sellers keep 95% — the 5% platform fee comes out of the seller's cut, never on top of your price.",
    );
    expect(enNs.crownsNoMoney).toBe(
      "Crowns are honor, not money: decided by published works, exports, followers, streams, tips, sales and memberships across the year. No Visual Bucs change hands in this chamber.",
    );
    expect(enNs.identityRemoveCopy).toBe(
      "Removing takes the photo out of the set. The file itself is kept in storage — nothing is destroyed.",
    );
    expect(enNs.storeFooter).toBe(
      "Buying finishes right here in the room — the payment form opens in this panel, and the cart here is the same cart as this creator's Marketplace stand.",
    );
    expect(enNs.profileCreateSubmit).toBe("Create my creator profile — free");
    expect(enNs.dressingLockReason).toBe(
      "Unlocks at ★{{band}} {{name}} — dressing from a higher rung.",
    );
    expect(enNs.officeErrDuration).toBe("A session runs between 5 minutes and 4 hours.");
    expect(enNs.inviteAcceptedDone).toBe(
      "You're in — {{room}} is under \"Rooms you're in\" whenever you're ready.",
    );
    expect(enNs.orderPendingHonest).toBe(
      "This order is pending — it is not paid yet, and it will never be shown as paid until the payment confirms.",
    );
  });
});

describe("Creator Rooms catalog parity (unit 48)", () => {
  it("all 10 locales carry exactly the extracted key set", () => {
    for (const loc of LOCALES) {
      expect(Object.keys(CATALOGS[loc]!).sort(), loc).toEqual(enKeys);
    }
  });

  it("no locale's value is empty or an untranslated copy of the key name", () => {
    for (const loc of LOCALES) {
      for (const key of enKeys) {
        const value = CATALOGS[loc]![key];
        expect(typeof value, `${loc}.${key}`).toBe("string");
        expect(value.trim().length, `${loc}.${key}`).toBeGreaterThan(0);
        expect(value, `${loc}.${key}`).not.toBe(key);
      }
    }
  });

  it("interpolation tokens survive identically in every locale, key for key", () => {
    for (const loc of LOCALES) {
      for (const key of enKeys) {
        expect(tokensOf(CATALOGS[loc]![key]!), `${loc}.${key}`).toEqual(tokensOf(enNs[key]!));
      }
    }
  });

  it("MONEY LAW: every money line is the English source verbatim in all 10 catalogs", () => {
    expect(MONEY_KEYS.length).toBe(25);
    for (const key of MONEY_KEYS) {
      expect(enNs[key], `en missing money key ${key}`).toBeDefined();
      for (const loc of LOCALES) {
        expect(CATALOGS[loc]![key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });
});
