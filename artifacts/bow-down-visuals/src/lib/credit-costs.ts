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
  "/api/generate-song": { cost: 400, feature: "Generate Song" },
  "/api/generate-song-video": { cost: 400, feature: "Generate Song + Video" },
  "/api/generate-music-audio": { cost: 400, feature: "Generate Music Audio" },
  "/api/beat/generate": { cost: 300, feature: "Generate Beat" },
  "/api/music/export": { cost: 400, feature: "Export Audio" },
  "/api/music/preview-render": { cost: 100, feature: "Preview Render" },
  "/api/voiceover/generate": { cost: 200, feature: "AI Voiceover" },
  "/api/podcast/generate": { cost: 300, feature: "Generate Podcast" },
  "/api/mastering": { cost: 200, feature: "AI Mastering" },
  "/api/mix-master/master": { cost: 800, feature: "AI Master (Mix & Master)" },
  "/api/mix-master/mix": { cost: 1500, feature: "AI Mix — Stems (Mix & Master)" },
  "/api/stems": { cost: 200, feature: "Stem Separation" },
  "/api/vocal-removal": { cost: 200, feature: "Vocal Removal" },

  // ── Video ──────────────────────────────────────────────────────
  "/api/generate-video": { cost: 400, feature: "Generate Video Clip" },
  "/api/generate-runway-clip": { cost: 400, feature: "Generate Video Clip" },
  "/api/generate-promo-clips": { cost: 400, feature: "Generate Promo Clips" },
  "/api/streamer-clips/analyze": { cost: 300, feature: "Analyze Stream for Clips" },
  "/api/streamer-clips/cut": { cost: 200, feature: "Cut Stream Clip" },
  "/api/generate-video-plan": { cost: 100, feature: "AI Video Plan" },
  "/api/generate/ai-edit-plan": { cost: 100, feature: "AI Edit Plan" },
  "/api/auto-video-plan": { cost: 100, feature: "Auto Video Plan" },
  "/api/lip-sync": { cost: 300, feature: "Lip Sync" },
  "/api/export-final-video": { cost: 400, feature: "Export Final Video" },
  "/api/export-doctor/export": { cost: 400, feature: "Export Clip" },
  "/api/export-doctor/export-audio": { cost: 200, feature: "Export Audio" },
  "/api/export-doctor/export-all": { cost: 400, feature: "Export All Clips" },
  "/api/export-doctor/export-all-audio": { cost: 200, feature: "Export All Audio" },
  "/api/export-doctor/export-all-captions": { cost: 200, feature: "Export Captions" },
  "/api/export-doctor/export-all-effects": { cost: 200, feature: "Export Effects" },
  "/api/export-doctor/export-all-overlays": { cost: 200, feature: "Export Overlays" },
  "/api/export-doctor/export-overlays-range": { cost: 200, feature: "Export Overlays Range" },
  "/api/export-doctor/export-effects-range": { cost: 200, feature: "Export Effects Range" },
  "/api/export-doctor/export-effects-transitions": { cost: 200, feature: "Export Transitions" },
  "/api/export-doctor/export-audio-sync-short": { cost: 200, feature: "Export Audio Sync" },
  "/api/export-doctor/repair-normalize": { cost: 100, feature: "Repair: Normalize Clip" },
  "/api/export-doctor/repair-clip": { cost: 100, feature: "Repair Clip" },
  "/api/pro-tools/auto-grade": { cost: 200, feature: "AI Auto Grade" },
  "/api/upscale": { cost: 300, feature: "Upscale" },
  "/api/upscale/image": { cost: 300, feature: "Upscale Image" },
  "/api/watermark-removal": { cost: 200, feature: "Remove Watermark" },
  "/api/video-translator/translate": { cost: 500, feature: "Video Translator" },
  "/api/analyze-sections": { cost: 100, feature: "Analyze Song Sections" },
  "/api/transcribe": { cost: 100, feature: "Transcribe Audio" },
  "/api/transcribe-url": { cost: 100, feature: "Transcribe" },
  "/api/mix-plan": { cost: 100, feature: "AI Mix Plan" },

  // ── Images & design ────────────────────────────────────────────
  "/api/generate-artist-image": { cost: 200, feature: "Generate Artist Image (Pro)" },
  "/api/generate-thumbnail": { cost: 100, feature: "Generate Thumbnail" },
  "/api/thumbnail-generator": { cost: 200, feature: "Generate Thumbnail" },
  "/api/thumbnail-test": { cost: 100, feature: "Thumbnail A/B Test" },
  "/api/generate-logo": { cost: 100, feature: "Logo Generator" },
  "/api/generate-intro-outro": { cost: 200, feature: "Intro/Outro Generator" },
  "/api/cover-art": { cost: 200, feature: "Cover Art" },
  "/api/merch/design": { cost: 300, feature: "Merch Design" },
  "/api/stream-pack/generate": { cost: 200, feature: "Stream Pack Generator" },
  "/api/sample-pack/generate": { cost: 100, feature: "Sample Pack Generator" },
  "/api/jewelry/design": { cost: 200, feature: "Jewelry Design" },
  "/api/jewelry/export-stl": { cost: 200, feature: "Export Jewelry STL" },
  "/api/jewelry/consult": { cost: 100, feature: "Jewelry Consult" },
  "/api/jewelry/estimate": { cost: 100, feature: "Jewelry Estimate" },

  // ── Audio AI ───────────────────────────────────────────────────
  "/api/generate-sfx": { cost: 100, feature: "Generate SFX" },

  // ── AI text / copilots (1 credit) ──────────────────────────────
  "/api/chat": { cost: 100, feature: "AI Chat Message" },
  "/api/hook-studio": { cost: 100, feature: "Hook Studio" },
  "/api/virality-check": { cost: 200, feature: "Virality Pre-Flight Check" },
  "/api/analytics-hub/insights": { cost: 200, feature: "AI Growth Plan" },
  "/api/monetization-coach": { cost: 100, feature: "Monetization Coach" },
  "/api/script-writer": { cost: 200, feature: "Script Writer" },
  "/api/title-studio": { cost: 100, feature: "Title Studio" },
  "/api/caption-styler": { cost: 300, feature: "Caption Styler" },
  "/api/comment-replies": { cost: 100, feature: "Comment Replies" },
  "/api/trend-predictor": { cost: 100, feature: "Trend Predictor" },
  "/api/trend-predictor/forecast": { cost: 200, feature: "Trend Forecast" },
  "/api/channel-audit": { cost: 300, feature: "Channel Audit" },
  "/api/sponsors/pitch": { cost: 100, feature: "Sponsor Pitch" },
  "/api/sponsors/match": { cost: 100, feature: "Sponsor Match" },
  "/api/sponsors/deals": { cost: 500, feature: "Sponsor Deals" },
  "/api/outreach": { cost: 200, feature: "Outreach" },
  "/api/shoutouts/ai-message": { cost: 100, feature: "AI Shoutout Message" },
  "/api/press-kit/generate": { cost: 300, feature: "Press Kit Generator" },
  "/api/gamers/ideas": { cost: 100, feature: "Gamer Content Ideas" },
  "/api/show-finder/pitch": { cost: 100, feature: "Show Pitch Draft" },
  "/api/show-finder": { cost: 200, feature: "Show Finder" },
  "/api/brand-deals/outreach": { cost: 100, feature: "Brand Outreach Draft" },
  "/api/brand-deals": { cost: 200, feature: "Brand Deal Finder" },
  "/api/live-shopping/ai-description": { cost: 100, feature: "AI Product Description" },
  "/api/randomizer": { cost: 100, feature: "Content Randomizer" },
  "/api/sound-finder/match": { cost: 100, feature: "Sound Finder" },
  "/api/content-calendar": { cost: 100, feature: "Content Calendar AI" },
  "/api/release-checklist": { cost: 200, feature: "Release Checklist AI" },

  // ── Storefronts ────────────────────────────────────────────────
  "/api/shops/ai/shop-description": { cost: 100, feature: "AI Shop Description" },
  "/api/shops/ai/product-description": { cost: 100, feature: "AI Product Description" },
  "/api/shops/ai/product-image": { cost: 100, feature: "AI Product Image" },

  // ── Social publishing ──────────────────────────────────────────
  "/api/social/instagram/publish": { cost: 100, feature: "Publish to Instagram" },
  "/api/social/facebook/publish": { cost: 100, feature: "Publish to Facebook" },
  "/api/social/tiktok/publish": { cost: 100, feature: "Publish to TikTok" },
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
