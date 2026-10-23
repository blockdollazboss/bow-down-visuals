/**
 * locale-numeric-parity.test.ts — numbers in translated copy are FACTS
 * (Stack-24 numeric-drift lane, Oct 22 2026).
 *
 * Prices, prize amounts, credit costs and counts are facts, not flavor:
 * when en says a song costs 400 Visual Bucs, the French leaf may not say
 * 100. The catalogs were re-based ×100 (Visual Bucs hundreds) and most
 * translations followed, but a stale layer never did — the drift lane
 * found 500 numeric mismatches across the nine non-en catalogs and
 * corrected 202 leaves where the translation's number was a stale or
 * dropped FACT (÷100 studio costs, a 100-VB jackpot where en promises
 * 10,000, a referral bonus of "10 credits" where en grants 1,000, a
 * Hook Studio note that lost its "per 100 Visual Bucs", badges quoting
 * 100/200 VB against en's 400, a 75-VB scheduler quoting 100, …).
 *
 * This suite pins the repaired state: for every leaf present in both en
 * and a translation, the canonical numeric-token multiset must match —
 * unless the key sits on that locale's explicit allowlist below. The
 * tokenizer canonicalizes the legitimate notation differences so they
 * need NO allowlist entry: native digits (Arabic-Indic, Devanagari,
 * fullwidth), thousands grouping (1,000 / 1.000 / 1 000), decimal
 * separators, K/M magnitude suffixes (but not units: 80MB ≠ 80M),
 * space-separated "k" (fr "100 k"), unit words (million/mil/mille,
 * ar ألف, ja 万/億/千, ko 만/억/천 — so "50k" == "5万" == "50 ألف" ==
 * "50 mil"), durations (3:30), and {{placeholder}} spans are skipped.
 *
 * What remains on the allowlist is only what a tokenizer cannot prove:
 * quantities one side spells in words (Arabic duals واحد/دقيقتان,
 * ja/ko numeralizing en's "one/first/four", fr "trois"), per-unit
 * counter 1s (ja "1曲あたり" for "per song"), idioms ("pure" rendered
 * as "100 %"), the 24k karat, counts split across sibling keys — each
 * entry was read and verified value-equal by the drift lane — plus a
 * small AMBIGUOUS set the lane deliberately did NOT touch (a dropped
 * "Creator Level 6" fact; two home.studio elements whose text belongs
 * to the old tool lineup). The stale-entry test below fails if an
 * allowlisted key ever stops mismatching, so the list cannot rot.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LOCALES = ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"] as const;

type Catalog = Record<string, unknown>;

function load(locale: string): Catalog {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Catalog;
}

function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (Array.isArray(o)) {
    o.forEach((v, i) => flat(v, p ? `${p}.${i}` : `${i}`, out));
  } else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      flat(v, p ? `${p}.${k}` : k, out);
    }
  } else if (typeof o === "string") {
    out[p] = o;
  }
  return out;
}

/* ---- numeric tokenizer (canonical multiset of numeric tokens) ---- */

function mapDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\uFF10-\uFF19]/g, (ch) => {
    const c = ch.codePointAt(0)!;
    if (c >= 0x660 && c <= 0x669) return String(c - 0x660);
    if (c >= 0x6f0 && c <= 0x6f9) return String(c - 0x6f0);
    if (c >= 0x966 && c <= 0x96f) return String(c - 0x966);
    return String(c - 0xff10);
  });
}

function stripPlaceholders(s: string): string {
  return s.replace(/\{\{[^}]*\}\}/g, " ").replace(/\{[^{}\s]*\}/g, " ");
}

function canon(raw: string): string {
  const t = raw.replace(/[\s\u00A0\u202F]/g, "");
  if (t.includes(":")) return "T:" + t.replace(/:+/g, ":");
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return String(parseInt(t.replace(/[.,]/g, ""), 10));
  if (/^\d+[.,]\d+$/.test(t)) return String(Number(t.replace(",", ".")));
  if (/^\d+$/.test(t)) return String(parseInt(t, 10));
  return t;
}

const CJK_UNITS: Record<string, number> = { "千": 1e3, "万": 1e4, "億": 1e8, "천": 1e3, "만": 1e4, "억": 1e8 };
const WORD_UNITS: [RegExp, number][] = [
  [/^\s*(?:millions?|millionen|milioni|millones|milhão|milhões|مليون)\b/i, 1e6],
  [/^\s*(?:mil|mille)\b/i, 1e3],
  [/^\s+ألف(?=[\s،,.؛]|$)/, 1e3],
  [/^\s+k\b/i, 1e3],
];

