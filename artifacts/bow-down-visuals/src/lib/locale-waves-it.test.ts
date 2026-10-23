/**
 * locale-waves-it.test.ts — Stack-28 Italian locale waves (board items
 * 75 / 84 / 93 = it-W1 / it-W2 / it-W3 per a7-locale.md §5.6).
 *
 * Pins, per wave namespace set:
 *  - completeness: every en key in the wave namespaces exists in it,
 *    non-empty;
 *  - placeholder parity: {{...}} tokens identical to en;
 *  - no REAL untranslated identicals: an it value byte-identical to en
 *    fails unless the key sits on the wave's explicit legit-identical
 *    allowlist (brand/house names incl. "Bow Down Visuals" / "Visual
 *    Bucs", platform names, URLs, numbers/formats only, Italian
 *    cognates and established loanwords — a7-locale.md §1.4 classes);
 *  - CLDR plurals whole: families carried by the wave exist in it with
 *    _one / _other / _many (it selects one+other+many).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Catalog = Record<string, unknown>;

function load(locale: string): Catalog {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Catalog;
}

function flat(o: unknown, p = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v;
    }
  }
  return out;
}

const EN = flat(load("en"));
const IT = flat(load("it"));

function placeholders(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return [...v.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkWave(namespaces: string[], legitIdentical: string[]) {
  const legit = new Set(legitIdentical);
  const keys = Object.keys(EN).filter((k) => namespaces.includes(k.split(".")[0]!));
  const missing: string[] = [];
  const empty: string[] = [];
  const badPlaceholders: string[] = [];
  const realIdentical: string[] = [];
  for (const k of keys) {
    const v = IT[k];
    if (v === undefined) {
      missing.push(k);
      continue;
    }
    if (typeof v === "string" && v.trim() === "") empty.push(k);
    if (JSON.stringify(placeholders(EN[k])) !== JSON.stringify(placeholders(v))) badPlaceholders.push(k);
    if (sameValue(v, EN[k]) && !legit.has(k)) realIdentical.push(k);
  }
  return { keys, missing, empty, badPlaceholders, realIdentical };
}

/* ------------------------------ it-W1 (item 75) ------------------------------ */
const W1_NAMESPACES = [
  "pricing", "referrals", "memberships", "merch", "royalties", "moneyTracker",
  "refundPolicy", "liveShopping", "llcGuide", "tips", "myShop", "jewelry",
  "storefrontBuilder", "brandingShop", "contracts", "jewelryShop", "tipPage",
  "credit-history", "shop", "storefronts", "syncPitch", "brandDeals",
];

/* Legit identicals (§1.4): brand/house + plan names, platforms, numbers /
   formats only, placeholder-only, Italian cognates & established loanwords
   (Email, Film, No, Dashboard, Software, Fitness, Gaming, Lifestyle, Tech,
   Marketplace, Merch, Design, Logo, Host, Branding, Management, Creator…). */
