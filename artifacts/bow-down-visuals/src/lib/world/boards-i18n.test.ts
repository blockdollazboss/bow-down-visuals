/**
 * Boards i18n pins (stack100 locale unit 50, manifest item 50).
 *
 * The World's Boards family — ChartsBoard, BrandOutreachPanel,
 * EarningsBoard, StudioBoard, KingdomBoardBlocks, PitchFixBoard
 * and SeasonMarksWall — rendered hard-coded English inside a
 * 10-locale product. Their own copy now lives in the locale
 * catalogs under worldBoards.*, extracted key-for-key (the en
 * values are the boards' original wording, verbatim). NativeBoard
 * is the family's eighth file and is verified literal-free: it is
 * a pure frame whose title/detail/meta all arrive as props from
 * the calling boards, so it carries no keys and no i18n hook.
 * These pins hold:
 *
 *  - extraction: every wired family component renders through
 *    useTranslation, and every catalog key in the namespace is
 *    actually referenced by the components or their seams (no
 *    orphan keys, no unextracted remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set,
 *    values non-empty, with identical interpolation-token sets
 *    per key;
 *  - the MONEY LAW: every line that states a specific price, fee,
 *    charge, payout, reward or money-state fact (enumerated in
 *    MONEY_KEYS below — the pitch-draft price and refund lines,
 *    the credit-history and jackpot/prize lines, the sponsor
 *    pipeline totals, the pitch-&-fix reward line, and the
 *    earnings board's amount/payout/statement lines, whose figures
 *    all arrive by interpolation) carries the English source
 *    VERBATIM in every catalog. Money copy is never agent-drafted;
 *  - board truths: board numbers (counts, points, positions,
 *    amounts) are DATA — no figure is catalogued anywhere in the
 *    namespace; stars/ranks copy speaks of earning only;
 *  - formatting: numbers/dates in the family components format
 *    with i18n.language — no hard-coded "en-US", no bare
 *    toLocale*() calls in the family components. (Seam helpers
 *    keep an "en-US" DEFAULT locale param, pinned byte-identical
 *    by their own suites; wired callers pass i18n.language.)
 *
 * Deliberately NOT extracted (documented in the unit report):
 * strings produced inside shared seams outside this family —
 * treasury-quests, games-lobby (party game titles, contest status
 * lines), objective-strip (its formatEventTime output, en-US
 * inside that module), contests, characters, guest-honest pitch
 * strings (the known shared follow-on), jukebox-sync denied copy,
 * lib/ugc-ads (UGC_PAYMENT_NOTE, UGC_STYLES labels), lib/verticals
 * VERTICAL_META names (the board's own "All verticals" name IS
 * extracted), lib/world/shelf embed code, lib/earnings-statement
 * line labels (re-exported by the earnings seam, produced in that
 * shared module), lib/streaming + discovery cards formatters;
 * the pitchFix.* page keys PitchFixBoard REUSES byte-identically
 * (rewardsLine — the ruled 500 / 100–250 VB headline — the page
 * and severity tables, most category labels, sortNewest,
 * fixStatus.fixed) rather than duplicating into worldBoards;
 * common.visualBucs / common.continue, reused by StudioBoard the
 * same way; rail/enum tokens, platform proper names, member and
 * server DATA (names, titles, standings rows) — data, not copy;
 * NativeStates primitives (unit 51).
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
const NS = "worldBoards";

const COMPONENTS: Record<string, string> = {
  ChartsBoard: read("../../components/world/native/boards/ChartsBoard.tsx"),
  BrandOutreachPanel: read("../../components/world/native/boards/BrandOutreachPanel.tsx"),
  EarningsBoard: read("../../components/world/native/boards/EarningsBoard.tsx"),
  StudioBoard: read("../../components/world/native/boards/StudioBoard.tsx"),
  KingdomBoardBlocks: read("../../components/world/native/KingdomBoardBlocks.tsx"),
  PitchFixBoard: read("../../components/world/native/PitchFixBoard.tsx"),
  SeasonMarksWall: read("../../components/world/native/SeasonMarksWall.tsx"),
};
const NATIVE_BOARD = read("../../components/world/native/NativeBoard.tsx");
const SEAMS: Record<string, string> = {
  chartsBoard: read("./charts-board.ts"),
  earningsBoard: read("./earnings-board.ts"),
  studioBoard: read("./studio-board.ts"),
  pitchFixBoard: read("./pitch-fix-board.ts"),
  courtSeason: read("./court-season.ts"),
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
  "boBriefHint",
  "boDraftHint",
  "boDraftPitchButton",
  "boDraftedFor",
  "boDraftedLeft",
  "chDraftOutOfBucs",
  "ebBrandDeals",
  "ebLedgerCharge",
  "ebLedgerFree",
  "ebLedgerGrant",
  "ebLedgerRefund",
  "ebPaymentDetailVb",
  "ebPaymentOne",
  "ebPaymentOther",
  "ebPdfDownloading",
  "ebStageTipsDetail",
  "ebStatementBlurb",
  "ebStatementNotTaxForm",
  "ebStoreBreakdown",
  "ebStreamTipsDetail",
  "ebTipsMetaVb",
  "ebTotalEarnedUsd",
  "ebVisualBucBack",
  "ebVisualBucPack",
  "ebVisualBucPurchase",
  "pfRewardPaid",
  "sbBonusBanked",
  "sbJackpotLine",
  "sbLatestActivity",
  "sbLatestMinus",
  "sbLatestPlus",
  "sbProjectCredits",
  "sbSponsorActiveMany",
  "sbSponsorActiveOne",
  "sbWeeklyPrize",
];

const tokensOf = (value: string): string[] =>
  [...value.matchAll(/\{\{\s*[^{}]+?\s*\}\}/g)].map((m) => m[0].replace(/\s+/g, "")).sort();

describe("Boards extraction (unit 50)", () => {
  it("every wired family component renders through useTranslation", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).toContain('import { useTranslation } from "react-i18next"');
      expect(src, name).toContain("useTranslation()");
    }
  });

  it("NativeBoard is the family's pure frame — no literals, no i18n hook", () => {
    expect(NATIVE_BOARD).not.toContain("useTranslation");
    expect(NATIVE_BOARD).not.toContain("worldBoards");
    expect(NATIVE_BOARD).not.toContain("react-i18next");
  });

  it("the namespace holds the family's full extracted key set", () => {
    expect(enKeys.length).toBe(418);
  });

  it("every catalog key is referenced by a component or seam (no orphans, no remainder)", () => {
    const referenced = new Set<string>();
    for (const m of JOINED.matchAll(/worldBoards\.([A-Za-z0-9_]+)/g)) {
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
    expect(COMPONENTS.EarningsBoard).toContain("i18n.language");
    expect(COMPONENTS.StudioBoard).toContain("i18n.language");
    expect(COMPONENTS.SeasonMarksWall).toContain("i18n.language");
    /* ChartsBoard, BrandOutreachPanel, KingdomBoardBlocks and
       PitchFixBoard format no numbers locale-side: their figures
       ride seam values and shared formatters. */
  });

  it("en copy is the boards' original wording, verbatim (representative pins)", () => {
    expect(enNs.boDraftPitchButton).toBe("Draft my pitch — {{cost}} Visual Bucs");
    expect(enNs.pfRewardPaid).toBe("+{{amount}} Bucs landed");
    expect(enNs.sbJackpotLine).toBe("{{name}}: {{prize}} VB jackpot live now");
    expect(enNs.ebStreamTipsDetail).toBe(
      "{{count}} stream tips credited · tip jar {{amount}} pending payment ({{fans}} fans) — not yet earnings",
    );
    expect(enNs.smHonorNote).toBe(
      "Marks are honor, not money: earned by published work, exports, followers, streams, tips, sales and memberships during the season. No Visual Bucs change hands on this wall.",
    );
    expect(enNs.chDraftOutOfBucs).toBe("You're out of Visual Bucs — top up to draft a pitch.");
    expect(enNs.ebStatementNotTaxForm).toBe(
      "A statement of platform-recorded earnings — it is not a filed tax form.",
    );
    expect(enNs.sbSponsorActiveMany).toBe("{{count}} active deals · ${{amount}} in play");
    expect(enNs.pfFiledNote).toBe(
      "Filed — thank you. Every voice is read by the team before it shows on the board; watch yours under “Your filings” below.",
    );
  });
});

describe("Boards catalog parity (unit 50)", () => {
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

  it("digit sequences survive identically in every locale, key for key", () => {
    const digitsOf = (v: string) => (v.match(/\d+/g) ?? []).join(",");
    for (const loc of LOCALES) {
      for (const key of enKeys) {
        expect(digitsOf(CATALOGS[loc]![key]!), `${loc}.${key}`).toBe(digitsOf(enNs[key]!));
      }
    }
  });

  it("MONEY LAW: every money line is the English source verbatim in all 10 catalogs", () => {
    expect(MONEY_KEYS.length).toBe(35);
    for (const key of MONEY_KEYS) {
      expect(enNs[key], `en missing money key ${key}`).toBeDefined();
      for (const loc of LOCALES) {
        expect(CATALOGS[loc]![key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });
});
