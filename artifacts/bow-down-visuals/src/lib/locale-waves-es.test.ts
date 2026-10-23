/**
 * locale-waves-es.test.ts — Spanish (es) Stack-28 locale waves W1–W5
 * (board items 72 / 81 / 90; audit a7-locale.md §5.3).
 *
 * Each wave closes a set of whole namespaces: every en key of a wave
 * namespace must be present and non-empty in es, and no es value in a
 * closed namespace may be byte-identical to en unless the key sits on
 * the wave's explicit legit-identical allowlist below (brand names —
 * "Bow Down Visuals" / "Visual Bucs" / house plan & product names —
 * platform names, URLs, numbers/formats only, ALL-CAPS codes, and
 * true Spanish cognates/loanwords spelled identically, per §1.4).
 * Plural families are closed whole: es carries the _many form
 * alongside _one/_other wherever the family uses it (§4).
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
const ES = flat(load("es"));
const nonEmpty = (v: unknown): boolean =>
  Array.isArray(v)
    ? v.length > 0 && v.every((x) => (typeof x === "string" ? x.trim() !== "" : x != null))
    : typeof v === "string" && v.trim() !== "";

const W1_NAMESPACES = ["pricing", "referrals", "merch", "memberships", "royalties", "moneyTracker", "refundPolicy", "myShop", "jewelry", "llcGuide", "brandingShop", "tips", "storefrontBuilder", "liveShopping", "contracts", "jewelryShop", "tipPage", "shop", "storefronts", "syncPitch", "brandDeals", "labelPitch", "distribute", "brandCalculator", "sponsors", "sponsorsPost", "sponsorDealDetail", "playlistPitch"] as const;
const W1_LEGIT: ReadonlySet<string> = new Set([
  "brandCalculator.niches.fitness",
  "brandCalculator.niches.gaming",
  "brandDeals.audiences.k10_50k",
  "brandDeals.audiences.k1_10k",
  "brandDeals.audiences.k250plus",
  "brandDeals.audiences.k50_250k",
  "brandDeals.niches.fitness",
  "brandDeals.niches.gaming",
  "brandDeals.resultsCount",
  "brandingShop.colorLabel",
  "brandingShop.departments.merch",
  "brandingShop.totalLabel",
  "distribute.100_visual_bucs",
  "distribute.bow_down_records",
  "distribute.hip_hop_trap",
  "distribute.isrc",
  "distribute.isrc_2",
  "distribute.midnight_frequencies",
  "distribute.shark_king",
  "distribute.tier.ep.label",
  "distribute.us_xxx_26_00001",
  "distribute.visual_bucs",
  "jewelry.merchWord",
  "jewelry.metal",
  "jewelry.nfcNo",
  "jewelry.stepLogo",
  "jewelryShop.total",
  "labelPitch.genres.afrobeats",
  "labelPitch.genres.country",
  "labelPitch.genres.edm",
  "labelPitch.genres.hip-hop",
  "labelPitch.genres.latin",
  "labelPitch.genres.pop",
  "labelPitch.genres.r&b",
  "labelPitch.genres.rock",
  "labelPitch.labelOneSheet",
  "liveShopping.crossLinkEnd",
  "llcGuide.cheatCodeLabel",
  "llcGuide.creatorPodcaster",
  "llcGuide.creatorStreamer",
  "llcGuide.creatorYouTuber",
  "llcGuide.statEin",
  "memberships.aiCost",
  "merch.pricePlaceholder",
  "merch.styles.streetwear.label",
  "merch.styles.vintage.label",
  "merch.tabs.design",
  "moneyTracker.cat_software",
  "moneyTracker.title",
  "myShop.domainPlaceholder",
  "myShop.handlePlaceholder",
  "myShop.premium200",
  "myShop.pricePlaceholder",
  "myShop.productNamePlaceholder",
  "myShop.shopNamePlaceholder",
  "playlistPitch.copyDmLabel",
  "pricing.creditPacks.packs.10.credits",
  "pricing.creditPacks.packs.10.price",
  "pricing.creditPacks.packs.150.credits",
  "pricing.creditPacks.packs.150.price",
  "pricing.creditPacks.packs.50.credits",
  "pricing.creditPacks.packs.50.price",
  "pricing.creditPacks.packs.500.credits",
  "pricing.creditPacks.packs.500.price",
  "pricing.plans.crimeBoss.name",
  "pricing.plans.gangster.name",
  "pricing.plans.hustler.features.f4",
  "pricing.plans.hustler.features.f5",
  "pricing.plans.hustler.name",
  "pricing.plans.kingpin.name",
  "pricing.plans.shotCaller.name",
  "pricing.plans.streetPunk.name",
  "referrals.contest.days",
  "referrals.contest.hours",
  "referrals.contest.prizeFor",
  "referrals.contest.secs",
  "referrals.hero.p4",
  "referrals.sharekit.templates.chat",
  "referrals.sharekit.templates.threads",
  "referrals.titleSuffix",
  "referrals.tracker.earned",
  "royalties.insights.cost",
  "shop.totalLabel",
  "sponsorDealDetail.followersPlaceholder",
  "sponsors.matchFollowersPlaceholder",
  "sponsors.matchPlatformsPlaceholder",
  "sponsorsPost.budgetMaxPlaceholder",
  "sponsorsPost.budgetMinPlaceholder",
  "storefrontBuilder.handlePlaceholder",
  "storefrontBuilder.step3Cost",
  "syncPitch.madeWith",
  "syncPitch.no",
  "syncPitch.statBpm",
  "syncPitch.statInstrumental",
  "syncPitch.statStems",
  "syncPitch.tagInstrumental",
  "syncPitch.tagStems",
  "syncPitch.typeTv",
  "tips.goalAmountPlaceholder",
  "tips.suggestedPlaceholder",
  "tips.tipMeta"
]);

describe("es W1 (Stack-28 #72) — namespaces closed whole", () => {
  const keys = Object.keys(EN).filter((k) => W1_NAMESPACES.some((ns) => k === ns || k.startsWith(`${ns}.`)));
  it("every en key of the wave namespaces is present and non-empty in es", () => {
    const bad = keys.filter((k) => !(k in ES) || !nonEmpty(ES[k]));
    expect(bad, `es W1 missing/empty: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("no es value is identical to en outside the legit allowlist", () => {
    const bad = keys.filter((k) => k in ES && JSON.stringify(ES[k]) === JSON.stringify(EN[k]) && !W1_LEGIT.has(k));
    expect(bad, `es W1 untranslated residue: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("the legit allowlist names only keys still identical to en (no stale entries)", () => {
    for (const k of W1_LEGIT) {
      expect(EN[k], `allowlist entry ${k} missing from en`).toBeDefined();
      expect(JSON.stringify(ES[k]), `allowlist entry ${k} no longer identical — drop it`).toBe(JSON.stringify(EN[k]));
    }
  });
});

const W2_NAMESPACES = ["retentionDoctor", "retentionDelight", "invite", "fomoFeed", "planPublic", "home", "delight", "academy", "common", "features", "waitlist", "auth", "signup", "betaAccess", "promo-clip", "splitScreen", "productPhotoStudio", "carouselMaker", "videoTemplates", "movies", "motionGraphics"] as const;
const W2_LEGIT: ReadonlySet<string> = new Set([
  "academy.coachRole",
  "academy.hoursPlaceholder",
  "academy.lessonMinutes",
  "auth.passwordPlaceholder",
  "betaAccess.badgeBeta",
  "carouselMaker.brandColorsPlaceholder",
  "carouselMaker.fontDisplay",
  "carouselMaker.fontSans",
  "carouselMaker.fontSerif",
  "common.beta",
  "common.premium",
  "common.visualBucs",
  "features.cheat_code",
  "home.demo.hiphop.label",
  "home.demo.pop.label",
  "home.demo.rnb.label",
  "home.extTitleA",
  "home.faqKicker",
  "home.formats.podcasts.title",
  "home.formats.streamers.title",
  "home.vaultBodyB",
  "movies.comparables",
  "movies.epLabel",
  "movies.logline",
  "movies.streamUrlPlaceholder",
  "productPhotoStudio.confirmFeature",
  "productPhotoStudio.credits",
  "productPhotoStudio.modelIdeogram",
  "productPhotoStudio.modelNano",
  "productPhotoStudio.packshot",
  "productPhotoStudio.pastePlaceholder",
  "productPhotoStudio.title",
  "promo-clip.clips.count_one",
  "promo-clip.clips.count_other",
  "promo-clip.clipsSelector.clipFallback",
  "promo-clip.creditBadge",
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
  "promo-clip.platforms.tiktok",
  "promo-clip.tags.ctas",
  "promo-clip.tags.hashtags",
  "retentionDelight.prefs_sharkDrops",
  "retentionDoctor.atPlaceholder",
  "retentionDoctor.dropPlaceholder",
  "retentionDoctor.platform_instagram",
  "retentionDoctor.platform_tiktok",
  "retentionDoctor.platform_x",
  "retentionDoctor.platform_youtube",
  "retentionDoctor.type_tutorial",
  "retentionDoctor.type_vlog",
  "splitScreen.cellN",
  "splitScreen.modeSimple",
  "videoTemplates.kindVideo",
  "waitlist.badgeBeta"
]);

describe("es W2 (Stack-28 #81) — namespaces closed whole", () => {
  const keys = Object.keys(EN).filter((k) => W2_NAMESPACES.some((ns) => k === ns || k.startsWith(`${ns}.`)));
  it("every en key of the wave namespaces is present and non-empty in es", () => {
    const bad = keys.filter((k) => !(k in ES) || !nonEmpty(ES[k]));
    expect(bad, `es W2 missing/empty: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("no es value is identical to en outside the legit allowlist", () => {
    const bad = keys.filter((k) => k in ES && JSON.stringify(ES[k]) === JSON.stringify(EN[k]) && !W2_LEGIT.has(k));
    expect(bad, `es W2 untranslated residue: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("the legit allowlist names only keys still identical to en (no stale entries)", () => {
    for (const k of W2_LEGIT) {
      expect(EN[k], `allowlist entry ${k} missing from en`).toBeDefined();
      expect(JSON.stringify(ES[k]), `allowlist entry ${k} no longer identical — drop it`).toBe(JSON.stringify(EN[k]));
    }
  });
});

const W3_NAMESPACES = ["cartoonStudio", "bgStudio", "headshotStudio", "colorGrade", "photoEnhance", "speedRamp", "captionTemplates", "videoTemplatesPage", "photoShoot", "upscale", "makeVideo", "songAndVideo", "avatarPresenter", "thumbnailMaker", "thumbnailStudio", "thumbnail", "clipMaker", "logoMaker", "captionStyler", "thumbnailTest", "thumbnails", "watermarkRemoval", "harmony", "mixMaster", "deverb", "fillerRemover", "lrcExport"] as const;
const W3_LEGIT: ReadonlySet<string> = new Set([
  "avatarPresenter.avatarLabel",
  "bgStudio.kind.color",
  "captionStyler.autoEmoji",
  "captionStyler.styles.hormozi.label",
  "captionStyler.styles.karaoke.label",
  "cartoonStudio.pageTitle",
  "cartoonStudio.styleAnimeName",
  "cartoonStudio.title",
  "clipMaker.secondsLabel",
  "deverb.abOriginal",
  "deverb.featureName",
  "deverb.handoffPodcast",
  "deverb.handoffVoiceover",
  "deverb.labelOriginal",
  "harmony.buttonCost",
  "harmony.confirmFeature",
  "harmony.partsLine",
  "harmony.title",
  "harmony.vb",
  "headshotStudio.models.ideogram",
  "headshotStudio.models.nano",
  "headshotStudio.visualBucs",
  "logoMaker.modelPremium",
  "logoMaker.styleGaming",
  "logoMaker.vb",
  "lrcExport.aiCost",
  "makeVideo.clipFallback",
  "makeVideo.genreAfrobeats",
  "makeVideo.genreCountry",
  "makeVideo.genreDancehall",
  "makeVideo.genreDrill",
  "makeVideo.genreHipHop",
  "makeVideo.genrePop",
  "makeVideo.genreRB",
  "makeVideo.genreRock",
  "makeVideo.genreTrap",
  "makeVideo.platformTiktok",
  "makeVideo.priceBadge",
  "makeVideo.refundedNoticeSuffix",
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
  "mixMaster.stemTypes.fx",
  "mixMaster.stemTypes.other",
  "mixMaster.tabMixStems",
  "photoEnhance.featureName",
  "songAndVideo.costBadge",
  "songAndVideo.genreAfrobeats",
  "songAndVideo.genreCountry",
  "songAndVideo.genreDancehall",
  "songAndVideo.genreDrill",
  "songAndVideo.genreHipHop",
  "songAndVideo.genrePop",
  "songAndVideo.genreRB",
  "songAndVideo.genreRock",
  "songAndVideo.genreTrap",
  "songAndVideo.platformTiktokReels",
  "songAndVideo.simpleTabLabel",
  "songAndVideo.summaryVideo",
  "songAndVideo.videoStyleBrooklynDrill",
  "speedRamp.slowmo.simple",
  "thumbnail.artStyleAnime",
  "thumbnail.artStyleVintage",
  "thumbnail.platformAppleMusic",
  "thumbnail.platformSoundCloud",
  "thumbnail.platformSpotify",
  "thumbnail.platformYouTube",
  "thumbnailMaker.portraitBlurb",
  "thumbnailMaker.styleGamingName",
  "thumbnailMaker.styleVlogName",
  "upscale.tabVideoShort",
  "upscale.target1080p",
  "upscale.target4k"
]);

describe("es W3 (Stack-28 #90) — namespaces closed whole", () => {
  const keys = Object.keys(EN).filter((k) => W3_NAMESPACES.some((ns) => k === ns || k.startsWith(`${ns}.`)));
  it("every en key of the wave namespaces is present and non-empty in es", () => {
    const bad = keys.filter((k) => !(k in ES) || !nonEmpty(ES[k]));
    expect(bad, `es W3 missing/empty: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("no es value is identical to en outside the legit allowlist", () => {
    const bad = keys.filter((k) => k in ES && JSON.stringify(ES[k]) === JSON.stringify(EN[k]) && !W3_LEGIT.has(k));
    expect(bad, `es W3 untranslated residue: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("the legit allowlist names only keys still identical to en (no stale entries)", () => {
    for (const k of W3_LEGIT) {
      expect(EN[k], `allowlist entry ${k} missing from en`).toBeDefined();
      expect(JSON.stringify(ES[k]), `allowlist entry ${k} no longer identical — drop it`).toBe(JSON.stringify(EN[k]));
    }
  });
});

const W4_NAMESPACES = ["mastering", "samples", "vocalPolish", "vocalTune", "songRework", "producerTag", "audioStudio", "stems", "singingVoice", "bgReplace", "beatMaker", "aiAudio", "makeSong", "songs", "sounds", "sfx", "beats", "translate", "vocalRemoval", "audioCleanup", "voiceover", "scheduler"] as const;
const W4_LEGIT: ReadonlySet<string> = new Set([
  "aiAudio.tabs.beats",
  "aiAudio.tabs.samples",
  "audioCleanup.abOriginal",
  "audioStudio.tabs.deverb",
  "audioStudio.tabs.hum",
  "audioStudio.tabs.loudness",
  "audioStudio.tabs.master",
  "audioStudio.tabs.podcast",
  "audioStudio.tabs.sounds",
  "audioStudio.tabs.stems",
  "audioStudio.tabs.voiceover",
  "beatMaker.beatMeta",
  "beatMaker.bpmLabel",
  "beatMaker.bpmValue",
  "beatMaker.duration1m",
  "beatMaker.duration2m",
  "beatMaker.duration3m",
  "beatMaker.presetAfrobeats",
  "beatMaker.presetBoomBap",
  "beatMaker.presetDrill",
  "beatMaker.presetHouse",
  "beatMaker.presetTrap",
  "beatMaker.swingValue",
  "beatMaker.titlePlaceholder",
  "beatMaker.track808",
  "beatMaker.trackCrash",
  "beatMaker.trackPerc",
  "beatMaker.trackShaker",
  "beats.bpmLabel",
  "beats.tierPremiumLabel",
  "beats.titlePlaceholder",
  "bgReplace.ai.presetsTab",
  "makeSong.genreAfrobeats",
  "makeSong.genreCountry",
  "makeSong.genreDancehall",
  "makeSong.genreDrill",
  "makeSong.genreHipHop",
  "makeSong.genrePop",
  "makeSong.genreRB",
  "makeSong.genreRock",
  "makeSong.genreTrap",
  "makeSong.priceBadge",
  "mastering.downloadMp3",
  "mastering.downloadWav",
  "mastering.presets.club.label",
  "mastering.presets.lofi.label",
  "mastering.presets.radio.label",
  "mastering.presets.streaming.label",
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
  "scheduler.bestTime.benchmark",
  "scheduler.bestTime.bucs",
  "scheduler.bestTime.cost",
  "scheduler.communityPosts.badge",
  "scheduler.communityPosts.platformLabels.instagram",
  "scheduler.communityPosts.platformLabels.threads",
  "scheduler.communityPosts.platformLabels.x",
  "scheduler.communityPosts.platformLabels.youtube-community",
  "scheduler.composer.hashtags",
  "scheduler.composer.video",
  "scheduler.niches.fitness",
  "scheduler.niches.gaming",
  "scheduler.platforms.facebook.label",
  "scheduler.platforms.instagram.label",
  "scheduler.platforms.instagram.sub",
  "scheduler.platforms.tiktok.label",
  "scheduler.tabs.plan",
  "scheduler.titlePrefix",
  "scheduler.titleSuffix",
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
  "sounds.nicheFitness",
  "sounds.platformReels",
  "sounds.platformShorts",
  "sounds.platformTiktok",
  "stems.hubAssetDefaultName",
  "stems.instrumentalHubAssetLabel",
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
  "vocalRemoval.instrumental",
  "vocalTune.abOriginal",
  "vocalTune.semitones",
  "vocalTune.title",
  "voiceover.creditsEstimate",
]);
describe("es W4 (Stack-28 appendix) — namespaces closed whole", () => {
  const keys = Object.keys(EN).filter((k) => W4_NAMESPACES.some((ns) => k === ns || k.startsWith(`${ns}.`)));
  it("every en key of the wave namespaces is present and non-empty in es", () => {
    const bad = keys.filter((k) => !(k in ES) || !nonEmpty(ES[k]));
    expect(bad, `es W4 missing/empty: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("no es value is identical to en outside the legit allowlist", () => {
    const bad = keys.filter((k) => k in ES && JSON.stringify(ES[k]) === JSON.stringify(EN[k]) && !W4_LEGIT.has(k));
    expect(bad, `es W4 untranslated residue: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("the legit allowlist names only keys still identical to en (no stale entries)", () => {
    for (const k of W4_LEGIT) {
      expect(EN[k], `allowlist entry ${k} missing from en`).toBeDefined();
      expect(JSON.stringify(ES[k]), `allowlist entry ${k} no longer identical — drop it`).toBe(JSON.stringify(EN[k]));
    }
  });
});

const W5_NAMESPACES = ["myProjects", "mashup", "repurpose", "myClips", "hooks", "mediaDetector", "scriptWriter", "randomizer", "library", "artistVault", "catalogVault", "streamPack", "importPage", "titles", "viralityCheck", "retention", "interviewPrep", "trends", "email-list", "chooseArtist", "analytics", "audit", "generations", "introsOutros", "setlist", "hub", "linkInBio", "weekly_contest", "community", "shows", "discord-bot", "collabs", "extension", "contests", "team", "commentReplies", "shoutouts", "tour", "nfcCards"] as const;
const W5_LEGIT: ReadonlySet<string> = new Set([
  "library.tabPresets",
  "linkInBio.profile.bio",
  "artistVault.voicePresetNatural",
  "analytics.creditsPerRun",
  "artistVault.creditsCount",
  "audit.platformInstagram",
  "audit.platformTikTok",
  "audit.platformYouTube",
  "chooseArtist.eyebrow",
  "collabs.bioLabel",
  "commentReplies.batchSubline",
  "commentReplies.toneHypeLabel",
  "community.tabs.superfans.label",
  "community.tones.hype",
  "discord-bot.discord",
  "discord-bot.discord_bot_shared_secret",
  "discord-bot.discord_bot_token",
  "discord-bot.discord_client_id",
  "email-list.100_visual_bucs",
  "email-list.join_2",
  "email-list.thy_cheat_code",
  "email-list.your_handle",
  "extension.bdv",
  "extension.chrome_extensions",
  "extension.thy_cheat_code",
  "generations.type.video",
  "hooks.hashtagsLabel",
  "hooks.heroTitleA",
  "hooks.scoreOutOf",
  "hooks.videoType.tutorial.label",
  "hub.beta",
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
  "introsOutros.introLabel",
  "introsOutros.outroLabel",
  "library.headingA",
  "linkInBio.links.urlPlaceholder",
  "linkInBio.profile.avatarUrlPlaceholder",
  "linkInBio.tipJar.placeholder",
  "mashup.balanceLabel",
  "mashup.bpmUnknown",
  "mashup.modeSimple",
  "mashup.priceBadge",
  "mashup.styleCrossfade",
  "mashup.tabMashup",
  "myClips.extractAudioCost",
  "myProjects.editor",
  "myProjects.typePromoClip",
  "myProjects.typeThumbnail",
  "myProjects.typeThumbnailPrompt",
  "myProjects.visualBucsUsed",
  "nfcCards.bio",
  "nfcCards.qrSvg",
  "nfcCards.total",
  "randomizer.crossLink.name",
  "repurpose.modeSmart",
  "repurpose.modeStreamVod",
  "retention.awayDigest.bowRaceProgress",
  "retention.dailyDrop.title",
  "retention.drops.podcast-episode-thumbnail.title",
  "retention.prefs.dailyDropEnabled.title",
  "retention.quests_progress",
  "scriptWriter.bRollLabel",
  "scriptWriter.beatLabel",
  "scriptWriter.lengthDeep",
  "scriptWriter.lengthLong",
  "scriptWriter.lengthMedium",
  "scriptWriter.platformReels",
  "scriptWriter.platformTiktok",
  "scriptWriter.platformYoutube",
  "scriptWriter.teleprompterTitle",
  "setlist.durationPlaceholder",
  "setlist.setlistFallback",
  "shows.typeOpenMics",
  "shows.typePodcasts",
  "shows.typeShowcases",
  "team.fundPlaceholder",
  "team.spendingAmount",
  "titles.costBadge",
  "titles.platformInstagram",
  "titles.platformTikTok",
  "titles.platformYouTube",
  "titles.toneHype",
  "trends.nicheFitness",
  "trends.nicheGaming",
  "trends.platformInstagram",
  "trends.platformTiktok",
  "trends.platformYoutube",
  "viralityCheck.hashtagsLabel",
  "viralityCheck.hashtagsScoreLabel",
  "viralityCheck.platformInstagram",
  "viralityCheck.platformTiktok",
  "viralityCheck.platformX",
  "viralityCheck.platformYoutube",
]);
describe("es W5 (Stack-28 appendix) — namespaces closed whole", () => {
  const keys = Object.keys(EN).filter((k) => W5_NAMESPACES.some((ns) => k === ns || k.startsWith(`${ns}.`)));
  it("every en key of the wave namespaces is present and non-empty in es", () => {
    const bad = keys.filter((k) => !(k in ES) || !nonEmpty(ES[k]));
    expect(bad, `es W5 missing/empty: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("no es value is identical to en outside the legit allowlist", () => {
    const bad = keys.filter((k) => k in ES && JSON.stringify(ES[k]) === JSON.stringify(EN[k]) && !W5_LEGIT.has(k));
    expect(bad, `es W5 untranslated residue: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("the legit allowlist names only keys still identical to en (no stale entries)", () => {
    for (const k of W5_LEGIT) {
      expect(EN[k], `allowlist entry ${k} missing from en`).toBeDefined();
      expect(JSON.stringify(ES[k]), `allowlist entry ${k} no longer identical — drop it`).toBe(JSON.stringify(EN[k]));
    }
  });
});