const W1_LEGIT = new Set([
  "brandDeals.tabs.marketplace",
  "referrals.contest.hours",
  "referrals.contest.secs",
  "referrals.contest.prizeFor",
  "referrals.sharekit.templates.threads",
  "referrals.sharekit.templates.chat",
  "memberships.titleStart",
  "memberships.aiCost",
  "merch.tabs.design",
  "merch.tabs.merch",
  "merch.products.t-shirt.label",
  "merch.products.poster.label",
  "merch.styles.streetwear.label",
  "merch.styles.minimal.label",
  "merch.styles.vintage.label",
  "merch.styles.luxury-gold.label",
  "merch.pricePlaceholder",
  "pricing.creditPacks.packs.10.credits",
  "pricing.creditPacks.packs.10.price",
  "pricing.creditPacks.packs.50.credits",
  "pricing.creditPacks.packs.50.price",
  "pricing.creditPacks.packs.150.credits",
  "pricing.creditPacks.packs.150.price",
  "pricing.creditPacks.packs.500.credits",
  "pricing.creditPacks.packs.500.price",
  "pricing.plans.crimeBoss.name",
  "pricing.plans.gangster.features.f2",
  "pricing.plans.gangster.name",
  "pricing.plans.hustler.features.f4",
  "pricing.plans.hustler.name",
  "pricing.plans.kingpin.name",
  "pricing.plans.shotCaller.name",
  "pricing.plans.streetPunk.name",
  "moneyTracker.title",
  "moneyTracker.cat_software",
  "moneyTracker.viewRoyalties",
  "brandDeals.audiences.k10_50k",
  "brandDeals.audiences.k1_10k",
  "brandDeals.audiences.k250plus",
  "brandDeals.audiences.k50_250k",
  "brandDeals.niches.fitness",
  "brandDeals.niches.gaming",
  "brandDeals.niches.lifestyle",
  "brandDeals.niches.tech",
  "brandDeals.resultsCount",
  "brandingShop.departments.merch",
  "brandingShop.emailPlaceholder",
  "contracts.type.management",
  "credit-history.dashboard",
  "jewelry.merchWord",
  "jewelry.nfcNo",
  "jewelry.stepDesign",
  "jewelry.stepLogo",
  "jewelryShop.emailPh",
  "liveShopping.badge",
  "liveShopping.crossLinkEnd",
  "liveShopping.liveBadge",
  "liveShopping.tabDashboard",
  "llcGuide.cheatCodeLabel",
  "llcGuide.creatorDesigner",
  "llcGuide.creatorPodcaster",
  "llcGuide.creatorStreamer",
  "llcGuide.creatorYouTuber",
  "llcGuide.statEin",
  "storefrontBuilder.handlePlaceholder",
  "storefrontBuilder.hostLabel",
  "storefrontBuilder.step3Cost",
  "storefrontBuilder.stepBranding",
  "tips.displayNamePlaceholder",
  "tips.goalAmountPlaceholder",
  "tips.handlePlaceholder",
  "tips.suggestedPlaceholder",
  "tips.tipMeta",
  "royalties.insights.cost",
  "refundPolicy.howTo.email",
  "referrals.hero.p4",
  "referrals.tracker.creator",
  "referrals.tracker.earned",
  "myShop.shopNamePlaceholder",
  "myShop.handlePlaceholder",
  "myShop.pricePlaceholder",
  "myShop.premium200",
  "myShop.domainPlaceholder",
  "syncPitch.typeTv",
  "syncPitch.typeFilm",
  "syncPitch.copyEmailLabel",
  "syncPitch.statBpm",
  "syncPitch.no",
  "syncPitch.publicBadge",
  "syncPitch.publicTitle",
  "syncPitch.madeWith",
]);

describe("it-W1 (Stack-28 #75) — commerce namespaces fully Italian", () => {
  const r = checkWave(W1_NAMESPACES, [...W1_LEGIT]);
  it("covers every en key in the wave namespaces", () => {
    expect(r.missing).toEqual([]);
    expect(r.empty).toEqual([]);
  });
  it("preserves {{placeholders}} exactly", () => {
    expect(r.badPlaceholders).toEqual([]);
  });
  it("leaves no REAL untranslated identicals", () => {
    expect(r.realIdentical).toEqual([]);
  });
  it("carries pricing.wantedMeter plurals whole (_one/_other/_many)", () => {
    for (const base of ["pricing.wantedMeter.hoverLabel", "pricing.wantedMeter.starOption"]) {
      for (const suffix of ["_one", "_other", "_many"]) {
        expect(typeof IT[`${base}${suffix}`], `${base}${suffix}`).toBe("string");
      }
    }
  });
});

/* ------------------------------ it-W2 (item 84) ------------------------------ */
const W2_NAMESPACES = [
  "labelPitch", "distribute", "brandCalculator", "playlistPitch", "sponsorsPost",
  "sponsorDealDetail", "sponsors", "sponsorDashboard", "retentionDoctor",
  "retentionDelight", "invite", "fomoFeed", "planPublic", "home", "delight",
  "academy", "common", "waitlist", "betaAccess", "auth", "signup", "features",
  "guides", "promo-clip", "splitScreen", "productPhotoStudio", "carouselMaker",
  "videoTemplates", "movies",
];

/* Legit identicals (§1.4): platforms, genres, brand/house names, example
   placeholders & ISRC codes, numbers/formats only, Italian cognates &
   loanwords (Email, Password, Video, Album, Film, Tutorial, Vlog, Promo,
   Layout, Turbo, Clip, Hook, Logline, Brand, Serif/Sans/Display…). */
