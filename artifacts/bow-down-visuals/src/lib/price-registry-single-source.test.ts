import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getCreditCost } from "./credit-costs";

/* Stack 400 census A-07 (remainder): every priced surface that used to
   declare its own local COST constant now reads the FE credit registry
   (src/lib/credit-costs.ts) via getCreditCost, keeping the old literal
   ONLY as the fallback for a missing registry row. This pin proves, for
   each converted surface:
     1. the declaration is a registry read with the named fallback; and
     2. the registry value equals that fallback — so the price a member
        sees and is quoted can never drift from the registry again (the
        x100-off-registry bug family dies here).
   Surfaces whose charge route is NOT in the registry at all, and the
   legacy per-unit / per-second client mirrors whose arithmetic already
   equals the registry, were left untouched on purpose and are named in
   the lane report. */

const CONVERTED: Array<[file: string, name: string, route: string, fallback: number]> = [
  ["components/GuestQuestions.tsx", "AUDIOGRAM_COST", "/api/audiogram", 250],
  ["components/GuestQuestions.tsx", "QUESTION_COST", "/api/guest-questions", 75],
  ["components/HumToSong.tsx", "HUM_PRICE", "/api/hum-to-song", 500],
  ["components/PressReleasePanel.tsx", "RELEASE_COST", "/api/press-release", 100],
  ["components/SceneStudio/CameraMovePlanner.tsx", "BUILD_CREDITS", "/api/wave9d/camera/prompt", 100],
  ["components/analytics-hub/ChannelAuditPanel.tsx", "CREDIT_COST", "/api/channel-audit", 300],
  ["components/analytics-hub/RetentionDoctor.tsx", "COST", "/api/retention-doctor", 150],
  ["components/analytics-hub/ViralityCheckPanel.tsx", "CREDIT_COST", "/api/trend-predictor/forecast", 200],
  ["components/analytics-hub/intelligence/StepCalendar.tsx", "COST", "/api/content-calendar", 150],
  ["components/analytics-hub/intelligence/StepCompetitor.tsx", "COST", "/api/competitor-analysis", 200],
  ["components/analytics-hub/intelligence/StepHookLab.tsx", "COST", "/api/analyze-hook", 75],
  ["components/analytics-hub/intelligence/StepNiche.tsx", "COST", "/api/analyze-niche", 150],
  ["components/analytics-hub/intelligence/StepValidateIdea.tsx", "COST", "/api/validate-idea", 75],
  ["components/audio-studio/AiAudio.tsx", "SFX_CREDIT_COST", "/api/generate-sfx", 100],
  ["components/audio-studio/FinishMySong.tsx", "COST", "/api/finish-my-song/complete", 400],
  ["components/audio-studio/RateMyMix.tsx", "COST", "/api/rate-my-mix/analyze", 100],
  ["components/audio-studio/ViralSoundFinder.tsx", "MATCH_CREDIT_COST", "/api/sound-finder/match", 100],
  ["components/audio/DeverbPanel.tsx", "DEVERB_CREDIT_COST_VB", "/api/deverb", 1000],
  ["components/audio/VocalTunePanel.tsx", "VOCAL_TUNE_CREDIT_COST", "/api/vocal-tune", 200],
  ["components/coach/NicheAnalyzerPanel.tsx", "IDEA_VALIDATOR_COST", "/api/validate-idea", 75],
  ["components/coach/RoyaltyTrackerPanel.tsx", "INSIGHTS_CREDIT_COST", "/api/royalties/insights", 100],
  ["components/create/CoverInMotionPanel.tsx", "COST", "/api/cover-in-motion/animate", 400],
  ["components/editor/MultiRatioExport.tsx", "COST_PER_RATIO", "/api/export-multi-ratio/job", 100],
  ["components/editor/MultiRatioExport.tsx", "EXTRACT_COST", "/api/extract-audio", 50],
  ["components/editor/sections/AutoChaptersCard.tsx", "AUTO_CHAPTERS_COST", "/api/auto-chapters", 150],
  ["components/editor/sections/BackgroundReplaceSection.tsx", "AI_GENERATE_COST_FALLBACK", "/api/bg-generate/status", 200],
  ["components/editor/sections/BackgroundReplaceSection.tsx", "CREDIT_COST", "/api/bg-generate", 200],
  ["components/editor/sections/BeatSyncSection.tsx", "CREDIT_COST", "/api/wave9b/beats/detect", 150],
  ["components/editor/sections/CanvasGeneratorSection.tsx", "CANVAS_COST", "/api/canvas/generate", 150],
  ["components/editor/sections/CinematicFxCard.tsx", "CINEMATIC_FX_PRICE", "/api/cinematic-fx", 150],
  ["components/editor/sections/ColorGradeSection.tsx", "GRADE_COST", "/api/color-grade", 150],
  ["components/editor/sections/FillerRemoverCard.tsx", "CREDIT_COST", "/api/remove-fillers/analyze", 200],
  ["components/editor/sections/LutImportSection.tsx", "APPLY_COST", "/api/apply-lut", 150],
  ["components/editor/sections/MemeMachineSection.tsx", "COST", "/api/meme-machine/captions", 100],
  ["components/editor/sections/SpeedRampSection.tsx", "SLOW_MO_COST", "/api/slow-motion", 300],
  ["components/editor/sections/SpeedRampSection.tsx", "SPEED_PRESET_COST", "/api/apply-speed", 150],
  ["components/editor/sections/StabilizeSection.tsx", "STABILIZE_COST", "/api/stabilize", 300],
  ["components/editor/sections/StyleStealerSection.tsx", "COST", "/api/style-stealer/analyze", 200],
  ["components/editor/sections/TimelineTemplatesSection.tsx", "CREDIT_COST", "/api/wave9b/templates/apply", 100],
  ["components/editor/sections/TranscriptCutCard.tsx", "CREDIT_COST", "/api/remove-fillers/analyze", 200],
  ["components/editor/sections/VoiceDirectedEditsSection.tsx", "DIRECT_EDIT_COST", "/api/wave9c/direct/edit", 150],
  ["components/go-live/ShowFinder.tsx", "PITCH_COST", "/api/show-finder/pitch", 100],
  ["components/go-live/ShowFinder.tsx", "SEARCH_COST", "/api/show-finder", 200],
  ["components/go-live/StreamCopilotSection.tsx", "CLIP_COST", "/api/stream-copilot/clip-plan", 100],
  ["components/go-live/StreamCopilotSection.tsx", "PREP_COST", "/api/stream-copilot/prep", 100],
  ["components/hooks/AIInterviewSection.tsx", "PKG_COST", "/api/ai-interview/package", 200],
  ["components/hooks/AIInterviewSection.tsx", "Q_COST", "/api/ai-interview/questions", 100],
  ["components/hooks/LyricStoriesSection.tsx", "COST_PER_CARD", "/api/lyric-stories/generate", 200],
  ["components/outreach/InvoiceGeneratorPanel.tsx", "INVOICE_COST", "/api/generate-invoice", 50],
  ["components/outreach/SponsorReadPanel.tsx", "READ_COST", "/api/sponsor-read", 100],
  ["components/photo/HeadshotStudio.tsx", "HEADSHOT_COST", "/api/generate-headshot", 100],
  ["components/photo/PhotoEnhance.tsx", "PHOTO_ENHANCE_COST", "/api/photo-enhance", 100],
  ["components/photo/ProductPhotoStudio.tsx", "PACKSHOT_CREDITS", "/api/generate-product-photo", 100],
  ["components/promote/LinkInBioBuilder.tsx", "PUBLISH_COST", "/api/bio-publish", 100],
  ["components/scheduler/TrendJackerSection.tsx", "DRAFT_CREDITS", "/api/trend-jacker/draft", 200],
  ["components/song/SingingVoiceModal.tsx", "CREDIT_COST", "/api/singing-voice", 800],
  ["components/song/VocalPolishModal.tsx", "CREDIT_COST", "/api/vocal-polish", 200],
  ["components/sync-pitch/SyncTab.tsx", "ONE_SHEET_COST", "/api/sync-pitch/one-sheet", 150],
  ["components/wave8/MediaKitBuilder.tsx", "KIT_COST", "/api/wave8/media-kit/generate", 100],
  ["components/wave8/SplitCalculator.tsx", "PDF_CREDITS", "/api/wave8/splits/pdf", 50],
  ["components/wave8/SponsorPipeline.tsx", "FOLLOWUP_CREDITS", "/api/sponsors/pipeline/followup", 50],
  ["pages/academy.tsx", "CREDIT_COST", "/api/academy/learning-path", 100],
  ["pages/analytics-hub.tsx", "COACH_COST", "/api/ai-coach", 100],
  ["pages/analytics-hub.tsx", "COMPETITOR_COST", "/api/competitor-analysis", 200],
  ["pages/analytics-hub.tsx", "INSIGHT_COST", "/api/analytics-hub/insights", 200],
  ["pages/beats.tsx", "AI_TAGS_CREDIT_COST", "/api/beats/:id/ai-tags", 100],
  ["pages/brand-calculator.tsx", "CREDIT_COST", "/api/brand-calculator/calculate", 200],
  ["pages/brand-deals.tsx", "MATCHER_COST", "/api/sponsors/match", 100],
  ["pages/brand-deals.tsx", "OUTREACH_COST", "/api/brand-deals/outreach", 100],
  ["pages/brand-deals.tsx", "PITCH_KIT_COST", "/api/outreach", 200],
  ["pages/brand-deals.tsx", "SEARCH_COST", "/api/brand-deals", 200],
  ["pages/caption-styler.tsx", "CREDIT_COST", "/api/caption-styler", 300],
  ["pages/cartoon-studio.tsx", "IMAGE_COST", "/api/generate-artist-image", 200],
  ["pages/coach.tsx", "CREDIT_COST", "/api/monetization-coach", 100],
  ["pages/collabs.tsx", "MATCH_CREDIT_COST", "/api/collabs/match", 100],
  ["pages/community.tsx", "REPLY_CREDIT_COST", "/api/comment-replies", 100],
  ["pages/contracts.tsx", "CREDIT_COST", "/api/contracts/analyze", 300],
  ["pages/copyright.tsx", "ASK_CREDIT_COST", "/api/copyright/ask", 100],
  ["pages/copyright.tsx", "DRAFT_CREDIT_COST", "/api/copyright/draft", 100],
  ["pages/distribute.tsx", "RELEASE_PLAN_CREDIT_COST", "/api/release-checklist", 200],
  ["pages/hooks.tsx", "AI_CREDIT_COST", "/api/randomizer", 100],
  ["pages/hooks.tsx", "CREDIT_COST", "/api/randomizer", 100],
  ["pages/hooks.tsx", "TITLE_CREDIT_COST", "/api/randomizer", 100],
  ["pages/interview-prep.tsx", "FEEDBACK_COST", "/api/interview-prep/feedback", 100],
  ["pages/interview-prep.tsx", "SESSION_COST", "/api/interview-prep/session", 200],
  ["pages/label-pitch.tsx", "CREDIT_COST", "/api/label-pitch/kit", 300],
  ["pages/label-pitch.tsx", "PLAYLIST_KIT_COST", "/api/playlist-pitch/kit", 200],
  ["pages/llc-guide.tsx", "CREDIT_COST", "/api/llc-guide/ask", 100],
  ["pages/media-detector.tsx", "CREDIT_COST", "/api/detect/media", 200],
  ["pages/movies.tsx", "CLIP_DETECT_CREDITS", "/api/movies/clip-detect", 300],
  ["pages/movies.tsx", "CONCEPT_CREDITS", "/api/movies/concept", 400],
  ["pages/promote.tsx", "CREDIT_COST", "/api/promo-generator", 100],
  ["pages/repurpose.tsx", "ANALYZE_COST", "/api/streamer-clips/analyze", 300],
  ["pages/repurpose.tsx", "CUT_COST_PER_CLIP", "/api/streamer-clips/cut", 200],
  ["pages/repurpose.tsx", "SMART_CLIP_COST_PER_CLIP", "/api/streamer-clips/cut", 200],
  ["pages/script-writer.tsx", "CREDIT_COST", "/api/script-writer", 200],
  ["pages/setlist.tsx", "CREDIT_COST", "/api/setlist/flow", 100],
  ["pages/songs/albums-section.tsx", "PUBLISH_COST", "/api/album-publish", 300],
  ["pages/sponsor-deal-detail.tsx", "AI_COST", "/api/sponsors/pitch", 100],
  ["pages/thumbnail-studio.tsx", "CREDIT_COST", "/api/thumbnail-generator", 200],
  ["pages/thumbnail-studio.tsx", "IMPROVE_COST", "/api/thumbnail-test/improve", 200],
  ["pages/tour.tsx", "CREDIT_COST", "/api/tour/optimize", 300],
  ["pages/trends.tsx", "FORECAST_CREDITS", "/api/trend-predictor/forecast", 200],
  ["pages/trends.tsx", "IDEAS_CREDITS", "/api/trend-predictor/ideas", 100],
  ["pages/upscale.tsx", "ENHANCE_CREDIT_COST", "/api/watermark-removal", 200],
  ["pages/upscale.tsx", "GENERATIVE_UPSCALE_CREDIT_COST", "/api/ai-upscale", 1500],
  ["pages/upscale.tsx", "IMAGE_CREDIT_COST", "/api/upscale/image", 300],
  ["pages/upscale.tsx", "VIDEO_CREDIT_COST", "/api/upscale", 300],
  ["pages/website-builder.tsx", "BUILD_COST", "/api/website-builder/generate", 3000],
  ["pages/website-builder.tsx", "EDIT_COST", "/api/website-builder/edit", 200]
];

function readSource(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

describe("price-registry single source (Stack 400 A-07)", () => {
  it("covers the full converted set", () => {
    expect(CONVERTED.length).toBe(110);
  });

  it.each(CONVERTED)("%s: %s reads the registry", (file, name, route, fallback) => {
    const src = readSource(file);
    expect(src).toContain(`const ${name} = getCreditCost("${route}")?.cost ?? ${fallback};`);
    expect(getCreditCost(route)?.cost).toBe(fallback);
  });
});
