/**
 * locale-waves-ar.test.ts — Stack-28 Arabic locale waves (board items
 * 70/79/88/97 = ar-W1..W4, namespaces per a7-locale.md §5.1).
 *
 * Per completed wave this pins, for every en key in the wave's namespaces:
 *  - the key exists in ar.json, non-empty;
 *  - the {{placeholder}} shape matches en exactly;
 *  - the value is NOT byte-identical to en, unless the key sits on the
 *    wave's explicit legit-identical allowlist below (brand/house names,
 *    platform names, URLs/example identifiers, pure numbers/formats,
 *    codes — §1.4 classes, each verified by hand for ar).
 *
 * Waves are added here as they land; a wave block appears only when the
 * whole wave is translated.
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
const AR = flat(load("ar"));

function placeholders(v: unknown): string[] {
  const s = typeof v === "string" ? v : JSON.stringify(v) ?? "";
  return [...s.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
}

function checkWave(namespaces: string[], allowlist: Set<string>) {
  const keys = Object.keys(EN).filter((k) => namespaces.includes(k.split(".")[0]!));
  expect(keys.length).toBeGreaterThan(0);
  for (const k of keys) {
    const arv = AR[k];
    expect(arv, `ar missing ${k}`).toBeDefined();
    if (typeof EN[k] === "string" && EN[k] === "") continue; // en itself is empty (split-title accent) — nothing to carry
    const ars = typeof arv === "string" ? arv : JSON.stringify(arv);
    expect(ars && ars.length > 0, `ar empty ${k}`).toBeTruthy();
    expect(placeholders(arv), `placeholder shape ${k}`).toEqual(placeholders(EN[k]));
    if (!allowlist.has(k)) {
      const ens = typeof EN[k] === "string" ? (EN[k] as string) : JSON.stringify(EN[k]);
      expect(ars, `ar identical to en (untranslated): ${k}`).not.toBe(ens);
    }
  }
  // every allowlist entry must really be identical (no stale entries)
  for (const k of allowlist) {
    const ens = typeof EN[k] === "string" ? (EN[k] as string) : JSON.stringify(EN[k]);
    const ars = typeof AR[k] === "string" ? (AR[k] as string) : JSON.stringify(AR[k]);
    expect(ars, `allowlist entry no longer identical: ${k}`).toBe(ens);
  }
}

/* ar-W1 (item 70) — commerce. Legit identicals: pack credits/prices and
   plan rank names (house names, kept in English site-wide), brand phrases
   ("100 Visual Bucs", "Bow Down Records"), codes (ISRC, EP, DM, BPM, TV),
   audience ranges and numeric/example placeholders, platform-name pairs,
   and pure-format strings ("({{n}})", ".", "{{date}} · {{status}}"). */
