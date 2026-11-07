/**
 * Commerce stands i18n pins (stack100 locale unit 41, manifest item 41).
 *
 * The World's Commerce stands family — ShopStands (marketplace stand,
 * stand create/manage, branding shop, Crowns creator desk + fan stand),
 * PaidSeriesDropsDesk, MerchBench, JewelryBench, StoreGrowthDesk,
 * DiscountCodesDesk and SmartCardsStand — rendered hard-coded English
 * inside a 10-locale product. Their own copy now lives in the locale
 * catalogs under worldCommerceStands.*, extracted key-for-key (the en
 * values are the stands' original wording, verbatim). These pins hold:
 *
 *  - extraction: every family component renders through useTranslation,
 *    and every catalog key in the namespace is actually referenced by
 *    the components or their seams (no orphan keys, no unextracted
 *    remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set, values
 *    non-empty, with identical interpolation-token sets per key;
 *  - the MONEY LAW: every line that states a specific price, fee,
 *    charge, split or amount (enumerated in MONEY_KEYS below — fee
 *    lines, per-unit prices, reservation terms, unlock splits, tier
 *    price labels, AI-helper charge lines) carries the English source
 *    VERBATIM in every catalog. Money copy is never agent-drafted;
 *    figures reach the line by interpolation;
 *  - formatting: dates/numbers/currency in the family format with
 *    i18n.language — no hard-coded "en-US", no bare toLocale*() calls.
 *
 * Stack 200 Lane E1 item E-3 extracted the two seam constants that
 * used to sit on the not-extracted list: CHECKOUT_TRANSFER_LABEL /
 * CONTACT_FOR_QUOTE_LABEL now resolve through this namespace
 * (checkoutTransfer / contactForQuote, referenced from the
 * shop-stands seam resolvers, constants riding as defaults; the
 * non-English values are the English source verbatim, UNREVIEWED).
 *
 * Deliberately NOT extracted (documented in the unit report): rail
 * status/enum humanizers (smartCardOrderStatusLabel,
 * brandingOrderStatusLabel); shared lib catalog data
 * (branding-shop products, shop-starters looks, nfc-cards styles,
 * merch seam labels ride as i18next defaultValue fallbacks); jewelry
 * guide/estimate content the rail itself provides; the money-desks
 * seam's tier/member problem lines (shared with nine other desks —
 * that seam belongs to its own locale unit); overrideFeature rail
 * labels per house convention.
 *
 * TRANSLATION STATUS: en is final. The other nine catalogs' values
 * are AGENT-DRAFTED and UNREVIEWED (standing stack600 practice); the
 * MONEY_KEYS values are exempt from drafting by the money law — they
 * are the English source in every catalog.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const NS = "worldCommerceStands";

const COMPONENTS: Record<string, string> = {
  ShopStands: read("../../components/world/native/ShopStands.tsx"),
  PaidSeriesDropsDesk: read("../../components/world/native/PaidSeriesDropsDesk.tsx"),
  MerchBench: read("../../components/world/native/MerchBench.tsx"),
  JewelryBench: read("../../components/world/native/JewelryBench.tsx"),
  StoreGrowthDesk: read("../../components/world/native/StoreGrowthDesk.tsx"),
  DiscountCodesDesk: read("../../components/world/native/DiscountCodesDesk.tsx"),
  SmartCardsStand: read("../../components/world/native/SmartCardsStand.tsx"),
};
const SEAMS: Record<string, string> = {
  shopStands: read("./shop-stands.ts"),
  discountsDesk: read("./discounts-desk.ts"),
  storeGrowth: read("./store-growth.ts"),
  paidSeriesDrops: read("./paid-series-drops.ts"),
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
  "cardsPerCard",
  "cardsReservationTotalBefore",
  "cardsReservationTotalAfter",
  "cardsReserveOne",
  "cardsReserveMany",
  "growthAddonFeeLabel",
  "growthLeadIntro",
  "growthLeadPriceNote",
  "growthConvertArmedNote",
  "growthRestoredNote",
  "growthBuyerPreview",
  "growthBuyerPreviewOff",
  "growthProblemRestorePrice",
  "jewelryPreviewCost",
  "jewelryStlCost",
  "jewelryConsultIntro",
  "jewelryConsultSend",
  "merchBatchOutOfBucs",
  "merchPlanOutOfBucs",
  "merchDesignCost",
  "merchPlanCost",
  "merchCommissionNote",
  "merchComingSoon",
  "merchMarginBefore",
  "merchMarginAfter",
  "merchMarginNone",
  "merchCostsToMake",
  "merchMetaCosts",
  "merchMetaSuggested",
  "seriesProbCeiling",
  "seriesProbValid",
  "seriesProbMin",
  "seriesPriceSetNote",
  "seriesPriceFreeNote",
  "seriesUnlockNoPrice",
  "seriesUnlockPendingNote",
  "seriesVerifyPending",
  "seriesVerifyClosed",
  "seriesCheckoutFailed",
  "seriesUnlockPayNote",
  "seriesUnlockTabNote",
  "seriesCheckoutNoPage",
  "seriesUnlockSplit",
  "seriesBuyersLineOne",
  "seriesBuyersLineMany",
  "seriesPricePlaceholder",
  "seriesCreatePricePlaceholder",
  "seriesCreateNote",
  "shopProbPriceValid",
  "crownsTierPerMonth",
  "crownsTierPerYear",
  "crownsTierSaving",
  "crownsStartingFrom",
  "shopOrderExpiredNote",
  "shopOrderPendingHosted",
  "shopOrderPendingStale",
  "shopCheckoutFailed",
  "shopOrderPendingEmbedded",
  "shopOrderPendingTab",
  "shopCheckoutNoPage",
  "shopCheckoutFailedCart",
  "shopCartPill",
  "shopFeeLine",
  "shopPendingHonesty",
  "shopQtyPrefix",
  "shopPaidSummary",
  "shopAiOutWriter",
  "shopAiOutImage",
  "shopAiWriterFailed",
  "shopAiWriterEmpty",
  "shopAiImageFailed",
  "shopAiImageEmpty",
  "shopAiDescButton",
  "shopAiImageButton",
  "shopAiImagePremiumButton",
  "shopAiStoryButton",
  "shopHelpersNote",
  "shopWriterNote",
  "shopPricePlaceholder",
  "shopEarnedLine",
  "shopEarningsFailed",
  "shopStreamTipsLabel",
  "shopStageTipsLabel",
  "shopTipsVbSuffix",
  "shopTipsFromOne",
  "shopTipsFromMany",
  "shopTipsKeptApart",
  "shopTipJarWorth",
  "shopTipJarPendingOne",
  "shopTipJarPendingMany",
  "shopEarningsFooter",
  "shopStartersNote",
  "shopRecentSalesFee",
  "shopYouKeepLine",
  "shopAwaitingNote",
  "shopSalesFooter",
  "brandDesignedNote",
  "brandDesignHiccup",
  "brandCheckoutSavedNote",
  "brandDemoNote",
  "brandPayFailed",
  "brandDesignCardTitle",
  "brandDesignButton",
  "brandRefundNote",
  "brandOutOfCredits",
  "brandPayButton",
  "brandOrderSettled",
  "crownsDashNetFee",
  "crownsYouKeep",
  "crownsAnnualOff",
  "crownsFeeNote",
  "crownsSuggestTitle",
  "crownsSuggestPriceLine",
  "crownsPriceLabel",
  "crownsPriceAria",
  "crownsSuggestOut",
  "crownsSuggestFailed",
  "crownsSuggestEmpty",
  "crownsMemberAddNote",
  "crownsVerifyGiftConfirmed",
  "crownsVerifyConfirmed",
  "crownsVerifyPending",
  "crownsTrialOn",
  "crownsGiftCheckoutNote",
  "crownsJoinCheckoutNote",
  "crownsGiftTabNote",
  "crownsJoinTabNote",
  "crownsWaitingNote"
];

const tokensOf = (value: string): string[] =>
  [...value.matchAll(/\{\{\s*[^{}]+?\s*\}\}/g)].map((m) => m[0].replace(/\s+/g, "")).sort();

describe("Commerce stands extraction (unit 41)", () => {
  it("every family component renders through useTranslation", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).toContain('import { useTranslation } from "react-i18next"');
      expect(src, name).toContain("useTranslation()");
    }
  });

  it("the namespace holds the family's full extracted key set", () => {
    // 872 at unit 41; +2 for Stack 200 E-3 (checkoutTransfer,
    // contactForQuote — the shop-stands seam constants, extracted).
    expect(enKeys.length).toBe(874);
  });

  it("every catalog key is referenced by a component or seam (no orphans, no remainder)", () => {
    const referenced = new Set<string>();
    for (const m of JOINED.matchAll(/worldCommerceStands\.([A-Za-z0-9_]+)/g)) {
      referenced.add(m[1]!);
    }
    expect([...referenced].sort()).toEqual(enKeys);
  });

  it("dates, numbers and currency format in the walker's language — never hard-coded en-US, never bare", () => {
    for (const [name, src] of Object.entries(ALL_SOURCES)) {
      expect(src, name).not.toContain('toLocaleDateString("en-US"');
      expect(src, name).not.toContain('toLocaleString("en-US"');
      expect(src, name).not.toContain(".toLocaleDateString()");
      expect(src, name).not.toContain(".toLocaleString()");
    }
    expect(COMPONENTS.ShopStands).toContain("toLocaleDateString(i18n.language)");
    expect(COMPONENTS.ShopStands).toContain("membershipDollars(n, i18n.language)");
  });

  it("en copy is the stands' original wording, verbatim (representative pins)", () => {
    expect(enNs.shopSquareTitle).toBe("Shopfronts on the square");
    expect(enNs.shopFeeLine).toBe(
      "Sellers keep {{keep}}% — the {{fee}}% platform fee comes out of the seller’s cut, never on top of your price.",
    );
    expect(enNs.discountsTitle).toBe("Discount Codes");
    expect(enNs.growthAddonFeeLabel).toBe("flat 5% platform fee");
    expect(enNs.jewelryBenchTitle).toBe("Jewelry bench");
    expect(enNs.merchTabPlanner).toBe("Merch Drop Planner");
    expect(enNs.seriesDeskTitle).toBe("Paid series — sell a whole series as one unlock");
    expect(enNs.dropsDeskTitle).toBe("Product drops — timed releases on your storefront");
    expect(enNs.cardsDedupedTitle).toBe("That reservation already stands");
    expect(enNs.crownsDeskTitle).toBe("Your fan club — tiers you sell");
  });
});

describe("Commerce stands catalog parity (unit 41)", () => {
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
    expect(MONEY_KEYS.length).toBe(128);
    for (const key of MONEY_KEYS) {
      expect(enNs[key], `en missing money key ${key}`).toBeDefined();
      for (const loc of LOCALES) {
        expect(CATALOGS[loc]![key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });
});
