/**
 * locale-waves-hi.test.ts — Stack-28 Hindi locale waves hi-W1..hi-W5
 * (board items 74, 83, 92, 100) + U+FFFD repairs.
 *
 * Source audit: .lane/audit/a7-locale.md §5.5 (wave namespace lists),
 * §1.4 (LEGIT vs REAL identical classification), §3 (18 U+FFFD-corrupted
 * hi keys), §4 (CLDR plural families: hi selects one/other).
 *
 * For every COMPLETED wave this suite pins, over that wave's exact
 * namespace list:
 *  - completeness: every en leaf is present and non-empty in hi
 *    (arrays are single leaves, matching the guard's flattening);
 *  - no REAL identicals left: a hi value identical to en is allowed
 *    only for the explicit LEGIT allowlist below (brand names incl.
 *    "Bow Down Visuals" / "Visual Bucs", platform names, codes,
 *    number/format-only values, proper-noun examples — §1.4);
 *  - placeholder parity: {{...}} multisets match en exactly;
 *  - plural completeness: every en plural family (base carrying both
 *    _one and _other) in the wave carries hi _one and _other;
 *  - U+FFFD: no replacement characters in any completed-wave
 *    namespace, and the whole-file set of corrupted keys is exactly
 *    the shrinking remainder pinned below (empty once hi-W4 lands —
 *    the final state is zero U+FFFD in hi.json).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Catalog = Record<string, unknown>;

function load(locale: string): Catalog {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Catalog;
}

function loadRaw(locale: string): string {
  return readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
}

type Leaf = string | unknown[];
function flat(o: unknown, p = "", out: Record<string, Leaf> = {}): Record<string, Leaf> {
  if (Array.isArray(o)) {
    out[p] = o;
  } else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      flat(v, p ? `${p}.${k}` : k, out);
    }
  } else if (typeof o === "string") {
    out[p] = o;
  }
  return out;
}

const en = flat(load("en"));
const hi = flat(load("hi"));

const WAVES: Record<string, string[]> = {
  W1: ["pricing", "referrals", "memberships", "merch", "royalties", "moneyTracker", "refundPolicy", "tips", "myShop", "storefrontBuilder", "brandingShop", "llcGuide", "liveShopping", "jewelryShop", "contracts", "tipPage", "storefronts", "jewelry", "syncPitch", "labelPitch", "brandDeals", "distribute", "sponsorsPost", "sponsors", "sponsorDealDetail"],
  W2: ["brandCalculator", "playlistPitch", "retentionDoctor", "retentionDelight", "invite", "fomoFeed", "planPublic", "delight", "academy", "home", "common", "features", "waitlist", "auth", "promo-clip", "splitScreen", "productPhotoStudio", "carouselMaker", "videoTemplates", "movies", "motionGraphics"],
  W3: ["cartoonStudio", "bgStudio", "headshotStudio", "colorGrade", "photoEnhance", "speedRamp", "captionTemplates", "videoTemplatesPage", "photoShoot", "upscale", "avatarPresenter", "thumbnailMaker", "thumbnailStudio", "captionStyler", "makeVideo", "songAndVideo", "thumbnail", "thumbnailTest", "clipMaker", "thumbnails", "watermarkRemoval", "logoMaker", "mixMaster", "harmony", "deverb", "fillerRemover", "mastering"],
  W4: ["lrcExport", "samples", "vocalPolish", "vocalTune", "songRework", "makeSong", "producerTag", "audioStudio", "singingVoice", "stems", "bgReplace", "beatMaker", "aiAudio", "beats", "songs", "sounds", "translate", "vocalRemoval", "lyricVideo", "voiceover", "scheduler"],
  W5: ["myProjects", "mashup", "repurpose", "myClips", "hooks", "mediaDetector", "randomizer", "scriptWriter", "library", "artistVault", "catalogVault", "streamPack", "viralityCheck", "importPage", "audit", "retention", "titles", "email-list", "chooseArtist", "interviewPrep", "trends", "analytics", "setlist", "generations", "linkInBio", "weekly_contest", "discord-bot", "tour", "extension", "shows", "shoutouts", "community", "collabs", "team", "commentReplies", "contests", "gamers", "nfcCards"],
  W6: ["privacy", "promote", "coach", "nfcCardProfile", "qrLogin", "notFound", "copyright", "fog-lab", "locations", "milestones", "lufs", "presave", "release", "stabilize", "create", "press-public", "videoEditor", "captionSuite", "outreach", "press-kit", "contentIntelligence", "moveHome", "nav", "podcast", "hubSpine", "admin", "cover-art", "videoExport", "analyticsHub", "djSets", "share", "wave9", "brandingKit", "dashboard", "paidSeries", "proFinishing", "review", "tutorials", "wave8"],
};

const LEGIT_IDENTICAL: Record<string, string[]> = {
  W1: ["brandDeals.audiences.k10_50k", "brandDeals.audiences.k1_10k", "brandDeals.audiences.k250plus", "brandDeals.audiences.k50_250k", "brandDeals.resultsCount", "brandingShop.brandNamePlaceholder", "brandingShop.nichePlaceholder", "brandingShop.noPaymentNote", "brandingShop.zipPlaceholder", "distribute.100_visual_bucs", "distribute.bow_down_records", "distribute.isrc", "distribute.isrc_2", "distribute.midnight_frequencies", "distribute.shark_king", "distribute.tier.ep.label", "distribute.us_xxx_26_00001", "distribute.visual_bucs", "distribute.releases_load_error", "labelPitch.genrePlaceholder", "labelPitch.labelNamePlaceholder", "labelPitch.moodPlaceholder", "labelPitch.songTitlePlaceholder", "labelPitch.tempoPlaceholder", "liveShopping.liveBadge", "liveShopping.testAlertsNote", "llcGuide.cheatCodeLabel", "llcGuide.creatorYouTuber", "llcGuide.statEin", "memberships.aiCost", "memberships.aiSuggesterTitle", "memberships.badge", "memberships.perMonth", "memberships.tierOption", "memberships.titleAccent", "memberships.titleStart", "merch.pricePlaceholder", "merch.products.cap.blurb", "moneyTracker.cat_sponsor_deals", "moneyTracker.cat_streaming_royalties", "myShop.domainPlaceholder", "myShop.handlePlaceholder", "myShop.pricePlaceholder", "myShop.productNamePlaceholder", "myShop.shopNamePlaceholder", "pricing.creditPacks.packs.10.credits", "pricing.creditPacks.packs.10.price", "pricing.creditPacks.packs.150.credits", "pricing.creditPacks.packs.150.price", "pricing.creditPacks.packs.50.credits", "pricing.creditPacks.packs.50.price", "pricing.creditPacks.packs.500.credits", "pricing.creditPacks.packs.500.price", "pricing.hero.titleLine2", "pricing.jsonLd.offerCatalogName", "referrals.contest.days", "referrals.contest.hours", "referrals.contest.mins", "referrals.contest.prizeFor", "referrals.contest.secs", "referrals.hero.p4", "referrals.ladder.title", "referrals.ladder.you", "referrals.leaderboard.title", "referrals.sharekit.templates.chat", "referrals.sharekit.templates.threads", "referrals.sharekit.templates.tiktok", "referrals.sharekit.title", "referrals.titleSuffix", "referrals.tracker.creator", "referrals.tracker.earned", "royalties.insights.cost", "royalties.payouts.distributor", "royalties.streams", "sponsorDealDetail.followersPlaceholder", "sponsors.matchFollowersPlaceholder", "sponsors.matchPlatformsPlaceholder", "sponsorsPost.brandNamePlaceholder", "sponsorsPost.budgetMaxPlaceholder", "sponsorsPost.budgetMinPlaceholder", "sponsorsPost.deliverablesPlaceholder", "sponsorsPost.nichePlaceholder", "storefrontBuilder.domainPlaceholder", "storefrontBuilder.handlePlaceholder", "storefrontBuilder.shopPreviewHandle", "storefrontBuilder.step3Cost", "syncPitch.amountPlaceholder", "syncPitch.artistNamePlaceholder", "syncPitch.bpmPlaceholder", "syncPitch.briefMoodPlaceholder", "syncPitch.briefTitlePlaceholder", "syncPitch.budgetPlaceholder", "syncPitch.contactEmailPlaceholder", "syncPitch.contactNamePlaceholder", "syncPitch.genrePlaceholder", "syncPitch.keyPlaceholder", "syncPitch.notesPlaceholder", "syncPitch.songTitlePlaceholder", "syncPitch.statBpm", "syncPitch.targetPlaceholder", "syncPitch.typeTv", "tips.displayNamePlaceholder", "tips.goalAmountPlaceholder", "tips.handlePlaceholder", "tips.suggestedPlaceholder", "tips.tipMeta", "storefronts.planNote", "sponsorDealDetail.applicationsLoadError", "sponsorDealDetail.retryLoad", "brandDeals.related.brandCalculator", "sponsors.handoffDealPage", "sponsors.handoffFunded", "sponsors.handoffOrOnThe", "sponsors.handoffSelfLink", "sponsors.handoffSelfPrefix", "sponsors.managerHandoffNote", "sponsors.openInManager", "royalties.loadSummaryFailed", "royalties.loadPlatformsFailed", "royalties.loadPayoutsFailed", "royalties.loadSummaryFallback", "royalties.loadPlatformsFallback", "royalties.loadPayoutsFallback", "sponsors.errorBrandNameMissing", "sponsors.errorDeliverablesMissing", "sponsors.errorMinAmount", "pricing.hero.subtitle", "contracts.mode_label", "contracts.mode_analyze", "contracts.mode_generate", "contracts.gen_intro", "contracts.gen_creator_name", "contracts.gen_creator_placeholder", "contracts.gen_counterparty_name", "contracts.gen_counterparty_placeholder", "contracts.gen_payment_label", "contracts.gen_payment_placeholder", "contracts.gen_term_label", "contracts.gen_term_placeholder", "contracts.gen_territory_label", "contracts.gen_territory_placeholder", "contracts.gen_exclusivity_label", "contracts.gen_exclusivity_placeholder", "contracts.gen_rights_label", "contracts.gen_rights_placeholder", "contracts.gen_termination_label", "contracts.gen_termination_placeholder", "contracts.gen_context_label", "contracts.gen_context_placeholder", "contracts.gen_generating", "contracts.gen_generate_button", "contracts.gen_sign_in", "contracts.gen_out_of_credits", "contracts.gen_error_failed", "contracts.gen_error_shape", "contracts.gen_result_fallback_title", "contracts.gen_copy_draft", "contracts.gen_download_draft", "contracts.gen_analyze_draft", "contracts.gen_draft_loaded", "contracts.gen_generate_another"],
  W2: ["academy.heroTitleStart", "academy.hoursPlaceholder", "auth.passwordPlaceholder", "carouselMaker.brandColorsPlaceholder", "carouselMaker.kicker", "common.visualBucs", "home.demo.rnb.label", "home.extTitleA", "movies.streamUrlLabel", "movies.virality", "playlistPitch.copyDmLabel", "productPhotoStudio.credits", "productPhotoStudio.pastePlaceholder", "promo-clip.creditBadge", "promo-clip.genres.afrobeats", "promo-clip.genres.country", "promo-clip.genres.dancehall", "promo-clip.genres.drill", "promo-clip.genres.gospel", "promo-clip.genres.hipHop", "promo-clip.genres.pop", "promo-clip.genres.rnb", "promo-clip.genres.rock", "promo-clip.genres.trap", "promo-clip.platforms.reels", "promo-clip.platforms.shorts", "promo-clip.platforms.tiktok", "promo-clip.tags.ctas", "retentionDelight.prefs_sharkDrops", "retentionDoctor.atPlaceholder", "retentionDoctor.platform_instagram", "retentionDoctor.platform_tiktok", "retentionDoctor.platform_x", "retentionDoctor.platform_youtube", "retentionDoctor.type_short", "splitScreen.modeSimple", "fomoFeed.load_error", "fomoFeed.load_retry", "features.registry.creation-hub.name", "features.registry.creation-hub.tagline", "features.registry.video-generator.name", "features.registry.video-generator.tagline", "features.registry.lip-sync.name", "features.registry.lip-sync.tagline", "features.registry.music-maker.name", "features.registry.music-maker.tagline", "features.registry.audio-studio.name", "features.registry.audio-studio.tagline", "features.registry.video-editor.name", "features.registry.video-editor.tagline", "features.registry.thumbnail-maker.name", "features.registry.thumbnail-maker.tagline", "features.registry.hook-studio.name", "features.registry.hook-studio.tagline", "features.registry.randomizer.name", "features.registry.randomizer.tagline", "features.registry.beats-marketplace.name", "features.registry.beats-marketplace.tagline", "features.registry.video-translator.name", "features.registry.video-translator.tagline", "features.registry.thumbnail-duels.name", "features.registry.thumbnail-duels.tagline", "features.registry.branding-kit.name", "features.registry.branding-kit.tagline", "features.registry.logo-maker.name", "features.registry.logo-maker.tagline", "features.registry.intros-outros.name", "features.registry.intros-outros.tagline", "features.registry.stream-packs.name", "features.registry.stream-packs.tagline", "features.registry.promo-clips.name", "features.registry.promo-clips.tagline", "features.registry.virality-check.name", "features.registry.virality-check.tagline", "features.registry.content-calendar.name", "features.registry.content-calendar.tagline", "features.registry.discord-live.name", "features.registry.discord-live.tagline", "features.registry.refer-earn.name", "features.registry.refer-earn.tagline", "features.registry.show-finder.name", "features.registry.show-finder.tagline", "features.registry.green-screen.name", "features.registry.green-screen.tagline", "features.registry.widgets-desk.name", "features.registry.widgets-desk.tagline", "features.registry.stream-overlays.name", "features.registry.stream-overlays.tagline", "features.registry.drop-day-kit.name", "features.registry.drop-day-kit.tagline", "features.registry.social-feed.name", "features.registry.social-feed.tagline", "features.registry.explore.name", "features.registry.explore.tagline", "features.registry.groups.name", "features.registry.groups.tagline", "features.registry.contests.name", "features.registry.contests.tagline", "features.registry.comment-replies.name", "features.registry.comment-replies.tagline", "features.registry.money-coach.name", "features.registry.money-coach.tagline", "features.registry.brand-deals.name", "features.registry.brand-deals.tagline", "features.registry.distribute.name", "features.registry.distribute.tagline", "features.registry.tips.name", "features.registry.tips.tagline", "features.registry.memberships.name", "features.registry.memberships.tagline", "features.registry.storefronts.name", "features.registry.storefronts.tagline", "features.registry.my-shop.name", "features.registry.my-shop.tagline", "features.registry.creator-academy.name", "features.registry.creator-academy.tagline", "features.registry.copyright.name", "features.registry.copyright.tagline", "features.registry.llc-guide.name", "features.registry.llc-guide.tagline", "features.registry.earnings.name", "features.registry.earnings.tagline", "features.registry.artist-vault.name", "features.registry.artist-vault.tagline", "features.registry.voice-lock.name", "features.registry.voice-lock.tagline", "features.registry.photo-shoot.name", "features.registry.photo-shoot.tagline", "features.category.create.label", "features.category.create.blurb", "features.category.branding.label", "features.category.branding.blurb", "features.category.promote.label", "features.category.promote.blurb", "features.category.social.label", "features.category.social.blurb", "features.category.business.label", "features.category.business.blurb", "features.category.studio.label", "features.category.studio.blurb", "carouselMaker.tplTimelineName", "carouselMaker.tplTimelineDesc", "carouselMaker.tplProsConsName", "carouselMaker.tplProsConsDesc", "carouselMaker.tplAgendaName", "carouselMaker.tplAgendaDesc", "carouselMaker.tplWrappedName", "carouselMaker.tplWrappedDesc"],
  W3: ["captionStyler.styles.hormozi.label", "clipMaker.secondsLabel", "harmony.buttonCost", "harmony.modeAiShort", "harmony.partsLine", "harmony.vb", "headshotStudio.visualBucs", "logoMaker.vb", "makeVideo.genreRB", "makeVideo.platformTiktok", "makeVideo.priceBadge", "makeVideo.soundAttachFailed", "makeVideo.unknownStep", "mastering.downloadMp3", "mastering.downloadWav", "mixMaster.stemTypes.fx", "songAndVideo.costBadge", "songAndVideo.genreRB", "songAndVideo.platformTiktokReels", "songAndVideo.simpleTabLabel", "thumbnail.platformAppleMusic", "thumbnail.platformSoundCloud", "thumbnail.platformSpotify", "thumbnail.platformYouTube", "thumbnailMaker.headlinePlaceholder"],
  W4: ["beatMaker.beatMeta", "beatMaker.bpmLabel", "beatMaker.bpmValue", "beatMaker.presetAfrobeats", "beatMaker.presetDrill", "beatMaker.presetTrap", "beatMaker.titlePlaceholder", "beatMaker.track808", "beatMaker.trackKick", "beats.bpmLabel", "beats.keyPlaceholder", "beats.moodTagsPlaceholder", "beats.titlePlaceholder", "lrcExport.aiCost", "lrcExport.aiTab", "makeSong.artistNamePlaceholder", "makeSong.genreAfrobeats", "makeSong.genreCountry", "makeSong.genreDancehall", "makeSong.genreDrill", "makeSong.genreGospel", "makeSong.genreHipHop", "makeSong.genrePop", "makeSong.genreRB", "makeSong.genreRock", "makeSong.genreTrap", "makeSong.priceBadge", "makeSong.songTitlePlaceholder", "samples.bpm", "samples.credits", "samples.genres.afrobeats", "samples.genres.drill", "samples.genres.hip-hop", "samples.genres.house", "samples.genres.lofi", "samples.genres.pop", "samples.genres.rnb", "samples.genres.techno", "samples.genres.trap", "scheduler.bestTime.bucs", "scheduler.bestTime.cost", "scheduler.bestTime.niche", "scheduler.communityPosts.platformLabels.instagram", "scheduler.communityPosts.platformLabels.threads", "scheduler.communityPosts.platformLabels.x", "scheduler.platforms.facebook.label", "scheduler.platforms.instagram.label", "scheduler.platforms.instagram.sub", "scheduler.platforms.tiktok.label", "scheduler.platforms.x.label", "scheduler.titlePrefix", "scheduler.titleSuffix", "sounds.platformReels", "sounds.platformShorts", "sounds.platformTiktok", "stems.instrumentalHubAssetLabel", "stems.midi", "stems.modeInstrumental", "stems.soloButton", "stems.wav", "translate.creditsLabel", "translate.perMinuteCost", "translate.globalDropBanner", "translate.globalDropUnresolved", "translate.globalDropSaving", "translate.globalDropSaved", "translate.globalDropReviewLink", "translate.globalDropSaveFailed", "translate.globalDropRetry", "translate.voicesLoadError", "translate.voicesRetry", "lyricVideo.songsLoadError", "lyricVideo.retryLoad", "vocalPolish.buttonCost", "vocalPolish.keyShiftValue", "vocalPolish.strengthValue", "vocalPolish.tempoValue", "vocalTune.semitones", "voiceover.creditsEstimate", "beatMaker.soundBankComing", "beatMaker.soundGroupBank", "beatMaker.soundGroupBuiltIn", "beatMaker.soundGroupYours", "beatMaker.soundLoadOwn", "beatMaker.soundNoneLoaded", "beatMaker.soundNotLoadedShort", "beatMaker.soundPickerAria", "beatMaker.soundSaved", "beatMaker.soundSessionOnlyShort", "beats.agreeAndPayButton", "beats.noStemsOnFile", "beats.sellPrefilledNote", "beats.signInToLicense", "beats.signInToLicenseButton", "beats.soldExclusively", "beatMaker.presetRnB", "beatMaker.presetJerseyClub", "beatMaker.presetLofi", "beatMaker.presetPop", "beatMaker.presetEdm", "beatMaker.presetDancehall", "repurpose.error.lostJobs", "beatMaker.soundBankGroupDrums", "beatMaker.soundBankGroup808", "beatMaker.soundBankGroupBass", "beatMaker.soundBankGroupMelodic", "beatMaker.soundBankGroupFx", "beatMaker.soundBankGroupOther", "beatMaker.soundBankKit", "singingVoice.buttonCost", "singingVoice.convertButton"],
  W5: ["linkInBio.theme.onyxMinimal", "myClips.extractAudioCost", "mediaDetector.titleAi", "mashup.modeCustom", "scriptWriter.teleprompterWpmValue", "artistVault.voiceAdvanced", "artistVault.voicePresetNatural", "analytics.creditsPerRun", "analytics.heroTitleStart", "artistVault.creditsCount", "audit.handlePlaceholder", "audit.platformInstagram", "audit.platformTikTok", "audit.platformYouTube", "audit.recentPostsPlaceholder", "chooseArtist.eyebrow", "commentReplies.batchSubline", "commentReplies.commentsPlaceholder", "commentReplies.voiceNotesPlaceholder", "community.removed", "discord-bot.announcements_channel_id", "discord-bot.discord", "discord-bot.discord_bot_shared_secret", "discord-bot.discord_bot_token", "discord-bot.discord_client_id", "discord-bot.live_companion_bot", "email-list.100_visual_bucs", "email-list.join_2", "email-list.thy_cheat_code", "extension.bdv", "extension.chrome_extensions", "extension.developer_mode", "extension.load_unpacked", "extension.thy_cheat_code", "gamers.player_one_ready", "hooks.heroTitleA", "hooks.pfHashtagsPlaceholder", "hooks.scoreOutOf", "importPage.kbSize", "importPage.mbSize", "importPage.urlPlaceholder", "interviewPrep.artistNamePh", "interviewPrep.audienceSizePh", "interviewPrep.of100", "library.headingA", "linkInBio.links.urlPlaceholder", "linkInBio.profile.avatarUrlPlaceholder", "linkInBio.tipJar.placeholder", "mashup.balanceLabel", "mashup.bpmUnknown", "mashup.songsLoadError", "mashup.songsRetry", "mashup.modeSimple", "mashup.priceBadge", "mashup.styleCrossfade", "mashup.tabMashup", "myProjects.editor", "myProjects.visualBucsUsed", "nfcCards.qrSvg", "randomizer.crossLink.name", "repurpose.modeLabel", "repurpose.modeStreamVod", "retention.awayDigest.bowRace", "retention.awayDigest.jackpot", "retention.dailyDrop.title", "retention.prefs.dailyDropEnabled.title", "retention.quests_progress", "retention.streak_load_error", "weekly_contest.load_error", "weekly_contest.load_retry", "retention.streak_retry", "scriptWriter.bRollLabel", "scriptWriter.platformTiktok", "scriptWriter.platformYoutube", "setlist.durationPlaceholder", "shoutouts.displayNamePlaceholder", "shoutouts.emailPlaceholder", "shoutouts.noChargeNote", "shoutouts.paymentsNotice", "shoutouts.revenueDisclaimer", "shoutouts.setupFeeNote", "shows.artistNamePlaceholder", "shows.cityPlaceholder", "team.fundPlaceholder", "team.inviteEmailPlaceholder", "team.spendingAmount", "titles.crossLinkHook", "titles.platformInstagram", "titles.platformTikTok", "titles.platformYouTube", "tour.cityPlaceholder", "tour.homeBasePlaceholder", "tour.venuePlaceholder", "trends.radar.outsideBadge", "collabs.myProfileLoadError", "collabs.myProfileLoadErrorBody", "collabs.myProfileRetry", "trends.platformInstagram", "trends.platformTiktok", "trends.platformYoutube", "viralityCheck.crossLinkHookStudio", "viralityCheck.hashtagsPlaceholder", "viralityCheck.platformInstagram", "viralityCheck.platformTiktok", "viralityCheck.platformX", "viralityCheck.platformYoutube", "artistVault.sharedWithTeam", "streamPack.theme.gold-luxury.name", "streamPack.theme.gold-luxury.blurb", "streamPack.theme.neon-cyber.name", "streamPack.theme.neon-cyber.blurb", "streamPack.theme.crimson-royal.name", "streamPack.theme.crimson-royal.blurb", "streamPack.theme.emerald-empire.name", "streamPack.theme.emerald-empire.blurb", "streamPack.theme.violet-noir.name", "streamPack.theme.violet-noir.blurb", "streamPack.theme.arctic-frost.name", "streamPack.theme.arctic-frost.blurb", "streamPack.theme.desert-dune.name", "streamPack.theme.desert-dune.blurb", "streamPack.theme.midnight-jazz.name", "streamPack.theme.midnight-jazz.blurb", "linkInBio.theme.cobaltStage", "linkInBio.theme.cobaltStageBlurb", "linkInBio.theme.mintAtelier", "linkInBio.theme.mintAtelierBlurb", "linkInBio.theme.amberDusk", "linkInBio.theme.amberDuskBlurb", "extension.metaTitle", "extension.one_email_when_it_launches_no_sp", "extension.we_ll_email_you_the_install_link", "linkInBio.theme.violetReign", "linkInBio.theme.violetReignBlurb", "linkInBio.theme.skyAtrium", "linkInBio.theme.skyAtriumBlurb", "streamPack.theme.rose-velvet.name", "streamPack.theme.rose-velvet.blurb", "streamPack.theme.obsidian-chrome.name", "streamPack.theme.obsidian-chrome.blurb", "streamPack.catalogError", "repurpose.error.lostJobs"],
  W6: ["admin.challenges.amountLabel", "admin.friendEmailPlaceholder", "admin.planEmailPlaceholder", "admin.remixKing.title", "admin.reversals.age", "admin.users.credits", "admin.users.emailPlaceholder", "admin.worldDrops.budgetLine", "admin.worldDrops.claimsLine", "admin.worldDrops.errors.amountRange", "admin.worldDrops.rangeLine", "analyticsHub.hookStudio", "analyticsHub.milestones.loggedFrom", "captionSuite.burnModeHint", "captionSuite.credits", "captionSuite.endCardText", "captionSuite.generateCost", "captionSuite.share_facebook", "captionSuite.share_telegram", "captionSuite.share_whatsapp", "coach.cadencePlaceholder", "coach.crossLinkBrand", "coach.platformInstagram", "coach.platformTikTok", "coach.platformTikTokBlurb", "coach.platformYouTube", "coach.platformYouTubeBlurb", "coach.titleStart", "contentIntelligence.calendarFrom", "contentIntelligence.compUrlPlaceholder", "contentIntelligence.platformInstagram", "contentIntelligence.platformTikTok", "contentIntelligence.platformX", "contentIntelligence.platformYouTube", "copyright.copyright", "copyright.e_g_2026", "copyright.e_g_midnight_crown", "cover-art.dark_hip_hop_triumphant_late_nig", "cover-art.midnight_crown", "cover-art.thy_cheat_code", "dashboard.tile_vibes", "djSets.bpm", "djSets.exportRekordbox", "hubSpine.attributionTitle", "hubSpine.handoffs.resultLabel", "hubSpine.madeWith", "hubSpine.promoCards.historyForRelease", "hubSpine.promoCards.sizeHint.16x9", "lufs.formatMp3", "lufs.formatWav", "moveHome.displayNamePh", "moveHome.genrePh", "moveHome.handlePh", "moveHome.locationPh", "moveHome.starterProductPh", "nav.analytics", "nav.bowRace", "nav.contentCalendar", "nav.credits", "nav.shorts", "nav.videoEditor", "outreach.audiencePlaceholder", "outreach.brandNamePlaceholder", "outreach.contactPlaceholder", "outreach.creatorNamePlaceholder", "outreach.invoice.brandEmailPlaceholder", "outreach.invoice.creatorEmailPlaceholder", "outreach.productPlaceholder", "paidSeries.buyerInitial", "podcast.generate.creditsEstimate", "podcast.publish.appleHeading", "podcast.publish.spotifyHeading", "podcast.result.apple", "podcast.result.durationApprox", "podcast.result.spotify", "podcast.script.creditsCost", "podcast.script.durationApprox", "press-kit.pdf", "press-kit.placeholders.artistName", "press-kit.placeholders.bookingEmail", "press-kit.placeholders.handle", "press-kit.placeholders.url", "press-kit.pressRelease.placeholders.contactEmail", "press-kit.pressRelease.placeholders.contactPhone", "privacy.section4Item1Label", "privacy.section4Item2Label", "privacy.section4Item3Label", "proFinishing.qualitySummary", "release.types.ep.label", "share.attribution", "share.whatsapp", "tutorials.officialBadge", "videoEditor.modeSimple", "videoEditor.motionTrack.costChip", "videoEditor.pageTitle", "videoEditor.subjectReframe.costLabel", "videoEditor.subjectReframe.platformVertical", "videoEditor.subjectReframe.platformYoutube", "videoEditor.vibe_80s", "videoEditor.vibe_90s", "videoEditor.vibe_y2k", "videoExport.aspectVertical", "videoExport.aspectWide", "videoExport.colNum", "videoExport.colUrl", "wave8.splits.royaltyAmountPlaceholder", "wave9.cameraMovePlanner.buildCost", "wave9.characterDirector.planCost", "wave9.characterDirector.vaultsLoadError", "wave9.characterDirector.vaultsRetry", "coach.tabActionTracker", "coach.tabContracts", "coach.tabManageDeals", "brandingKit.colorRole.primary", "brandingKit.colorRole.secondary", "brandingKit.colorRole.accent", "brandingKit.colorRole.neutral", "brandingKit.colorRole.background", "locations.errImageTooLarge", "locations.retryLoad", "podcast.dialogue.disabledTitle"],
};

/** hi keys still carrying U+FFFD, pinned exactly; shrinks per wave, [] at hi-W4. */
const FFFD_REMAINING: string[] = [];