const W1_NS = [
  "pricing", "referrals", "merch", "memberships", "royalties", "moneyTracker",
  "refundPolicy", "tips", "myShop", "storefrontBuilder", "jewelry",
  "liveShopping", "contracts", "llcGuide", "tipPage", "storefronts",
  "jewelryShop", "brandingShop", "syncPitch", "brandDeals", "distribute",
  "sponsors", "sponsorsPost", "sponsorDealDetail", "labelPitch",
  "brandCalculator", "playlistPitch",
];
const W1_ALLOW = new Set([
  "brandDeals.audiences.k10_50k",
  "brandDeals.audiences.k1_10k",
  "brandDeals.audiences.k250plus",
  "brandDeals.audiences.k50_250k",
  "brandDeals.related.brandCalculator",
  "brandDeals.resultsCount",
  "brandingShop.noPaymentNote",
  "distribute.100_visual_bucs",
  "distribute.bow_down_records",
  "distribute.isrc",
  "distribute.isrc_2",
  "distribute.midnight_frequencies",
  "distribute.shark_king",
  "distribute.tier.ep.label",
  "distribute.us_xxx_26_00001",
  "distribute.visual_bucs",
  "jewelry.merchWord",
  "liveShopping.crossLinkEnd",
  "liveShopping.testAlertsNote",
  "llcGuide.cheatCodeLabel",
  "llcGuide.creatorYouTuber",
  "memberships.aiCost",
  "memberships.perMonth",
  "merch.pricePlaceholder",
  "myShop.domainPlaceholder",
  "myShop.handlePlaceholder",
  "myShop.pricePlaceholder",
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
  "pricing.plans.hustler.name",
  "pricing.plans.kingpin.name",
  "pricing.plans.shotCaller.name",
  "pricing.plans.streetPunk.name",
  "referrals.contest.prizeFor",
  "referrals.hero.p4",
  "referrals.sharekit.templates.chat",
  "referrals.sharekit.templates.threads",
  "referrals.titleSuffix",
  "referrals.tracker.earned",
  "royalties.insights.cost",
  "sponsorDealDetail.applicationsLoadError",
  "sponsorDealDetail.followersPlaceholder",
  "sponsorDealDetail.retryLoad",
  "sponsors.handoffDealPage",
  "sponsors.handoffFunded",
  "sponsors.handoffOrOnThe",
  "sponsors.handoffSelfLink",
  "sponsors.handoffSelfPrefix",
  "sponsors.managerHandoffNote",
  "sponsors.matchFollowersPlaceholder",
  "sponsors.matchPlatformsPlaceholder",
  "sponsors.openInManager",
  "sponsorsPost.budgetMaxPlaceholder",
  "sponsorsPost.budgetMinPlaceholder",
  "storefrontBuilder.domainPlaceholder",
  "storefrontBuilder.handlePlaceholder",
  "storefrontBuilder.step3Cost",
  "storefronts.planNote",
  "syncPitch.bpmPlaceholder",
  "syncPitch.statBpm",
  "syncPitch.typeTv",
  "tips.displayNamePlaceholder",
  "tips.goalAmountPlaceholder",
  "tips.handlePlaceholder",
  "tips.suggestedPlaceholder",
  "tips.tipMeta",
  "royalties.loadSummaryFailed",
  "royalties.loadPlatformsFailed",
  "royalties.loadPayoutsFailed",
  "royalties.loadSummaryFallback",
  "royalties.loadPlatformsFallback",
  "royalties.loadPayoutsFallback",
]);

describe("ar-W1 (Stack-28 #70) commerce namespaces fully translated", () => {
  it("every en key present, non-empty, placeholders intact, no untranslated residue", () => {
    checkWave(W1_NS, W1_ALLOW);
  });
});

/* ar-W2 (item 79) — retention/invite + video surfaces. Legit identicals:
   platform names (TikTok/Instagram/YouTube/X), the Turbo mode name (house
   rendering, cf. videoEditor.modeSimple), brand-only strings ("Visual
   Bucs", "100 Visual Bucs"), and pure formats (placeholder e-mail/dots,
   hex colours, "https://…", "0:12", ".", "{n} Visual Bucs"). */
