import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import pt from "../../locales/pt.json";
import fr from "../../locales/fr.json";
import itCatalog from "../../locales/it.json";
import de from "../../locales/de.json";
import ar from "../../locales/ar.json";
import hi from "../../locales/hi.json";
import ja from "../../locales/ja.json";
import ko from "../../locales/ko.json";
import { SUCCESSION_STRINGS_EN } from "./get-paid-tail";
import { TIP_STRINGS_EN } from "./money-desks-2";
import { PORTRAIT_SUMMARY_STRINGS_EN } from "./portrait-card";
import { DETECTOR_VERDICT_LABELS } from "./detector-desk";
import { DNS_INSTRUCTION_STRINGS_EN } from "../domains";

/* ─── Stack 100 locale unit 49 — the Identity/Misc desk family
   speaks through the catalogs (worldIdentityMisc).

   SCOPE: the six family components the manifest census assigned
   to unit 49 ([D16]) — SuccessionDesk, DomainsDesk, PortraitCard,
   PortraitTip, DetectorDesk, TipJarDesk — plus the four seams
   they share copy through: get-paid-tail.ts (the succession
   validators + designation line — unit 42 threaded the SAME file
   for its catalog-export half; the two halves are different
   functions and merge textually at the join), money-desks-2.ts
   (tipAmountProblem + tipFeedStatusLabel — unit 40 threaded other
   functions of the same module), portrait-card.ts
   (membershipSummaryRows) and lib/domains.ts (dnsInstructionsFor —
   shared with the 2D creator-domains page, which passes no bundle
   and keeps the English defaults). Seam bundles are OPTIONAL with
   byte-identical English defaults, so every existing seam suite
   passes unchanged and English rendering is identical, key for
   key. NO-OVERLAP: the six components were verified against every
   file list of units 36–48 in the manifest census — none appears
   in any earlier unit.

   ACCOUNT/IDENTITY HONESTY: the sign-in family surfaces are
   door-only by design; nothing here builds auth behavior — copy
   extraction only. The desks carry their honesty lines as copy:
   the succession "not legal effect / never transfers money"
   framing, the tip jar's test-mode + 100%-to-the-creator note,
   the detector's refund lines.

   MONEY LAW: lines stating a specific price, fee, amount or
   no-charge fact carry the English source VERBATIM in every
   catalog (figures by interpolation where the line takes one):
   detCostLine, detNeedFile, detNeedUrl, detOutOfCredits,
   detFailedRefund, detUnreadable, domFreeLine, domNone,
   jarStatusNote, porFreeLabel, porPerMonthSuffix, tipGoalLine,
   tipStatsLine, tipSendAmount, tipSentCheckout, tipSentIntent,
   tipEmbeddedNote, tipEmbeddedClose, tipProblemMin, tipProblemMax
   (20 keys, enumerated in MONEY_KEYS and asserted byte-identical
   in all ten catalogs below).

   REUSED KEYS (byte-identical verified against en.json — the
   family rides the existing catalog instead of duplicating):
   tipPage.amountRequired (the tip problem bundle's pick-first
   line), tipPage.fanNamePlaceholder, tips.anonymousFan,
   tips.createButton, tips.goalDefault, tips.recentTips,
   mediaDetector.pointsToAi, mediaDetector.pointsToHuman. Honest
   near-misses rejected: mediaDetector.verdictAi ("Likely
   AI-Generated") differs from the desk's "Likely AI-generated" by
   case; tips.updateButton ("Update tip page") differs from the
   desk's "Update my tip page"; tipPage.messagePlaceholder ("Say
   something nice") differs from the desk's "Say something kind".

   DELIBERATELY NOT EXTRACTED: rail/enum tokens (domain status,
   detector severity + media-kind tokens — the file-meta line
   interpolates the kind token as data); rail-provided text
   (verdict summaries, signal names/descriptions, disclaimers,
   frame notes, membership tier names and prices, tip feed rows);
   shape placeholders ("yourname.com", "yourhandle"); the
   " · {duration}" clock suffix (punctuation + data); the detector
   seam's verdict table DETECTOR_VERDICT_LABELS stays the English
   fallback behind the component's key-map (unit 43 precedent).

   All non-English values in worldIdentityMisc are AGENT-DRAFTED
   and UNREVIEWED — no native speaker has checked them. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const NS = "worldIdentityMisc";
type Catalog = Record<string, Record<string, string>>;
const CATALOGS: Record<string, Catalog> = {
  en: en as unknown as Catalog,
  es: es as unknown as Catalog,
  pt: pt as unknown as Catalog,
  fr: fr as unknown as Catalog,
  it: itCatalog as unknown as Catalog,
  de: de as unknown as Catalog,
  ar: ar as unknown as Catalog,
  hi: hi as unknown as Catalog,
  ja: ja as unknown as Catalog,
  ko: ko as unknown as Catalog,
};
const EN = CATALOGS.en[NS];

const COMPONENTS = [
  "../../components/world/native/SuccessionDesk.tsx",
  "../../components/world/native/DomainsDesk.tsx",
  "../../components/world/native/PortraitCard.tsx",
  "../../components/world/native/PortraitTip.tsx",
  "../../components/world/native/DetectorDesk.tsx",
  "../../components/world/native/TipJarDesk.tsx",
];
const SEAMS = ["./get-paid-tail.ts", "./money-desks-2.ts", "./portrait-card.ts", "../domains.ts"];

const MONEY_KEYS = [
  "detCostLine", "detFailedRefund", "detNeedFile", "detNeedUrl", "detOutOfCredits", "detUnreadable",
  "domFreeLine", "domNone",
  "jarStatusNote",
  "porFreeLabel", "porPerMonthSuffix",
  "tipEmbeddedClose", "tipEmbeddedNote", "tipGoalLine", "tipProblemMax", "tipProblemMin",
  "tipSendAmount", "tipSentCheckout", "tipSentIntent", "tipStatsLine",
];

const tokensOf = (value: string): string[] => {
  const found = value.match(/\{\{[A-Za-z0-9_]+\}\}/g) ?? [];
  return [...found].sort();
};
const digitsOf = (value: string): string[] => value.match(/[0-9][0-9,]*/g) ?? [];

