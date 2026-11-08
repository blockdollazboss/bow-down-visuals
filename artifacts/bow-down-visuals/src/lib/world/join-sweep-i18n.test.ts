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

/* ─── Stack 100 phase-2 JOIN SWEEP — the branch-only strings of
   the wave desks speak through the catalogs (worldJoinSweep).

   Repair #6 of the phase-2 join checklist: five surfaces landed
   in the waves with English-only literals because the locale
   units (36–54) ran off the base tree, before these desks
   existed. This namespace carries exactly those strings:

   - HookDesk TITLES + SCRIPTS benches (wave 5, item 30): the
     two benches' form labels, the packaging note, the results
     chrome (readiness line, Description/tags, the hook header,
     On screen / B-roll lines, Retention beats, CTA, Teleprompter)
     and the two empty-result notes. The benches' tab + run labels
     were already carried in worldCreateMedia during the join
     (hookModeTitles/hookModeScripts/hookRunTitles/hookRunScripts).
   - CoachPlanLadder (wave 5, item 31): the ladder chrome, the
     standing line's fragments, card chrome, the embedded-door
     and tier-change panels' labels, and the honest stop notes.
     Prices interpolate from CREATOR_PLANS / ladderPriceLabel
     (the seam's en money record — "Free" / "$N/mo" — composed
     from plan data, left with its seam like every unit's
     seam-composed money label).
   - ShopDomainSection (wave 5, item 29): the shop-domain
     section inside ShopStands — attach/verify/detach logic
     notes, DNS card labels, detach confirm row. The rail's own
     answers (server messages, DNS steps, pending reasons) are
     data and stay verbatim from the rail.
   - LibraryDesk breadth (wave 4, item 26): the desk chrome,
     tab + kind labels (resolved through key maps; the seam
     records LIBRARY_BREADTH_LABELS / WISHLIST_KIND_LABELS stay
     the English defaults), preset/font search + empty states,
     favorites aria labels, wishlist states and notes. The
     seam's wishlistDropLine takes the wording as an optional
     template ("{{amount}}" is its money format) with the
     English line as default — byte-identical for other callers.
     Preset/font catalog data (names, blurbs, categories, font
     specimens) is the 2D page's data and stays with it.
   - ThemePacksDesk shared-look banner (unit 53's observation):
     the three banner sentences; the pack NAME still resolves
     through worldThemePacks inside the banner's <strong>.

   MONEY LAW: 17 keys state a price, fee, charge, refund or
   no-charge fact and are byte-identical English in ALL TEN
   catalogs (MONEY_KEYS below) — the two HookDesk refund notes,
   the ladder intro (flat 5% fee), the door note (nothing was
   charged), both plan-now lines, the payment-pending fallback,
   the standing line's fee + boosts fragments, the card fee
   line, the glide note, Cancel — no charge, the domain intro
   (Free — no Visual Bucs), the wishlist saved/now line and
   drop-line template, and the banner's premium (1,000 VB) and
   included sentences. Figures in the rest interpolate
   ({{feePct}}, {{boosts}}, {{saved}}, {{now}}, {{amount}},
   {{price}} via ladderPriceLabel).

   EN FIDELITY: every en value was verified mechanically against
   the pre-sweep component sources (join report, repair #6):
   all 116 values' static fragments appear verbatim there
   (JSX &rsquo; entities render as ’ in the seven values that
   came from entity text; whitespace normalized for JSX line
   wraps). EN_VERBATIM below locks the money + composition
   keys in this pin.

   DATES: the ladder's period-end date now formats with
   i18n.language (was a hard-coded "en-US").

   All non-English values in worldJoinSweep are AGENT-DRAFTED
   and UNREVIEWED — no native speaker has checked them. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const NS = "worldJoinSweep";
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

const SOURCES = [
  "../../components/world/native/HookDesk.tsx",
  "../../components/world/native/CoachPlanLadder.tsx",
  "../../components/world/native/ShopStands.tsx",
  "../../components/world/native/LibraryDesk.tsx",
  "../../components/theme-packs/ThemePacksDesk.tsx",
];

const MONEY_KEYS = [
  "tsbEmptyTitles", "tsbEmptyScript",
  "coachIntro", "coachDoorNote", "coachNowLine", "coachPaymentPending",
  "coachPaidLine", "coachStandingFee", "coachStandingBoosts",
  "coachFeeBoostLine", "coachGlideNote", "coachCancelNoCharge",
  "domainIntro", "libSavedNowLine", "libDropLine",
  "packBannerPremium", "packBannerIncluded",
];

/** Money + composition keys whose English is locked verbatim here. */
const EN_VERBATIM: Record<string, string> = {
  tsbEmptyTitles: "The titles came back empty — a failed make is refunded. Try again.",
  tsbEmptyScript: "The script came back empty — a failed make is refunded. Try again.",
  coachIntro: "The same ladder as Creator Plans, read from the one pricing source: every tier sells at the same flat 5% platform fee, and paid tiers earn their keep with features — pro analytics, more AI promotion boosts. Upgrading happens right here in the palace: the card form opens in this desk, never on a hosted page.",
  coachDoorNote: "Plan checkout isn't switched on inside the World right now — your plan is unchanged and nothing was charged.",
  coachNowLine: "Your plan is now {{name}} — switched in place on the same subscription.",
  coachPaymentPending: "Your payment went through — we're still applying your plan. Give it a moment, then check your standing here again.",
  coachPaidLine: "You're {{name}} now. Your plan is active — paid right here, no detour.",
  coachStandingFee: " — flat {{feePct}} platform fee",
  coachStandingBoosts: ", {{boosts}} AI promotion boosts a month",
  coachFeeBoostLine: "{{feePct}} platform fee · {{boosts}} AI promotion boosts / month",
  coachGlideNote: "Leaving a paid plan is a glide, not a switch — your tier holds to the end of the period, then returns to Free.",
  coachCancelNoCharge: "Cancel — no charge",
  coachRetryLoad: "Couldn’t load plans — tap to retry",
  domainIntro: "Point your own domain at your shop. You’ll add one TXT record to prove ownership. Free — no Visual Bucs; the rail checks that your plan covers shops when you connect, same as the website.",
  libSavedNowLine: "Saved at {{saved}} · Now {{now}}",
  libDropLine: "Down {{amount}} since you saved it",
  packBannerPremium: "This pack is premium: the preview is free, owning it is still 1,000 VB — the sender's link never bypasses the price.",
  packBannerIncluded: "This pack is included — apply it any time.",
  packBannerPreviewStart: "You're previewing a shared look — ",
  packBannerPreviewEnd: " wearing the sender's exact customization mix.",
  coachYouAreOn: "You’re on",
  coachStandingPeriod: " · current period runs to {{date}}",
  tsbTagsLabel: "tags: ",
};

