/**
 * locale-waves-ko.test.ts — Stack-28 Korean wave pins (board items
 * 77 / 86 / 95 / 99 = ko-W1..W4, per .lane/audit/a7-locale.md §5.8).
 *
 * For each completed wave this suite pins, over the wave's EXACT §5
 * namespace list:
 *   1. completeness — every en key in those namespaces is present in
 *      ko and non-empty (arrays: present, same length, non-empty);
 *   2. no REAL identicals left — a ko value identical to en is only
 *      allowed for keys on the wave's explicit legit-identical
 *      allowlist below (brand/house names incl. "Bow Down Visuals" /
 *      "Visual Bucs" and the pricing rank names, platform names, URLs,
 *      numbers/prices alone, abbreviations, and proper-noun example
 *      placeholders — a7-locale.md §1.4 classes);
 *   3. placeholder parity — the {{…}} placeholder multiset of every
 *      wave key matches en exactly;
 *   4. no U+FFFD replacement characters in any wave value.
 *
 * Plural note (§4): ko selects only the CLDR `other` category; the
 * catalog's established pattern carries _one and _other with the same
 * Korean text, which this pin accepts — completeness is over en keys,
 * so both suffixes are present where en has them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Leaf = string | string[];

function load(locale: string): Record<string, unknown> {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function flat(o: unknown, p = "", out: Record<string, Leaf> = {}): Record<string, Leaf> {
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

const EN = flat(load("en"));
const KO = flat(load("ko"));

export const KO_WAVES: Record<string, string[]> = {
  W1: [
    "pricing", "referrals", "memberships", "merch", "royalties", "moneyTracker",
    "refundPolicy", "tips", "myShop", "storefrontBuilder", "contracts", "tipPage",
    "storefronts", "jewelry", "jewelryShop", "brandingShop", "liveShopping",
    "llcGuide", "syncPitch", "brandDeals", "distribute", "sponsors", "sponsorsPost",
    "sponsorDealDetail", "labelPitch", "brandCalculator", "playlistPitch",
  ],
  W2: [
    "retentionDoctor", "retentionDelight", "invite", "fomoFeed", "planPublic",
    "delight", "home", "academy", "common", "auth", "features", "waitlist",
    "promo-clip", "splitScreen", "productPhotoStudio", "carouselMaker",
    "videoTemplates", "movies", "motionGraphics",
  ],
  W3: [
    "cartoonStudio", "bgStudio", "headshotStudio", "colorGrade", "photoEnhance",
    "speedRamp", "captionTemplates", "videoTemplatesPage", "photoShoot", "upscale",
    "avatarPresenter", "thumbnailStudio", "makeVideo", "thumbnailMaker",
    "songAndVideo", "thumbnail", "thumbnailTest", "thumbnails", "clipMaker",
    "watermarkRemoval", "logoMaker", "captionStyler", "mixMaster", "harmony",
    "deverb", "fillerRemover", "mastering", "lrcExport",
  ],
};

/** Legit-identical allowlists, per wave — see header for the classes. */
export const KO_WAVE_ALLOW: Record<string, string[]> = {
  W1: [
    // numbers / prices / brand currency alone
    "pricing.creditPacks.packs.10.credits", "pricing.creditPacks.packs.10.price",
    "pricing.creditPacks.packs.50.credits", "pricing.creditPacks.packs.50.price",
    "pricing.creditPacks.packs.150.credits", "pricing.creditPacks.packs.150.price",
    "pricing.creditPacks.packs.500.credits", "pricing.creditPacks.packs.500.price",
    "memberships.aiCost", "merch.pricePlaceholder", "royalties.insights.cost",
    "storefrontBuilder.step3Cost",
    // house rank names (kept in English in the existing ko catalog)
    "pricing.plans.crimeBoss.name", "pricing.plans.gangster.name",
    "pricing.plans.hustler.name", "pricing.plans.kingpin.name",
    "pricing.plans.shotCaller.name", "pricing.plans.streetPunk.name",
    // punctuation / placeholder-only fragments
    "referrals.hero.p4", "referrals.tracker.earned", "referrals.contest.prizeFor",
    "liveShopping.crossLinkEnd", "tips.tipMeta", "brandDeals.resultsCount",
    // platform names
    "referrals.sharekit.templates.threads", "referrals.sharekit.templates.chat",
    // proper-noun example placeholders
    "tips.displayNamePlaceholder", "tips.goalAmountPlaceholder", "tips.handlePlaceholder",
    "tips.suggestedPlaceholder", "myShop.shopNamePlaceholder", "myShop.handlePlaceholder",
    "myShop.productNamePlaceholder", "myShop.pricePlaceholder", "myShop.domainPlaceholder",
    "storefrontBuilder.domainPlaceholder", "storefrontBuilder.handlePlaceholder",
    "storefrontBuilder.shopPreviewHandle", "sponsors.matchFollowersPlaceholder",
    "sponsors.matchPlatformsPlaceholder", "sponsorsPost.budgetMaxPlaceholder",
    "sponsorsPost.budgetMinPlaceholder", "sponsorDealDetail.followersPlaceholder",
    "distribute.midnight_frequencies", "distribute.shark_king",
    "distribute.us_xxx_26_00001", "distribute.luxury_gold_and_black_album_cove",
    "distribute.dark_luxury_trap_anthem_heavy_80",
    // brand / abbreviation / identifier literals
    "llcGuide.statEin", "syncPitch.typeTv", "syncPitch.statBpm",
    "distribute.bow_down_records", "distribute.isrc", "distribute.isrc_2",
    "distribute.visual_bucs", "distribute.100_visual_bucs", "distribute.tier.ep.label",
    "playlistPitch.copyDmLabel",
    // numeric ranges alone
    "brandDeals.audiences.k10_50k", "brandDeals.audiences.k1_10k",
    "brandDeals.audiences.k250plus", "brandDeals.audiences.k50_250k",
  ],
  W2: [
    // time-format example / platform names
    "retentionDoctor.atPlaceholder", "retentionDoctor.platform_tiktok",
    "retentionDoctor.platform_instagram", "retentionDoctor.platform_youtube",
    "retentionDoctor.platform_x", "promo-clip.platforms.tiktok",
    "promo-clip.platforms.reels", "promo-clip.platforms.shorts",
    // genre names (established loanwords / abbreviations)
    "home.demo.rnb.label", "promo-clip.genres.rnb", "promo-clip.genres.pop",
    "promo-clip.genres.afrobeats", "promo-clip.genres.dancehall", "promo-clip.genres.gospel",
    // brand fragments / stylized brand lines
    "home.manifestoTitleA", "home.manifestoTitleB", "home.extTitleA",
    "common.visualBucs",
    // proper-noun / number / format example placeholders
    "academy.nichePlaceholder", "academy.hoursPlaceholder", "auth.emailPlaceholder",
    "auth.passwordPlaceholder", "productPhotoStudio.pastePlaceholder",
    "carouselMaker.brandColorsPlaceholder",
    // brand currency / placeholder-only
    "promo-clip.creditBadge", "productPhotoStudio.credits",
    // house mode names (kept in English across the existing ko catalog)
    "splitScreen.modeSimple", "splitScreen.modeCustom",
    // episode abbreviation label
    "movies.epLabel",
    // home studio lineup array leaves (pre-existing): tool/product names
    // and "NNN VB" price cells — two cost cells are the numeric-parity
    // suite's documented AMBIGUOUS old-lineup cells, left untouched there too
    "home.studio.0.tools.0.cost", "home.studio.0.tools.1.title",
    "home.studio.0.tools.1.cost", "home.studio.0.tools.2.title",
    "home.studio.0.tools.2.cost", "home.studio.1.tools.0.title",
    "home.studio.1.tools.0.cost", "home.studio.1.tools.1.title",
    "home.studio.1.tools.2.cost", "home.studio.2.tools.0.cost",
    "home.studio.2.tools.1.cost", "home.studio.2.tools.2.title",
    "home.studio.3.tools.0.cost", "home.studio.3.tools.1.cost",
    "home.studio.3.tools.2.cost",
    // home credit-pack array leaves: numbers + brand currency alone
    "home.creditPacks.0.credits", "home.creditPacks.1.credits",
    "home.creditPacks.2.credits", "home.creditPacks.3.credits",
  ],
  W3: [
    // brand currency / placeholder-only / punctuation
    "headshotStudio.visualBucs", "makeVideo.priceBadge", "makeVideo.unknownStep",
    "makeVideo.refundedNoticeSuffix", "songAndVideo.costBadge", "harmony.buttonCost",
    "harmony.vb", "harmony.partsLine", "lrcExport.aiCost",
    // genre / format / platform names
    "makeVideo.genreRB", "makeVideo.platformTiktok", "songAndVideo.genreRB",
    "thumbnail.platformAppleMusic", "thumbnail.platformSoundCloud",
    "thumbnail.platformSpotify", "thumbnail.platformYouTube",
    "mixMaster.genres.pop.label", "mixMaster.genres.rnb.label",
    "mixMaster.genres.edm.label", "mixMaster.genres.rock.label",
    "mixMaster.genres.gospel.label", "mastering.downloadWav", "mastering.downloadMp3",
    // abbreviations / house mode + format labels / proper name
    "logoMaker.vb", "captionStyler.styles.hormozi.label", "thumbnailStudio.tabs.abtest",
    "songAndVideo.simpleTabLabel", "mixMaster.stemTypes.fx", "harmony.modeAiShort",
  ],
};