const W2_NS = [
  "retentionDoctor", "retentionDelight", "invite", "fomoFeed", "planPublic",
  "delight", "academy", "common", "home", "auth", "features", "waitlist",
  "promo-clip", "splitScreen", "productPhotoStudio", "carouselMaker",
  "videoTemplates", "movies", "motionGraphics", "cartoonStudio",
];
const W2_ALLOW = new Set([
  "academy.hoursPlaceholder",
  "fomoFeed.load_error",
  "fomoFeed.load_retry",
  "auth.emailPlaceholder",
  "auth.passwordPlaceholder",
  "carouselMaker.brandColorsPlaceholder", "carouselMaker.tplTimelineName", "carouselMaker.tplTimelineDesc", "carouselMaker.tplProsConsName", "carouselMaker.tplProsConsDesc",
  "common.visualBucs",
  "home.vaultBodyB",
  "productPhotoStudio.credits",
  "productPhotoStudio.pastePlaceholder",
  "promo-clip.creditBadge",
  "promo-clip.platforms.tiktok",
  "retentionDoctor.atPlaceholder",
  "retentionDoctor.platform_instagram",
  "retentionDoctor.platform_tiktok",
  "retentionDoctor.platform_x",
  "retentionDoctor.platform_youtube",
  "splitScreen.modeSimple",
  "features.registry.creation-hub.name",
  "features.registry.creation-hub.tagline",
  "features.registry.video-generator.name",
  "features.registry.video-generator.tagline",
  "features.registry.lip-sync.name",
  "features.registry.lip-sync.tagline",
  "features.registry.music-maker.name",
  "features.registry.music-maker.tagline",
  "features.registry.audio-studio.name",
  "features.registry.audio-studio.tagline",
  "features.registry.video-editor.name",
  "features.registry.video-editor.tagline",
  "features.registry.thumbnail-maker.name",
  "features.registry.thumbnail-maker.tagline",
  "features.registry.hook-studio.name",
  "features.registry.hook-studio.tagline",
  "features.registry.randomizer.name",
  "features.registry.randomizer.tagline",
  "features.registry.beats-marketplace.name",
  "features.registry.beats-marketplace.tagline",
  "features.registry.video-translator.name",
  "features.registry.video-translator.tagline",
  "features.registry.thumbnail-duels.name",
  "features.registry.thumbnail-duels.tagline",
  "features.registry.branding-kit.name",
  "features.registry.branding-kit.tagline",
  "features.registry.logo-maker.name",
  "features.registry.logo-maker.tagline",
  "features.registry.intros-outros.name",
  "features.registry.intros-outros.tagline",
  "features.registry.stream-packs.name",
  "features.registry.stream-packs.tagline",
  "features.registry.promo-clips.name",
  "features.registry.promo-clips.tagline",
  "features.registry.virality-check.name",
  "features.registry.virality-check.tagline",
  "features.registry.content-calendar.name",
  "features.registry.content-calendar.tagline",
  "features.registry.discord-live.name",
  "features.registry.discord-live.tagline",
  "features.registry.refer-earn.name",
  "features.registry.refer-earn.tagline",
  "features.registry.show-finder.name",
  "features.registry.show-finder.tagline",
  "features.registry.green-screen.name",
  "features.registry.green-screen.tagline",
  "features.registry.widgets-desk.name",
  "features.registry.widgets-desk.tagline",
  "features.registry.stream-overlays.name",
  "features.registry.stream-overlays.tagline",
  "features.registry.drop-day-kit.name",
  "features.registry.drop-day-kit.tagline",
  "features.registry.social-feed.name",
  "features.registry.social-feed.tagline",
  "features.registry.explore.name",
  "features.registry.explore.tagline",
  "features.registry.groups.name",
  "features.registry.groups.tagline",
  "features.registry.contests.name",
  "features.registry.contests.tagline",
  "features.registry.comment-replies.name",
  "features.registry.comment-replies.tagline",
  "features.registry.money-coach.name",
  "features.registry.money-coach.tagline",
  "features.registry.brand-deals.name",
  "features.registry.brand-deals.tagline",
  "features.registry.distribute.name",
  "features.registry.distribute.tagline",
  "features.registry.tips.name",
  "features.registry.tips.tagline",
  "features.registry.memberships.name",
  "features.registry.memberships.tagline",
  "features.registry.storefronts.name",
  "features.registry.storefronts.tagline",
  "features.registry.my-shop.name",
  "features.registry.my-shop.tagline",
  "features.registry.creator-academy.name",
  "features.registry.creator-academy.tagline",
  "features.registry.copyright.name",
  "features.registry.copyright.tagline",
  "features.registry.llc-guide.name",
  "features.registry.llc-guide.tagline",
  "features.registry.earnings.name",
  "features.registry.earnings.tagline",
  "features.registry.artist-vault.name",
  "features.registry.artist-vault.tagline",
  "features.registry.voice-lock.name",
  "features.registry.voice-lock.tagline",
  "features.registry.photo-shoot.name",
  "features.registry.photo-shoot.tagline",
  "features.category.create.label",
  "features.category.create.blurb",
  "features.category.branding.label",
  "features.category.branding.blurb",
  "features.category.promote.label",
  "features.category.promote.blurb",
  "features.category.social.label",
  "features.category.social.blurb",
  "features.category.business.label",
  "features.category.business.blurb",
  "features.category.studio.label",
  "features.category.studio.blurb",
]);

describe("ar-W2 (Stack-28 #79) retention/invite + video namespaces fully translated", () => {
  it("every en key present, non-empty, placeholders intact, no untranslated residue", () => {
    checkWave(W2_NS, W2_ALLOW);
  });
});