const tokensOf = (value: string): string[] => {
  const found = value.match(/\{\{[A-Za-z0-9_]+\}\}/g) ?? [];
  return [...found].sort();
};
const digitsOf = (value: string): string[] => value.match(/[0-9][0-9,]*/g) ?? [];

describe("join sweep — the branch-only desk strings resolve through the catalog", () => {
  it("the en namespace carries the full sweep set (116 keys)", () => {
    expect(Object.keys(EN)).toHaveLength(116);
  });

  it("referenced keys == catalog keys (zero orphans, zero missing) across the five surfaces", () => {
    const joined = SOURCES.map(read).join("\n");
    const referenced = new Set([...joined.matchAll(/worldJoinSweep\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    expect([...referenced].sort()).toEqual(Object.keys(EN).sort());
  });

  it("the money + composition English is locked verbatim", () => {
    for (const [key, value] of Object.entries(EN_VERBATIM)) {
      expect(EN[key], key).toBe(value);
    }
  });

  it("the wired surfaces carry no leftover bench literals", () => {
    const hook = read("../../components/world/native/HookDesk.tsx");
    expect(hook).not.toContain("The titles came back empty");
    expect(hook).not.toContain("The script came back empty");
    expect(hook).not.toContain('label="Platform"');
    expect(hook).not.toContain("Ten click-ranked titles");
    const coach = read("../../components/world/native/CoachPlanLadder.tsx");
    expect(coach).not.toContain("Your creator plan — the full ladder");
    expect(coach).not.toContain("nothing was charged");
    expect(coach).not.toContain('toLocaleDateString("en-US"');
    expect(coach).toContain("toLocaleDateString(i18n.language");
    const stands = read("../../components/world/native/ShopStands.tsx");
    expect(stands).not.toContain("Type the domain you want to connect first.");
    expect(stands).not.toContain("Reconnect for a fresh token");
    const library = read("../../components/world/native/LibraryDesk.tsx");
    expect(library).not.toContain("Nothing on your wishlist yet");
    expect(library).toContain('wishlistDropLine(entry, t("worldJoinSweep.libDropLine"))');
    const packs = read("../../components/theme-packs/ThemePacksDesk.tsx");
    expect(packs).not.toContain("This pack is premium:");
    expect(packs).toContain('t("worldJoinSweep.packBannerPremium")');
  });

  it("the drop-line seam keeps its English default and takes the template", () => {
    const seam = read("./library-desk.ts");
    expect(seam).toContain('template = "Down {{amount}} since you saved it"');
    expect(seam).toContain('template.replace("{{amount}}", wishlistMoney(view.droppedCents))');
  });
});

describe("join sweep — all ten catalogs carry the family whole", () => {
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

  it("the 17 money lines are byte-identical English in every catalog", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const key of MONEY_KEYS) {
        expect(catalog[NS][key], `${locale}.${key}`).toBe(EN[key]);
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

  it("leading/trailing spaces match the English per key", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "en") continue;
      const ns = catalog[NS];
      for (const [key, enValue] of Object.entries(EN)) {
        expect(ns[key].startsWith(" "), `${locale}.${key} leading`).toBe(enValue.startsWith(" "));
        expect(ns[key].endsWith(" "), `${locale}.${key} trailing`).toBe(enValue.endsWith(" "));
      }
    }
  });
});