describe("unit 49 — Identity/Misc family resolves through the catalog", () => {
  it("every family component imports and calls useTranslation", () => {
    for (const rel of COMPONENTS) {
      const src = read(rel);
      expect(src, rel).toContain('import { useTranslation } from "react-i18next"');
      expect(src, rel).toContain("useTranslation()");
    }
  });

  it("the en namespace carries the full family key set (199 keys)", () => {
    expect(Object.keys(EN)).toHaveLength(199);
  });

  it("referenced keys == catalog keys (zero orphans, zero missing) across components + seams", () => {
    const joined = [...COMPONENTS, ...SEAMS].map(read).join("\n");
    const referenced = new Set([...joined.matchAll(/worldIdentityMisc\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    expect([...referenced].sort()).toEqual(Object.keys(EN).sort());
  });

  it("no hard-coded en-US formatting remains in the family components", () => {
    for (const rel of COMPONENTS) {
      const src = read(rel);
      expect(src, rel).not.toContain('toLocaleString("en-US"');
      expect(src, rel).not.toContain('toLocaleDateString("en-US"');
      expect(src, rel).not.toContain(".toLocaleString()");
      expect(src, rel).not.toContain(".toLocaleDateString()");
    }
  });

  it("representative en values are the desks' own words, verbatim", () => {
    expect(EN.sucTitle).toBe("Legacy & succession");
    expect(EN.sucDesigNone).toBe("No designation recorded — your catalog and page have no named heir.");
    expect(EN.domTitle).toBe("Your own domain");
    expect(EN.domSslNote).toBe("We handle SSL automatically — your site gets HTTPS the moment the domain goes live. No certificates to buy or install. 🦈");
    expect(EN.porBack).toBe("← Back to the gallery");
    expect(EN.porSeatLine).toBe("Front Row · Seat #{{seat}}");
    expect(EN.detVerdictAi).toBe("Likely AI-generated");
    expect(EN.detVerdictHuman).toBe("Likely human-made");
    expect(EN.detVerdictUncertain).toBe("Uncertain — mixed evidence");
    expect(EN.jarTitle).toBe("Your Tip Jar");
    expect(EN.jarStatusNote).toBe("Tips are live — tips are charged for real in test mode, and 100% of every tip goes to you with no fee taken. Setup is free.");
    expect(EN.tipGoalLine).toBe("{{label}}: ${{raised}} of ${{goal}}");
  });

  it("the seams' English defaults ARE the catalog's English values", () => {
    expect(SUCCESSION_STRINGS_EN.problemHeirEmpty).toBe(EN.sucProblemHeirEmpty);
    expect(SUCCESSION_STRINGS_EN.problemHeirShape).toBe(EN.sucProblemHeirShape);
    expect(SUCCESSION_STRINGS_EN.problemInstructionsCap).toBe(EN.sucProblemInstructionsCap);
    expect(SUCCESSION_STRINGS_EN.problemNameEmpty).toBe(EN.sucProblemNameEmpty);
    expect(SUCCESSION_STRINGS_EN.problemNameCap).toBe(EN.sucProblemNameCap);
    expect(SUCCESSION_STRINGS_EN.problemEmailEmpty).toBe(EN.sucProblemEmailEmpty);
    expect(SUCCESSION_STRINGS_EN.problemEmailShape).toBe(EN.sucProblemEmailShape);
    expect(SUCCESSION_STRINGS_EN.problemNoteCap).toBe(EN.sucProblemNoteCap);
    expect(SUCCESSION_STRINGS_EN.designationNone).toBe(EN.sucDesigNone);
    expect(SUCCESSION_STRINGS_EN.designationCurrent).toBe(EN.sucDesigCurrent);
    expect(TIP_STRINGS_EN.problemPickFirst).toBe((en as unknown as Catalog).tipPage.amountRequired);
    expect(TIP_STRINGS_EN.problemMin).toBe(EN.tipProblemMin);
    expect(TIP_STRINGS_EN.problemMax).toBe(EN.tipProblemMax);
    expect(TIP_STRINGS_EN.feedStatusIntent).toBe(EN.jarFeedStatusIntent);
    expect(TIP_STRINGS_EN.feedStatusReceived).toBe(EN.jarFeedStatusReceived);
    expect(TIP_STRINGS_EN.feedStatusUnavailable).toBe(EN.jarFeedStatusUnavailable);
    expect(PORTRAIT_SUMMARY_STRINGS_EN.membershipFallback).toBe(EN.porMembershipFallback);
    expect(PORTRAIT_SUMMARY_STRINGS_EN.freeLabel).toBe(EN.porFreeLabel);
    expect(PORTRAIT_SUMMARY_STRINGS_EN.perMonthSuffix).toBe(EN.porPerMonthSuffix);
    expect(DNS_INSTRUCTION_STRINGS_EN.sslNote).toBe(EN.domSslNote);
    expect(DNS_INSTRUCTION_STRINGS_EN.placeholderWarning).toBe(EN.domPlaceholderWarning);
    expect(DETECTOR_VERDICT_LABELS.likely_ai).toBe(EN.detVerdictAi);
    expect(DETECTOR_VERDICT_LABELS.likely_human).toBe(EN.detVerdictHuman);
    expect(DETECTOR_VERDICT_LABELS.uncertain).toBe(EN.detVerdictUncertain);
  });

  it("the family rides the reused catalog keys where surfaces already had them", () => {
    const tip = read("../../components/world/native/PortraitTip.tsx");
    const jar = read("../../components/world/native/TipJarDesk.tsx");
    const det = read("../../components/world/native/DetectorDesk.tsx");
    expect(tip).toContain('t("tipPage.amountRequired")');
    expect(tip).toContain('t("tipPage.fanNamePlaceholder")');
    expect(tip).toContain('t("tips.goalDefault")');
    expect(jar).toContain('t("tips.createButton")');
    expect(jar).toContain('t("tips.recentTips")');
    expect(jar).toContain('t("tips.anonymousFan")');
    expect(jar).toContain('t("tips.goalDefault")');
    expect(det).toContain('t("mediaDetector.pointsToAi")');
    expect(det).toContain('t("mediaDetector.pointsToHuman")');
  });
});

describe("unit 49 — all ten catalogs carry the family whole", () => {
  it("every catalog has exactly the en key set, no empty values", () => {
    const enKeys = Object.keys(EN).sort();
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const ns = catalog[NS];
      expect(ns, locale).toBeDefined();
      expect(Object.keys(ns).sort(), locale).toEqual(enKeys);
      for (const [key, value] of Object.entries(ns)) {
        expect(typeof value, `${locale}.${key}`).toBe("string");
        expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolation tokens match the English per key in every catalog", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "en") continue;
      const ns = catalog[NS];
      for (const [key, enValue] of Object.entries(EN)) {
        expect(tokensOf(ns[key]), `${locale}.${key}`).toEqual(tokensOf(enValue));
      }
    }
  });

  it("digit sequences match the English per key in every catalog", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "en") continue;
      const ns = catalog[NS];
      for (const [key, enValue] of Object.entries(EN)) {
        expect(digitsOf(ns[key]), `${locale}.${key}`).toEqual(digitsOf(enValue));
      }
    }
  });

  it("leading/trailing spaces match the English per key (composed strings depend on them)", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "en") continue;
      const ns = catalog[NS];
      for (const [key, enValue] of Object.entries(EN)) {
        expect(ns[key].startsWith(" "), `${locale}.${key} leading`).toBe(enValue.startsWith(" "));
        expect(ns[key].endsWith(" "), `${locale}.${key} trailing`).toBe(enValue.endsWith(" "));
      }
    }
  });

  it("money lines are byte-identical English in all ten catalogs", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const ns = catalog[NS];
      for (const key of MONEY_KEYS) {
        expect(ns[key], `${locale}.${key}`).toBe(EN[key]);
      }
    }
  });
});