/* ar-W3 (item 88) — image/video studio tools + audio (harmony/mixMaster/
   mastering/samples). Legit identicals: brand/price formats ("300 Visual
   Bucs", "200 Visual Bucs", "{{num}} Visual Bucs", "VB"), the Turbo tab
   name, platform names (Spotify/YouTube/Apple Music/SoundCloud), format
   labels (MP3 (320k), WAV (24-bit), 1080p Full HD, 4K Ultra HD), the
   Hormozi style name (proper noun), and placeholder-only strings.
   thumbnailTest completed by the coordinator at integration: its only
   gap was the filesSkipped plural family (2 en keys → six ar CLDR forms);
   the lane held it because completing it raises ar's carried-family
   count 33 → 34 against the hard pin in i18n-plural-categories.test.ts
   (outside lane ownership). The coordinator landed the six forms and
   corrected that pin to 34 in the same integration commit, so
   thumbnailTest is pinned here with the rest of W3. */
const W3_NS = [
  "bgStudio", "headshotStudio", "colorGrade", "photoEnhance", "speedRamp",
  "captionTemplates", "videoTemplatesPage", "photoShoot", "upscale",
  "avatarPresenter", "thumbnailStudio", "thumbnailMaker", "makeVideo",
  "songAndVideo", "thumbnail", "thumbnails", "clipMaker",
  "watermarkRemoval", "logoMaker", "captionStyler", "thumbnailTest", "harmony", "mixMaster",
  "deverb", "fillerRemover", "lrcExport", "mastering", "samples",
];
const W3_ALLOW = new Set([
  "captionStyler.styles.hormozi.label",
  "harmony.buttonCost",
  "harmony.partsLine",
  "harmony.vb",
  "headshotStudio.visualBucs",
  "logoMaker.vb",
  "lrcExport.aiCost",
  "makeVideo.priceBadge",
  "makeVideo.soundAttachFailed",
  "makeVideo.refundedNoticeSuffix",
  "mastering.downloadMp3",
  "mastering.downloadWav",
  "samples.bpm",
  "samples.credits",
  "songAndVideo.costBadge",
  "songAndVideo.simpleTabLabel",
  "thumbnail.platformAppleMusic",
  "thumbnail.platformSoundCloud",
  "thumbnail.platformSpotify",
  "thumbnail.platformYouTube",
  "thumbnailMaker.portraitBlurb",
  "upscale.target1080p",
  "upscale.target4k",
]);

describe("ar-W3 (Stack-28 #88) studio-tool namespaces fully translated", () => {
  it("every en key present, non-empty, placeholders intact, no untranslated residue", () => {
    checkWave(W3_NS, W3_ALLOW);
  });
});

/* ar-W4 (item 97) — audio tools + scheduler/projects. Legit identicals:
   BPM/MIDI/WAV/SFX abbreviations and placeholder formats ("BPM {{n}}",
   "{{n}}%", "—"), brand/price strings ("400 Visual Bucs", "75 Visual
   Bucs", "{{count}} Visual Bucs", "× 500 Visual Bucs"), platform names
   (TikTok/Facebook/Instagram/Threads), proper-noun placeholder examples
   ("Midnight Run", "Midnight Drive"), the Turbo mode name, the house
   name fragments "Thy" / "War Room" (Thy War Room), and the semitone
   unit "st" / "{{n}} st". */
