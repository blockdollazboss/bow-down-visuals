import { Router, type IRouter } from "express";
import healthRouter from "./health";
import songRouter from "./generate/song";
import songInspoRouter from "./generate/song-inspo";
import songsRouter from "./songs";
import songRemixRouter from "./song-remix";
import mashupRouter from "./mashup";
import playlistRouter from "./playlist";
import videoRouter from "./generate/video";
import songVideoRouter from "./generate/song-video";
import autoVideoPlanRouter from "./generate/auto-video-plan";
import promoRouter from "./generate/promo";
import thumbnailRouter from "./generate/thumbnail";
import projectsRouter from "./projects";
import hubProjectsRouter from "./hub-projects";
import reviewLinksRouter from "./review-links";
import artistVaultsRouter from "./artist-vaults";
import generationsRouter from "./generations";
import artistVoicesRouter from "./artist-voices";
import locationsRouter from "./locations";
import artistOutfitsRouter from "./artist-outfits";
import artistVaultIdentityRouter from "./artist-vault-identity";
import waitlistRouter from "./waitlist";
import contactRouter from "./contact";
import qrLoginRouter from "./qr-login";
import webauthnRouter from "./webauthn";
import r2UploadRouter from "./r2-upload";
import expressPayRouter from "./express-pay";
import spotlightRouter from "./spotlight";
import loadingScreenRouter from "./loading-screen";
import micBandRouter from "./mic-band";
import stockRouter from "./stock";
import transcribeRouter from "./transcribe";
import analyzeSectionsRouter from "./analyze-sections";
import runwayClipRouter from "./generate/runway-clip";
import artistImageRouter from "./generate/artist-image";
import headshotStudioRouter from "./generate/headshot-studio";
import productPhotoRouter from "./generate/product-photo";
import photoEnhanceRouter from "./generate/photo-enhance";
import photoBackdropRouter from "./generate/photo-backdrop";
import photoEditorRouter from "./generate/photo-editor";
import uploadClipRouter from "./generate/upload-clip";
import adminRouter from "./admin";
import reportsRouter from "./reports";
import accountRouter from "./account";
import vaultRouter from "./vault";
import groupProfilesRouter from "./group-profiles";
import bowChallengeRouter from "./bow-challenge";
import nfcCardsRouter from "./nfc-cards";
import bioPagesRouter from "./bio-pages";
import jewelryOrdersRouter from "./jewelry";
import exportVideoRouter from "./generate/export-video";
import prepareExportFilesRouter from "./generate/prepare-export-files";
import improvePromptRouter from "./generate/improve-prompt";
import directorLookRouter from "./generate/director-look";
import improveStyleRouter from "./generate/improve-style";
import autoEditRouter from "./generate/auto-edit";
import aiCopilotRouter from "./generate/ai-copilot";
import aiEditPlanRouter from "./generate/ai-edit-plan";
import mixPlanRouter from "./generate/mix-plan";
import musicAudioRouter from "./generate/music-audio";
import songCoverRouter from "./generate/song-cover";
import humToSongRouter from "./generate/hum-to-song";
import finishMySongRouter from "./generate/finish-my-song";
import rateMyMixRouter from "./generate/rate-my-mix";
import fanDecoderRouter from "./generate/fan-decoder";
import aiInterviewRouter from "./generate/ai-interview";
import lyricStoriesRouter from "./generate/lyric-stories";
import coverInMotionRouter from "./generate/cover-in-motion";
import songHarmonyRouter from "./generate/song-harmony";
import beatRouter from "./generate/beat";
import musicExportRouter from "./music-export";
import uploadWatermarkRouter from "./upload-watermark";
import devRouter from "./dev";
import stripePaymentsRouter from "./stripe-payments";
import embeddedCheckoutRouter from "./embedded-checkout";
import stripeConnectRouter from "./stripe-connect";
import creditsRouter from "./credits";
import publicApiRouter from "./public-api";
import carouselRouter from "./carousel";
import booksRouter from "./books";
import bonusRouter from "./bonus";
import teamsRouter from "./teams";
import teamSeatsRouter from "./team-seats";
import referralsRouter from "./referrals";
import sharesRouter from "./shares";
import generatedClipsRouter from "./generated-clips";
import draftsRouter from "./drafts";
import storyboardsRouter from "./storyboards";
import ugcAdsRouter from "./ugc-ads";
import ugcBriefsRouter from "./ugc-briefs";
import generationHistoryRouter from "./generation-history";
import assetLibraryRouter from "./asset-library";
import provenanceRouter from "./provenance";
import thumbnailsRouter from "./thumbnails";
import showcaseRouter from "./showcase";
import playerUpgradesRouter from "./player-upgrades";
import embedApiRouter from "./embed";
import albumsRouter from "./albums";
import djRouter from "./dj";
import soundFitRouter from "./sound-fit";
import lipSyncRouter from "./lip-sync";
import chatRouter from "./chat";
import freeChatRouter from "./free-chat";
import chatSpeakRouter from "./chat-speak";
import chatVoiceRouter from "./chat-voice";
import operatorActionsRouter from "./operator-actions";
import preProductionRouter from "./generate/pre-production";
import randomizerRouter from "./generate/randomizer";
import hookStudioRouter from "./generate/hook-studio";
import ctaGeneratorRouter from "./generate/cta-generator";
import gamersRouter from "./generate/gamers";
import proToolsAiRouter from "./generate/pro-tools-ai";
import soundFinderRouter from "./generate/sound-finder";
import monetizationCoachRouter from "./generate/monetization-coach";
import aiCoachRouter from "./generate/ai-coach";
import brandCalculatorRouter from "./generate/brand-calculator";
import academyRouter from "./generate/academy";
import commentRepliesRouter from "./generate/comment-replies";
import contentCalendarRouter from "./generate/content-calendar";
import tipJarRouter from "./generate/tip-jar";import interviewPrepRouter from "./generate/interview-prep";import upscaleRouter from "./generate/upscale";
import upscaleGenerativeRouter from "./generate/upscale-generative";
import avatarPresenterRouter from "./generate/avatar-presenter";
import singingVoiceRouter from "./generate/singing-voice";
import moneyRouter from "./money";
import publishingSplitsRouter from "./publishing-splits";
import songCreditsRouter from "./song-credits";
import featureVerseRouter from "./feature-verse";
import coachTrackerRouter from "./coach-tracker";
import earningsRouter from "./earnings";
import affiliatesRouter from "./affiliates";
import saleSplitsRouter from "./sale-splits";
import commandRouter from "./command";
import contentIdRouter from "./content-id";
import titleStudioRouter from "./generate/title-studio";
import sponsorsRouter from "./generate/sponsors";
import brandingShopRouter from "./generate/branding-shop";
import collabsRouter from "./generate/collabs";
import coPostsRouter from "./co-posts";
import coReleasesRouter from "./co-releases";
import plainDealsRouter from "./plain-deals";
import communityRouter from "./generate/community";
import contestsRouter from "./generate/contests";
import copyrightRouter from "./generate/copyright";
import coverArtRouter from "./generate/cover-art";
import emailListRouter from "./generate/email-list";
import fanGraphRouter from "./generate/fan-graph";
import fanSegmentsRouter from "./generate/fan-segments";
import liveShoppingRouter from "./live-shopping";
import liveStreamsRouter from "./live-streams";
import liveChatRouter from "./live-chat";
import liveCaptionsRouter from "./live-captions";
import keywordAutomationsRouter from "./keyword-automations";
import liveGuestsRouter from "./live-guests";
import pushRouter from "./push";
import liveTipsRouter from "./live-tips";
import songRequestsRouter from "./song-requests";
import liveTicketsRouter from "./live-tickets";
import liveModeratorsRouter from "./live-moderators";
import liveWidgetsRouter from "./live-widgets";
import liveSummaryRouter from "./live-summary";
import liveBattlesRouter from "./live-battles";
import reachRouter from "./reach";
import trustRouter from "./trust";
import membershipsRouter from "./generate/memberships";
import podcastRouter from "./generate/podcast";
import podcastDialogueRouter from "./generate/podcast-dialogue";
import podcastMultiplierRouter from "./generate/podcast-multiplier";
import pressKitRouter from "./generate/press-kit";
import pressReleaseRouter from "./generate/press-release";
import royaltiesRouter from "./generate/royalties";
import scriptWriterRouter from "./generate/script-writer";
import sfxRouter from "./generate/sfx";
import thumbnailTestRouter from "./generate/thumbnail-test";
import trendPredictorRouter from "./generate/trend-predictor";
import trendRadarRouter from "./trend-radar";
import coverFridaysRouter from "./cover-fridays";
import sceneEffectsRouter from "./generate/scene-effects";
import trendJackerRouter from "./generate/trend-jacker";
import styleStealerRouter from "./generate/style-stealer";
import commentToVideoRouter from "./generate/comment-to-video";
import dreamCollabRouter from "./generate/dream-collab";
import threeSecondLabRouter from "./generate/three-second-lab";
import streamCopilotRouter from "./generate/stream-copilot";
import memeMachineRouter from "./generate/meme-machine";
import linkToHitRouter from "./generate/link-to-hit";
import voiceoverRouter from "./generate/voiceover";
import beatsRouter from "./generate/beats";
import captionStylerRouter from "./generate/caption-styler";
import lyricVideoRouter from "./generate/lyric-video";
import backgroundRemovalRouter from "./generate/background-removal";
import videoBackgroundRemovalRouter from "./generate/video-background-removal";
import bgReplacerRouter from "./generate/bg-replacer";
import bgGenerateRouter from "./generate/bg-generate";
import lyricsGeneratorRouter from "./generate/lyrics-generator";
import autoReframeRouter from "./generate/auto-reframe";
import voiceEffectsRouter from "./generate/voice-effects";
import audioDuckingRouter from "./generate/audio-ducking";
import videoStylesRouter from "./generate/video-styles";
import silenceRemovalRouter from "./generate/silence-removal";
import fillerRemovalRouter from "./generate/filler-removal";
import logoAnimatorRouter from "./generate/logo-animator";
import transitionsRouter from "./generate/transitions";
import videoTemplateRouter from "./generate/video-template";
import splitScreenRouter from "./generate/split-screen";
import smartClipsRouter from "./generate/video-to-shorts";
import voicePersonasRouter from "./generate/voice-personas";
import voiceCloneRouter from "./generate/voice-clone";
import scriptToVideoRouter from "./generate/script-to-video";
import bgMusicRouter from "./generate/bg-music";
import translateCaptionsRouter from "./generate/translate-captions";
import socialAnalyticsRouter from "./generate/social-analytics";
import hookAnalyzerRouter from "./generate/hook-analyzer";
import showNotesRouter from "./generate/show-notes";
import autoChaptersRouter from "./generate/auto-chapters";
import chaptersRouter from "./generate/chapters";
import voiceoverProRouter from "./generate/voiceover-pro";
import producerTagRouter from "./generate/producer-tag";
import producerTagLifecycleRouter from "./generate/producer-tag-lifecycle";
import brandKitRouter from "./generate/brand-kit";
import brollSuggesterRouter from "./generate/broll-suggester";
import colorGradeRouter from "./generate/color-grade";
import lutRouter from "./lut";
import speedPresetsRouter from "./generate/speed-presets";
import videoTrimRouter from "./generate/video-trim";
import slowMotionRouter from "./generate/slow-motion";
import loopMakerRouter from "./generate/loop-maker";
import endScreenRouter from "./generate/end-screen";
import videoMergerRouter from "./generate/video-merger";
import beatSyncRouter from "./generate/beat-sync";
import thumbnailAbRouter from "./generate/thumbnail-ab";
import thumbBgRouter from "./generate/thumb-bg";
import chapterArtRouter from "./generate/chapter-art";
import socialKitRouter from "./generate/social-kit";
import promoCardsRouter from "./generate/promo-cards";
import storyboardRouter from "./generate/storyboard";
import volumeNormRouter from "./generate/volume-norm";
import stabilizeRouter from "./generate/stabilize";
import cinematicFxRouter from "./generate/cinematic-fx";
import motionTrackRouter from "./generate/motion-track";
import videoTitlesRouter from "./generate/video-titles";
import clipDescriptionsRouter from "./generate/clip-descriptions";
import descAbTestRouter from "./generate/desc-ab-test";
import seoScoreRouter from "./generate/seo-score";
import thumbnailTextRouter from "./generate/thumbnail-text";
import audiogramRouter from "./generate/audiogram";
import canvasRouter from "./generate/canvas";
import memeGeneratorRouter from "./generate/meme-generator";
import testimonialRouter from "./generate/testimonial";
import nicheAnalyzerRouter from "./generate/niche-analyzer";
import ideaValidatorRouter from "./generate/idea-validator";
import hashtagsRouter from "./generate/hashtags";
import virtualBgRouter from "./generate/virtual-bg";
import masteringRouter from "./generate/mastering";
import bioGeneratorRouter from "./generate/bio-generator";
import communityPostRouter from "./generate/community-post";
import repurposeRouter from "./generate/repurpose";
import samplePackRouter from "./generate/sample-pack";
import stemSplitterRouter from "./generate/stem-splitter";
import streamerClipsRouter from "./generate/streamer-clips";
import videoTranslatorRouter from "./generate/video-translator";
import vocalRemovalRouter from "./generate/vocal-removal";
import streamPackRouter from "./generate/stream-pack";
import watermarkRemovalRouter from "./generate/watermark-removal";
import mediaImporterRouter from "./generate/media-importer";
import logoRouter from "./generate/logo";
import introOutroRouter from "./generate/intro-outro";
import introOutroFfmpegRouter from "./generate/intro-outro-ffmpeg";
import viralityCheckRouter from "./generate/virality-check";
import upscaleImageRouter from "./generate/upscale-image";
import analyticsHubRouter from "./generate/analytics-hub";
import competitorTrackerRouter from "./generate/competitor-tracker";
import retentionDoctorRouter from "./retention-doctor";
import retentionRouter from "./retention";
import soundPrefsRouter from "./sound-prefs";
import monthWrappedRouter from "./month-wrapped";
import groupDigestRouter from "./group-digest";
import viralSpikeRouter from "./viral-spike";
import secondLifeRouter from "./second-life";
import trendRadarRouter from "./trend-radar";
import dropDayKitsRouter from "./drop-day-kits";
import globalDropRouter from "./global-drop";
import livePrefsRouter from "./live-prefs";
import liveHighlightsRouter from "./live-highlights";
import liveStageManagerRouter from "./live-stage-manager";
import pitchFixRouter from "./pitch-fix";
import studioGearRouter from "./studio-gear";
import openVerseRouter from "./open-verse";
import sampleClearanceRouter from "./sample-clearance";
import communityGrantsRouter from "./community-grants";
import priorityDmsRouter from "./priority-dms";
import proxyEditingRouter from "./proxy-editing";
import remixKingRouter from "./remix-king";
import loopExchangeRouter from "./loop-exchange";
import retentionDelightRouter from "./retention-delight";
import activityFeedRouter from "./activity-feed";
import contentPlansRouter from "./content-plans";
import llcGuideRouter from "./generate/llc-guide";
import tourPlannerRouter from "./generate/tour-planner";
import setlistRouter from "./generate/setlist";
import promoGeneratorRouter from "./generate/promo-generator";
import socialRouter from "./social";
import socialProofRouter from "./social-proof";
import resultsWallRouter from "./results-wall";
import productReviewsRouter from "./product-reviews";
import wishlistsRouter from "./wishlists";
import productOffersRouter from "./product-offers";
import analyticsRouter from "./analytics";
import discordRouter from "./discord";
import discordBotRouter from "./discord-bot";
import jobNotificationsRouter from "./job-notifications";
import distributionRouter from "./generate/distribution";
import distributionLegacyRouter from "./distribution-legacy";
import schedulerRouter from "./scheduler";
import evergreenRouter from "./evergreen";
import merchRouter from "./generate/merch";
import jewelryRouter from "./generate/jewelry";
import playlistPitchRouter from "./generate/playlist-pitch";
import labelPitchRouter from "./generate/label-pitch";
import syncPitchRouter from "./generate/sync-pitch";
import invoiceRouter from "./generate/invoice";
import milestoneRouter from "./generate/milestones";
import channelAuditRouter from "./generate/channel-audit";
import contractAnalyzerRouter from "./generate/contract-analyzer";
import moviesRouter from "./generate/movies";
import websiteBuilderRouter from "./generate/website-builder";
import mediaDetectorRouter from "./generate/media-detector";
import sponsorshipOutreachRouter from "./generate/sponsorship-outreach";
import sponsorReadRouter from "./generate/sponsor-read";
import shoutoutsRouter from "./generate/shoutouts";
import releaseChecklistRouter from "./generate/release-checklist";
import thumbnailGeneratorRouter from "./generate/thumbnail-generator";
import audioCleanupRouter from "./generate/audio-cleanup";
import deverbRouter from "./generate/deverb";
import lufsRouter from "./generate/lufs-meter";
import vocalTuneRouter from "./generate/vocal-tune";
import aspectConvertRouter from "./generate/aspect-convert";
import wallpapersRouter from "./wallpapers";
import themePacksRouter from "./theme-packs";
import themeKitRouter from "./theme-kit";
import exportMultiRatioRouter from "./generate/export-multi-ratio";
import extractAudioRouter from "./generate/extract-audio";
import vocalPolishRouter from "./generate/vocal-polish";
import cheatCodeRouter from "./cheat-code";
import mixMasterRouter from "./generate/mix-master";
import shopsRouter from "./generate/shops";
import showFinderRouter from "./generate/show-finder";
import brandDealsRouter from "./generate/brand-deals";
import collageRouter from "./generate/collage";
import karaokeRouter from "./generate/karaoke";
// ── Wave 8 ─────────────────────────────────────────────────────────
import wave8ThumbnailAbRouter from "./wave8-thumbnail-ab";
import wave8CaptionStylerRouter from "./wave8-caption-styler";
import wave8CalendarRouter from "./wave8-calendar";
import wave8HookRewriterRouter from "./wave8-hook-rewriter";
import wave8AdlibRouter from "./wave8-adlib";
import wave8HighlightsRouter from "./wave8-highlights";
import wave8MerchDropRouter from "./wave8-merch-drop";
import wave8MediaKitRouter from "./wave8-media-kit";
import wave8SplitsRouter from "./wave8-splits";
import wave8SponsorsRouter from "./wave8-sponsors";
import wave9aMusicRouter from "./wave9a-music";
import wave9bEditorRouter from "./wave9b-editor";
import wave9cDirectEditRouter from "./wave9c-direct-edit";
import wave9dDirectorRouter from "./wave9d-director";
import wave9dCameraRouter from "./wave9d-camera";
import textAnimatorRouter from "./generate/text-animator";
import subtitleStylerRouter from "./generate/subtitle-styler";
import autoCaptionsRouter from "./generate/auto-captions";
import watermarkRouter from "./generate/watermark";
import gifConverterRouter from "./generate/gif-converter";
import reverseVideoRouter from "./generate/reverse-video";
import freezeMaskRouter from "./generate/freeze-mask";
import thumbExtractRouter from "./generate/thumb-extract";
import ctrPredictorRouter from "./generate/ctr-predictor";
import altTextRouter from "./generate/alt-text";
import bestTimeRouter from "./generate/best-time";
import quoteFinderRouter from "./generate/quote-finder";
import podcastIntroRouter from "./generate/podcast-intro";
import guestQuestionsRouter from "./generate/guest-questions";
import slideshowRouter from "./generate/slideshow";
import reactionVideoRouter from "./generate/reaction-video";
import videoDubRouter from "./generate/video-dub";
// ── Creator Streaming Platform (12-worker build, 2026-10-07) ──
import creatorPlatformRouter from "./creator-platform";
import podcastFeedRouter from "./podcast-feed";
import commentControlsRouter from "./comment-controls";
import royalCourtRouter from "./royal-court";
import supporterBoardRouter from "./supporter-board";
import profileWebsiteRouter from "./profile-website";
import fanArtRouter from "./fan-art";
import profileHostingRouter from "./profile-hosting";
import worldRouter from "./world";
import worldEventsRouter from "./world-events";
import worldCourtSeasonRouter from "./world-court-season";
import theCrownsRouter from "./the-crowns";
import worldContestsRouter from "./world-contests";
import worldTutorialRouter from "./world-tutorial";
import moveHomeRouter from "./move-home";
import first100Router from "./first100";
import catalogImportRouter from "./catalog-import";
import tutorialsRouter from "./tutorials";
import coursesRouter from "./courses";
import dailyQuestsRouter from "./daily-quests";
import publishRouter from "./publish";
import mirrorMediaRouter from "./mirror-media";
import discoveryRouter from "./discovery";
import scenesRouter from "./scenes";
import shortsRouter from "./shorts";
import challengeEngineRouter from "./challenge-engine";
import creatorCommunityRouter from "./community";
import videoCallsRouter from "./video-calls";
import domainsRouter from "./domains";
import storeRouter from "./store";
import storefrontRouter from "./storefront";
import performanceBookingsRouter from "./performance-bookings";
import shopifyBridgeRouter from "./shopify-bridge";
import giftCardsRouter from "./gift-cards";
import giftProductRouter from "./gift-product";
import membershipGiftsRouter from "./membership-gifts";
import creatorTiersRouter from "./creator-tiers";
import aiPageDesignerRouter from "./ai-page-designer";
import publicStatsRouter from "./public-stats";
import retentionDropsRouter from "./retention-drops";
import arcadeRouter from "./arcade";
import partyRouter from "./party";
import upgFansRouter from "./upg-fans";
import emailTrackingRouter from "./email-tracking";

