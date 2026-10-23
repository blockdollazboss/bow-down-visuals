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

/* ------------------------------ it-W3 (item 93) ------------------------------ */
const W3_NAMESPACES = [
  "motionGraphics", "cartoonStudio", "bgStudio", "headshotStudio", "colorGrade",
  "photoEnhance", "speedRamp", "captionTemplates", "videoTemplatesPage",
  "photoShoot", "makeVideo", "songAndVideo", "upscale", "avatarPresenter",
  "thumbnail", "thumbnailMaker", "logoMaker", "thumbnailStudio", "captionStyler",
  "clipMaker", "thumbnailTest", "thumbnails", "watermarkRemoval", "mixMaster",
  "harmony", "deverb",
];

/* Legit identicals (§1.4): genres, platforms, house/feature names (Mix &
   Master, Cartoon Studio, Logo Maker, Speed Ramp, Color Grade, Photo
   Enhance, Headshot, Avatar Presenter, De-Reverb, Podcast Studio), numbers /
   formats only, Italian cognates & loanwords (Video, Radio, Club, Streaming,
   Avatar, Studio, Stage, Stem, Beat, FX, Vibe, Hype, Tagline, Gaming,
   Minimal, Premium, Standard, Turbo, Anime, Vintage, Neon, Karaoke…). */
const W3_LEGIT = new Set([
  "harmony.buttonCost", "harmony.vb", "harmony.modeAiShort", "harmony.partsLine",
  "songAndVideo.simpleTabLabel",
  "mixMaster.title", "mixMaster.tabMaster", "mixMaster.tabMix",
  "mixMaster.genres.hip-hop.label", "mixMaster.genres.pop.label",
  "mixMaster.genres.rnb.label", "mixMaster.genres.edm.label",
  "mixMaster.genres.rock.label", "mixMaster.genres.lofi.label",
  "mixMaster.genres.afrobeat.label", "mixMaster.genres.gospel.label",
  "mixMaster.genres.podcast.label", "mixMaster.genres.trap.label",
  "mixMaster.loudness.streaming.label", "mixMaster.loudness.club.label",
  "mixMaster.loudness.radio.label", "mixMaster.stemTypes.fx",
  "mixMaster.stemTypes.beat", "mixMaster.stemTypes.other",
  "cartoonStudio.pageTitle", "cartoonStudio.title", "cartoonStudio.styleAnimeName",
  "motionGraphics.templates.typewriter",
  "avatarPresenter.title", "avatarPresenter.avatarLabel",
  "headshotStudio.presetNames.studio", "headshotStudio.presetNames.stage",
  "headshotStudio.presetNames.street", "headshotStudio.presetNames.luxury",
  "headshotStudio.featureName", "headshotStudio.visualBucs",
  "photoEnhance.featureName", "photoEnhance.ops.upscale",
  "photoShoot.scenePacks.packs.neonStage.name",
  "photoShoot.scenePacks.packs.rooftopGolden.name",
  "photoShoot.scenePacks.packs.studioNoir.name",
  "photoShoot.scenePacks.packs.streetLuxury.name",
  "photoShoot.scenePacks.packs.palaceThrone.name",
  "speedRamp.title", "colorGrade.title",
  "deverb.featureName", "deverb.handoffPodcast",
  "captionStyler.styles.hormozi.label", "captionStyler.styles.karaoke.label",
  "captionStyler.styles.luxuryGold.label", "captionStyler.styles.minimal.label",
  "captionStyler.styles.neon.label",
  "clipMaker.secondsLabel", "clipMaker.vibe", "clipMaker.vibeHypeLabel",
  "logoMaker.pageTitle", "logoMaker.title", "logoMaker.taglineLabel",
  "logoMaker.styleGaming", "logoMaker.styleMinimal", "logoMaker.modelPremium",
  "logoMaker.modelStandard", "logoMaker.vb",
  "makeVideo.priceBadge", "makeVideo.unknownStep", "makeVideo.clipFallback",
  "makeVideo.refundedNoticeSuffix",
  "makeVideo.genreHipHop", "makeVideo.genreDrill", "makeVideo.genreTrap",
  "makeVideo.genreRB", "makeVideo.genrePop", "makeVideo.genreAfrobeats",
  "makeVideo.genreDancehall", "makeVideo.genreGospel", "makeVideo.genreRock",
  "makeVideo.genreCountry", "makeVideo.videoStyleBrooklynDrill",
  "makeVideo.platformTiktok",
  "songAndVideo.costBadge",
  "songAndVideo.genreAfrobeats", "songAndVideo.genreCountry",
  "songAndVideo.genreDancehall", "songAndVideo.genreDrill",
  "songAndVideo.genreGospel", "songAndVideo.genreHipHop", "songAndVideo.genrePop",
  "songAndVideo.genreRB", "songAndVideo.genreRock", "songAndVideo.genreTrap",
  "songAndVideo.platformTiktokReels", "songAndVideo.summaryVideo",
  "songAndVideo.videoStyleBrooklynDrill",
  "thumbnail.artStyleAnime", "thumbnail.artStyleVintage",
  "thumbnail.platformAppleMusic", "thumbnail.platformSoundCloud",
  "thumbnail.platformSpotify", "thumbnail.platformYouTube",
  "thumbnailMaker.portraitBlurb", "thumbnailMaker.styleGamingName",
  "thumbnailMaker.styleVlogName",
  "upscale.tabVideoShort", "upscale.target1080p", "upscale.target4k",
]);

