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

/* ─── Stack 100 FINAL LOCALE REMAINDER — the nine wave desks'
   English-only strings speak through the catalogs
   (worldDeskRemainder, 685 keys).

   The join2 report's named deferral: the desks that landed in
   the waves after the locale units (36–54) ran — LiveDesk,
   LiveCopilotDesk, AnalyticsDesk, PublishDesk,
   WebsiteBuilderDesk, TourDesk, VideoTemplateBench, GamersDesk,
   TemplatesDesk — carried ~254 measured English literal lines.
   This namespace carries those strings plus the seam bundles
   the desks consume (tour-desk / publish-desk /
   website-builder-desk optional-string seams with byte-identical
   English defaults, song-requests' upfrontRuleLines /
   requestStatusLabel strings, live-desk's noise/voice held-note
   strings, analyticsTimeAgo's strings and formatAnalyticsCount's
   locale parameter).

   MONEY LAW: 59 keys state a charge, fee, price, refund or
   no-charge fact and are byte-identical English in ALL TEN
   catalogs (MONEY_KEYS below). Prices interpolate from the
   registry/constants the desks already read — no number changed,
   no copy invented: every en value is the literal the desk
   rendered before this unit (JSX &rsquo; entities render as ’,
   per the standing pin convention).

   All non-English values in worldDeskRemainder are
   AGENT-DRAFTED and UNREVIEWED — no native speaker has checked
   them. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const NS = "worldDeskRemainder";
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
  "../../components/world/native/TemplatesDesk.tsx",
  "../../components/world/native/GamersDesk.tsx",
  "../../components/world/native/TourDesk.tsx",
  "../../components/world/native/VideoTemplateBench.tsx",
  "../../components/world/native/PublishDesk.tsx",
  "../../components/world/native/WebsiteBuilderDesk.tsx",
  "../../components/world/native/LiveCopilotDesk.tsx",
  "../../components/world/native/AnalyticsDesk.tsx",
  "../../components/world/native/LiveDesk.tsx",
];

const MONEY_KEYS = [
  "anlAuditButton",
  "anlAuditFailed",
  "anlCoachFailed",
  "anlCoachTitle",
  "anlCompetitorButton",
  "anlCompetitorFailed",
  "anlFeatureCost",
  "anlGrowthIntro",
  "anlGrowthPlanFailed",
  "anlIntro",
  "anlOutOfCredits",
  "anlOverviewTitle",
  "anlViralityButton",
  "anlViralityFailed",
  "bldApplyEdit",
  "bldBuildButton",
  "bldEditFailed",
  "bldEditsIntro",
  "bldFeeNote",
  "bldGenerationFailed",
  "bldIntro",
  "bldOutOfCredits",
  "copBuildPrep",
  "copCutCancelled",
  "copCutIt",
  "copCutNotEnough",
  "copOutOfCredits",
  "copSpotClips",
  "gamGenerate",
  "gamOutOfCredits",
  "gamPriceLine",
  "liveSrCloseQueueRefund",
  "liveSrDeskIntro",
  "liveSrNotLiveNote",
  "liveSrRequestedBy",
  "liveSrRuleMinTip",
  "liveSrSkipRefund",
  "liveSrStatusEndedRefunded",
  "liveSrStatusSkippedRefunded",
  "pubFooter",
  "pubIntro",
  "pubPriceDownload",
  "pubPriceFree",
  "pubPricePlaceholder",
  "tourIntro",
  "tourOptimizeButton",
  "tourOptimizerLine",
  "tourOptimizerRefunded",
  "tourOutOfCredits",
  "tourPlanUnusable",
  "tplFreeLine",
  "tplVideoPrice",
  "vtbApply",
  "vtbIntro",
  "vtbLoadFailedMessage",
  "vtbOutOfCredits",
  "vtbReachFailed",
  "vtbRefundSuffix",
  "vtbRenderDidntStart"
];

/** The money English, locked verbatim here. */
const EN_VERBATIM: Record<string, string> = {
  "tplVideoPrice": "Browsing is free. Applying a video template costs {{cost}} Visual Bucs — you're asked to confirm before anything is charged, and a render that fails is refunded.",
  "tplFreeLine": "Browsing and opening are free — each desk prices its own makes.",
  "gamPriceLine": "AI powered · {{count}} Visual Bucs per idea pack",
  "gamGenerate": "Generate ideas · {{count}} Visual Bucs",
  "gamOutOfCredits": "You're out of Visual Bucs — top up to keep generating stream ideas.",
  "tourIntro": "Your tour dates, kept here and on the website — one list. Dates are free; the AI route + budget plan is {{cost}} Visual Bucs.",
  "tourOptimizerLine": "The smart order for your stops plus a full budget breakdown — {{cost}} Visual Bucs per plan.",
  "tourOptimizeButton": "Optimize {{count}} stops · {{cost}} Visual Bucs",
  "tourOutOfCredits": "You’re out of Visual Bucs — top up at the Visual Buc Packs desk in the Treasury and the optimizer is ready again.",
  "tourOptimizerRefunded": "The tour optimizer hiccupped — any charge was refunded. Try again.",
  "tourPlanUnusable": "The plan came back unusable — your Visual Bucs were refunded. Try again.",
  "vtbIntro": "Pick a template, drop in your clips and photos, and get an auto-edited video — {{cost}} Visual Bucs per apply, confirmed before anything charges. A render that fails is refunded.",
  "vtbLoadFailedMessage": "The video templates didn't answer. Nothing was charged — try the catalog again.",
  "vtbReachFailed": "Couldn't reach the render — nothing was charged. Try again.",
  "vtbOutOfCredits": "You're out of Visual Bucs — grab a pack and this template is yours.",
  "vtbRenderDidntStart": "The render didn't start — nothing was charged. Try again.",
  "vtbRefundSuffix": " The {{cost}} Visual Bucs for this render were refunded.",
  "vtbApply": "Make my video — {{cost}} Visual Bucs",
  "pubIntro": "Your tracks and videos, live on your profile or saved as drafts — the same library as the website’s Publish page. Publishing your own work is free; a track’s download price is your price for your buyers.",
  "pubPricePlaceholder": "Download price $ — blank is free",
  "pubFooter": "Publishing is free — no Visual Bucs. Files up to 80 MB; artwork up to {{artworkMb}} MB.",
  "pubPriceFree": "Free download",
  "pubPriceDownload": "${{amount}} download",
  "bldIntro": "Describe your site, the AI builds the complete package — pages, styles, and a deploy guide. A build costs {{buildCost}} Visual Bucs, named again before anything charges; each follow-up edit is {{editCost}} Bucs. Preview it privately here, download the zip, and host it on your own domain.",
  "bldBuildButton": "Build my site — {{cost}} Visual Bucs",
  "bldEditsIntro": "\"Make the hero section darker\", \"change the headline to…\", \"use warmer colors\" — each edit regenerates the site at {{cost}} Visual Bucs.",
  "bldApplyEdit": "Apply edit — {{cost}} Visual Bucs",
  "bldOutOfCredits": "Not enough Visual Bucs for that — nothing was charged. Top up at the Treasury and try again.",
  "bldGenerationFailed": "Generation failed — Visual Bucs were refunded.",
  "bldEditFailed": "Edit failed — Visual Bucs were refunded.",
  "bldFeeNote": "One-time fee. You preview before anything is final, and you own the files outright.",
  "copBuildPrep": "Build My Prep ({{cost}} VB)",
  "copSpotClips": "Spot the Clips ({{cost}} VB)",
  "copOutOfCredits": "Not enough Visual Bucs for that Copilot run — nothing was charged. Top up at the Treasury and try again.",
  "copCutIt": "Cut it · {{cost}} VB",
  "copCutCancelled": "Cut cancelled — nothing was charged.",
  "copCutNotEnough": "Not enough Visual Bucs for that cut — the proposal stays right here.",
  "anlIntro": "The depth tools from your Analytics Hub, right here at the board: a full channel audit, a pre-flight score for your next post, plain-English reads on your connected numbers, a growth plan from your own stats, a competitor read, and a coach for your posts. Every price is named before anything charges — and on these rails a failed run refunds itself.",
  "anlOverviewTitle": "Connected accounts — live numbers (free)",
  "anlFeatureCost": "{{feature}} — {{cost}} Bucs",
  "anlGrowthIntro": "Your own per-platform numbers — the same set your website Analytics Hub keeps, so editing here edits there. Saving is free; the plan written from them costs {{cost}} Bucs.",
  "anlAuditButton": "Run the audit — {{cost}} Bucs",
  "anlViralityButton": "Score this post — {{cost}} Bucs",
  "anlCompetitorButton": "Read this competitor — {{cost}} Bucs",
  "anlCoachTitle": "AI Coach — {{cost}} Bucs",
  "anlOutOfCredits": "Not enough Visual Bucs for that — nothing was charged. Top up at the Treasury and try again.",
  "anlGrowthPlanFailed": "The Growth Plan couldn't be written — if the rail took your Bucs they come back on failure. Try again.",
  "anlAuditFailed": "The audit couldn't be run — if the rail took your Bucs they come back on failure. Try again.",
  "anlViralityFailed": "The pre-flight check couldn't be scored — if the rail took your Bucs they come back on failure. Try again.",
  "anlCompetitorFailed": "The competitor read couldn't be built — if the rail took your Bucs they come back on failure. Try again.",
  "anlCoachFailed": "The coach couldn't read your numbers — if the rail took your Bucs they come back on failure. Try again.",
  "liveSrStatusSkippedRefunded": "Skipped by the creator · tip refunded",
  "liveSrStatusEndedRefunded": "Stream ended before it played · tip refunded",
  "liveSrRuleMinTip": "This creator's minimum tip for a request is {{amount}}.",
  "liveSrRequestedBy": "Requested by {{name}} · {{tip}} tip",
  "liveSrSkipRefund": "Skip · refund",
  "liveSrDeskIntro": "Set your rules before you go live — fans see them, and the refund deal, up front before anyone tips.",
  "liveSrCloseQueueRefund": "Close queue · refund the line",
  "liveSrNotLiveNote": "You’re not live right now — your queue controls appear here while you stream. Ending a stream automatically refunds every request that never played."
};

