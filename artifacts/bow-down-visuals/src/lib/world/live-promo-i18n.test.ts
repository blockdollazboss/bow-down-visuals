/**
 * Live/Promo i18n pins (stack100 locale unit 44, manifest item 44).
 *
 * The World's Live/Promo desk family — LiveDesk (the studio,
 * behind-me, ingest, destinations, loyalty, backstage, guest join,
 * schedule, controller, watch and premiere desks), LiveShoppingDesk,
 * TrendsDesk, TakeoversDesk, ReferralsDesk and the UGC Ads station —
 * rendered hard-coded English inside a 10-locale product. Their own
 * copy now lives in the locale catalogs under worldLivePromo.*,
 * extracted key-for-key (the en values are the desks' original
 * wording, verbatim). These pins hold:
 *
 *  - extraction: every family component renders through
 *    useTranslation, and every catalog key in the namespace is
 *    actually referenced by the components or their seams (no
 *    orphan keys, no unextracted remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set,
 *    values non-empty, with identical interpolation-token sets
 *    per key;
 *  - the MONEY LAW: every line that states a specific price, fee,
 *    charge, refund or no-charge fact (enumerated in MONEY_KEYS
 *    below — trend run prices, the live-shop fee and checkout
 *    honesty lines, the UGC price/refund lines, the referral reward
 *    and next-tier lines, the takeover no-charge framing, the
 *    loyalty points honesty lines) carries the English source
 *    VERBATIM in every catalog. Money copy is never agent-drafted;
 *    figures reach the line by interpolation;
 *  - formatting: numbers/dates in the family format with
 *    i18n.language — no hard-coded "en-US", no bare toLocale*()
 *    calls in the family components.
 *
 * Deliberately NOT extracted (documented in the unit report):
 * the seams' PROMOTIONS / FOLLOW_ONS arrays (live-desk.ts
 * LIVE_WAVE1/2/3_PROMOTIONS, LIVE_NATIVE_FOLLOW_ONS and
 * live-shopping-desk.ts LIVE_SHOPPING_PROMOTION/FOLLOW_ONS) —
 * consumed by tests only, rendered by no component; the shared
 * @/lib/ugc-ads strings (UGC_STYLES labels, ugcAdShareText — the
 * shared lib serves the 2D page too); the
 * buildAlertText composer in shared @/lib/live-shopping; the
 * BACKDROPS labels in shared lib/stream-kit/backdrops; trend-desk's
 * TREND_NICHES (category DATA sent verbatim to the rail) and
 * TREND_PLATFORMS / TREND_FEATURE_* (proper platform names and
 * registry feature names); rail/enum tokens and server-formatted
 * price strings (data, not copy); the background kit's own error
 * messages, which ride verbatim from the kit; LiveDesk's internal
 * camera-kit Error (never displayed — the catch maps it to the
 * catalogued camera-failed note); LiveDesksPanel, the family
 * wrapper, which holds no user-facing literals of its own.
 *
 * TRANSLATION STATUS: en is final. The other nine catalogs' values
 * are AGENT-DRAFTED and UNREVIEWED (standing stack600 practice);
 * the MONEY_KEYS values are exempt from drafting by the money
 * law — they are the English source in every catalog.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const NS = "worldLivePromo";

const COMPONENTS: Record<string, string> = {
  LiveDesk: read("../../components/world/native/LiveDesk.tsx"),
  LiveShoppingDesk: read("../../components/world/native/LiveShoppingDesk.tsx"),
  TrendsDesk: read("../../components/world/native/TrendsDesk.tsx"),
  TakeoversDesk: read("../../components/world/native/TakeoversDesk.tsx"),
  ReferralsDesk: read("../../components/world/native/ReferralsDesk.tsx"),
  UgcAdsStation: read("../../components/world/native/UgcAdsStation.tsx"),
};
const PANEL = read("../../components/world/native/LiveDesksPanel.tsx");
const SEAMS: Record<string, string> = {
  liveDesk: read("./live-desk.ts"),
  liveShoppingDesk: read("./live-shopping-desk.ts"),
  referralsDesk: read("./referrals-desk.ts"),
  ugcStation: read("./ugc-station.ts"),
};
/* Stack-200 D6 (hardening items 44–45) was the follow-on unit for
   the shared @/lib/ugc-ads strings: it keyed the ad/brief status
   labels and the briefs money notes into this namespace (+12
   keys). The nine status labels are referenced by UgcAdsStation
   above; the three money notes are referenced by the seam's own
   documented bundle keys (lib/ugc-ads.ts) and by the cross-surface
   consumers below (the 2D UgcAdsPanel, the World
   BrandOutreachPanel, the /charts For Brands tab). The notes are
   money copy: English source verbatim in every catalog, pinned
   byte-equal to the lib constants by locale-newest-keying. */
