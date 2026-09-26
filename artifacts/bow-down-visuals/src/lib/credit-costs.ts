/**
 * Central registry of credit costs for API endpoints.
 * Used by the credit confirmation system to show the cost before spending.
 *
 * Costs are in credits. For dynamic costs (e.g. per-second, per-minute),
 * the caller should compute the cost and pass overrideCost/overrideFeature
 * to confirmedFetch. The `cost` here is a fallback/default.
 *
 * Matching: exact endpoint, or prefix (endpoint + "/" or endpoint + "?").
 * Callers must only route actual SPENDING calls through confirmedFetch —
 * status/health/list/download endpoints stay on plain fetch.
 */
export const CREDIT_COSTS: Record<string, { cost: number; feature: string }> = {
  // ── Songs & audio ──────────────────────────────────────────────
  "/api/generate-song": { cost: 4, feature: "Generate Song" },
  "/api/generate-song-video": { cost: 4, feature: "Generate Song + Video" },
  "/api/generate-music-audio": { cost: 4, feature: "Generate Music Audio" },
  "/api/music/export": { cost: 4, feature: "Export Audio" },
  "/api/music/preview-render": { cost: 1, feature: "Preview Render" },
  "/api/voiceover/generate": { cost: 2, feature: "AI Voiceover" },
  "/api/podcast/generate": { cost: 3, feature: "Generate Podcast" },
  "/api/mastering": { cost: 2, feature: "AI Mastering" },
  "/api/stems": { cost: 2, feature: "Stem Separation" },
  "/api/vocal-removal": { cost: 2, feature: "Vocal Removal" },

  // ── Video ──────────────────────────────────────────────────────
  "/api/generate-video": { cost: 4, feature: "Generate Video Clip" },
  "/api/generate-runway-clip": { cost: 4, feature: "Generate Video Clip" },
  "/api/generate-promo-clips": { cost: 4, feature: "Generate Promo Clips" },
  "/api/streamer-clips/analyze": { cost: 3, feature: "Analyze Stream for Clips" },
  "/api/streamer-clips/cut": { cost: 2, feature: "Cut Stream Clip" },
  "/api/generate-video-plan": { cost: 1, feature: "AI Video Plan" },
  "/api/generate/ai-edit-plan": { cost: 1, feature: "AI Edit Plan" },
  "/api/auto-video-plan": { cost: 1, feature: "Auto Video Plan" },
  "/api/lip-sync": { cost: 3, feature: "Lip Sync" },
  "/api/export-final-video": { cost: 4, feature: "Export Final Video" },
  "/api/export-doctor/export": { cost: 4, feature: "Export Clip" },
  "/api/export-doctor/export-audio": { cost: 2, feature: "Export Audio" },
  "/api/export-doctor/export-all": { cost: 4, feature: "Export All Clips" },
  "/api/export-doctor/export-all-audio": { cost: 2, feature: "Export All Audio" },
  "/api/export-doctor/export-all-captions": { cost: 2, feature: "Export Captions" },
  "/api/export-doctor/export-all-effects": { cost: 2, feature: "Export Effects" },
  "/api/export-doctor/export-all-overlays": { cost: 2, feature: "Export Overlays" },
  "/api/export-doctor/export-overlays-range": { cost: 2, feature: "Export Overlays Range" },
  "/api/export-doctor/export-effects-range": { cost: 2, feature: "Export Effects Range" },
  "/api/export-doctor/export-effects-transitions": { cost: 2, feature: "Export Transitions" },
  "/api/export-doctor/export-audio-sync-short": { cost: 2, feature: "Export Audio Sync" },
  "/api/export-doctor/repair-normalize": { cost: 1, feature: "Repair: Normalize Clip" },
  "/api/export-doctor/repair-clip": { cost: 1, feature: "Repair Clip" },
  "/api/pro-tools/auto-grade": { cost: 2, feature: "AI Auto Grade" },
  "/api/upscale": { cost: 2, feature: "Upscale" },
  "/api/upscale/image": { cost: 3, feature: "Upscale Image" },
  "/api/watermark-removal": { cost: 2, feature: "Remove Watermark" },
  "/api/video-translator/translate": { cost: 5, feature: "Video Translator" },
  "/api/analyze-sections": { cost: 1, feature: "Analyze Song Sections" },
  "/api/transcribe": { cost: 1, feature: "Transcribe Audio" },
  "/api/transcribe-url": { cost: 1, feature: "Transcribe" },
  "/api/mix-plan": { cost: 1, feature: "AI Mix Plan" },

  // ── Images & design ────────────────────────────────────────────
  "/api/generate-artist-image": { cost: 2, feature: "Generate Artist Image (Pro)" },
  "/api/generate-thumbnail": { cost: 1, feature: "Generate Thumbnail" },
  "/api/thumbnail-generator": { cost: 1, feature: "Generate Thumbnail" },
  "/api/thumbnail-test": { cost: 1, feature: "Thumbnail A/B Test" },
  "/api/generate-logo": { cost: 1, feature: "Logo Generator" },
  "/api/generate-intro-outro": { cost: 2, feature: "Intro/Outro Generator" },
  "/api/cover-art": { cost: 2, feature: "Cover Art" },
  "/api/merch/design": { cost: 2, feature: "Merch Design" },
  "/api/stream-pack/generate": { cost: 2, feature: "Stream Pack Generator" },
  "/api/sample-pack/generate": { cost: 1, feature: "Sample Pack Generator" },
  "/api/jewelry/design": { cost: 2, feature: "Jewelry Design" },
  "/api/jewelry/export-stl": { cost: 2, feature: "Export Jewelry STL" },
  "/api/jewelry/consult": { cost: 1, feature: "Jewelry Consult" },
  "/api/jewelry/estimate": { cost: 1, feature: "Jewelry Estimate" },

  // ── Audio AI ───────────────────────────────────────────────────
  "/api/generate-sfx": { cost: 1, feature: "Generate SFX" },

  // ── AI text / copilots (1 credit) ──────────────────────────────
  "/api/chat": { cost: 1, feature: "AI Chat Message" },
  "/api/hook-studio": { cost: 1, feature: "Hook Studio" },
  "/api/analytics-hub/insights": { cost: 2, feature: "AI Growth Plan" },
  "/api/monetization-coach": { cost: 1, feature: "Monetization Coach" },
  "/api/script-writer": { cost: 2, feature: "Script Writer" },
  "/api/title-studio": { cost: 1, feature: "Title Studio" },
  "/api/caption-styler": { cost: 3, feature: "Caption Styler" },
  "/api/comment-replies": { cost: 1, feature: "Comment Replies" },
  "/api/trend-predictor": { cost: 1, feature: "Trend Predictor" },
  "/api/trend-predictor/forecast": { cost: 2, feature: "Trend Forecast" },
  "/api/channel-audit": { cost: 3, feature: "Channel Audit" },
  "/api/sponsors/pitch": { cost: 1, feature: "Sponsor Pitch" },
  "/api/sponsors/match": { cost: 1, feature: "Sponsor Match" },
  "/api/sponsors/deals": { cost: 5, feature: "Sponsor Deals" },
  "/api/outreach": { cost: 2, feature: "Outreach" },
  "/api/shoutouts/ai-message": { cost: 1, feature: "AI Shoutout Message" },
  "/api/press-kit/generate": { cost: 3, feature: "Press Kit Generator" },
  "/api/gamers/ideas": { cost: 1, feature: "Gamer Content Ideas" },
  "/api/live-shopping/ai-description": { cost: 1, feature: "AI Product Description" },
  "/api/randomizer": { cost: 1, feature: "Content Randomizer" },
  "/api/sound-finder/match": { cost: 1, feature: "Sound Finder" },
  "/api/content-calendar": { cost: 1, feature: "Content Calendar AI" },
  "/api/release-checklist": { cost: 2, feature: "Release Checklist AI" },

  // ── Social publishing ──────────────────────────────────────────
  "/api/social/instagram/publish": { cost: 1, feature: "Publish to Instagram" },
  "/api/social/facebook/publish": { cost: 1, feature: "Publish to Facebook" },
  "/api/social/tiktok/publish": { cost: 1, feature: "Publish to TikTok" },
};

/**
 * Get the credit cost for an API endpoint.
 * Returns null if the endpoint doesn't cost credits (or isn't registered).
 */
export function getCreditCost(endpoint: string): { cost: number; feature: string } | null {
  // Match exact endpoint or prefix
  for (const [key, value] of Object.entries(CREDIT_COSTS)) {
    if (endpoint === key || endpoint.startsWith(key + "/") || endpoint.startsWith(key + "?")) {
      return value;
    }
  }
  return null;
}