describe("it-W3 (Stack-28 #93) — create video/image + audio namespaces fully Italian", () => {
  const r = checkWave(W3_NAMESPACES, [...W3_LEGIT]);
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
  it("carries thumbnailTest.filesSkipped plurals whole (_one/_other/_many)", () => {
    for (const suffix of ["_one", "_other", "_many"]) {
      expect(typeof IT[`thumbnailTest.filesSkipped${suffix}`], `filesSkipped${suffix}`).toBe("string");
    }
  });
});

// ── it-W4 (Stack-28 appendix) — audio + tools namespaces closed whole ──
const W4_NAMESPACES = ["fillerRemover", "mastering", "lrcExport", "samples", "vocalPolish", "vocalTune", "songRework", "producerTag", "audioStudio", "stems", "singingVoice", "beatMaker", "bgReplace", "makeSong", "aiAudio", "sounds", "songs", "beats", "sfx", "translate", "vocalRemoval", "voiceover"];
const W4_LEGIT = new Set([
  "vocalTune.styleHardtuneLabel",
  "lrcExport.aiCost",
  "mastering.truePeakMix",
  "aiAudio.tabs.beats",
  "aiAudio.tabs.samples",
  "audioStudio.tabs.deverb",
  "audioStudio.tabs.hum",
  "audioStudio.tabs.loudness",
  "audioStudio.tabs.master",
  "audioStudio.tabs.podcast",
  "audioStudio.tabs.stems",
  "audioStudio.tabs.voiceover",
  "beatMaker.beatMeta",
  "beatMaker.bpmLabel",
  "beatMaker.bpmValue",
  "beatMaker.duration1m",
  "beatMaker.duration2m",
  "beatMaker.duration30s",
  "beatMaker.duration3m",
  "beatMaker.presetAfrobeats",
  "beatMaker.presetBoomBap",
  "beatMaker.presetDrill",
  "beatMaker.presetHouse",
  "beatMaker.presetTrap",
  "beatMaker.stepSequencerTab",
  "beatMaker.stop",
  "beatMaker.swingValue",
  "beatMaker.title",
  "beatMaker.track808",
  "beatMaker.trackClap",
  "beatMaker.trackCrash",
  "beatMaker.trackPerc",
  "beatMaker.trackShaker",
  "beats.badge",
  "beats.beatCount_one",
  "beats.bpmLabel",
  "beats.tierPremiumLabel",
  "beats.titlePlaceholder",
  "bgReplace.ai.styleStudio",
  "makeSong.cleanOption",
  "makeSong.explicitOption",
  "makeSong.genreAfrobeats",
  "makeSong.genreCountry",
  "makeSong.genreDancehall",
  "makeSong.genreDrill",
  "makeSong.genreGospel",
  "makeSong.genreHipHop",
  "makeSong.genrePop",
  "makeSong.genreRB",
  "makeSong.genreRock",
  "makeSong.genreTrap",
  "makeSong.moodDark",
  "makeSong.moodLabel",
  "makeSong.moodStreet",
  "makeSong.priceBadge",
  "mastering.presets.club.label",
  "mastering.presets.lofi.label",
  "mastering.presets.radio.label",
  "mastering.presets.streaming.label",
  "mastering.title",
  "producerTag.presets.chipmunk",
  "producerTag.presets.hype",
  "producerTag.presets.radio",
  "producerTag.tabLabel",
  "producerTag.title",
  "samples.bpm",
  "samples.credits",
  "samples.genres.afrobeats",
  "samples.genres.drill",
  "samples.genres.drum-and-bass",
  "samples.genres.hip-hop",
  "samples.genres.house",
  "samples.genres.lofi",
  "samples.genres.pop",
  "samples.genres.rnb",
  "samples.genres.techno",
  "samples.genres.trap",
  "samples.tempo",
  "sfx.categoryAmbient",
  "sfx.categoryFoley",
  "sfx.categoryRisers",
  "sfx.categoryWhooshes",
  "sfx.packButton",
  "sfx.titleAccent",
  "singingVoice.abOriginal",
  "songRework.remixCta",
  "songRework.remixTitle",
  "songs.remixButton",
  "songs.sourceCover",
  "songs.sourceMashup",
  "songs.sourceRemix",
  "songs.sourceSongRemix",
  "sounds.heroTitleAccent",
  "sounds.moodChill",
  "sounds.moodHype",
  "sounds.nicheBusiness",
  "sounds.nicheFitness",
  "sounds.nicheGaming",
  "sounds.platformReels",
  "sounds.platformShorts",
  "sounds.platformTiktok",
  "stems.hubAssetDefaultName",
  "stems.midi",
  "stems.modeInstrumental",
  "stems.solo",
  "stems.soloButton",
  "stems.stemPiano",
  "stems.wav",
  "translate.billableMinutes",
  "translate.creditsLabel",
  "translate.perMinuteCost",
  "translate.videoDownload",
  "vocalPolish.abOriginal",
  "vocalPolish.buttonCost",
  "vocalPolish.keyShiftValue",
  "vocalPolish.strengthValue",
  "vocalPolish.tempoLabel",
  "vocalPolish.tempoValue",
  "vocalPolish.title",
  "vocalRemoval.acapella",
  "vocalTune.semitones",
  "voiceover.assetLabel",
  "voiceover.confirmFeatureName",
  "voiceover.creditsEstimate",
  "voiceover.pageTitle",
  "voiceover.voiceoverFallback",
]);

