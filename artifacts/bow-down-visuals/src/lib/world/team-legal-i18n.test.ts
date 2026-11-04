import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import pt from "../../locales/pt.json";
import de from "../../locales/de.json";
import itJson from "../../locales/it.json";
import ar from "../../locales/ar.json";
import hi from "../../locales/hi.json";
import ja from "../../locales/ja.json";
import ko from "../../locales/ko.json";
import { COPYRIGHT_DISCLAIMER } from "./copyright-desk";
import { LLC_DISCLAIMER_BODY, LLC_DISCLAIMER_TITLE } from "./llc-desk";

/* ─── Stack100 locale unit 46 — Team/Legal desk family ─────────────
   The six World desks of the Team/Legal family (TeamDesk,
   TeamSeatsDesk, ContractAnalyzer, CopyrightDesk, LlcDesk,
   BriefDesk) ride the i18n catalogs: their own flat namespace
   worldTeamLegal (212 keys) plus REUSED catalog keys where the
   2D pages already carry the same words byte-for-byte
   (team.* for TeamDesk, settings.team* for TeamSeatsDesk,
   contracts.type.* for the analyzer's type labels,
   copyright.* + llcGuide.* for the legal desks).

   LOCALE HONESTY: the non-English worldTeamLegal values are
   agent-drafted and UNREVIEWED — a native pass is still owed.
   The 13 MONEY lines below state a price / fee / charge /
   no-charge fact: they carry the English source verbatim in
   EVERY catalog, figures by interpolation, never translated.

   CORE-CORRECTED STRINGS (join reconciliation): the certified
   stack1600 core corrected two TeamDesk strings to the earned-
   rank truth (Team Workspace = ★4 Shot Caller at 300 points,
   never purchasable). This unit extracts the BASE literals
   verbatim, so worldTeamLegal.teamTierGateNote and
   worldTeamLegal.teamCreateHint still carry the old base copy
   here; the join takes the core's corrected English and the
   translations of those two keys get re-drafted against it.

   Deliberately NOT extracted:
   - TEAM_TIER_GATE_MESSAGE (team-desk seam): the rail's own
     verbatim sentence from routes/teams.ts, pinned against the
     route by team-desk.test.ts — extracting it would fork the
     rail's words.
   - lib/group-profile-view.ts strings (groupKindLabel,
     buildSplitTerms): a shared lib used by the 2D page too —
     a follow-on unit owns it.
   - The shared NativeStates / NativeCard primitive copy —
     unit 51 (shared primitives).
   - Rail/enum tokens (feature names sent to the spend rail,
     status/role enums, BRIEF_ACTION_LABELS' seam keys stay as
     the EN mirror behind briefDigestStrings), data placeholders
     ("crown-duo", "https://…", "e.g. 2026-03-14"). */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const COMPONENTS = [
  "../../components/world/native/TeamDesk.tsx",
  "../../components/world/native/TeamSeatsDesk.tsx",
  "../../components/world/native/ContractAnalyzer.tsx",
  "../../components/world/native/CopyrightDesk.tsx",
  "../../components/world/native/LlcDesk.tsx",
  "../../components/world/native/BriefDesk.tsx",
];
const SEAMS = [
  "./team-desk.ts",
  "./team-seats-desk.ts",
  "./contract-analyzer.ts",
  "./copyright-desk.ts",
  "./llc-desk.ts",
  "./brief-desk.ts",
];

type Catalog = Record<string, unknown>;
const CATALOGS: Record<string, Catalog> = {
  en: en as Catalog,
  es: es as Catalog,
  fr: fr as Catalog,
  pt: pt as Catalog,
  de: de as Catalog,
  it: itJson as Catalog,
  ar: ar as Catalog,
  hi: hi as Catalog,
  ja: ja as Catalog,
  ko: ko as Catalog,
};

const nsOf = (cat: Catalog) =>
  (cat["worldTeamLegal"] ?? {}) as Record<string, string>;
const EN = nsOf(en as Catalog);
const EN_KEYS = Object.keys(EN);

/* The 13 money lines: en verbatim in all 10 catalogs. */
const MONEY_KEYS = [
  "teamOutOfCredits",
  "teamCreateHint",
  "teamNoteFunded",
  "teamNoteAlreadyFunded",
  "contractIntro",
  "contractOutOfCredits",
  "contractButton",
  "contractErrorShape",
  "copyrightDraftButton",
  "llcPlanButton",
  "briefSubtitle",
  "askButton",
  "outOfBucsLine",
];