function numericTokens(str: string): string[] {
  let s = mapDigits(stripPlaceholders(str));
  // fold space-grouped thousands (10 000), but never into a K/M suffix (MP3 192k)
  s = s.replace(/\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?![\dKkMm])/g, (mch) => mch.replace(/[ \u00A0\u202F]/g, ""));
  const out: string[] = [];
  const re = /\d[\d.,:]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const raw = m[0].replace(/[.,:]+$/, "");
    if (!raw) continue;
    let rest = s.slice(m.index + m[0].length);
    let mult = 1;
    const suf = /^([KkMm])(?![A-Za-z])/.exec(rest);
    if (suf && !raw.includes(":")) {
      mult = suf[1].toLowerCase() === "k" ? 1e3 : 1e6;
      rest = rest.slice(1);
    } else {
      let cjk = 1;
      let i = 0;
      while (i < rest.length && CJK_UNITS[rest[i]]) { cjk *= CJK_UNITS[rest[i]]; i++; }
      if (i > 0) {
        mult = cjk;
        rest = rest.slice(i);
      } else {
        for (const [rx, f] of WORD_UNITS) {
          if (rx.test(rest)) { mult = f; break; }
        }
      }
    }
    let c = canon(raw);
    if (mult !== 1 && !c.startsWith("T:")) c = String(Number(c) * mult);
    out.push(c);
  }
  return out.sort();
}

/* ---- allowlist ---- */

const T_SPELL = "LEGIT: quantity spelled out in words in the translation — verified value-equal";
const T_NUM = "LEGIT: en spells the quantity in words; translation numeralizes it — verified value-equal";
const T_KARAT = "LEGIT: 24k is karat, not 24,000";
const T_SPLIT = "LEGIT: the count lives in the sibling split key (start/end compose one string)";
const T_PCT = "LEGIT: en's 'pure/outright' rendered as a 100% idiom";
const T_AMBIG_GATE = "AMBIGUOUS (left for a copy call): en's 'Creator Level 6' gate fact is absent — the translation describes Advanced mode instead";
const T_AMBIG_DRIFT = "AMBIGUOUS (left for a lineup call): home.studio element text belongs to the old tool lineup; its per-unit cost cell was left untouched";
const T_AMBIG_YEAR = "AMBIGUOUS (left for a copy call): en's 'year 1' marker is dropped in the translation";

function grouped(...groups: [string, string[]][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [tag, ks] of groups) for (const k of ks) out[k] = tag;
  return out;
}

