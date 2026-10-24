/**
 * locale-waves-ja.test.ts — Stack-28 locale lane, Japanese waves ja-W1..W5
 * (board items 76, 85, 94, 98; wave definitions: a7-locale.md §5.7).
 *
 * Pins, per completed wave: every en key in the wave's namespaces is
 * present in ja (except the explicit CLDR/legit missing allowlist —
 * Japanese selects only the `_other` plural category, so `_one` forms
 * are correctly absent), and no key in those namespaces is still
 * identical to en except the explicit legit-identical allowlist
 * (brand/house names, platform names, URLs, placeholder-only values,
 * numbers, proper-noun placeholder examples — a7-locale.md §1.4).
 * Also pins placeholder parity and zero U+FFFD on wave keys.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function load(locale: string): Record<string, unknown> {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}
function flat(o: unknown, p = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(o)) { out[p] = o; return out; }
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) flat(v, p ? `${p}.${k}` : k, out);
    return out;
  }
  out[p] = o; return out;
}
const EN = flat(load("en"));
const JA = flat(load("ja"));

const WAVES: Record<string, { namespaces: string[]; legitIdentical: string[]; legitMissing: string[] }> = {
  W1: {
    namespaces: ["pricing", "referrals", "memberships", "merch", "royalties", "moneyTracker", "refundPolicy", "tips", "myShop", "storefrontBuilder", "contracts", "tipPage", "storefronts", "jewelry", "jewelryShop", "brandingShop", "liveShopping", "llcGuide", "syncPitch", "brandDeals", "distribute", "sponsors", "sponsorsPost", "sponsorDealDetail", "labelPitch", "brandCalculator", "playlistPitch"],
    legitIdentical: ["brandDeals.resultsCount", "distribute.100_visual_bucs", "distribute.bow_down_records", "distribute.isrc", "distribute.midnight_frequencies", "distribute.shark_king", "distribute.tier.ep.label", "distribute.us_xxx_26_00001", "distribute.visual_bucs", "liveShopping.liveBadge", "llcGuide.creatorYouTuber", "memberships.aiCost", "merch.pricePlaceholder", "myShop.domainPlaceholder", "myShop.handlePlaceholder", "myShop.pricePlaceholder", "myShop.productNamePlaceholder", "myShop.shopNamePlaceholder", "playlistPitch.copyDmLabel", "pricing.creditPacks.packs.10.credits", "pricing.creditPacks.packs.10.price", "pricing.creditPacks.packs.150.credits", "pricing.creditPacks.packs.150.price", "pricing.creditPacks.packs.50.credits", "pricing.creditPacks.packs.50.price", "pricing.creditPacks.packs.500.credits", "pricing.creditPacks.packs.500.price", "pricing.plans.crimeBoss.name", "pricing.plans.gangster.name", "pricing.plans.hustler.features.f5", "pricing.plans.hustler.name", "pricing.plans.kingpin.name", "pricing.plans.shotCaller.name", "pricing.plans.streetPunk.features.f1", "pricing.plans.streetPunk.name", "referrals.contest.prizeFor", "referrals.hero.p4", "referrals.sharekit.templates.chat", "referrals.sharekit.templates.threads", "referrals.tracker.earned", "royalties.insights.cost", "sponsorDealDetail.followersPlaceholder", "sponsors.matchFollowersPlaceholder", "sponsors.matchPlatformsPlaceholder", "sponsorsPost.budgetMaxPlaceholder", "sponsorsPost.budgetMinPlaceholder", "storefrontBuilder.domainPlaceholder", "storefrontBuilder.handlePlaceholder", "storefrontBuilder.shopPreviewHandle", "storefrontBuilder.step3Cost", "syncPitch.statBpm", "syncPitch.typeTv", "tips.displayNamePlaceholder", "tips.goalAmountPlaceholder", "tips.handlePlaceholder", "tips.suggestedPlaceholder", "tips.tipMeta"],
    legitMissing: ["pricing.wantedMeter.hoverLabel_one", "pricing.wantedMeter.starOption_one"],
  },
  W2: {
    namespaces: ["retentionDoctor", "retentionDelight", "invite", "fomoFeed", "planPublic", "delight", "home", "academy", "common", "auth", "features", "waitlist", "promo-clip", "splitScreen", "productPhotoStudio", "carouselMaker", "videoTemplates", "movies", "motionGraphics"],
    legitIdentical: ["academy.hoursPlaceholder", "auth.emailPlaceholder", "auth.passwordPlaceholder", "carouselMaker.brandColorsPlaceholder", "common.visualBucs", "home.demo.rnb.label", "home.faqKicker", "home.konamiAlt", "productPhotoStudio.credits", "productPhotoStudio.pastePlaceholder", "promo-clip.creditBadge", "promo-clip.genres.afrobeats", "promo-clip.genres.country", "promo-clip.genres.dancehall", "promo-clip.genres.drill", "promo-clip.genres.gospel", "promo-clip.genres.hipHop", "promo-clip.genres.pop", "promo-clip.genres.rnb", "promo-clip.genres.rock", "promo-clip.genres.trap", "promo-clip.platforms.reels", "promo-clip.platforms.shorts", "promo-clip.platforms.tiktok", "retentionDoctor.atPlaceholder", "retentionDoctor.platform_instagram", "retentionDoctor.platform_tiktok", "retentionDoctor.platform_x", "retentionDoctor.platform_youtube", "retentionDoctor.type_vlog", "splitScreen.modeSimple"],
    legitMissing: ["promo-clip.clips.count_one", "promo-clip.summary.clipsSelected_one"],
  },
  W3: {
    namespaces: ["cartoonStudio", "bgStudio", "headshotStudio", "colorGrade", "photoEnhance", "speedRamp", "captionTemplates", "videoTemplatesPage", "photoShoot", "upscale", "avatarPresenter", "thumbnailStudio", "songAndVideo", "thumbnailMaker", "makeVideo", "captionStyler", "thumbnail", "thumbnailTest", "thumbnails", "clipMaker", "watermarkRemoval", "logoMaker", "mixMaster", "harmony", "deverb", "fillerRemover", "mastering"],
    legitIdentical: ["captionStyler.styles.hormozi.label", "captionStyler.styles.karaoke.label", "captionStyler.styles.luxuryGold.label", "captionStyler.styles.minimal.label", "captionStyler.styles.neon.label", "cartoonStudio.styleAnimeName", "harmony.buttonCost", "harmony.modeAiShort", "harmony.partsLine", "harmony.vb", "headshotStudio.visualBucs", "logoMaker.vb", "makeVideo.genreRB", "makeVideo.platformTiktok", "makeVideo.platformYoutube", "makeVideo.priceBadge", "makeVideo.unknownStep", "mastering.presets.lofi.label", "mixMaster.genres.afrobeat.label", "mixMaster.genres.edm.label", "mixMaster.genres.gospel.label", "mixMaster.genres.hip-hop.label", "mixMaster.genres.lofi.label", "mixMaster.genres.podcast.label", "mixMaster.genres.pop.label", "mixMaster.genres.rnb.label", "mixMaster.genres.rock.label", "mixMaster.genres.trap.label", "mixMaster.stemTypes.fx", "songAndVideo.costBadge", "songAndVideo.genreRB", "songAndVideo.platformTiktokReels", "songAndVideo.platformYoutube", "songAndVideo.simpleTabLabel", "thumbnail.platformAppleMusic", "thumbnail.platformSoundCloud", "thumbnail.platformSpotify", "thumbnail.platformYouTube", "thumbnailMaker.styleVlogName"],
    legitMissing: ["thumbnailTest.filesSkipped_one"],
  },
  W4: {
    namespaces: ["lrcExport", "samples", "vocalPolish", "vocalTune", "songRework", "producerTag", "audioStudio", "singingVoice", "stems", "bgReplace", "beatMaker", "aiAudio", "songs", "beats", "sounds", "makeSong", "translate", "sfx", "lyricVideo", "voiceover", "scheduler", "myProjects"],
    legitIdentical: ["beatMaker.bpmLabel", "beatMaker.bpmValue", "beatMaker.presetAfrobeats", "beatMaker.presetBoomBap", "beatMaker.presetDrill", "beatMaker.presetTrap", "beatMaker.titlePlaceholder", "beatMaker.track808", "beatMaker.trackClap", "beatMaker.trackClosedHat", "beatMaker.trackKick", "beatMaker.trackOpenHat", "beatMaker.trackPerc", "beatMaker.trackShaker", "beatMaker.trackSnare", "beats.bpmLabel", "beats.keyPlaceholder", "beats.moodTagsPlaceholder", "beats.titlePlaceholder", "lrcExport.aiCost", "lyricVideo.lyricsPlaceholder", "makeSong.genreRB", "makeSong.priceBadge", "myProjects.visualBucsUsed", "samples.bpm", "samples.credits", "samples.genres.afrobeats", "samples.genres.drill", "samples.genres.drum-and-bass", "samples.genres.hip-hop", "samples.genres.house", "samples.genres.lofi", "samples.genres.pop", "samples.genres.rnb", "samples.genres.techno", "samples.genres.trap", "scheduler.bestTime.bucs", "scheduler.bestTime.cost", "scheduler.communityPosts.platformLabels.instagram", "scheduler.communityPosts.platformLabels.threads", "scheduler.communityPosts.platformLabels.x", "scheduler.communityPosts.platformLabels.youtube-community", "scheduler.platforms.facebook.label", "scheduler.platforms.instagram.label", "scheduler.platforms.instagram.sub", "scheduler.platforms.tiktok.label", "scheduler.titlePrefix", "scheduler.titleSuffix", "sfx.titleAccent", "sounds.platformReels", "sounds.platformShorts", "sounds.platformTiktok", "stems.hubAssetDefaultName", "stems.midi", "stems.soloButton", "stems.wav", "translate.creditsLabel", "translate.perMinuteCost", "vocalPolish.buttonCost", "vocalPolish.keyShiftValue", "vocalPolish.strengthValue", "vocalPolish.tempoValue", "vocalTune.semitones", "voiceover.creditsEstimate"],
    legitMissing: [],
  },
  W5: {
    namespaces: ["mashup", "repurpose", "myClips", "hooks", "mediaDetector", "randomizer", "scriptWriter", "library", "artistVault", "catalogVault", "streamPack", "viralityCheck", "retention", "titles", "email-list", "importPage", "audit", "interviewPrep", "chooseArtist", "trends", "generations", "setlist", "linkInBio", "weekly_contest", "discord-bot", "shoutouts", "team", "community", "collabs", "contests", "extension", "goLive", "shows", "tour", "nfcCards", "privacy", "promote", "coach", "nfcCardProfile", "qrLogin"],
    legitIdentical: ["scriptWriter.teleprompterWpmValue", "promote.hero.titleAccent", "privacy.section4Item3Label", "privacy.section4Item2Label", "privacy.section4Item1Label", "nfcCardProfile.poweredBy", "linkInBio.theme.onyxMinimal", "artistVault.creditsCount", "audit.handlePlaceholder", "audit.platformInstagram", "audit.platformTikTok", "audit.platformYouTube", "chooseArtist.eyebrow", "coach.cadencePlaceholder", "coach.crossLinkBrand", "coach.platformInstagram", "coach.platformTikTok", "coach.platformYouTube", "coach.titleStart", "discord-bot.discord", "discord-bot.discord_bot_shared_secret", "discord-bot.discord_bot_token", "discord-bot.discord_client_id", "email-list.100_visual_bucs", "email-list.join_2", "email-list.thy_cheat_code", "email-list.your_handle", "extension.bdv", "extension.chrome_extensions", "goLive.pageTitle", "hooks.heroTitleA", "hooks.heroTitleB", "hooks.pfHashtagsPlaceholder", "hooks.scoreOutOf", "importPage.kbSize", "importPage.mbSize", "importPage.urlPlaceholder", "interviewPrep.artistNamePh", "interviewPrep.audienceSizePh", "interviewPrep.genrePh", "interviewPrep.of100", "library.headingA", "linkInBio.links.urlPlaceholder", "linkInBio.profile.avatarUrlPlaceholder", "linkInBio.tipJar.placeholder", "mashup.balanceLabel", "mashup.bpmUnknown", "mashup.modeSimple", "mashup.priceBadge", "mashup.styleCrossfade", "mashup.tabMashup", "myClips.extractAudioCost", "nfcCards.qrSvg", "randomizer.crossLink.name", "repurpose.modeLabel", "repurpose.modeStreamVod", "retention.awayDigest.bowRace", "retention.awayDigest.jackpot", "retention.dailyDrop.title", "retention.prefs.dailyDropEnabled.title", "retention.quests_progress", "scriptWriter.platformReels", "scriptWriter.platformTiktok", "scriptWriter.platformYoutube", "setlist.durationPlaceholder", "shoutouts.displayNamePlaceholder", "shoutouts.emailPlaceholder", "team.fundPlaceholder", "team.inviteEmailPlaceholder", "team.spendingAmount", "titles.crossLinkHook", "titles.platformInstagram", "titles.platformTikTok", "titles.platformYouTube", "trends.platformInstagram", "trends.platformTiktok", "trends.platformYoutube", "viralityCheck.crossLinkHookStudio", "viralityCheck.hashtagsPlaceholder", "viralityCheck.platformInstagram", "viralityCheck.platformTiktok", "viralityCheck.platformX", "viralityCheck.platformYoutube"],
    legitMissing: [],
  },
  W6: {
    namespaces: ["notFound", "copyright", "locations", "websiteBuilder", "milestones", "lufs", "presave", "release", "stabilize", "create", "press-public", "videoEditor", "captionSuite", "outreach", "press-kit", "contentIntelligence", "moveHome", "podcast", "admin", "hubSpine", "nav", "videoExport", "analyticsHub", "cover-art", "wave9", "djSets", "share", "brandingKit", "dashboard", "paidSeries", "playlist", "proFinishing", "review", "tutorials", "wave8"],
    legitIdentical: ["notFound.myProjects", "admin.friendEmailPlaceholder", "admin.jackpot.phaseLive", "admin.planEmailPlaceholder", "admin.users.credits", "admin.users.emailPlaceholder", "analyticsHub.hookStudio", "analyticsHub.milestones.loggedFrom", "captionSuite.burnModeHint", "captionSuite.credits", "captionSuite.endCardText", "captionSuite.generateCost", "captionSuite.share_facebook", "captionSuite.share_telegram", "captionSuite.share_whatsapp", "contentIntelligence.calendarFrom", "contentIntelligence.compUrlPlaceholder", "contentIntelligence.platformInstagram", "contentIntelligence.platformTikTok", "contentIntelligence.platformX", "contentIntelligence.platformYouTube", "cover-art.midnight_crown", "cover-art.thy_cheat_code", "dashboard.tile_vibes", "djSets.bpm", "djSets.exportRekordbox", "hubSpine.attributionTitle", "hubSpine.handoffs.resultLabel", "hubSpine.madeWith", "hubSpine.promoCards.historyForRelease", "hubSpine.promoCards.sizeHint.16x9", "lufs.formatMp3", "lufs.formatWav", "moveHome.displayNamePh", "moveHome.genrePh", "moveHome.handlePh", "moveHome.locationPh", "moveHome.starterProductPh", "nav.bowRace", "nav.contentCalendar", "nav.credits", "nav.videoEditor", "outreach.audiencePlaceholder", "outreach.brandNamePlaceholder", "outreach.contactPlaceholder", "outreach.creatorNamePlaceholder", "outreach.invoice.brandEmailPlaceholder", "outreach.invoice.creatorEmailPlaceholder", "outreach.productPlaceholder", "paidSeries.buyerInitial", "podcast.generate.creditsEstimate", "podcast.publish.appleHeading", "podcast.publish.spotifyHeading", "podcast.result.apple", "podcast.result.durationApprox", "podcast.result.spotify", "podcast.script.creditsCost", "podcast.script.durationApprox", "press-kit.pdf", "press-kit.placeholders.artistName", "press-kit.placeholders.bookingEmail", "press-kit.placeholders.handle", "press-kit.placeholders.url", "press-kit.pressRelease.placeholders.contactEmail", "press-kit.pressRelease.placeholders.contactPhone", "proFinishing.qualitySummary", "release.types.ep.label", "share.attribution", "share.whatsapp", "tutorials.officialBadge", "videoEditor.mask.creditLine", "videoEditor.motionTrack.costChip", "videoEditor.multiRatio.ytCaption", "videoEditor.pageTitle", "videoEditor.shareAttribution", "videoEditor.subjectReframe.costLabel", "videoEditor.subjectReframe.platformVertical", "videoEditor.subjectReframe.platformYoutube", "videoEditor.vibe_y2k", "videoExport.aspectVertical", "videoExport.aspectWide", "videoExport.colNum", "videoExport.colUrl", "wave8.splits.royaltyAmountPlaceholder", "wave9.cameraMovePlanner.buildCost", "wave9.characterDirector.planCost", "websiteBuilder.templateLinkInBio"],
    legitMissing: [],
  },
};

function placeholders(v: unknown): string[] {
  const s = Array.isArray(v) ? v.join("\n") : String(v ?? "");
  return [...s.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
}

describe("ja locale waves (Stack-28)", () => {
  for (const [wave, def] of Object.entries(WAVES)) {
    const keys = Object.keys(EN).filter((k) => def.namespaces.includes(k.split(".")[0]));
    it(`${wave}: all en keys present in ja except legit/CLDR allowlist`, () => {
      const missing = keys.filter((k) => !(k in JA) && !def.legitMissing.includes(k));
      expect(missing).toEqual([]);
    });
    it(`${wave}: no REAL identical-to-en values remain`, () => {
      const identical = keys.filter((k) => k in JA && JSON.stringify(JA[k]) === JSON.stringify(EN[k]) && !def.legitIdentical.includes(k));
      expect(identical).toEqual([]);
    });
    it(`${wave}: placeholder parity and no U+FFFD on wave keys`, () => {
      const bad: string[] = [];
      for (const k of keys) {
        if (!(k in JA)) continue;
        if (JSON.stringify(placeholders(JA[k])) !== JSON.stringify(placeholders(EN[k]))) bad.push(`placeholder:${k}`);
        if (JSON.stringify(JA[k]).includes("\uFFFD")) bad.push(`fffd:${k}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