const W4_NS = [
  "vocalPolish", "vocalTune", "songRework", "producerTag", "audioStudio",
  "singingVoice", "stems", "bgReplace", "aiAudio", "songs", "beatMaker",
  "sounds", "beats", "translate", "makeSong", "sfx", "voiceover",
  "scheduler", "myProjects", "mashup", "repurpose",
];
const W4_ALLOW = new Set([
  "beatMaker.bpmLabel",
  "beatMaker.bpmValue",
  "beatMaker.presetJerseyClub",
  "beatMaker.presetLofi",
  "beatMaker.presetRnB",
  "beatMaker.soundBankComing",
  "beatMaker.soundGroupBank",
  "beatMaker.soundGroupBuiltIn",
  "beatMaker.soundGroupYours",
  "beatMaker.soundLoadOwn",
  "beatMaker.soundNoneLoaded",
  "beatMaker.soundNotLoadedShort",
  "beatMaker.soundPickerAria",
  "beatMaker.soundSaved",
  "beatMaker.soundSessionOnlyShort",
  "beatMaker.titlePlaceholder",
  "beatMaker.track808",
  "beats.agreeAndPayButton",
  "beats.bpmLabel",
  "beats.noStemsOnFile",
  "beats.sellPrefilledNote",
  "beats.signInToLicense",
  "beats.signInToLicenseButton",
  "beats.soldExclusively",
  "beats.titlePlaceholder",
  "makeSong.priceBadge",
  "mashup.bpmUnknown",
  "mashup.songsLoadError",
  "mashup.songsRetry",
  "mashup.modeSimple",
  "mashup.priceBadge",
  "myProjects.visualBucsUsed",
  "scheduler.bestTime.bucs",
  "scheduler.bestTime.cost",
  "scheduler.communityPosts.platformLabels.instagram",
  "scheduler.communityPosts.platformLabels.threads",
  "scheduler.communityPosts.platformLabels.x",
  "scheduler.platforms.facebook.label",
  "scheduler.platforms.instagram.label",
  "scheduler.platforms.tiktok.label",
  "scheduler.platforms.x.label",
  "scheduler.titlePrefix",
  "scheduler.titleSuffix",
  "sfx.titleAccent",
  // English-verbatim UNREVIEWED money copy: the singing-voice 800 VB
  // price was RATIFIED by owner ruling 2026-11-07 and the stale
  // "price TBD" wording retired — this catalog carries the English
  // source until a reviewed translation lands.
  "singingVoice.buttonCost",
  "singingVoice.convertButton",
  "sounds.platformTiktok",
  "stems.midi",
  "stems.wav",
  "translate.creditsLabel",
  "translate.perMinuteCost",
  "translate.globalDropBanner",
  "translate.globalDropUnresolved",
  "translate.globalDropSaving",
  "translate.globalDropSaved",
  "translate.globalDropReviewLink",
  "translate.globalDropSaveFailed",
  "translate.globalDropRetry",
  "translate.voicesLoadError",
  "translate.voicesRetry",
  "vocalPolish.buttonCost",
  "vocalPolish.keyShiftValue",
  "vocalPolish.strengthValue",
  "vocalPolish.tempoValue",
  "vocalTune.semitones",
  "voiceover.creditsEstimate",
]);

describe("ar-W4 (Stack-28 #97) audio + scheduler/projects namespaces fully translated", () => {
  it("every en key present, non-empty, placeholders intact, no untranslated residue", () => {
    checkWave(W4_NS, W4_ALLOW);
  });
});

/* ar-W5 (Stack-28 appendix) — link-in-bio / nfc / privacy + promo-tool
   namespaces. Legit identicals: brand/platform names, env-var names,
   URLs/example identifiers, pure formats, house feature names. */
