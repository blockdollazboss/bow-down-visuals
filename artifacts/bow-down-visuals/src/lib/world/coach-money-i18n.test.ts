/**
 * Coach/Money desks i18n pins (Stack-100 locale unit 40).
 *
 * The World's Coach/Money desk family — CoachPanels,
 * CoachMoneySubViews, BusinessDesks, MoneyActionsDesk, PayoutDesk
 * and BrandCalculatorDesk — rendered hard-coded English inside a
 * 10-locale product: none of the six files contained a
 * t()/useTranslation call. Their own copy now lives in the locale
 * catalogs under worldCoachMoney.*. (The seventh family file,
 * CoachPanelBits, is a pure class-string kit — inputCls / goldBtn /
 * chipBtn / smallBtn and two layout wrappers — and carries no
 * display copy at all; it is pinned as a no-literal file below.)
 * These pins hold both halves:
 *
 *  - extraction: every one of the six files renders through
 *    useTranslation, and every catalog key in the namespace is
 *    actually referenced by one of the six (no orphan keys, no
 *    unextracted remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set, so
 *    the desks can never silently fall back to one language again;
 *  - money law: the lines that state a specific charge, fee,
 *    payout, split or amount — priced buttons, charge/refund
 *    notes, never-charged statements, free-price statements and
 *    the split rules — carry the English source verbatim in EVERY
 *    catalog (enumerated in MONEY_KEYS below); money copy is
 *    never agent-drafted and fee percentages / splits ride as
 *    interpolation or preserved numerals.
 *
 * Deliberately NOT extracted (family convention): shared-lib copy
 * other surfaces also render — PUBLISHING_COPY (server-owned
 * money-adjacent copy; it stays the English source everywhere) and
 * TRANSFER_BUTTON_LABEL (lib/world/station-panel), and
 * payoutSuccessNote's money sentence, which the payout seam
 * composes from the rail's own answer. Stack 200 Lane E1 (E-2)
 * later extracted the rest of this list through the catalogs:
 * the publishing state / writer status / split validators
 * (lib/publishing-splits strings table, publishingSplits.*
 * catalog keys), roleLabel (lib/distribution, distribution.*),
 * the royalties loader's fallback errors (lib/royalties-load,
 * royalties.load*), the brand-kit color-role words
 * (brandingKit.colorRole.*), the stream-pack theme names/blurbs
 * (streamPack.theme.*) and the SITE_FEATURES / category display
 * words (features.registry.* / features.category.*) — each seam
 * resolving through the catalogs with its English literal as the
 * default, so other consumers keep the canonical English. Rail status/enum tokens
 * and rail-verbatim strings (platform labels, verdict enums,
 * claim/payout status words the key-maps don't know) render
 * literally, and server-saved DATA compositions (split-ledger
 * post bodies, promo-card asset labels, roadmap week titles,
 * CSV examples, form-data defaults) stay what the member saved.
 * Seam validators take optional strings tables with the English
 * consts as defaults, so every other consumer of the shared
 * seams renders exactly as before.
 *
 * TRANSLATION STATUS: en is final. The other nine catalogs'
 * values are AGENT-DRAFTED and UNREVIEWED (standing stack600
 * practice), except the money lines, which are verbatim en.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const FILES = [
  "CoachPanels",
  "CoachMoneySubViews",
  "BusinessDesks",
  "MoneyActionsDesk",
  "PayoutDesk",
  "BrandCalculatorDesk",
] as const;
const sources: Record<string, string> = {};
for (const f of FILES) {
  sources[f] = read(`../../components/world/native/${f}.tsx`);
}
const allSrc = FILES.map((f) => sources[f]).join("\n");
const bitsSrc = read("../../components/world/native/CoachPanelBits.tsx");
const en = readJson("../../locales/en.json");
const enNs = (en.worldCoachMoney ?? {}) as Record<string, string>;
const enKeys = Object.keys(enNs).sort();

const MONEY_KEYS = [
  // BrandCalculatorDesk — the priced run button.
  "bcRunButton",
  // PayoutDesk — cash-out amounts, the verified minimum, the
  // unlock threshold and the two amount-line fragments.
  "poBankVerifiedMin",
  "poCashOut",
  "poPendingMeanwhile",
  "poReadyPrefix",
  "poSendConfirm",
  "poUnlocksAt",
  // CoachPanels — priced analyzer/validator runs, the
  // never-charged failure notes, the tips line, the free save
  // and the two amount validators.
  "cpAnalyzeButton",
  "cpAnalyzeFailed",
  "cpGoalTypeProblem",
  "cpIdeaFailed",
  "cpIdeaIntro",
  "cpLedgerAmountProblem",
  "cpNicheIntro",
  "cpPlusTips",
  "cpSaveEntry",
  "cpValidateButton",
  // CoachMoneySubViews — the split rules (100% totals, 0–100%
  // shares), the priced PDF + insights runs and the registry's
  // never-charged warming note.
  "subInsightsIntro",
  "subInsightsOut",
  "subPdfButton",
  "subPdfOutOfBucs",
  "subPercentNote",
  "subRegistryWarming",
  "subSharesNote",
  "subSheetShareRange",
  "subSheetTotalExact",
  // BusinessDesks — every priced bench button, charge/refund/
  // never-charged note, free-price statement and the coach's
  // tracked-money line.
  "bizApplyNote",
  "bizBioEmptyDetail",
  "bizBioPublishButton",
  "bizBioPublishNote",
  "bizBioRefreshButton",
  "bizBioRefreshFailed",
  "bizCardsFailedRefund",
  "bizCoachButton",
  "bizCoachFailed",
  "bizCoachIntro",
  "bizCoachMoneyLine",
  "bizCreatePageFree",
  "bizGenerateKitButton",
  "bizGraphicFailed",
  "bizHandTuneNote",
  "bizHeadshotButton",
  "bizHeadshotChargeNote",
  "bizHeadshotFailed",
  "bizLogoFailed",
  "bizLogoNotFound",
  "bizLogoSaveButton",
  "bizLogoTierLine",
  "bizPressGenerateButton",
  "bizPressGenerateEmpty",
  "bizPressGenerateFailed",
  "bizPublishFailed",
  "bizPublishNoAnswer",
  "bizPromoCardsCost",
  "bizRegenerateKitButton",
  "bizSaveChangesFree",
  "bizSaveKitButton",
  "bizStartPageFree",
  "bizStingFailed",
  "bizStingNotFound",
  "bizStreamPackButton",
  "bizStreamPackChargeNote",
  "bizUnpublishButton",
  "bizUnpublishNote",
];

describe("Coach/Money desks extraction (unit 40)", () => {
  it("all six copy files render through useTranslation", () => {
    for (const f of FILES) {
      expect(sources[f], f).toContain('import { useTranslation } from "react-i18next"');
      expect(sources[f], f).toContain("worldCoachMoney.");
    }
  });

  it("CoachPanelBits stays a no-literal class kit", () => {
    expect(bitsSrc).not.toContain("useTranslation");
    expect(bitsSrc).not.toContain("worldCoachMoney.");
    expect(bitsSrc).toContain("export const inputCls");
    expect(bitsSrc).toContain("export const goldBtn");
  });

  it("every extracted key is referenced by the six files (no orphans, no remainder)", () => {
    expect(enKeys.length).toBe(878);
    const referenced = new Set(
      [...allSrc.matchAll(/worldCoachMoney\.(\w+)/g)].map((m) => m[1]),
    );
    for (const key of enKeys) {
      expect(referenced.has(key), `worldCoachMoney.${key}`).toBe(true);
    }
    for (const key of referenced) {
      expect(enNs, `worldCoachMoney.${key}`).toHaveProperty(key as string);
    }
  });

  it("en copy is the desks' original wording, verbatim", () => {
    expect(enNs.bcRunButton).toBe("Price my deal — {{cost}} Bucs");
    expect(enNs.poCashOut).toBe("Cash out {{amount}}");
    expect(enNs.poSendConfirm).toBe("Send {{amount}} to your bank? Tap again to send");
    expect(enNs.maClaimsTitle).toBe("Content-ID matches & claims");
    expect(enNs.cpGoalTypeProblem).toBe("Type a goal above $0 — like 1500.");
    expect(enNs.cpAnalyzeFailed).toBe(
      "The analyzer couldn't build the read right now — a failed analysis never charges. Try again.",
    );
    expect(enNs.subSheetTotalExact).toBe("Splits must add up to exactly 100% to save.");
    expect(enNs.subPdfFeature).toBe("Royalty Split Sheet PDF");
    expect(enNs.bizBioPublishNote).toBe(
      "Saving is free — publishing is {{cost}} Visual Bucs, asked before it charges.",
    );
    expect(enNs.bizFeatureBrandKit).toBe("Brand Kit Generator");
    expect(enNs.bizGuestGate).toBe(
      "{{desk}} works on your own account — guests can look around the palace, but this desk only opens for members.",
    );
    expect(enNs.tryAgain).toBe("Try again");
  });

  it("numbers format in the walker's language, never hard-coded en-US", () => {
    for (const f of FILES) {
      expect(sources[f], f).not.toContain('toLocaleString("en-US")');
      expect(sources[f], f).not.toContain('toLocaleDateString("en-US")');
      expect(sources[f], f).not.toMatch(/\.toLocaleString\(\)/);
    }
    for (const f of ["CoachPanels", "CoachMoneySubViews", "BusinessDesks", "BrandCalculatorDesk"] as const) {
      expect(sources[f], f).toContain("i18n.language");
    }
  });

  it("no extracted display literal survives in the six files", () => {
    for (const frag of [
      "Brand Deal Calculator",
      "Content-ID matches & claims",
      "Generate brand kit",
      "Ask the coach",
      "Split agreements",
      "Connect your bank. Get your money.",
    ]) {
      expect(allSrc, frag).not.toContain(frag);
    }
  });
});

describe("Coach/Money desks catalog parity (unit 40)", () => {
  it("all 10 locales carry exactly the extracted key set", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(Object.keys(cat.worldCoachMoney ?? {}).sort(), loc).toEqual(enKeys);
    }
  });

  it("interpolation tokens survive in every locale, key for key", () => {
    const tokens = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of enKeys) {
        expect(tokens(cat.worldCoachMoney[key]), `${loc}.${key}`).toEqual(tokens(enNs[key]!));
      }
    }
  });

  it("money lines carry the English source verbatim in every catalog", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of MONEY_KEYS) {
        expect(cat.worldCoachMoney[key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });
});