const placeholders = (v: Leaf): string[] => {
  const s = Array.isArray(v) ? v.join("\n") : v;
  return (s.match(/\{\{[^}]*\}\}/g) ?? []).sort();
};
const text = (v: Leaf): string => (Array.isArray(v) ? v.join("\n") : v);

describe("Stack-28 ko locale waves", () => {
  for (const [wave, namespaces] of Object.entries(KO_WAVES)) {
    describe(`ko-${wave}`, () => {
      const keys = Object.keys(EN).filter((k) => namespaces.includes(k.split(".")[0]!));
      const allow = new Set(KO_WAVE_ALLOW[wave] ?? []);

      it("wave namespaces are complete and non-empty in ko", () => {
        const missing: string[] = [];
        for (const k of keys) {
          const v = KO[k];
          if (v === undefined) { missing.push(`${k} (absent)`); continue; }
          if (typeof v !== "string" || !v.trim()) missing.push(`${k} (empty)`);
        }
        expect(missing).toEqual([]);
      });

      it("no REAL identical-to-en values remain outside the legit allowlist", () => {
        const bad: string[] = [];
        for (const k of keys) {
          const v = KO[k];
          if (v === undefined || allow.has(k)) continue;
          if (text(v) === text(EN[k]!)) bad.push(k);
        }
        expect(bad).toEqual([]);
      });

      it("allowlist entries are exactly the remaining identicals (no rot)", () => {
        const identical = keys.filter(
          (k) => KO[k] !== undefined && text(KO[k]!) === text(EN[k]!),
        );
        expect([...identical].sort()).toEqual([...allow].sort());
      });

      it("placeholder parity with en for every wave key", () => {
        const bad: string[] = [];
        for (const k of keys) {
          if (KO[k] === undefined) continue;
          if (JSON.stringify(placeholders(KO[k]!)) !== JSON.stringify(placeholders(EN[k]!))) {
            bad.push(k);
          }
        }
        expect(bad).toEqual([]);
      });

      it("no U+FFFD in any wave value", () => {
        const bad = keys.filter((k) => KO[k] !== undefined && text(KO[k]!).includes("�"));
        expect(bad).toEqual([]);
      });
    });
  }
});