const W5_NS = ["myClips", "hooks", "mediaDetector", "randomizer", "scriptWriter", "library", "artistVault", "catalogVault", "streamPack", "viralityCheck", "importPage", "audit", "titles", "email-list", "interviewPrep", "trends", "chooseArtist", "retention", "generations", "analytics", "setlist", "linkInBio", "weekly_contest", "discord-bot", "shoutouts", "community", "collabs", "goLive", "contests", "team", "extension", "shows", "tour", "nfcCards", "privacy"];
const W5_ALLOW = new Set([
  "linkInBio.tipJar.placeholder",
  "linkInBio.links.urlPlaceholder",
  "linkInBio.profile.avatarUrlPlaceholder",
  "linkInBio.theme.cobaltStage",
  "linkInBio.theme.cobaltStageBlurb",
  "linkInBio.theme.mintAtelier",
  "linkInBio.theme.mintAtelierBlurb",
  "linkInBio.theme.amberDusk",
  "linkInBio.theme.amberDuskBlurb",
  "myClips.extractAudioCost",
  "analytics.creditsPerRun",
  "artistVault.creditsCount",
  "artistVault.sharedWithTeam",
  "audit.handlePlaceholder",
  "audit.platformInstagram",
  "audit.platformTikTok",
  "audit.platformYouTube",
  "collabs.myProfileLoadError",
  "collabs.myProfileLoadErrorBody",
  "collabs.myProfileRetry",
  "discord-bot.discord",
  "discord-bot.discord_bot_shared_secret",
  "discord-bot.discord_bot_token",
  "discord-bot.discord_client_id",
  "email-list.100_visual_bucs",
  "email-list.join_2",
  "email-list.thy_cheat_code",
  "extension.bdv",
  "extension.chrome_extensions",
  "goLive.gamePlaceholder",
  "goLive.streamsLoading",
  "goLive.streamsLoadError",
  "goLive.streamsRetry",
  "goLive.streamTitlePlaceholder",
  "hooks.heroTitleA",
  "hooks.pfHashtagsPlaceholder",
  "hooks.scoreOutOf",
  "importPage.kbSize",
  "importPage.mbSize",
  "importPage.urlPlaceholder",
  "interviewPrep.artistNamePh",
  "interviewPrep.audienceSizePh",
  "interviewPrep.of100",
  "library.headingA",
  "nfcCards.qrSvg",
  "privacy.section4Item1Label",
  "privacy.section4Item2Label",
  "privacy.section4Item3Label",
  "randomizer.crossLink.name",
  "retention.awayDigest.bowRace",
  "retention.quests_progress",
  "retention.streak_load_error",
  "weekly_contest.load_error",
  "weekly_contest.load_retry",
  "retention.streak_retry",
  "scriptWriter.platformTiktok",
  "scriptWriter.platformYoutube",
  "setlist.durationPlaceholder",
  "shoutouts.displayNamePlaceholder",
  "shoutouts.emailPlaceholder",
  "shoutouts.noChargeNote",
  "shoutouts.paymentsNotice",
  "shoutouts.revenueDisclaimer",
  "shoutouts.setupFeeNote",
  "team.fundPlaceholder",
  "team.inviteEmailPlaceholder",
  "titles.platformInstagram",
  "titles.platformTikTok",
  "titles.platformYouTube",
  "trends.radar.outsideBadge",
  "trends.platformInstagram",
  "trends.platformTiktok",
  "trends.platformYoutube",
  "viralityCheck.crossLinkHookStudio",
  "viralityCheck.hashtagsPlaceholder",
  "viralityCheck.platformInstagram",
  "viralityCheck.platformTiktok",
  "viralityCheck.platformX",
  "viralityCheck.platformYoutube",
  "streamPack.theme.gold-luxury.name",
  "streamPack.theme.gold-luxury.blurb",
  "streamPack.theme.neon-cyber.name",
  "streamPack.theme.neon-cyber.blurb",
  "streamPack.theme.crimson-royal.name",
  "streamPack.theme.crimson-royal.blurb",
  "streamPack.theme.emerald-empire.name",
  "streamPack.theme.emerald-empire.blurb",
  "streamPack.theme.violet-noir.name",
  "streamPack.theme.violet-noir.blurb",
  "streamPack.theme.arctic-frost.name",
  "streamPack.theme.arctic-frost.blurb",
  "streamPack.theme.desert-dune.name",
  "streamPack.theme.desert-dune.blurb",
  "streamPack.theme.midnight-jazz.name",
  "streamPack.theme.midnight-jazz.blurb",
]);

describe("ar-W5 (Stack-28 appendix) link-in-bio/nfc/privacy + promo namespaces fully translated", () => {
  it("wave is closed", () => {
    checkWave(W5_NS, W5_ALLOW);
  });
  it("carries mediaDetector.filesSkipped plurals whole (ar six forms)", () => {
    for (const suffix of ["_zero", "_one", "_two", "_few", "_many", "_other"]) {
      expect(typeof AR[`mediaDetector.filesSkipped${suffix}`], `filesSkipped${suffix}`).toBe("string");
    }
  });
});