const tokensOf = (v: string) =>
  [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe("unit 46 — the family is wired to the catalogs", () => {
  it("all six components translate through useTranslation", () => {
    for (const rel of COMPONENTS) {
      const src = read(rel);
      expect(src, rel).toContain('from "react-i18next"');
      expect(src, rel).toContain("useTranslation()");
    }
    // The two desks with a GuestGate subcomponent translate there too.
    expect(read(COMPONENTS[3]).match(/useTranslation\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read(COMPONENTS[4]).match(/useTranslation\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the namespace holds exactly 212 keys", () => {
    expect(EN_KEYS.length).toBe(212);
  });

  it("referenced keys == catalog keys (zero orphans, zero missing)", () => {
    const referenced = new Set<string>();
    for (const rel of [...COMPONENTS, ...SEAMS]) {
      const src = read(rel);
      for (const m of src.matchAll(/worldTeamLegal\.([A-Za-z0-9_]+)/g)) {
        referenced.add(m[1]);
      }
    }
    expect([...referenced].sort()).toEqual([...EN_KEYS].sort());
  });

  it("numbers and dates format with i18n.language, never bare", () => {
    for (const rel of COMPONENTS) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/\.toLocaleString\(\)/);
      expect(src, rel).not.toMatch(/\.toLocaleDateString\(\)/);
    }
    expect(read(COMPONENTS[0])).toContain("i18n.language");
    expect(read(COMPONENTS[2])).toContain("i18n.language");
    expect(read(COMPONENTS[5])).toContain("i18n.language");
  });
});

describe("unit 46 — all 10 catalogs carry the family", () => {
  it("every catalog carries exactly the en key set, nothing empty", () => {
    for (const [loc, cat] of Object.entries(CATALOGS)) {
      const ns = nsOf(cat);
      expect(Object.keys(ns).sort(), loc).toEqual([...EN_KEYS].sort());
      for (const k of EN_KEYS) {
        expect(typeof ns[k], `${loc}.${k}`).toBe("string");
        expect(ns[k].length, `${loc}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolation tokens match en per key per locale", () => {
    for (const [loc, cat] of Object.entries(CATALOGS)) {
      if (loc === "en") continue;
      const ns = nsOf(cat);
      for (const k of EN_KEYS) {
        expect(tokensOf(ns[k]), `${loc}.${k}`).toEqual(tokensOf(EN[k]));
      }
    }
  });

  it("the 13 money lines are byte-identical English in every catalog", () => {
    for (const [loc, cat] of Object.entries(CATALOGS)) {
      const ns = nsOf(cat);
      for (const k of MONEY_KEYS) {
        expect(ns[k], `${loc}.${k}`).toBe(EN[k]);
      }
    }
  });
});

describe("unit 46 — en fidelity pins", () => {
  it("the core-corrected strings still carry the BASE literals here", () => {
    // Join reconciliation: the core's corrected English wins there
    // and these two keys' translations get re-drafted against it.
    expect(EN.teamTierGateNote).toBe(
      "The Team Workspace — a shared Visual Buc pool, member roles and shared vaults — comes with the Shot Caller tier and up. Plans live at the Plans desk in the Treasury.",
    );
    expect(EN.teamCreateHint).toContain("Included with Shot Caller ($199/mo)");
  });

  it("the contract framing keeps its not-legal-advice words", () => {
    expect(EN.contractIntro).toContain("An AI reading,");
    expect(EN.contractIntro).toContain("not legal advice");
  });

  it("the copyright disclaimer equals the seam's verbatim text", () => {
    expect(EN.copyrightDisclaimer).toBe(COPYRIGHT_DISCLAIMER);
  });

  it("the LLC disclaimer composes byte-identically from the reused page keys", () => {
    const llc = (en as Catalog)["llcGuide"] as Record<string, string>;
    // The desk renders title + body with no extra space; the
    // catalog body carries the separating space, exactly like
    // the seam's "TITLE + ' ' + BODY" composition.
    expect(llc.disclaimerTitle).toBe(LLC_DISCLAIMER_TITLE);
    expect(llc.disclaimerTitle + llc.disclaimerBody).toBe(
      `${LLC_DISCLAIMER_TITLE} ${LLC_DISCLAIMER_BODY}`,
    );
  });
});