const tokensOf = (value: string): string[] => {
  const found = value.match(/\{\{[A-Za-z0-9_]+\}\}/g) ?? [];
  return [...found].sort();
};
const digitsOf = (value: string): string[] => value.match(/[0-9][0-9,]*/g) ?? [];

describe("desk remainder — the nine wave desks resolve through the catalog", () => {
  it("the en namespace carries the full remainder set (685 keys)", () => {
    expect(Object.keys(EN)).toHaveLength(685);
  });

  it("referenced keys == catalog keys (zero orphans, zero missing) across the nine desks", () => {
    const joined = SOURCES.map(read).join("\n");
    const referenced = new Set([...joined.matchAll(/worldDeskRemainder\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    /* The label key maps (GamersDesk, TourDesk, PublishDesk,
       WebsiteBuilderDesk) store bare key suffixes and compose the
       full key at the call site — count a quoted literal that is
       exactly a catalog key as a reference. */
    for (const m of joined.matchAll(/"([A-Za-z0-9_]+)"/g)) {
      if (Object.prototype.hasOwnProperty.call(EN, m[1])) referenced.add(m[1]);
    }
    expect([...referenced].sort()).toEqual(Object.keys(EN).sort());
  });

  it("the money English is locked verbatim", () => {
    for (const [key, value] of Object.entries(EN_VERBATIM)) {
      expect(EN[key], key).toBe(value);
    }
  });

  it("the wired desks carry no leftover literals from the census set", () => {
    const live = read("../../components/world/native/LiveDesk.tsx");
    expect(live).not.toContain("Song Requests — your queue desk");
    expect(live).not.toContain("Close queue · refund the line");
    expect(live).not.toContain("Camera &amp; voice");
    expect(live).not.toContain("Adds scene to Preview");
    const copilot = read("../../components/world/native/LiveCopilotDesk.tsx");
    expect(copilot).not.toContain('aria-label="Stream Copilot mode"');
    expect(copilot).not.toContain("Cut it ·");
    const analytics = read("../../components/world/native/AnalyticsDesk.tsx");
    expect(analytics).not.toContain("Connected accounts — live numbers (free)");
    expect(analytics).not.toContain("Grading your channel…");
    const publish = read("../../components/world/native/PublishDesk.tsx");
    expect(publish).not.toContain("Publishing is free — no Visual Bucs");
    const builder = read("../../components/world/native/WebsiteBuilderDesk.tsx");
    expect(builder).not.toContain("Build my site —");
    const tour = read("../../components/world/native/TourDesk.tsx");
    expect(tour).not.toContain("The smart order for your stops");
  });

  it("the seam bundles keep byte-identical English defaults", () => {
    const tour = read("./tour-desk.ts");
    expect(tour).toContain("TOUR_DRAFT_ERROR_DEFAULTS");
    const publish = read("./publish-desk.ts");
    expect(publish).toContain("PUBLISH_DRAFT_ERROR_DEFAULTS");
    expect(publish).toContain("PUBLISH_FILE_ERROR_DEFAULTS");
    expect(publish).toContain("PUBLISH_PRICE_LABEL_DEFAULTS");
    const builder = read("./website-builder-desk.ts");
    expect(builder).toContain("WEBSITE_SOURCE_LABEL_DEFAULTS");
    const songRequests = read("../../lib/song-requests.ts");
    expect(songRequests).toContain("UPFRONT_RULE_DEFAULTS");
    expect(songRequests).toContain("REQUEST_STATUS_DEFAULTS");
    expect(songRequests).toContain("catalogOnly:");
    expect(songRequests).toContain("Requests come from this creator");
    const liveDesk = read("./live-desk.ts");
    expect(liveDesk).toContain("NOISE_HELD_DEFAULTS");
    expect(liveDesk).toContain("VOICE_EFFECT_HELD_DEFAULTS");
    expect(liveDesk).toContain('CAMERA_VOICE_OPENING_NOTE = "Noise cancellation starts with the camera."');
    const analytics = read("./analytics-desk.ts");
    expect(analytics).toContain("ANALYTICS_TIME_AGO_DEFAULTS");
  });
});

describe("desk remainder — all ten catalogs carry the family whole", () => {
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

  it("the 59 money lines are byte-identical English in every catalog", () => {
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