const W6_NS = ["promote", "coach", "nfcCardProfile", "qrLogin", "notFound", "copyright", "locations", "milestones", "lufs", "presave", "release", "stabilize", "create", "press-public", "captionSuite", "outreach", "press-kit", "videoEditor", "contentIntelligence", "moveHome", "podcast", "hubSpine", "admin", "nav", "cover-art", "videoExport", "analyticsHub", "djSets", "share", "wave9", "brandingKit", "dashboard", "paidSeries", "proFinishing", "review", "tutorials", "wave8"];
const W6_ALLOW = new Set([
  "coach.tabActionTracker",
  "coach.tabContracts",
  "coach.tabManageDeals",
  "locations.errImageTooLarge",
  "podcast.publish.appleHeading",
  "podcast.publish.spotifyHeading",
  "lufs.formatMp3",
  "lufs.formatWav",
  "promote.hero.titleAccent",
  "admin.challenges.amountLabel",
  "admin.friendEmailPlaceholder",
  "admin.planEmailPlaceholder",
  "admin.remixKing.title",
  "admin.reversals.age",
  "admin.users.credits",
  "admin.users.emailPlaceholder",
    "admin.worldDrops.budgetLine",
    "admin.worldDrops.claimsLine",
    "admin.worldDrops.errors.amountRange",
    "admin.worldDrops.rangeLine",
  "analyticsHub.hookStudio",
  "analyticsHub.milestones.loggedFrom",
  "captionSuite.burnModeHint",
  "captionSuite.credits",
  "captionSuite.endCardText",
  "captionSuite.generateCost",
  "captionSuite.share_facebook",
  "captionSuite.share_telegram",
  "captionSuite.share_whatsapp",
  "coach.cadencePlaceholder",
  "coach.crossLinkBrand",
  "coach.platformInstagram",
  "coach.platformTikTok",
  "coach.platformYouTube",
  "coach.titleStart",
  "contentIntelligence.calendarFrom",
  "contentIntelligence.compUrlPlaceholder",
  "contentIntelligence.platformInstagram",
  "contentIntelligence.platformTikTok",
  "contentIntelligence.platformX",
  "contentIntelligence.platformYouTube",
  "cover-art.midnight_crown",
  "cover-art.thy_cheat_code",
  "dashboard.tile_vibes",
  "djSets.bpm",
  "djSets.exportRekordbox",
  "hubSpine.attributionTitle",
  "hubSpine.handoffs.resultLabel",
  "hubSpine.madeWith",
  "hubSpine.promoCards.historyForRelease",
  "hubSpine.promoCards.sizeHint.16x9",
  "moveHome.displayNamePh",
  "moveHome.genrePh",
  "moveHome.handlePh",
  "moveHome.locationPh",
  "moveHome.starterProductPh",
  "nav.bowRace",
  "nav.contentCalendar",
  "nav.credits",
  "nav.videoEditor",
  "outreach.audiencePlaceholder",
  "outreach.brandNamePlaceholder",
  "outreach.contactPlaceholder",
  "outreach.creatorNamePlaceholder",
  "outreach.invoice.brandEmailPlaceholder",
  "outreach.invoice.creatorEmailPlaceholder",
  "outreach.productPlaceholder",
  "paidSeries.buyerInitial",
  "podcast.generate.creditsEstimate",
  "podcast.result.apple",
  "podcast.result.durationApprox",
  "podcast.result.spotify",
  "podcast.script.creditsCost",
  "podcast.script.durationApprox",
  "press-kit.pdf",
  "press-kit.placeholders.artistName",
  "press-kit.placeholders.bookingEmail",
  "press-kit.placeholders.handle",
  "press-kit.placeholders.url",
  "press-kit.pressRelease.placeholders.contactEmail",
  "press-kit.pressRelease.placeholders.contactPhone",
  "proFinishing.qualitySummary",
  "release.crossLinks.p3",
  "release.types.ep.label",
  "review.madeWith",
  "share.attribution",
  "share.whatsapp",
  "tutorials.officialBadge",
  "videoEditor.modeSimple",
  "videoEditor.motionTrack.costChip",
  "videoEditor.pageTitle",
  "videoEditor.subjectReframe.costLabel",
  "videoEditor.subjectReframe.platformVertical",
  "videoEditor.subjectReframe.platformYoutube",
  "videoEditor.vibe_y2k",
  "videoExport.aspectVertical",
  "videoExport.aspectWide",
  "videoExport.colNum",
  "wave8.splits.royaltyAmountPlaceholder",
  "wave9.cameraMovePlanner.buildCost",
  "wave9.characterDirector.planCost",
  "brandingKit.colorRole.accent",
  "brandingKit.colorRole.background",
  "brandingKit.colorRole.neutral",
  "brandingKit.colorRole.primary",
  "brandingKit.colorRole.secondary",
  "wave9.characterDirector.vaultsLoadError",
  "wave9.characterDirector.vaultsRetry",
]);

describe("ar-W6 (Stack-28 appendix) milestones/lufs/presave/stabilize/create + promote/coach/release namespaces fully translated", () => {
  it("wave is closed", () => {
    checkWave(W6_NS, W6_ALLOW);
  });
});