const router: IRouter = Router();

router.use("/email-track", emailTrackingRouter);
router.use(healthRouter);
router.use(songRouter);
router.use(songInspoRouter);
router.use(videoRouter);
router.use(songVideoRouter);
router.use(autoVideoPlanRouter);
router.use(promoRouter);
router.use(thumbnailRouter);
router.use(projectsRouter);
router.use(hubProjectsRouter);
router.use(reviewLinksRouter);
router.use(artistVaultsRouter);
router.use(generationsRouter);
router.use(artistVoicesRouter);
router.use(locationsRouter);
router.use(artistOutfitsRouter);
router.use(artistVaultIdentityRouter);
router.use(songsRouter);
router.use(songRemixRouter);
router.use(mashupRouter);
router.use(playlistRouter);
router.use(waitlistRouter);
router.use(contactRouter);
router.use(qrLoginRouter);
router.use(webauthnRouter);
router.use(expressPayRouter);
router.use(r2UploadRouter);
router.use(spotlightRouter);
router.use(loadingScreenRouter);
router.use(micBandRouter);
router.use(stockRouter);
router.use(transcribeRouter);
router.use(analyzeSectionsRouter);
router.use(runwayClipRouter);
router.use(artistImageRouter);
router.use(headshotStudioRouter);
router.use(productPhotoRouter);
router.use(photoEnhanceRouter);
router.use(photoBackdropRouter);
router.use(photoEditorRouter);
router.use(uploadClipRouter);
router.use(adminRouter);
router.use(reportsRouter);
router.use(accountRouter);
router.use(vaultRouter);
router.use(bowChallengeRouter);
router.use(nfcCardsRouter);
router.use(bioPagesRouter);
router.use(jewelryOrdersRouter);
router.use(exportVideoRouter);
router.use(prepareExportFilesRouter);
router.use(improvePromptRouter);
router.use(directorLookRouter);
router.use(improveStyleRouter);
router.use(autoEditRouter);
router.use("/ai-copilot", aiCopilotRouter); // /api/ai-copilot/analyze — the router defines POST /analyze; the FE (AICopilotPanel) and the G14 refund test both address it under this prefix
router.use(aiEditPlanRouter);
router.use(mixPlanRouter);
router.use(musicAudioRouter);
router.use(songCoverRouter);
router.use(humToSongRouter);
router.use(songHarmonyRouter);
router.use(beatRouter);
router.use(musicExportRouter);
router.use(uploadWatermarkRouter);
router.use(devRouter);
router.use(stripePaymentsRouter);
router.use(embeddedCheckoutRouter); // /api/embedded-checkout/* — on-site PaymentElement flows (credit packs + plan subscriptions)
router.use(stripeConnectRouter);
router.use(creditsRouter);
router.use(publicApiRouter); // Stack-100 #3 #9: /api-keys management + Public Creator API /v1 (me, content, balance, generate/bio)
router.use(carouselRouter);
router.use(booksRouter);
router.use(bonusRouter);
router.use(teamsRouter);router.use(teamSeatsRouter);router.use(groupProfilesRouter);
router.use(referralsRouter);
router.use(sharesRouter);
router.use(generatedClipsRouter);
router.use(draftsRouter);
router.use(storyboardsRouter);
router.use(ugcAdsRouter);                     // UGC Product Ads: /api/ugc-ads{,/products,/script,/persona,/:id,/:id/generate,/:id/pin}
router.use(ugcBriefsRouter);                  // UGC briefs board: /api/ugc-briefs{,/:id,/:id/claim,/release,/deliver,/approve,/close}
router.use(generationHistoryRouter);
router.use(assetLibraryRouter);
router.use(provenanceRouter);
router.use(thumbnailsRouter);
router.use(showcaseRouter);
router.use(playerUpgradesRouter);
router.use(embedApiRouter);
router.use(albumsRouter);
router.use(djRouter);
router.use(soundFitRouter);
router.use(lipSyncRouter);
router.use(preProductionRouter);
router.use(chatRouter);
router.use(freeChatRouter);
router.use(chatSpeakRouter);
router.use(chatVoiceRouter);
router.use(operatorActionsRouter);
router.use(randomizerRouter);
router.use(hookStudioRouter);
router.use(ctaGeneratorRouter);
router.use(gamersRouter);
router.use(proToolsAiRouter);
router.use(soundFinderRouter);
router.use(monetizationCoachRouter);
router.use(aiCoachRouter);
router.use(brandCalculatorRouter);
router.use(academyRouter);
router.use(commentRepliesRouter);
router.use(contentCalendarRouter);
router.use(tipJarRouter);
router.use(moneyRouter);router.use(publishingSplitsRouter); // /api/publishing-splits/* (songwriter registry, #22)
router.use(songCreditsRouter); // /api/song-credits/* (Stack-200 N1: canonical credits that follow the song)
router.use(featureVerseRouter); // /api/feature-verse/* (Feature Verse Market, Stack-200 N7)
router.use(moneyRouter);router.use(coachTrackerRouter);router.use(earningsRouter);router.use(affiliatesRouter);router.use(saleSplitsRouter);router.use(commandRouter);router.use(contentIdRouter);router.use(interviewPrepRouter);router.use(upscaleRouter);
router.use(upscaleGenerativeRouter);router.use(avatarPresenterRouter);router.use(singingVoiceRouter);
router.use(bgGenerateRouter);
router.use(titleStudioRouter);
router.use(sponsorsRouter);
router.use(brandingShopRouter);
router.use(collabsRouter);
router.use(coPostsRouter); // /api/co-posts/* (Stack-100 #3 #24: Collabs payoff — one post, both profiles)
router.use(coReleasesRouter); // /api/co-releases/* (Stack-100 #3 Wave 3: co-posts phase 2 — one release/product, both profiles, consented royalty split)
router.use(plainDealsRouter); // /api/plain-deals/* (Stack-200 upgrade #164: Plain-Words Deals — write/sign a deal in plain words; split attaches to co-release / sale-splits rails at signature)
router.use(communityRouter);
router.use(contestsRouter);
router.use(copyrightRouter);
router.use(coverArtRouter);
router.use(emailListRouter);
router.use(fanGraphRouter);                    // /api/email-list/fan-graph (One Fan Graph — unified fan view)
router.use(fanSegmentsRouter);                 // /api/email-list/fan-segments (fan-graph phase 2 — saved segments + desk send)
router.use(keywordAutomationsRouter);          // /api/keyword-automations/* (Wave 4 #32 — keyword → DM rules + audit log)
router.use(liveShoppingRouter);
router.use(liveStreamsRouter);              // /api/live-streams/* (Go Live broadcasts)
router.use(liveChatRouter);                 // /api/live/:id/chat (stream chat + moderation)
router.use(liveCaptionsRouter);             // /api/live/:id/captions/* + /api/live-captions/languages (Stack-200 #160 — live captions, per-viewer translation)
router.use(liveGuestsRouter);               // /api/live-streams/:id/guest-invites + /api/live-guest/* (guest invites + backstage)
router.use(pushRouter);                      // /api/push/* (web-push subscriptions)
router.use(liveTipsRouter);                  // /api/live/:id/tips (stream tips + paid pins)
router.use(songRequestsRouter);              // /api/live/:id/song-requests + /api/song-request-rules (N18 tipped song-request queue)
router.use(liveTicketsRouter);               // /api/live-streams/:id/ticket(s) (ticketed live — pay-per-view door)
router.use(liveModeratorsRouter);            // /api/live/moderators + /api/live/:id/chat/my-role
router.use(liveWidgetsRouter);               // /api/live/:id/widgets + /api/live/:id/tip-goal
router.use(liveSummaryRouter);               // /api/live/:id/summary (post-stream, owner)
router.use(liveBattlesRouter);               // /api/live-battles/* (Stack-200 #154 — two-creator live battles, recorded-vote tally, crown)
router.use(reachRouter);                     // /api/reach/* (Stack 9: fan-out, premieres, raids, drops, loyalty, close-friends, broadcast)
router.use(trustRouter);                     // Stack 10: /api/content-id/fingerprints|scan|claims, /api/legacy/*, /api/catalog-export, /api/mod-console, /api/earnings/statements, /api/stage-rooms, group roles/onboarding, retention analytics
router.use(membershipsRouter);
router.use(podcastRouter);
router.use(podcastDialogueRouter);
router.use(podcastMultiplierRouter);
router.use(pressKitRouter);
router.use(pressReleaseRouter);
router.use(royaltiesRouter);
router.use(scriptWriterRouter);
router.use(sfxRouter);
router.use(thumbnailTestRouter);
router.use(trendPredictorRouter);
router.use(trendRadarRouter);
router.use(sceneEffectsRouter); // /api/scene-effects/* — Viral Effects rail (recipes + Turbo Effect Match)
router.use(trendJackerRouter);
router.use(styleStealerRouter);
router.use(commentToVideoRouter);
router.use(dreamCollabRouter);
router.use(threeSecondLabRouter);
router.use(streamCopilotRouter);
router.use(memeMachineRouter);
router.use(linkToHitRouter);
router.use(voiceoverRouter);
router.use(beatsRouter);
router.use(captionStylerRouter);
router.use(lyricVideoRouter);
router.use(backgroundRemovalRouter);
router.use(videoBackgroundRemovalRouter);
router.use(bgReplacerRouter);
router.use(lyricsGeneratorRouter);
router.use(autoReframeRouter);
router.use(voiceEffectsRouter);
router.use(audioDuckingRouter);
router.use(videoStylesRouter);
router.use(silenceRemovalRouter);
router.use(fillerRemovalRouter);
router.use(logoAnimatorRouter);
router.use(transitionsRouter);
router.use(videoTemplateRouter);
router.use(splitScreenRouter);
router.use(smartClipsRouter);
router.use(voicePersonasRouter);
router.use(voiceCloneRouter);
router.use(scriptToVideoRouter);
router.use(bgMusicRouter);
router.use(translateCaptionsRouter);
router.use(socialAnalyticsRouter);
router.use(hookAnalyzerRouter);
router.use(showNotesRouter);
router.use(autoChaptersRouter);
router.use(chaptersRouter);
router.use(voiceoverProRouter);
router.use(producerTagRouter);
router.use(producerTagLifecycleRouter);
router.use(brollSuggesterRouter);
router.use(brandKitRouter);
router.use(speedPresetsRouter);
router.use(colorGradeRouter);
router.use(lutRouter);
router.use(videoTrimRouter);
router.use(slowMotionRouter);
router.use(loopMakerRouter);
router.use(endScreenRouter);
router.use(thumbnailAbRouter);
router.use(thumbBgRouter);
router.use(chapterArtRouter);
router.use(socialKitRouter);
router.use(promoCardsRouter);
router.use(storyboardRouter);
router.use(volumeNormRouter);
router.use(stabilizeRouter);
router.use(cinematicFxRouter);
router.use(motionTrackRouter);
router.use(videoTitlesRouter);
router.use(clipDescriptionsRouter);
router.use(descAbTestRouter);
router.use(seoScoreRouter);
router.use(thumbnailTextRouter);
router.use(audiogramRouter);
router.use(canvasRouter);
router.use(memeGeneratorRouter);
router.use(testimonialRouter);
router.use(nicheAnalyzerRouter);
router.use(ideaValidatorRouter);
router.use(hashtagsRouter);
router.use(virtualBgRouter);
router.use(masteringRouter);
router.use(bioGeneratorRouter);
router.use(communityPostRouter);
router.use(repurposeRouter);
router.use(samplePackRouter);
router.use(stemSplitterRouter);
router.use(streamerClipsRouter);
router.use(videoTranslatorRouter);
router.use(vocalRemovalRouter);
router.use(watermarkRemovalRouter);
router.use(mediaImporterRouter);
router.use(streamPackRouter);
router.use(logoRouter);
router.use(viralityCheckRouter);
router.use(upscaleImageRouter);
router.use(analyticsHubRouter);
router.use(competitorTrackerRouter);
router.use(retentionDoctorRouter);
router.use(retentionRouter);
router.use(soundPrefsRouter);            // /api/sound-prefs (signature sounds, UPGRADES 183)
router.use(monthWrappedRouter);          // /api/month-wrapped (Your Month, Wrapped, idea #170)
router.use(groupDigestRouter);           // /api/group-digest-prefs (per-group activity digest)
router.use(viralSpikeRouter);            // /api/viral-spike-prefs + /api/viral-spike-kits (viral-spike response kit, orphan wave)
router.use(secondLifeRouter);            // /api/second-life/* (Second Life revival queue + watch switch, UPGRADE #161)
router.use(trendRadarRouter);            // /api/trend-radar (real-signal trend feed, UPGRADE #178)
router.use(dropDayKitsRouter);
router.use(globalDropRouter);           // /api/drop-day-kits (one-tap release kit assembly, UPGRADE #169)
router.use(livePrefsRouter);             // /api/live-prefs (live automation switches, UPGRADE #172/#166)
router.use(liveHighlightsRouter);        // /api/live-streams/:id/highlights (Auto-Highlights proposals, UPGRADE #172)
router.use(liveStageManagerRouter);       // /api/live-streams/:id/stage-manager (co-host state/mute/unpin, UPGRADE #166)
router.use(pitchFixRouter);              // /api/pitch-fix/* + /api/admin/pitch-fix/* (Pitch & Fix + Feedback Pop-Ups, UPGRADES 196+180)
router.use(studioGearRouter);            // /api/studio-gear/* + /api/admin/studio-gear/* (Branding Shop studio-gear line, test mode)
router.use(openVerseRouter);             // /api/open-verse/* (Open Verse #176 — splits rail reuse, creator-gated pick, exactly-once ledger)
router.use(sampleClearanceRouter);       // /api/sample-clearance/* (Sample Clearance Lane, Stack-200 N2)
router.use(communityGrantsRouter);       // /api/community-grants/* + /api/admin/community-grants/* (Community Grants, N15)
router.use(priorityDmsRouter);           // /api/priority-dms/* (Paid Priority DMs, Wave-4 #44 — gated OFF by PRIORITY_DM_ENABLED until the owner rules)
router.use(proxyEditingRouter);          // /api/proxy-editing/* (proxy editing, board 184)
router.use(remixKingRouter);             // /api/remix-king/* + /api/admin/remix-king/* (Remix the King, #152)
router.use(loopExchangeRouter);          // /api/loop-exchange/* (Loop Exchange, Stack-200 #168)
router.use(retentionDelightRouter);
router.use(activityFeedRouter);           // /api/activity/feed (live FOMO feed)
router.use(contentPlansRouter);
router.use(introOutroRouter);
router.use(introOutroFfmpegRouter);
router.use(llcGuideRouter);
router.use(tourPlannerRouter);
router.use(setlistRouter);
router.use(promoGeneratorRouter);
router.use(socialRouter);
router.use(socialProofRouter);              // /api/social-proof/* (C5 live social-proof sync)
router.use(resultsWallRouter);              // /api/results-wall/* (Stack-200 #177 public results wall — verified, opt-in)
router.use(productReviewsRouter);           // /api/product-reviews* (Stack-100 #3 #14 verified-purchase product reviews)
router.use(wishlistsRouter);                // /api/wishlists* (Wave 4 #38 wishlists + price-drop alerts)
router.use(productOffersRouter);            // /api/product-offers* (Wave 4 #43 make-an-offer)
router.use(analyticsRouter);
router.use(discordRouter);
router.use(discordBotRouter);
router.use(jobNotificationsRouter);
router.use(distributionRouter);
router.use(distributionLegacyRouter);        // Stack 11: /api/distribution/{landing-content, spotify, splits/statements, lyrics-package, change-requests, permanence, roster} + /api/promote/unlock-gates
router.use(schedulerRouter);
router.use(evergreenRouter); // /api/evergreen/* (Wave-4 #48: evergreen recycling proposals in the Scheduler — never auto-posts)
router.use(merchRouter);
router.use(jewelryRouter);
router.use(playlistPitchRouter);
router.use(labelPitchRouter);
router.use(syncPitchRouter);
router.use(invoiceRouter);
router.use(milestoneRouter);
router.use(channelAuditRouter);
router.use("/contracts", contractAnalyzerRouter);
router.use("/movies", moviesRouter);
router.use("/website-builder", websiteBuilderRouter);
router.use("/detect", mediaDetectorRouter);
router.use(sponsorshipOutreachRouter);
router.use(sponsorReadRouter);
router.use(karaokeRouter);
router.use(shoutoutsRouter);
router.use(releaseChecklistRouter);
router.use(thumbnailGeneratorRouter);
router.use(audioCleanupRouter);
router.use(deverbRouter);
router.use(lufsRouter);
router.use(vocalTuneRouter);
router.use(aspectConvertRouter);
router.use(wallpapersRouter);
router.use(themePacksRouter);
router.use(themeKitRouter);
router.use(exportMultiRatioRouter);
router.use(extractAudioRouter);
router.use(vocalPolishRouter);
router.use(cheatCodeRouter);
router.use(videoMergerRouter);
router.use(beatSyncRouter);
router.use(mixMasterRouter);
router.use(subtitleStylerRouter);
router.use(autoCaptionsRouter);
router.use(shopsRouter);
router.use(showFinderRouter);
router.use(brandDealsRouter);
router.use(collageRouter);
router.use(textAnimatorRouter);
router.use(watermarkRouter);
router.use(gifConverterRouter);
router.use(reverseVideoRouter);
router.use(freezeMaskRouter);
router.use(thumbExtractRouter);
router.use(ctrPredictorRouter);
router.use(altTextRouter);
router.use(bestTimeRouter);
router.use(quoteFinderRouter);
router.use(videoDubRouter);
router.use(podcastIntroRouter);
router.use(guestQuestionsRouter);
router.use(slideshowRouter);
router.use(reactionVideoRouter);