describe("it-W4 (Stack-28 appendix) — audio + tools namespaces fully Italian", () => {
  const r = checkWave(W4_NAMESPACES, [...W4_LEGIT]);
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

});

// ---- W5 (Stack-28 appendix): scheduler + projects/promo band closed
const W5_NAMESPACES: string[] = ["scheduler", "myProjects", "mashup", "repurpose", "myClips", "hooks", "mediaDetector", "scriptWriter", "randomizer", "library", "artistVault", "catalogVault", "streamPack", "importPage", "viralityCheck", "email-list", "titles", "interviewPrep", "trends", "audit", "chooseArtist", "introsOutros", "generations", "hub", "analytics", "retention", "setlist", "content-calendar"];
const W5_LEGIT: string[] = [
  "scheduler.communityPosts.platformLabels.youtube-community",
  "scheduler.communityPosts.badge",
  "scheduler.queue.remixLabel",
  "scheduler.bestTime.benchmark",
  "scheduler.bestTime.bucs",
  "myProjects.typePromoClip",
  "scriptWriter.sendToVoiceover",
  "analytics.creditsPerRun",
  "analytics.hookLabel",
  "artistVault.creditsCount",
  "artistVault.voiceAdvanced",
  "artistVault.voicePresetNatural",
  "audit.handleLabel",
  "audit.platformInstagram",
  "audit.platformTikTok",
  "audit.platformYouTube",
  "chooseArtist.eyebrow",
  "content-calendar.hook_studio",
  "email-list.100_visual_bucs",
  "email-list.builder",
  "email-list.dashboard",
  "email-list.join_2",
  "email-list.thy_cheat_code",
  "generations.type.video",
  "hooks.callToAction",
  "hooks.pfHashtagsPlaceholder",
  "hooks.scoreOutOf",
  "hooks.videoType.tutorial.label",
  "hub.beta",
  "hub.trayAssetCount_one",
  "importPage.formatAudio",
  "importPage.formatVideo",
  "importPage.kbSize",
  "importPage.mbSize",
  "importPage.urlPlaceholder",
  "importPage.video",
  "interviewPrep.artistNamePh",
  "interviewPrep.audienceSizePh",
  "interviewPrep.genrePh",
  "interviewPrep.of100",
  "interviewPrep.typePodcast",
  "interviewPrep.typeRedCarpet",
  "introsOutros.introLabel",
  "introsOutros.outroLabel",
  "introsOutros.taglineLabel",
  "library.headingA",
  "mashup.balanceLabel",
  "mashup.bpmUnknown",
  "mashup.modeSimple",
  "mashup.priceBadge",
  "mashup.styleCrossfade",
  "mashup.tabMashup",
  "myClips.extractAudioCost",
  "myProjects.editor",
  "myProjects.visualBucsUsed",
  "randomizer.crossLink.name",
  "repurpose.modeSmart",
  "repurpose.modeStreamVod",
  "retention.awayDigest.bowRace",
  "retention.quests_progress",
  "scheduler.bestTime.cost",
  "scheduler.communityPosts.platformLabels.instagram",
  "scheduler.communityPosts.platformLabels.threads",
  "scheduler.communityPosts.platformLabels.x",
  "scheduler.composer.video",
  "scheduler.niches.fitness",
  "scheduler.niches.gaming",
  "scheduler.niches.lifestyle",
  "scheduler.niches.tech",
  "scheduler.platforms.facebook.label",
  "scheduler.platforms.instagram.label",
  "scheduler.platforms.instagram.sub",
  "scheduler.platforms.tiktok.label",
  "scheduler.titlePrefix",
  "scriptWriter.bRollLabel",
  "scriptWriter.beatLabel",
  "scriptWriter.ctaTitle",
  "scriptWriter.lengthDeep",
  "scriptWriter.lengthLong",
  "scriptWriter.lengthMedium",
  "scriptWriter.platformReels",
  "scriptWriter.platformTiktok",
  "scriptWriter.platformYoutube",
  "scriptWriter.scriptAssetLabel",
  "scriptWriter.titleHighlight",
  "setlist.durationPlaceholder",
  "titles.crossLinkHook",
  "titles.platformInstagram",
  "titles.platformTikTok",
  "titles.platformYouTube",
  "titles.toneHype",
  "trends.nicheFitness",
  "trends.nicheGaming",
  "trends.nicheTech",
  "trends.platformInstagram",
  "trends.platformTiktok",
  "trends.platformYoutube",
  "viralityCheck.crossLinkHookStudio",
  "viralityCheck.hashtagsPlaceholder",
  "viralityCheck.platformInstagram",
  "viralityCheck.platformTiktok",
  "viralityCheck.platformX",
  "viralityCheck.platformYoutube",
];
describe("it W5 namespaces (Stack-28 appendix)", () => {
  const r = checkWave(W5_NAMESPACES, [...W5_LEGIT]);
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
});