const D6_KEYS = new Set([
  "ugcAdStatusDraft",
  "ugcAdStatusFailedRefunded",
  "ugcAdStatusGenerating",
  "ugcAdStatusReady",
  "ugcBriefStatusApproved",
  "ugcBriefStatusClaimed",
  "ugcBriefStatusClosed",
  "ugcBriefStatusDelivered",
  "ugcBriefStatusOpen",
  "ugcBriefsMoneyNote",
  "ugcEscrowNote",
  "ugcPaymentNote",
]);
const D6_SOURCES = [
  read("../ugc-ads.ts"),
  read("../../components/hub/UgcAdsPanel.tsx"),
  read("../../components/world/native/boards/BrandOutreachPanel.tsx"),
  read("../../pages/discovery/charts.tsx"),
].join("\n");
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
  "loyaltyIntro",
  "loyaltyTipLabel",
  "referralNextTierBonus",
  "referralNextTierMoreMany",
  "referralNextTierMoreOne",
  "referralNextTierYours",
  "referralRewardLine",
  "shopCheckoutNoPage",
  "shopCheckoutNoStart",
  "shopCloseNoCharge",
  "shopFeeLine",
  "shopTestIntro",
  "takeoverInquiryNote",
  "takeoverSent",
  "trendsIdeasButton",
  "trendsIdeasOut",
  "trendsOutOfBucs",
  "trendsRunForecast",
  "ugcAdGenerate",
  "ugcGenerateAd",
  "ugcGenerationFailed",
  "ugcIntro",
  "ugcPersonaGenerate",
  "ugcPersonaRegenerate",
  "ugcRefundedSuffix",
  "ugcScriptFreeNote",
  "ugcTipLine",
  /* C-25 — the briefs escrow rail's money lines: the fee/hold/release
     facts, the fund + approve-release charge labels, the refund and
     held-state facts, and the World → website money-door honesty
     line. English verbatim in every catalog, like the rest. */
  "ugcApproveRelease",
  "ugcBoardNoteFree",
  "ugcBoardNotePaid",
  "ugcBriefPriceHelp",
  "ugcClosedRefundNote",
  "ugcCreatorReceives",
  "ugcEscrowRefunded",
  "ugcFundBrief",
  "ugcFundOnWebsite",
  "ugcFundedNote",
];

const tokensOf = (value: string): string[] =>
  [...value.matchAll(/\{\{\s*[^{}]+?\s*\}\}/g)].map((m) => m[0].replace(/\s+/g, "")).sort();

describe("Live/Promo extraction (unit 44)", () => {
  it("every family component renders through useTranslation", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).toContain('import { useTranslation } from "react-i18next"');
      expect(src, name).toContain("useTranslation()");
    }
  });

  it("the family wrapper holds no copy of its own (no-literal kit)", () => {
    expect(PANEL).not.toContain("useTranslation");
    expect(PANEL).not.toContain("worldLivePromo");
  });

  it("the namespace holds the family's full extracted key set", () => {
    /* 549 at unit 44; +12 from Stack-200 D6 (items 44–45) — the
       ugc-ads status labels and briefs money notes. */
    expect(enKeys.length).toBe(561);
  });

  it("every catalog key is referenced by a component or seam (no orphans, no remainder)", () => {
    const referenced = new Set<string>();
    for (const m of JOINED.matchAll(/worldLivePromo\.([A-Za-z0-9_]+)/g)) {
      referenced.add(m[1]!);
    }
    for (const m of D6_SOURCES.matchAll(/worldLivePromo\.([A-Za-z0-9_]+)/g)) {
      if (D6_KEYS.has(m[1]!)) referenced.add(m[1]!);
    }
    expect([...referenced].sort()).toEqual(enKeys);
  });

  it("numbers and dates format in the walker's language — never hard-coded en-US, never bare", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).not.toContain('toLocaleDateString("en-US"');
      expect(src, name).not.toContain('toLocaleString("en-US"');
      expect(src, name).not.toContain(".toLocaleDateString()");
      expect(src, name).not.toContain(".toLocaleTimeString()");
      expect(src, name).not.toContain(".toLocaleString()");
    }
    expect(COMPONENTS.LiveDesk).toContain("i18n.language");
    /* LiveShoppingDesk formats nothing locale-side: every number on
       it rides a server-formatted string (data), so it holds only t. */
    expect(COMPONENTS.ReferralsDesk).toContain("toLocaleDateString(i18n.language");
    expect(COMPONENTS.UgcAdsStation).toContain("toLocaleDateString(i18n.language)");
    expect(COMPONENTS.TakeoversDesk).toContain("toLocaleString(i18n.language)");
  });

  it("en copy is the desks' original wording, verbatim (representative pins)", () => {
    expect(enNs.studioTitle).toBe("Go Live — the studio, right here");
    expect(enNs.ingestUntested).toBe(
      "This key is untested — it's proven the first time your encoder connects and the stream goes live.",
    );
    expect(enNs.loyaltyTipLabel).toBe("Points per 100 VB tipped");
    expect(enNs.shopFeeLine).toBe(
      " The platform fee is {{fee}}% of each sale, taken from the seller's side.",
    );
    expect(enNs.trendsOutOfBucs).toBe(
      "You're out of Visual Bucs for the {{feature}}. Top up at the Treasury's Visual Buc Packs desk and run it again.",
    );
    expect(enNs.takeoverInquiryNote).toBe(
      "An inquiry is a request, not a purchase — no charge is taken when you send it.",
    );
    expect(enNs.referralRewardLine).toBe(
      "Friends who join through it get {{reward}} Bucs to start — and you earn {{pct}}% of what they spend for {{days}} days.",
    );
    expect(enNs.ugcTipLine).toBe(
      "Tip: Turbo writes the script free — the 400 Visual Bucs are only for filming the ad.",
    );
  });
});

describe("Live/Promo catalog parity (unit 44)", () => {
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
    expect(MONEY_KEYS.length).toBe(37);
    for (const key of MONEY_KEYS) {
      expect(enNs[key], `en missing money key ${key}`).toBeDefined();
      for (const loc of LOCALES) {
        expect(CATALOGS[loc]![key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });
});