// ── Creator Streaming Platform ──
router.use(commentControlsRouter);          // /api/creator-profiles/me/comment-settings, /me/held-comments, /api/creator-comments/:id/action (#27 — before creatorPlatform so /me/* wins over /:id)
router.use(creatorPlatformRouter);          // /api/creator-profiles/*, follows, likes, plays, DMCA
router.use(podcastFeedRouter);              // /api/podcast-feed/* — hosted per-show RSS for Apple/Spotify (Lane F10)
router.use(royalCourtRouter);               // /api/creator-profiles/:slug/court, /me/court (The Front Row)
router.use(supporterBoardRouter);           // /api/supporter-board/* (Wave-4 #49 + N6: top-supporter recognition on creator profiles)
router.use(profileWebsiteRouter);           // /api/creator-profiles layout/theme/store/spotlight, /api/collections/* (Stack 3)
router.use(fanArtRouter);                   // /api/creator-profiles/:slug/fan-art, /me/fan-art, /api/fan-art/mine (Fan Art Wall, #157)
router.use(profileHostingRouter);           // /api/creator-hosting/* (Stack 3 Hosting plan)
router.use(worldRouter);                      // /api/world/screen (The World — King's Hall big screen)
router.use(worldEventsRouter);                // /api/world/events (World Events — the palace calendar, 0145)
router.use(worldCourtSeasonRouter);           // /api/world/court-season (Court seasons — the Season Marks Wall read, 0153)
router.use(theCrownsRouter);                  // /api/crowns + /api/crowns/worn/:userId (The Crowns — yearly house awards read, N8/9999)
router.use(worldContestsRouter);              // /api/world/contests + /api/world/winners-circle (World Contests, 0158)
router.use(worldTutorialRouter);              // /api/world/tutorial (Your First 10 Minutes quest line, 0149)
router.use(moveHomeRouter);                   // /api/move-home (Move Home concierge onboarding, 0193)
router.use(first100Router);                   // /api/first100 (First 100 Fans guided path, #155)
router.use(catalogImportRouter);              // /api/catalog-import (Back-Catalog Migration Assistant, 0200)
router.use(tutorialsRouter);                  // /api/tutorials (Tutorials V1 — Academy how-tos + fan progress, 0201)
router.use(coursesRouter);                    // /api/courses (Creator Courses — storefront kind='course', curriculum + drip + progress; tables pending migration)
router.use(dailyQuestsRouter);                // /api/retention/quests/daily (Daily Quest Trio, 0150)
router.use("/publish", publishRouter);      // /api/publish/*
router.use(mirrorMediaRouter);              // /api/mirror-media (client-side mirror-on-save)
router.use("/discovery", discoveryRouter);  // /api/discovery/*
router.use("/discovery", scenesRouter);     // /api/discovery/scenes* (Local Scenes, Stack-200 N10 — declared-city pages inside the discovery family)
/* challengeEngineRouter is the ONE canonical mount for /api/challenges/*
   (Wave 3 #12 removed the duplicate mount that lived inside shorts.ts).
   It mounts before shortsRouter; shorts serves no challenge routes —
   it only borrows the engine's DTO/status helpers for /hashtag. */