const W6_NAMESPACES: string[] = ["linkInBio", "weekly_contest", "community", "collabs", "team", "discord-bot", "tour", "extension", "shoutouts", "goLive", "shows", "contests", "gamers", "commentReplies", "nfcCards", "privacy", "promote", "coach", "nfcCardProfile", "qrLogin", "notFound", "copyright", "websiteBuilder", "contact", "locations", "milestones"];
const W6_LEGIT: string[] = [
  "linkInBio.public.title",
  "linkInBio.links.urlPlaceholder",
  "linkInBio.theme.onyxMinimal",
  "linkInBio.theme.midnightGold",
  "linkInBio.theme.goldRoyal",
  "linkInBio.profile.avatarUrlPlaceholder",
  "linkInBio.profile.bio",
  "linkInBio.hero.badge",
  "linkInBio.tab",
  "nfcCards.bio",
  "nfcCards.emailPlaceholder",
  "nfcCardProfile.poweredBy",
  "notFound.myProjects",
  "promote.tabs.linkInBio",
  "promote.results.cta",
  "promote.tones.hype",
  "weekly_contest.hall_of_fame",
  "coach.tabTeam",
  "coach.cadencePlaceholder",
  "coach.crossLinkBrand",
  "coach.nicheBeautyFashion",
  "coach.nicheComedy",
  "coach.nicheFitness",
  "coach.nicheGaming",
  "coach.nicheLifestyle",
  "coach.nicheTech",
  "coach.platformInstagram",
  "coach.platformTikTok",
  "coach.platformTikTokBlurb",
  "coach.platformYouTube",
  "coach.platformYouTubeBlurb",
  "coach.titleStart",
  "collabs.bioLabel",
  "collabs.creatorCount_one",
  "collabs.matchCostNote",
  "collabs.tabInbox",
  "collabs.tabInboxWithCount",
  "commentReplies.batchSubline",
  "commentReplies.toneHypeLabel",
  "community.removed",
  "community.tabs.replies.cost",
  "community.tabs.sentiment.cost",
  "community.tabs.sentiment.label",
  "community.tones.hype",
  "contact.email",
  "contests.seed",
  "copyright.copyright",
  "copyright.workType.album.label",
  "discord-bot.discord",
  "discord-bot.discord_bot_shared_secret",
  "discord-bot.discord_bot_token",
  "discord-bot.discord_client_id",
  "discord-bot.live_companion_bot",
  "extension.bdv",
  "extension.chrome_extensions",
  "extension.in_chrome",
  "extension.thy_cheat_code",
  "gamers.loadout",
  "gamers.toolkit",
  "goLive.liveBadge",
  "goLive.pageTitle",
  "goLive.streamFallback",
  "nfcCards.qrSvg",
  "privacy.section4Item1Label",
  "privacy.section4Item2Label",
  "privacy.section4Item3Label",
  "shoutouts.displayNamePlaceholder",
  "shoutouts.perShoutout",
  "shows.titleAccent",
  "shows.titleStart",
  "team.fallbackOff",
  "team.fallbackOn",
  "team.fundPlaceholder",
  "team.roleAdmin",
  "team.spendingAmount",
  "team.teamFallbackName",
  "tour.budgetCrew",
  "tour.heroTitleA",
  "tour.heroTitleB",
  "websiteBuilder.templateLinkInBio",
  "websiteBuilder.templatePressKit",
];
describe("it W6 namespaces (Stack-28 appendix)", () => {
  const r = checkWave(W6_NAMESPACES, [...W6_LEGIT]);
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
});