const NUMERIC_ALLOWLIST: Record<string, Record<string, string>> = {
  ar: grouped(
    [T_SPELL, [
      "academy.next4Weeks", "admin.planDescription", "analytics.next3Moves", "analyticsHub.your3Moves",
      "audit.topPrioritiesTitle", "beatMaker.duration1m", "beatMaker.duration2m", "brandCalculator.perPostNote",
      "chooseArtist.emptyDescription", "coach.moneyMovesTitle", "coach.subtitle",
      "distribute.2_week_promo_plan", "distribute.release_timing_a_2_week_promo_pl", "distribute.tier.single.blurb",
      "guides.llc.bullet1", "hooks.yourHooks", "interviewPrep.typeRedCarpetBlurb", "liveGuests.expires1h",
      "liveGuests.perLink1", "llcGuide.feesSubtitle", "llcGuide.ongoingNote", "makeSong.length2min",
      "shows.bioPlaceholder", "smartClips.invalidTime", "songAndVideo.songLengthPlaceholder", "sounds.yourMatches",
      "storefrontBuilder.signInPrompt", "thumbnail.artStyle3DRender", "thumbnailMaker.styleBoldTextPopDesc",
      "titles.topicPlaceholder", "tour.needTwoDates", "tour.needTwoDatesUnlock", "tutorials.chapterOne",
      "videoEditor.labDesc", "videoEditor.labTitle", "videoEditor.railThreeSecondLab", "videoEditor.stepBackTitle",
      "videoEditor.stepForwardTitle", "videoEditor.styleStealerDescPh", "videoEditor.vibe_70s_film",
      "videoEditor.vibe_80s", "videoEditor.vibe_90s", "videoExport.oneClipWarning",
      "contentIntelligence.step2Eyebrow", "contentIntelligence.takeawaysTitle",
      "outreach.winsPlaceholder", "podcast.dialogue.errors.twoSpeakers",
      "wave8.hookRewriter.sub", "wave9.templates.previewHeadingOne",
    ]],
    ["LEGIT: counts spelled (واحد / dual forms) + ألف unit word — verified value-equal", [
      "beats.tierBasicBlurb", "beats.tierPremiumBlurb",
    ]],
    ["LEGIT: 2M spelled as the dual of million (مليوني) — verified value-equal", [
      "sponsorDealDetail.winsPlaceholder",
    ]],
    [T_KARAT, ["contests.e_g_24k_gold_chain_shoutout"]],
    [T_AMBIG_DRIFT, ["home.studio.1.tools.1.cost", "home.studio.2.tools.2.cost"]],
  ),
  de: grouped(
    ["LEGIT: 'first-year' numeralized as 'Jahr 1'", ["llcGuide.estimatedTotal"]],
    ["LEGIT: en's '1M' abbreviated as '1 Mio.' — verified value-equal", ["outreach.winsPlaceholder"]],
    ["LEGIT: en's '7pm' rendered on the 24-hour clock ('19 Uhr') — verified value-equal", ["press-kit.pressRelease.placeholders.topic"]],
    [T_AMBIG_YEAR, ["llcGuide.ongoingNote"]],
  ),
  es: grouped(
    [T_SPLIT, ["llcGuide.checklistTitleEnd", "llcGuide.checklistTitleStart"]],
    [T_AMBIG_DRIFT, ["home.studio.1.tools.1.cost", "home.studio.2.tools.2.cost"]],
  ),
  fr: grouped(
    ["LEGIT: en's '1M' abbreviated as '1 M' — verified value-equal", ["outreach.winsPlaceholder"]],
    ["LEGIT: en's '7pm' rendered on the 24-hour clock ('19 h') — verified value-equal", ["press-kit.pressRelease.placeholders.topic"]],
    [T_SPELL, ["home.studio.2.tools.1.description", "llcGuide.ongoingNote", "tour.needTwoDates", "videoExport.oneClipWarning"]],
    [T_PCT, ["beatMaker.sequencerNote", "brandingShop.fulfillmentText"]],
    [T_KARAT, ["contests.e_g_24k_gold_chain_shoutout"]],
    [T_AMBIG_GATE, ["beatMaker.gateTitle"]],
    [T_AMBIG_DRIFT, ["home.studio.1.tools.1.cost", "home.studio.2.tools.2.cost"]],
  ),
  hi: grouped(
    [T_AMBIG_DRIFT, ["home.studio.1.tools.1.cost", "home.studio.2.tools.2.cost"]],
  ),
  it: grouped(
    ["LEGIT: en's '7pm' rendered on the 24-hour clock ('19:00') — verified value-equal", ["press-kit.pressRelease.placeholders.topic"]],
    [T_SPLIT, ["llcGuide.checklistTitleEnd", "llcGuide.checklistTitleStart"]],
    [T_PCT, ["websiteBuilder.feeNote", "websiteBuilder.ownershipStrong"]],
    [T_AMBIG_DRIFT, ["home.studio.1.tools.1.cost", "home.studio.2.tools.2.cost"]],
  ),
  pt: grouped(
    ["LEGIT: en's '7pm' rendered on the 24-hour clock ('19h') — verified value-equal", ["press-kit.pressRelease.placeholders.topic"]],
    [T_SPELL, ["collabs.matchDescription"]],
    [T_SPLIT, ["llcGuide.checklistTitleEnd", "llcGuide.checklistTitleStart"]],
    [T_PCT, ["brandingShop.fulfillmentText"]],
    [T_AMBIG_DRIFT, ["home.studio.1.tools.1.cost", "home.studio.2.tools.2.cost"]],
  ),
  ja: grouped(
    [T_NUM, [
      "academy.coachHeader", "academy.errorPickPlatform", "academy.heroSubtitle", "academy.lessonsHeader",
      "academy.pathCostNote", "admin.bowRaceDescription", "admin.bowRaceFooterNote", "admin.jackpot.footerNote",
      "analytics.errorNoPlatforms", "analyticsHub.acrossPlatforms", "analyticsHub.heroSubtitle",
      "analyticsHub.pageDescription", "artistVault.identityFull", "artistVault.wardrobeFull",
      "audit.recentPostsOptional", "beats.emptyBrowse", "beats.templatesEmpty", "betaAccess.perkEarlyAccessBody",
      "brandCalculator.contentTypes.dedicatedVideo.blurb", "brandCalculator.contentTypes.sponsoredPost.blurb",
      "brandCalculator.costBadge", "brandDeals.errorDealTypes", "brandDeals.errorPlatforms",
      "brandingShop.designingHint", "brandingShop.errorProducts", "brandingShop.studioSubtitle",
      "clipMaker.errorNoSelection", "coach.costPerPlan", "coach.errorNoPlatform", "collabs.bioPlaceholder",
      "commentReplies.commentsLabel", "commentReplies.errorNoComments", "community.paste_some_comments_first_one_pe",
      "content-calendar.pick_at_least_one_platform_to_pl", "contests.verify_at_least_one_entry_first",
      "dashboard.metaDescription", "distribute.validation.2", "email-list.per_draft", "extension.five_tabs",
      "extension.one_email_when_it_launches_no_sp", "features.every_ai_tool_a_creator_needs_ma",
      "features.pick_any_feature_above_and_gener", "gamers.the_content_creator_cheat_code_f", "guides.whySkillBody",
      "home.demo.pop.treatment.0", "home.featuresSubtitle", "hooks.creditNoteGeneration", "hooks.creditNoteScorecard",
      "hooks.hookGenSub", "hooks.hooksTip", "hooks.pfDescPlaceholder", "hooks.pfTitleLabel", "hooks.pfTitlePlaceholder",
      "hooks.videoType.tutorial.blurb", "interviewPrep.answerTooShort", "interviewPrep.practiceHint",
      "introsOutros.tagline", "jewelry.previewDesc", "liveGuests.chatEmptyHost", "locations.noLocations",
      "lyricVideo.alignHint", "lyricVideo.subtitle", "makeSong.usesCredits", "makeVideo.usesCredits",
      "myShop.domainHint", "nav.hourlyCrate", "paidSeries.previewNote", "retention.dailyBonus.freezeEarned",
      "retention.dailyBonus.freezesBanked", "retention.dailyDrop.subtitle", "retention.dropCatalog.blurb",
      "retention.dropCatalog.emptyArchived", "retention.drops.grow-on-tiktok-hook.description",
      "retention.drops.mixing-tips-hook.description", "retention.drops.photo-dump-montage.description",
      "retention.drops.product-promo-punch.description", "retention.drops.tour-announcement-hook.description",
      "retention.prefs.questsEnabled.desc", "retention.quest_export_video_desc", "retention.quest_generate_song_desc",
      "retention.quest_make_thumbnail_desc", "setlist.errorNeedSongs", "sfx.generateCardSubtitle",
      "shoutouts.noRequests", "shoutouts.perShoutout", "shows.errorNeedTypes", "songs.emptyLibrary",
      "sounds.matchCostNote", "stems.pageSubtitle", "stems.remixHint", "streamPack.pageSubtitle",
      "thumbnailMaker.costNote", "thumbnailMaker.headlinePlaceholder", "thumbnailMaker.selectedSummary",
      "tips.messagePlaceholder", "translate.languageRequired", "trends.platformRequiredError",
      "videoEditor.multiRatio.noRatioDesc", "videoEditor.multiRatio.subtitle", "videoEditor.myLibrary.foot",
      "videoEditor.pipNeedsClick", "videoEditor.screenRecorder.recordAnother", "videoEditor.subjectReframe.workingHint",
      "videoExport.dupBody", "videoExport.errIdenticalClips", "videoExport.toastDupDesc", "viralityCheck.costNote",
      "vocalRemoval.resultReady", "voiceover.pageDescription", "wave9.cameraMovePlanner.deckFallback",
      "wave9.cameraMovePlanner.noMove", "wave9.cameraMovePlanner.stackEmpty", "wave9.cameraMovePlanner.stackFull",
      "websiteBuilder.editsDesc",
      "captionSuite.pickLanguageFirst", "contentIntelligence.heroSubtitle", "contentIntelligence.reviewBlurb",
      "contentIntelligence.step1Blurb", "contentIntelligence.step4Blurb", "hubSpine.promoCards.blurb",
      "hubSpine.promoCards.generating", "outreach.fillRequired", "outreach.invoice.fillRequired",
      "outreach.invoice.listEmpty", "outreach.sponsorReadFillRequired", "podcast.dialogue.noSpeakersYet",
      "podcast.modes.dialogueBlurb", "podcast.script.placeholder", "press-kit.emptyKits",
      "press-kit.form.achievementsLabel", "press-kit.form.photoUrlsLabel",
      "press-kit.pressRelease.errors.missingFacts", "wave8.mediaKit.title", "wave8.thumbnailAb.compareNote",
      "wave8.thumbnailAb.subtitle", "wave9.characterDirector.castHint", "wave9.characterDirector.needShot",
      "wave9.characterDirector.needTwoCharacters", "wave9.directEdit.nothingSelected",
      "wave9.timeline.lyricsPlaceholder",
    ]],
    ["LEGIT: per-unit counter 1 made explicit (あたり) — the priced fact matches en — verified value-equal", [
      "captionSuite.langHint", "press-kit.pressRelease.costNote", "wave8.captionStyler.paceLabel",
    ]],
    ["LEGIT: en's 'week' is one week; ja makes the count explicit (1週間) — verified value-equal", [
      "wave8.calendar.autofill", "wave8.calendar.autofilling", "wave8.calendar.errorAutofill",
      "wave8.calendar.ghostCtaSub", "wave8.calendar.outOfCredits", "wave8.calendar.panelSub",
      "wave8.calendar.planMyWeek",
    ]],
    ["LEGIT: month name numeralized (November = 11月) — verified value-equal", ["press-kit.pressRelease.placeholders.fact"]],
    ["LEGIT: en's '7pm' rendered on the 24-hour clock (19時) and the date numeralized twice (10月10日) — verified value-equal", ["press-kit.pressRelease.placeholders.topic"]],
    ["LEGIT: 'after year 1' rendered as 'from the second year' (2年目以降) — the same boundary", ["llcGuide.ongoingNote"]],
    ["LEGIT: 'Year 1' spelled as first-year (初年度)", ["llcGuide.statYearOne"]],
    ["LEGIT: month name numeralized (September/October = 9/10)", ["terms.lastUpdated", "coach.newsBadge"]],
    ["LEGIT: 'quarter-second' numeralized as 0.25", ["videoExport.rangeTooShort"]],
    ["LEGIT: 'a couple' rendered as 2、3", ["collabs.templateCasualDmBody"]],
    ["LEGIT: prices corrected to 200/200 by the drift lane; the residual is per-unit counters (1回)", ["thumbnailTest.costNote"]],
    [T_AMBIG_DRIFT, ["home.studio.1.tools.1.cost", "home.studio.2.tools.2.cost"]],
  ),
  ko: grouped(
    [T_NUM, [
      "analyticsHub.acrossPlatforms", "brandCalculator.contentTypes.sponsoredPost.blurb", "brandingShop.designingHint",
      "brandingShop.errorProducts", "clipMaker.errorNoSelection", "coach.earnsMost",
      "discord-bot.3_one_time_setup_checklist", "distribute.validation.2", "guides.whySkillBody",
      "home.featuresSubtitle", "hooks.hookGenSub", "hooks.hooksTip", "llcGuide.checklist5Detail", "llcGuide.faq4A",
      "llcGuide.feesSubtitle", "retention.drops.grow-on-tiktok-hook.description",
      "retention.drops.product-promo-punch.description", "retention.prefs.questsEnabled.desc",
      "retention.quest_export_video_desc", "retention.quest_generate_song_desc", "retention.quest_make_thumbnail_desc",
      "retention.streakWidget.atRiskSub", "shows.errorNeedTypes", "sponsorsPost.costNote", "stems.remixHint",
      "terms.section6Body", "thumbnailMaker.selectedSummary", "tour.budgetFood", "translate.languageRequired",
      "trends.platformRequiredError", "videoEditor.subjectReframe.workingHint", "vocalRemoval.resultReady",
      "contentIntelligence.step1Blurb", "hubSpine.promoCards.generating", "podcast.script.placeholder",
    ]],
    ["LEGIT: per-unit counter 1 made explicit (1건당) — the priced fact matches en — verified value-equal", ["press-kit.pressRelease.costNote"]],
    ["LEGIT: month name numeralized (November = 11월) — verified value-equal", ["press-kit.pressRelease.placeholders.fact"]],
    ["LEGIT: the date numeralized twice (10월 10일); en's '7pm' kept as 오후 7시 — verified value-equal", ["press-kit.pressRelease.placeholders.topic"]],
    ["LEGIT: 'first-year' numeralized as 1년차", ["llcGuide.estimatedTotal", "llcGuide.estimatorTitle"]],
    ["LEGIT: month name numeralized (September/October = 9/10)", ["terms.lastUpdated", "coach.newsBadge"]],
    ["LEGIT: 'quarter-second' numeralized as 0.25", ["videoExport.rangeTooShort"]],
    ["LEGIT: 'three-quarter' numeralized as the fraction 3/4", [
      "artistVault.identityAngleThreeQuarterLeft", "artistVault.identityAngleThreeQuarterRight",
    ]],
    [T_AMBIG_GATE, ["beatMaker.gateTitle"]],
    [T_AMBIG_DRIFT, ["home.studio.1.tools.1.cost", "home.studio.2.tools.2.cost"]],
  ),
};