/* Cover Fridays (N19) mounts AHEAD of the engine so its one
   specific path wins over the engine's GET /challenges/:slug
   capture — the same specific-before-slug ordering the engine
   keeps internally (weekly/trending before :slug). It serves
   no other challenge path; entering/voting stay the engine's. */
router.use(coverFridaysRouter);             // /api/challenges/cover-fridays (Cover Fridays ritual read, N19)
router.use(challengeEngineRouter);          // /api/challenges/* engine 2.0: prizes, votes, winners, lifecycle
router.use(shortsRouter);                   // /api/shorts/*, /api/sounds/*, /api/hashtag/*
router.use(creatorCommunityRouter);   // /api/groups/*, /api/events/*, /api/dm/*, /api/explore
router.use(videoCallsRouter);         // /api/dm/:id/call, /api/dm/:id/calls, /api/dm/calls/:callId/*, /api/dm/call-config (Video Calls Phase 1, Stack-200; provisional migration 9999)
router.use(domainsRouter);                  // /api/domains/*
router.use(storeRouter);                    // /api/store/* (digital sales checkout)
router.use(storefrontRouter);               // /api/storefront/* (products, orders, discounts)
router.use(performanceBookingsRouter);      // /api/performance-bookings/* (Book the Artist, #158)
router.use(shopifyBridgeRouter);            // /api/storefront/shopify-import/*, /api/storefront/shopify-export/* (CSV bridge)
router.use(giftCardsRouter);                // /api/gift-cards/* (stored-value gift cards: buy/verify/balance/mine/sold/refund)
router.use(giftProductRouter);              // /api/product-gifts/* (Wave-4 #45: buy a store product as a gift — purchase/mine/claim/resend)
router.use(membershipGiftsRouter);          // /api/membership-gifts/* (gift Pro/Elite: recipient/checkout/verify/mine)
router.use(creatorTiersRouter);             // /api/creator-tiers/*
router.use("/ai-page-designer", aiPageDesignerRouter); // /api/ai-page-designer/*
router.use(publicStatsRouter);                      // /api/public/stats (cached social-proof stats)
// NOTE: social.ts (stories/posts/reactions) was already mounted above as socialRouter.
// ── Wave 8 (each mounted exactly once) ─────────────────────────────────
router.use(wave8ThumbnailAbRouter);   // /api/wave8/thumbnail-ab/*
router.use(wave8CaptionStylerRouter); // /api/wave8/caption-styler/*
router.use(wave8CalendarRouter);      // /api/wave8/calendar/*
router.use(wave8HookRewriterRouter);  // /api/wave8/hook-rewriter/*
router.use(wave8AdlibRouter);         // /api/wave8/adlib/*
router.use(wave8HighlightsRouter);    // /api/wave8/highlights/*
router.use(wave8MerchDropRouter);     // /api/wave8/merch-drop/*
router.use(wave8MediaKitRouter);      // /api/wave8/media-kit/*
router.use(wave8SplitsRouter);        // /api/wave8/splits/*
router.use(wave8SponsorsRouter);       // /api/wave8/sponsors/*
router.use(wave9aMusicRouter);         // /api/wave9a/*
router.use(wave9bEditorRouter);        // /api/wave9b/*
router.use(wave9cDirectEditRouter);    // /api/wave9c/direct/*
router.use(wave9dDirectorRouter);      // /api/wave9d/director/*
router.use(wave9dCameraRouter);        // /api/wave9d/camera/*
router.use(finishMySongRouter);        // /api/finish-my-song/*
router.use(rateMyMixRouter);           // /api/rate-my-mix/*
router.use(fanDecoderRouter);          // /api/fan-decoder/*
router.use(aiInterviewRouter);         // /api/ai-interview/*
router.use(lyricStoriesRouter);        // /api/lyric-stories/*
router.use(coverInMotionRouter);       // /api/cover-in-motion/*
router.use(retentionDropsRouter);      // /api/retention/daily-drop (+ /catalog, /archive, /unarchive), /api/retention/away-digest
router.use(arcadeRouter);              // /api/arcade/scores, /api/arcade/leaderboard, /api/arcade/me
router.use(partyRouter);               // /api/party/rooms, /api/party/leaderboard, /api/party/me
router.use(upgFansRouter);             // /api/collab-match, /api/fan-links, /api/audience-room (upg-fans deltas #175/N16/N17)

export default router;