function inWave(key: string, wave: string): boolean {
  return WAVES[wave].some((ns) => key === ns || key.startsWith(`${ns}.`));
}

function placeholders(v: string): string[] {
  return [...v.matchAll(/{{[^}]*}}/g)].map((m) => m[0]).sort();
}

describe("Stack-28 Hindi locale waves", () => {
  for (const wave of Object.keys(WAVES)) {
    describe(wave, () => {
      it("is complete: every en leaf present and non-empty in hi", () => {
        const missing: string[] = [];
        for (const [k, v] of Object.entries(en)) {
          if (!inWave(k, wave)) continue;
          const hv = hi[k];
          if (hv === undefined) missing.push(k);
          else if (typeof v === "string" && typeof hv === "string" && hv.trim() === "") missing.push(`${k} (empty)`);
          else if (Array.isArray(v) && (!Array.isArray(hv) || hv.length !== v.length)) missing.push(`${k} (array shape)`);
        }
        expect(missing).toEqual([]);
      });

      it("has no REAL identicals left (identical ⇒ allowlisted LEGIT)", () => {
        const allow = new Set(LEGIT_IDENTICAL[wave]);
        const bad: string[] = [];
        for (const [k, v] of Object.entries(en)) {
          if (!inWave(k, wave) || typeof v !== "string") continue;
          if (hi[k] === v && !allow.has(k)) bad.push(k);
        }
        expect(bad).toEqual([]);
      });

      it("allowlist has no stale entries (each is still identical to en)", () => {
        for (const k of LEGIT_IDENTICAL[wave]) {
          expect(hi[k], k).toBe(en[k]);
        }
      });

      it("keeps {{placeholder}} parity with en", () => {
        const bad: string[] = [];
        for (const [k, v] of Object.entries(en)) {
          if (!inWave(k, wave) || typeof v !== "string") continue;
          const hv = hi[k];
          if (typeof hv === "string" && JSON.stringify(placeholders(hv)) !== JSON.stringify(placeholders(v))) bad.push(k);
        }
        expect(bad).toEqual([]);
      });

      it("carries whole CLDR plural families (hi: one/other)", () => {
        const bad: string[] = [];
        for (const k of Object.keys(en)) {
          if (!inWave(k, wave) || !k.endsWith("_one")) continue;
          const base = k.slice(0, -"_one".length);
          if (`${base}_other` in en) {
            if (!(`${base}_one` in hi) || !(`${base}_other` in hi)) bad.push(base);
          }
        }
        expect(bad).toEqual([]);
      });

      it("has no U+FFFD in this wave's namespaces", () => {
        const bad: string[] = [];
        for (const [k, v] of Object.entries(hi)) {
          if (!inWave(k, wave) || typeof v !== "string") continue;
          if (v.includes("\uFFFD")) bad.push(k);
        }
        expect(bad).toEqual([]);
      });
    });
  }

  it("whole-file U+FFFD keys are exactly the pinned remainder", () => {
    const got = Object.entries(hi)
      .filter(([, v]) => typeof v === "string" && v.includes("\uFFFD"))
      .map(([k]) => k)
      .sort();
    expect(got).toEqual([...FFFD_REMAINING].sort());
    expect(loadRaw("hi").split("\uFFFD").length - 1).toBe(
      got.reduce((n, k) => n + (typeof hi[k] === "string" ? (hi[k] as string).split("\uFFFD").length - 1 : 0), 0),
    );
  });
});
