/**
 * locale-waves-fr.test.ts — Stack-28 French locale waves (board items 73, 82, 91).
 *
 * Pins the fr-W1..W3 wave closures from the A7 locale audit
 * (.lane/audit/a7-locale.md §5.4): for every namespace in a closed wave,
 * every en key must be present in fr, and no fr value may remain identical
 * to en unless the key sits on that wave's legit-identical allowlist
 * (brand/house names incl. "Bow Down Visuals"/"Visual Bucs", platform
 * names, URLs, number/format-only strings, and French cognates/loanwords
 * spelled identically — §1.4 classes). Plan/rank names (Street Punk,
 * Hustler, Gangster, Shot Caller, Crime Boss, Kingpin) and the Money
 * Tracker product name stay English, matching already-translated fr
 * neighbours (e.g. team.createTeamHint keeps "Shot Caller",
 * outreach.invoice.logToTracker keeps "Money Tracker"). The house mode
 * rendering "Mode rapide" for Turbo is deliberate and pinned elsewhere.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Catalog = Record<string, unknown>;
function load(locale: string): Catalog {
  return JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8")) as Catalog;
}
function flat(o: unknown, p = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(o)) { out[p] = o; return out; }
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) flat(v, p ? `${p}.${k}` : k, out);
  } else out[p] = o;
  return out;
}
const EN = flat(load("en"));
const FR = flat(load("fr"));

const W1_NAMESPACES = ["brandDeals", "brandingShop", "contracts", "credit-history", "distribute", "jewelry", "jewelryShop", "labelPitch", "liveShopping", "llcGuide", "memberships", "merch", "moneyTracker", "myShop", "pricing", "referrals", "refundPolicy", "royalties", "shop", "storefrontBuilder", "storefronts", "syncPitch", "tipPage", "tips"] as const;
const W1_LEGIT: ReadonlySet<string> = new Set([
  "brandDeals.audiences.k10_50k",
  "brandDeals.audiences.k1_10k",
  "brandDeals.audiences.k250plus",
  "brandDeals.audiences.k50_250k",
  "brandDeals.niches.fitness",
  "brandDeals.niches.gaming",
  "brandDeals.niches.lifestyle",
  "brandDeals.niches.tech",
  "brandDeals.resultsCount",
  "brandDeals.tabs.marketplace",
  "brandingShop.departments.merch",
  "brandingShop.styleLabel",
  "brandingShop.totalLabel",
  "contracts.type.distribution",
  "contracts.type.management",
  "credit-history.action",
  "credit-history.date",
  "credit-history.pack",
  "credit-history.type",
  "distribute.100_visual_bucs",
  "distribute.bow_down_records",
  "distribute.distribution",
  "distribute.genre",
  "distribute.genre_2",
  "distribute.hip_hop_trap",
  "distribute.isrc",
  "distribute.label",
  "distribute.tier.album.label",
  "distribute.tier.ep.label",
  "distribute.tier.single.label",
  "distribute.type",
  "distribute.us_xxx_26_00001",
  "distribute.visual_bucs",
  "jewelry.format",
  "jewelry.merchWord",
  "jewelry.stepDesign",
  "jewelry.stepLogo",
  "jewelry.style",
  "labelPitch.analysisGenre",
  "labelPitch.genres.afrobeats",
  "labelPitch.genres.country",
  "labelPitch.genres.edm",
  "labelPitch.genres.hip-hop",
  "labelPitch.genres.latin",
  "labelPitch.genres.pop",
  "labelPitch.genres.r&b",
  "labelPitch.genres.rock",
  "labelPitch.heroBadge",
  "labelPitch.labelOneSheet",
  "labelPitch.tabLabels",
  "labelPitch.typeMajors",
  "liveShopping.crossLinkEnd",
  "liveShopping.descriptionLabel",
  "llcGuide.creatorDesigner",
  "llcGuide.creatorStreamer",
  "llcGuide.heroTitleGuide",
  "llcGuide.statEin",
  "memberships.aiCost",
  "memberships.badge",
  "memberships.titleStart",
  "merch.pricePlaceholder",
  "merch.products.hoodie.label",
  "merch.products.poster.label",
  "merch.products.t-shirt.label",
  "merch.styleLabel",
  "merch.styles.streetwear.label",
  "merch.styles.vintage.label",
  "merch.tabs.merch",
  "moneyTracker.cat_production",
  "moneyTracker.date",
  "moneyTracker.note",
  "moneyTracker.source",
  "moneyTracker.title",
  "myShop.descriptionLabel",
  "myShop.domainPlaceholder",
  "myShop.handlePlaceholder",
  "myShop.pause",
  "myShop.premium200",
  "myShop.pricePlaceholder",
  "myShop.productNamePlaceholder",
  "myShop.shopNamePlaceholder",
  "pricing.creditPacks.packs.10.price",
  "pricing.creditPacks.packs.150.price",
  "pricing.creditPacks.packs.50.price",
  "pricing.creditPacks.packs.500.price",
  "pricing.plans.crimeBoss.name",
  "pricing.plans.gangster.name",
  "pricing.plans.hustler.name",
  "pricing.plans.kingpin.name",
  "pricing.plans.shotCaller.name",
  "pricing.plans.streetPunk.name",
  "referrals.contest.hours",
  "referrals.contest.prizeFor",
  "referrals.contest.secs",
  "referrals.hero.p4",
  "referrals.sharekit.templates.chat",
  "referrals.sharekit.templates.threads",
  "referrals.tracker.earned",
  "royalties.insights.cost",
  "royalties.streams",
  "shop.totalLabel",
  "storefrontBuilder.colorRose",
  "storefrontBuilder.handlePlaceholder",
  "storefrontBuilder.step3Cost",
  "storefrontBuilder.stepBranding",
  "syncPitch.madeWith",
  "syncPitch.notesPlaceholder",
  "syncPitch.statBpm",
  "syncPitch.statInstrumental",
  "syncPitch.statStems",
  "syncPitch.tagInstrumental",
  "syncPitch.tagStems",
  "syncPitch.typeFilm",
  "syncPitch.typeTv",
  "tips.displayNamePlaceholder",
  "tips.goalAmountPlaceholder",
  "tips.handlePlaceholder",
  "tips.suggestedPlaceholder",
  "tips.tipMeta"
]);

const W2_NAMESPACES = ["academy", "auth", "betaAccess", "brandCalculator", "carouselMaker", "common", "delight", "features", "fomoFeed", "guides", "home", "invite", "motionGraphics", "movies", "planPublic", "playlistPitch", "productPhotoStudio", "promo-clip", "retentionDelight", "retentionDoctor", "splitScreen", "sponsorDashboard", "sponsorDealDetail", "sponsors", "sponsorsPost", "videoTemplates", "waitlist"] as const;
const W2_LEGIT: ReadonlySet<string> = new Set([
  "academy.catProduction",
  "academy.coachRole",
  "academy.hoursPlaceholder",
  "academy.lessonMinutes",
  "academy.nicheLabel",
  "auth.passwordPlaceholder",
  "betaAccess.creatorLabel",
  "betaAccess.messageLabel",
  "brandCalculator.niches.fitness",
  "brandCalculator.niches.lifestyle",
  "brandCalculator.niches.tech",
  "brandCalculator.platforms.twitch.blurb",
  "carouselMaker.brandColorsPlaceholder",
  "carouselMaker.fmtPortrait",
  "carouselMaker.fontDisplay",
  "carouselMaker.fontSans",
  "carouselMaker.fontSerif",
  "common.premium",
  "common.visualBucs",
  "features.cheat_code",
  "guides.academy.name",
  "guides.badge",
  "guides.pageTitle",
  "home.demo.hiphop.label",
  "home.demo.pop.label",
  "home.demo.rnb.label",
  "home.extTitleA",
  "home.faqKicker",
  "home.formats.streamers.title",
  "home.vaultBodyB",
  "motionGraphics.cat.transitions",
  "movies.arcLabel",
  "movies.comparables",
  "movies.genreLabel",
  "movies.logline",
  "movies.optional",
  "playlistPitch.copyDmLabel",
  "playlistPitch.packetDescription",
  "playlistPitch.packetGenre",
  "playlistPitch.statGenre",
  "playlistPitch.tabPlaylists",
  "productPhotoStudio.credits",
  "productPhotoStudio.lifestyle",
  "productPhotoStudio.packshot",
  "productPhotoStudio.pastePlaceholder",
  "productPhotoStudio.ratioStory",
  "promo-clip.clips.count_one",
  "promo-clip.clips.count_other",
  "promo-clip.clipsSelector.clipFallback",
  "promo-clip.creditBadge",
  "promo-clip.form.genre",
  "promo-clip.genres.afrobeats",
  "promo-clip.genres.country",
  "promo-clip.genres.dancehall",
  "promo-clip.genres.drill",
  "promo-clip.genres.gospel",
  "promo-clip.genres.hipHop",
  "promo-clip.genres.pop",
  "promo-clip.genres.rnb",
  "promo-clip.genres.rock",
  "promo-clip.genres.trap",
  "promo-clip.platforms.reels",
  "promo-clip.platforms.shorts",
  "promo-clip.platforms.square",
  "promo-clip.platforms.tiktok",
  "promo-clip.tags.hashtags",
  "retentionDelight.prefs_sharkDrops",
  "retentionDoctor.atPlaceholder",
  "retentionDoctor.eyebrow",
  "retentionDoctor.platform_instagram",
  "retentionDoctor.platform_tiktok",
  "retentionDoctor.platform_x",
  "retentionDoctor.platform_youtube",
  "retentionDoctor.prescriptionLabel",
  "retentionDoctor.type_promo",
  "retentionDoctor.type_vlog",
  "splitScreen.cellN",
  "sponsorDashboard.applicationDealLine",
  "sponsorDashboard.pageTitleAccent",
  "sponsorDealDetail.followersPlaceholder",
  "sponsors.matchFollowersPlaceholder",
  "sponsors.matchPlatformsPlaceholder",
  "sponsorsPost.budgetMaxLabel",
  "sponsorsPost.budgetMaxPlaceholder",
  "sponsorsPost.budgetMinLabel",
  "sponsorsPost.budgetMinPlaceholder",
  "sponsorsPost.descriptionLabel",
  "videoTemplates.kindPhoto",
  "waitlist.artistTypeLabel",
  "waitlist.contactKicker",
  "waitlist.messageLabel"
]);

const W3_NAMESPACES = ["avatarPresenter", "bgStudio", "captionStyler", "captionTemplates", "cartoonStudio", "clipMaker", "colorGrade", "deverb", "fillerRemover", "harmony", "headshotStudio", "logoMaker", "lrcExport", "makeVideo", "mixMaster", "photoEnhance", "photoShoot", "songAndVideo", "speedRamp", "thumbnail", "thumbnailMaker", "thumbnailStudio", "thumbnailTest", "thumbnails", "upscale", "videoTemplatesPage", "watermarkRemoval"] as const;
const W3_LEGIT: ReadonlySet<string> = new Set([
  "avatarPresenter.avatarLabel",
  "captionStyler.positionLabel",
  "captionStyler.styles.hormozi.label",
  "cartoonStudio.styleAnimeName",
  "clipMaker.secondsLabel",
  "clipMaker.vibeHypeLabel",
  "colorGrade.saturation",
  "deverb.abOriginal",
  "deverb.labelOriginal",
  "deverb.pause",
  "fillerRemover.kindSilence",
  "harmony.buttonCost",
  "harmony.modeAiShort",
  "harmony.partsLine",
  "harmony.vb",
  "headshotStudio.presetNames.stage",
  "headshotStudio.presetNames.street",
  "headshotStudio.presetNames.studio",
  "headshotStudio.styleLabel",
  "headshotStudio.visualBucs",
  "logoMaker.modelPremium",
  "logoMaker.modelStandard",
  "logoMaker.styleGaming",
  "logoMaker.styleLabel",
  "logoMaker.vb",
  "lrcExport.aiCost",
  "lrcExport.pause",
  "lrcExport.tapButton",
  "makeVideo.clipFallback",
  "makeVideo.genreAfrobeats",
  "makeVideo.genreCountry",
  "makeVideo.genreDancehall",
  "makeVideo.genreDrill",
  "makeVideo.genreGospel",
  "makeVideo.genreLabel",
  "makeVideo.genrePop",
  "makeVideo.genreRB",
  "makeVideo.genreRock",
  "makeVideo.genreTrap",
  "makeVideo.platformTiktok",
  "makeVideo.priceBadge",
  "makeVideo.refundedNoticeSuffix",
  "makeVideo.step3Short",
  "makeVideo.summaryGenre",
  "makeVideo.summaryStyle",
  "makeVideo.unknownStep",
  "makeVideo.videoStyleBrooklynDrill",
  "mixMaster.genres.afrobeat.label",
  "mixMaster.genres.edm.label",
  "mixMaster.genres.gospel.label",
  "mixMaster.genres.hip-hop.label",
  "mixMaster.genres.lofi.label",
  "mixMaster.genres.podcast.label",
  "mixMaster.genres.pop.label",
  "mixMaster.genres.rnb.label",
  "mixMaster.genres.rock.label",
  "mixMaster.genres.trap.label",
  "mixMaster.loudness.club.label",
  "mixMaster.loudness.radio.label",
  "mixMaster.loudness.streaming.label",
  "mixMaster.stemTypes.beat",
  "mixMaster.stemTypes.fx",
  "mixMaster.stemTypes.other",
  "mixMaster.tabMixStems",
  "photoEnhance.featureName",
  "photoShoot.scenePacks.tags.pressKit",
  "songAndVideo.cleanOption",
  "songAndVideo.costBadge",
  "songAndVideo.fieldGenre",
  "songAndVideo.genreAfrobeats",
  "songAndVideo.genreCountry",
  "songAndVideo.genreDancehall",
  "songAndVideo.genreDrill",
  "songAndVideo.genreGospel",
  "songAndVideo.genrePop",
  "songAndVideo.genreRB",
  "songAndVideo.genreRock",
  "songAndVideo.genreTrap",
  "songAndVideo.summaryGenre",
  "speedRamp.slowmo.simple",
  "thumbnail.artStyleAnime",
  "thumbnail.artStyleVintage",
  "thumbnail.platformAppleMusic",
  "thumbnail.platformSoundCloud",
  "thumbnail.platformSpotify",
  "thumbnail.platformYouTube",
  "thumbnailMaker.formatLabel",
  "thumbnailMaker.portraitBlurb",
  "thumbnailMaker.portraitLabel",
  "thumbnailMaker.styleGamingName",
  "thumbnailMaker.styleVlogName",
  "upscale.tabImageShort",
  "upscale.target1080p",
  "upscale.target4k"
]);

function waveKeys(namespaces: readonly string[]): string[] {
  return Object.keys(EN).filter((k) => namespaces.includes(k.split(".")[0]));
}

describe("fr-W1 (Stack-28 #73)", () => {
  it("every en key in the wave namespaces is present in fr", () => {
    const missing = waveKeys(W1_NAMESPACES).filter((k) => !(k in FR) || FR[k] === "" || FR[k] === undefined);
    expect(missing).toEqual([]);
  });
  it("no identical-to-en values remain outside the legit allowlist", () => {
    const real = waveKeys(W1_NAMESPACES).filter((k) => FR[k] === EN[k] && !W1_LEGIT.has(k));
    expect(real).toEqual([]);
  });
  it("the legit allowlist names only keys still identical to en (no stale entries)", () => {
    const stale = [...W1_LEGIT].filter((k) => FR[k] !== EN[k]);
    expect(stale).toEqual([]);
  });
  it("placeholders match en exactly for every wave key", () => {
    const shape = (v: unknown) => (typeof v === "string" ? v.split("{").slice(1).map((s) => "{" + s.split("}")[0] + "}").sort() : []);
    const bad = waveKeys(W1_NAMESPACES).filter((k) => JSON.stringify(shape(FR[k])) !== JSON.stringify(shape(EN[k])));
    expect(bad).toEqual([]);
  });
});

describe("fr-W2 (Stack-28 #82)", () => {
  it("every en key in the wave namespaces is present in fr", () => {
    const missing = waveKeys(W2_NAMESPACES).filter((k) => !(k in FR) || FR[k] === "" || FR[k] === undefined);
    expect(missing).toEqual([]);
  });
  it("no identical-to-en values remain outside the legit allowlist", () => {
    const real = waveKeys(W2_NAMESPACES).filter((k) => FR[k] === EN[k] && !W2_LEGIT.has(k));
    expect(real).toEqual([]);
  });
  it("the legit allowlist names only keys still identical to en (no stale entries)", () => {
    const stale = [...W2_LEGIT].filter((k) => FR[k] !== EN[k]);
    expect(stale).toEqual([]);
  });
  it("placeholders match en exactly for every wave key", () => {
    const shape = (v: unknown) => (typeof v === "string" ? v.split("{").slice(1).map((s) => "{" + s.split("}")[0] + "}").sort() : []);
    const bad = waveKeys(W2_NAMESPACES).filter((k) => JSON.stringify(shape(FR[k])) !== JSON.stringify(shape(EN[k])));
    expect(bad).toEqual([]);
  });
});

describe("fr-W3 (Stack-28 #91)", () => {
  it("every en key in the wave namespaces is present in fr", () => {
    const missing = waveKeys(W3_NAMESPACES).filter((k) => !(k in FR) || FR[k] === "" || FR[k] === undefined);
    expect(missing).toEqual([]);
  });
  it("no identical-to-en values remain outside the legit allowlist", () => {
    const real = waveKeys(W3_NAMESPACES).filter((k) => FR[k] === EN[k] && !W3_LEGIT.has(k));
    expect(real).toEqual([]);
  });
  it("the legit allowlist names only keys still identical to en (no stale entries)", () => {
    const stale = [...W3_LEGIT].filter((k) => FR[k] !== EN[k]);
    expect(stale).toEqual([]);
  });
  it("placeholders match en exactly for every wave key", () => {
    const shape = (v: unknown) => (typeof v === "string" ? v.split("{").slice(1).map((s) => "{" + s.split("}")[0] + "}").sort() : []);
    const bad = waveKeys(W3_NAMESPACES).filter((k) => JSON.stringify(shape(FR[k])) !== JSON.stringify(shape(EN[k])));
    expect(bad).toEqual([]);
  });
});