const W2_LEGIT = new Set([
  "academy.catBranding", "invite.email", "videoTemplates.kindVideo",
  "splitScreen.pickLayout", "splitScreen.modeSimple", "splitScreen.cellN",
  "promo-clip.creditBadge", "promo-clip.tags.hashtags", "promo-clip.clips.count_one",
  "promo-clip.platforms.tiktok", "promo-clip.platforms.reels", "promo-clip.platforms.shorts",
  "promo-clip.genres.hipHop", "promo-clip.genres.drill", "promo-clip.genres.trap",
  "promo-clip.genres.rnb", "promo-clip.genres.pop", "promo-clip.genres.afrobeats",
  "promo-clip.genres.dancehall", "promo-clip.genres.gospel", "promo-clip.genres.rock",
  "promo-clip.genres.country", "promo-clip.clipsSelector.clipFallback",
  "movies.logline", "movies.epLabel", "movies.hookLabel",
  "retentionDoctor.eyebrow", "retentionDoctor.atPlaceholder",
  "retentionDoctor.type_tutorial", "retentionDoctor.type_vlog", "retentionDoctor.type_promo",
  "retentionDoctor.platform_tiktok", "retentionDoctor.platform_instagram",
  "retentionDoctor.platform_youtube", "retentionDoctor.platform_x",
  "carouselMaker.heroTitleB", "carouselMaker.brandTitle", "carouselMaker.brandColorsPlaceholder",
  "carouselMaker.fontSerif", "carouselMaker.fontSans", "carouselMaker.fontDisplay",
  "carouselMaker.tplLuxeName", "retentionDelight.levelUp_title",
  "productPhotoStudio.title", "productPhotoStudio.pastePlaceholder",
  "productPhotoStudio.packshot", "productPhotoStudio.lifestyle",
  "productPhotoStudio.preset.infinityWhite", "productPhotoStudio.preset.streetStyle",
  "productPhotoStudio.preset.goldenHour", "productPhotoStudio.credits",
  "productPhotoStudio.confirmFeature",
  "auth.email", "auth.password", "auth.passwordPlaceholder",
  "common.beta", "common.premium", "common.visualBucs",
  "home.demo.hiphop.label", "home.demo.rnb.label", "home.demo.pop.label",
  "home.extTitleA", "home.faqKicker", "home.vaultBodyB", "home.academyKicker",
  "academy.pageTitle", "academy.hoursPlaceholder", "academy.lessonMinutes", "academy.coachRole",
  "betaAccess.emailLabel", "betaAccess.creatorRapper", "betaAccess.creatorContentCreator",
  "betaAccess.badgeBeta",
  "brandCalculator.niches.fitness", "brandCalculator.niches.gaming",
  "brandCalculator.niches.lifestyle", "brandCalculator.niches.tech",
  "brandCalculator.platforms.twitch.blurb", "brandCalculator.title",
  "distribute.midnight_frequencies", "distribute.shark_king", "distribute.hip_hop_trap",
  "distribute.us_xxx_26_00001", "distribute.bow_down_records", "distribute.isrc",
  "distribute.luxury_gold_and_black_album_cove", "distribute.dark_luxury_trap_anthem_heavy_80",
  "distribute.isrc_2", "distribute.visual_bucs", "distribute.100_visual_bucs",
  "distribute.tier.ep.label", "distribute.tier.album.label",
  "features.cheat_code", "guides.academy.name",
  "labelPitch.genres.afrobeats", "labelPitch.genres.country", "labelPitch.genres.edm",
  "labelPitch.genres.hip-hop", "labelPitch.genres.latin", "labelPitch.genres.pop",
  "labelPitch.genres.r&b", "labelPitch.genres.rock", "labelPitch.heroBadge",
  "labelPitch.labelEmail", "labelPitch.labelFollowUp", "labelPitch.labelOneSheet",
  "labelPitch.typeImprint", "labelPitch.typeMajor",
  "sponsorDealDetail.followersPlaceholder", "sponsors.matchFollowersPlaceholder",
  "sponsors.matchPlatformsPlaceholder", "sponsorsPost.budgetMaxPlaceholder",
  "sponsorsPost.budgetMinPlaceholder",
  "signup.emailField", "signup.passwordField",
  "waitlist.artistTypeContentCreator", "waitlist.artistTypeRapper",
  "waitlist.badgeBeta", "waitlist.emailLabel",
  "playlistPitch.copyEmailLabel", "playlistPitch.copyDmLabel",
  "playlistPitch.copyFollowUpLabel", "playlistPitch.heroBadge",
  "playlistPitch.tabTracker", "playlistPitch.tabTrackerCount",
]);

describe("it-W2 (Stack-28 #84) — sponsors/retention/create-entry namespaces fully Italian", () => {
  const r = checkWave(W2_NAMESPACES, [...W2_LEGIT]);
  it("covers every en key in the wave namespaces", () => {
    expect(r.missing).toEqual([]);
    expect(r.empty).toEqual([]);
  });
  it("preserves {{placeholders}} exactly", () => {
    expect(r.badPlaceholders).toEqual([]);
  });
  it("leaves no REAL untranslated identicals", () => {
    expect(r.realIdentical).toEqual([]);
  });
  it("carries promo-clip plurals whole (_one/_other/_many)", () => {
    for (const base of ["promo-clip.clips.count", "promo-clip.summary.clipsSelected"]) {
      for (const suffix of ["_one", "_other", "_many"]) {
        expect(typeof IT[`${base}${suffix}`], `${base}${suffix}`).toBe("string");
      }
    }
  });
});