const W7_NAMESPACES: string[] = ["lufs", "presave", "videoEditor", "release", "stabilize", "create", "nav", "press-public", "press-kit", "moveHome", "videoExport", "wave8", "outreach", "podcast", "admin", "analyticsHub", "captionSuite", "wave9", "contentIntelligence", "hubSpine", "cover-art", "playlist", "dashboard", "liveGuests", "proFinishing", "review", "wallpapers", "djSets", "settings", "share", "tutorials", "brandingKit", "paidSeries", "smartClips", "socialProof"];
const W7_LEGIT: string[] = [
  "presave.cdSecs",
  "presave.cdMins",
  "admin.jackpot.phaseLive",
  "admin.pageTitle",
  "admin.removal.kindPost",
  "admin.removal.liveLabel",
  "admin.removal.reasons.spam",
  "admin.reports.target.post",
  "admin.tiers.tier3",
  "admin.users.credits",
  "analyticsHub.fields.engagementRate",
  "analyticsHub.focus",
  "analyticsHub.heroTitle",
  "analyticsHub.hookStudio",
  "analyticsHub.milestones.loggedFrom",
  "analyticsHub.statEngagement",
  "analyticsHub.tabDashboard",
  "analyticsHub.trendLabel",
  "captionSuite.brandBadge",
  "captionSuite.burnModeHint",
  "captionSuite.credits",
  "captionSuite.endCardText",
  "captionSuite.generateCost",
  "captionSuite.share_facebook",
  "captionSuite.share_telegram",
  "captionSuite.share_whatsapp",
  "contentIntelligence.calendarFrom",
  "contentIntelligence.compUrlPlaceholder",
  "contentIntelligence.platformInstagram",
  "contentIntelligence.platformTikTok",
  "contentIntelligence.platformX",
  "contentIntelligence.platformYouTube",
  "cover-art.dark_hip_hop_triumphant_late_nig",
  "cover-art.midnight_crown",
  "cover-art.thy_cheat_code",
  "cover-art.tier.standard.label",
  "create.modes.video",
  "dashboard.metaTitle",
  "dashboard.tile_hook",
  "dashboard.tile_vibes",
  "dashboard.tile_video",
  "djSets.bpm",
  "djSets.exportRekordbox",
  "hubSpine.attributionTitle",
  "hubSpine.handoffs.meme.label",
  "hubSpine.handoffs.resultLabel",
  "hubSpine.madeWith",
  "hubSpine.promoCards.historyForRelease",
  "hubSpine.promoCards.sizeHint.16x9",
  "liveGuests.backstageFallbackTitle",
  "liveGuests.backstageWord",
  "liveGuests.suffixHost",
  "lufs.formatMp3",
  "lufs.formatWav",
  "moveHome.bioLabel",
  "moveHome.displayNamePh",
  "moveHome.genrePh",
  "moveHome.handlePh",
  "moveHome.locationPh",
  "moveHome.mediaVideo",
  "moveHome.starterProductPh",
  "moveHome.statusLive",
  "moveHome.verticalGaming",
  "moveHome.verticalInfluencer",
  "moveHome.verticalPodcast",
  "moveHome.verticalVideo",
  "nav.account",
  "nav.analytics",
  "nav.arcade",
  "nav.branding",
  "nav.contentCalendar",
  "nav.copyright",
  "nav.credits",
  "nav.dashboard",
  "nav.feed",
  "nav.home",
  "nav.merch",
  "nav.royalties",
  "nav.shorts",
  "nav.social",
  "nav.team",
  "nav.videoEditor",
  "outreach.audiencePlaceholder",
  "outreach.brandNamePlaceholder",
  "outreach.contactPlaceholder",
  "outreach.creatorNamePlaceholder",
  "outreach.heroTitleAccent",
  "outreach.invoice.brandEmailPlaceholder",
  "outreach.invoice.creatorEmailPlaceholder",
  "outreach.productPlaceholder",
  "outreach.sponsorReadCta",
  "paidSeries.buyerInitial",
  "playlist.creatorFallback",
  "playlist.itemsCount_one",
  "playlist.kindPlaylist",
  "playlist.mixBreakdown",
  "playlist.pageTitleWith",
  "podcast.generate.creditsEstimate",
  "podcast.hosts.duo",
  "podcast.hosts.solo",
  "podcast.modes.videoLabel",
  "podcast.result.apple",
  "podcast.result.durationApprox",
  "podcast.result.spotify",
  "podcast.script.creditsCost",
  "podcast.script.durationApprox",
  "press-kit.form.tagline",
  "press-kit.pdf",
  "press-kit.placeholders.artistName",
  "press-kit.placeholders.bookingEmail",
  "press-kit.placeholders.genre",
  "press-kit.placeholders.handle",
  "press-kit.placeholders.location",
  "press-kit.placeholders.url",
  "press-kit.pressRelease.placeholders.contactEmail",
  "press-kit.pressRelease.placeholders.contactPhone",
  "press-kit.pressRelease.types.album",
  "press-kit.pressRelease.types.tour",
  "press-kit.sections.bio",
  "press-kit.tabs.kit",
  "press-public.sections.bio",
  "proFinishing.codecLabel",
  "proFinishing.qualitySummary",
  "proFinishing.sliderStandard",
  "release.crossLinks.p3",
  "release.crossLinks.playlistPitcher",
  "release.titleSuffix",
  "release.types.album.label",
  "release.types.ep.label",
  "review.feedback",
  "review.password",
  "settings.backToDashboard",
  "settings.teamRole_manager",
  "share.attribution",
  "share.whatsapp",
  "smartClips.featureName",
  "socialProof.headlineCreatorWord",
  "tutorials.officialBadge",
  "tutorials.video",
  "videoEditor.audioTitle",
  "videoEditor.clipLabel",
  "videoEditor.inspector",
  "videoEditor.lipSyncTitle",
  "videoEditor.liveBadge",
  "videoEditor.loopChip",
  "videoEditor.mask.presetSpotlight",
  "videoEditor.mediaTitle",
  "videoEditor.modePro",
  "videoEditor.modeSimple",
  "videoEditor.motionTrack.costChip",
  "videoEditor.motionTrack.mode.sticker",
  "videoEditor.multiRatio.statusWorking",
  "videoEditor.myLibrary.filterAudio",
  "videoEditor.myLibrary.filterVideo",
  "videoEditor.no",
  "videoEditor.pageTitle",
  "videoEditor.pipTitle",
  "videoEditor.proToolsTitle",
  "videoEditor.railAudio",
  "videoEditor.railBrand",
  "videoEditor.railLipSync",
  "videoEditor.railMedia",
  "videoEditor.railPrePro",
  "videoEditor.railProTools",
  "videoEditor.railTimeline",
  "videoEditor.railUpscale",
  "videoEditor.railVibes",
  "videoEditor.rendering",
  "videoEditor.stockLibrary.badgeVideo",
  "videoEditor.stockLibrary.sceneSection",
  "videoEditor.studioTitle",
  "videoEditor.styleStealerHook",
  "videoEditor.subjectReframe.costLabel",
  "videoEditor.subjectReframe.platformVertical",
  "videoEditor.subjectReframe.platformYoutube",
  "videoEditor.timelineTitle",
  "videoEditor.vibe_noir",
  "videoEditor.vibe_y2k",
  "videoEditor.vibesTitle",
  "videoEditor.volumeTitle",
  "videoExport.aspectVertical",
  "videoExport.aspectWide",
  "videoExport.audioLine",
  "videoExport.audioPlus",
  "videoExport.colDuration",
  "videoExport.colNum",
  "videoExport.colProvider",
  "videoExport.colUrl",
  "videoExport.fCodec",
  "videoExport.no",
  "videoExport.noWith",
  "videoExport.readyFieldNo",
  "videoExport.toastClipsOne",
  "wallpapers.groupDesktop",
  "wallpapers.groupTablet",
  "wallpapers.rendering",
  "wave8.adlib.takeA",
  "wave8.adlib.takeB",
  "wave8.calendar.notesLabel",
  "wave8.captionStyler.presetKaraoke",
  "wave8.captionStyler.presetPopin",
  "wave8.highlights.reelLengthSeconds",
  "wave8.mediaKit.epkLabel",
  "wave8.merchDrop.ctaLabel",
  "wave8.merchDrop.priceBands.premium",
  "wave8.splits.royaltyAmountPlaceholder",
  "wave9.bgReplace.presetStudio",
  "wave9.cameraMovePlanner.buildCost",
  "wave9.characterDirector.castSelected",
  "wave9.characterDirector.planCost",
  "wave9.directEdit.clipFallback",
  "wave9.directEdit.clipLabel",
  "wave9.remix.master",
];
describe("it W7 namespaces (Stack-28 appendix)", () => {
  const r = checkWave(W7_NAMESPACES, [...W7_LEGIT]);
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
});