/* ---- parity checks ---- */

const EN = flat(load("en"));
const CATALOGS: Record<string, Record<string, string>> = {};
for (const locale of LOCALES) CATALOGS[locale] = flat(load(locale));

function numericMismatch(locale: string, key: string): boolean {
  const enValue = EN[key];
  const localeValue = CATALOGS[locale]?.[key];
  if (enValue === undefined || localeValue === undefined) return false;
  return JSON.stringify(numericTokens(enValue)) !== JSON.stringify(numericTokens(localeValue));
}

describe("locale numeric parity", () => {
  it.each(LOCALES)("%s numeric tokens match en outside the explicit allowlist", (locale) => {
    const allowlist = NUMERIC_ALLOWLIST[locale] ?? {};
    const violations = Object.keys(EN)
      .filter((key) => key in (CATALOGS[locale] ?? {}) && numericMismatch(locale, key) && !(key in allowlist))
      .map(
        (key) =>
          `${key}: en [${numericTokens(EN[key]!).join(", ")}] vs ${locale} [${numericTokens(CATALOGS[locale]![key]!).join(", ")}]`,
      );
    expect(violations).toEqual([]);
  });

  it("the allowlist names only keys that still mismatch en (no stale entries)", () => {
    for (const locale of LOCALES) {
      const allowlist = NUMERIC_ALLOWLIST[locale] ?? {};
      for (const [key, reason] of Object.entries(allowlist)) {
        expect(EN[key], `${locale} allowlist entry ${key} is missing from en`).toBeDefined();
        expect(CATALOGS[locale]?.[key], `${locale} allowlist entry ${key} is missing from the catalog`).toBeDefined();
        expect(
          numericMismatch(locale, key),
          `${locale} allowlist entry ${key} no longer mismatches en — remove it (${reason})`,
        ).toBe(true);
      }
    }
  });

  it("flagship corrected prices and prize amounts stay pinned in every catalog", () => {
    const expectedBadges: Record<string, string> = {
      "makeSong.priceBadge": "400 Visual Bucs",
      "makeVideo.priceBadge": "200 Visual Bucs",
      "songAndVideo.costBadge": "400 Visual Bucs",
      "scheduler.bestTime.cost": "75 Visual Bucs",
    };
    const jackpotFormats: Record<string, string> = {
      en: "10,000",
      ar: "10,000",
      de: "10.000",
      es: "10,000",
      fr: "10 000",
      hi: "10,000",
      it: "10.000",
      ja: "10,000",
      ko: "10,000",
      pt: "10.000",
    };

    for (const locale of ["en", ...LOCALES]) {
      const catalog = locale === "en" ? EN : CATALOGS[locale]!;
      for (const [key, expected] of Object.entries(expectedBadges)) {
        expect(catalog[key], `${locale} ${key}`).toBe(expected);
      }
      expect(catalog["home.jackpotBody"], `${locale} home.jackpotBody format`).toContain(jackpotFormats[locale]);
      expect(numericTokens(catalog["home.jackpotBody"]!), `${locale} home.jackpotBody value`).toEqual(["10000"]);
      expect(numericTokens(catalog["home.referBodyB"]!), `${locale} home.referBodyB value`).toEqual(["1000"]);
    }
  });
});
