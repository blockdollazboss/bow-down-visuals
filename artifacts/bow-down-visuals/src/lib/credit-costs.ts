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
  "/api/song-inspo/generate": { cost: 200, feature: "Inspo Mode Song" },
  "/api/song-inspo/analyze": { cost: 0, feature: "Inspo Vibe Analysis (free)" },
  "/api/generate-song-video": { cost: 400, feature: "Generate Song + Video" },
  "/api/generate-music-audio": { cost: 400, feature: "Generate Music Audio" },
  "/api/hum-to-song": { cost: 500, feature: "Hum to Song" },
  "/api/song-cover": { cost: 400, feature: "Song Cover" },
  "/api/song-remix": { cost: 400, feature: "Song Remix (new arrangement)" },
  "/api/song-replace-section": { cost: 300, feature: "Replace Song Section" },
  "/api/beat/generate": { cost: 300, feature: "Generate Beat" },
  "/api/producer-tag": { cost: 100, feature: "Producer Tag" },
  "/api/music/export": { cost: 400, feature: "Export Audio" },
  "/api/music/preview-render": { cost: 100, feature: "Preview Render" },
  "/api/voiceover/generate": { cost: 200, feature: "AI Voiceover" },
  "/api/album-publish": { cost: 300, feature: "Publish Album" },
  "/api/podcast/generate": { cost: 300, feature: "Generate Podcast" },
  "/api/guest-questions": { cost: 75, feature: "Podcast Guest Questions" },
  "/api/mastering": { cost: 400, feature: "AI Mastering" },
  "/api/mix-master/master": { cost: 800, feature: "AI Master (Mix & Master)" },
  "/api/mix-master/mix": { cost: 1500, feature: "AI Mix — Stems (Mix & Master)" },
  "/api/stems": { cost: 400, feature: "Stem Separation" },
  "/api/vocal-polish": { cost: 200, feature: "AI Vocal Polish" },
  "/api/vocal-removal": { cost: 300, feature: "Vocal Removal" },
  "/api/mashup": { cost: 400, feature: "Song Mashup" },
  "/api/generate-harmony": { cost: 300, feature: "Harmony Generator (Classic doubles)" },

  // ── Video ──────────────────────────────────────────────────────
  "/api/generate-video": { cost: 400, feature: "Generate Video Clip" },
  "/api/generate-runway-clip": { cost: 400, feature: "Generate Video Clip" },
  "/api/generate-promo-clips": { cost: 100, feature: "Generate Promo Clips" },
  "/api/canvas/generate": { cost: 150, feature: "Spotify Canvas Generator" },
  "/api/streamer-clips/analyze": { cost: 300, feature: "Analyze Stream for Clips" },
  "/api/streamer-clips/cut": { cost: 200, feature: "Cut Stream Clip" },
  "/api/generate-video-plan": { cost: 200, feature: "AI Video Plan" },
  "/api/generate/ai-edit-plan": { cost: 100, feature: "AI Edit Plan" },
  "/api/auto-video-plan": { cost: 200, feature: "Auto Video Plan" },
  "/api/lip-sync": { cost: 300, feature: "Lip Sync" },
  "/api/export-final-video": { cost: 400, feature: "Export Final Video" },
  "/api/export-quality/estimate": { cost: 0, feature: "Export Size Estimate (free)" },
  "/api/export-quality": { cost: 150, feature: "Quality-Controlled Export" },
  "/api/export-doctor/export": { cost: 400, feature: "Export Clip" },
  "/api/carousel/export": { cost: 100, feature: "Carousel Export" },
  "/api/export-doctor/export-audio": { cost: 200, feature: "Export Audio" },
  "/api/export-doctor/export-all": { cost: 400, feature: "Export All Clips" },
  "/api/export-doctor/export-all-audio": { cost: 200, feature: "Export All Audio" },
  "/api/export-doctor/export-all-captions": { cost: 200, feature: "Export Captions" },
  "/api/export-doctor/export-all-effects": { cost: 200, feature: "Export Effects" },
  "/api/export-doctor/export-all-overlays": { cost: 200, feature: "Export Overlays" },
  "/api/export-doctor/export-overlays-range": { cost: 200, feature: "Export Overlays Range" },
  "/api/export-doctor/export-effects-range": { cost: 200, feature: "Export Effects Range" },
  "/api/export-doctor/export-effects-transitions": { cost: 200, feature: "Export Transitions" },
  "/api/video-template/apply": { cost: 250, feature: "Apply Video Template" },
  "/api/split-screen/apply": { cost: 200, feature: "Split-Screen Grid" },
  "/api/export-doctor/export-audio-sync-short": { cost: 200, feature: "Export Audio Sync" },
  "/api/export-multi-ratio": { cost: 100, feature: "Multi-Ratio Export (per ratio)" },
  "/api/extract-audio": { cost: 50, feature: "Extract Audio" },
  "/api/export-doctor/repair-normalize": { cost: 100, feature: "Repair: Normalize Clip" },
  "/api/export-doctor/repair-clip": { cost: 100, feature: "Repair Clip" },
  "/api/pro-tools/auto-grade": { cost: 200, feature: "AI Auto Grade" },
  "/api/apply-lut": { cost: 150, feature: "LUT Apply" },
  "/api/slow-motion": { cost: 300, feature: "AI Slow Motion" },
  "/api/cinematic-fx": { cost: 150, feature: "Cinematic FX Render" },
  "/api/freeze-frame": { cost: 150, feature: "Freeze Frame" },
  "/api/apply-mask": { cost: 200, feature: "Mask Effect" },
  "/api/motion-track/track": { cost: 350, feature: "Motion Tracking" },
  "/api/motion-track/apply": { cost: 350, feature: "Motion Track Burn-in" },
  "/api/upscale": { cost: 300, feature: "Upscale" },
  "/api/upscale/image": { cost: 300, feature: "Upscale Image" },
  "/api/watermark-removal": { cost: 200, feature: "Remove Watermark" },
  "/api/video-translator/translate": { cost: 500, feature: "Video Translator" },
  "/api/analyze-sections": { cost: 100, feature: "Analyze Song Sections" },
  "/api/transcribe": { cost: 100, feature: "Transcribe Audio" },
  "/api/transcribe-url": { cost: 100, feature: "Transcribe" },
  "/api/remove-fillers/analyze": { cost: 200, feature: "AI Filler-Word Remover" },
  "/api/auto-chapters": { cost: 150, feature: "Auto Chapters" },
  "/api/mix-plan": { cost: 200, feature: "AI Mix Plan" },

  // ── Images & design ────────────────────────────────────────────
  "/api/generate-artist-image": { cost: 200, feature: "Generate Artist Image (Pro)" },
  "/api/generate-thumbnail": { cost: 100, feature: "Generate Thumbnail" },
  "/api/thumbnail-generator": { cost: 200, feature: "Generate Thumbnail" },
  "/api/thumbnail-test": { cost: 200, feature: "Thumbnail A/B Test" },
  "/api/thumbnail-test/improve": { cost: 200, feature: "Thumbnail A/B Apply Suggestions" },
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
  "/api/audio-cleanup": { cost: 300, feature: "Audio Cleanup" },

  // ── AI text / copilots (1 credit) ──────────────────────────────
  "/api/chat": { cost: 100, feature: "AI Chat Message" },
  "/api/hook-studio": { cost: 100, feature: "Hook Studio" },
  "/api/virality-check": { cost: 200, feature: "Virality Pre-Flight Check" },
  "/api/analytics-hub/insights": { cost: 200, feature: "AI Growth Plan" },
  "/api/analytics/insights": { cost: 100, feature: "Analytics AI Insights" },
  "/api/analytics/suggestions": { cost: 100, feature: "Analytics Content Suggestions" },
  "/api/monetization-coach": { cost: 100, feature: "Monetization Coach" },
  "/api/ai-coach": { cost: 100, feature: "AI Performance Coach" },
  "/api/analyze-niche": { cost: 150, feature: "Niche Analyzer" },
  "/api/validate-idea": { cost: 75, feature: "Idea Validator" },
  "/api/analyze-hook": { cost: 75, feature: "Hook Analyzer" },
  "/api/retention-doctor": { cost: 150, feature: "AI Retention Doctor" },
  "/api/competitor-analysis": { cost: 200, feature: "Competitor Tracker" },
  "/api/script-writer": { cost: 200, feature: "Script Writer" },
  "/api/title-studio": { cost: 100, feature: "Title Studio" },
  "/api/seo-score": { cost: 75, feature: "Video SEO Score" },
  "/api/caption-styler": { cost: 300, feature: "Caption Styler" },
  "/api/auto-captions": { cost: 300, feature: "AI Auto-Captions" },
  "/api/translate-captions": { cost: 50, feature: "Translate Captions (per language)" },
  "/api/generate-cta": { cost: 50, feature: "Generate CTA" },
  "/api/karaoke-video": { cost: 300, feature: "Karaoke Video" },
  "/api/lyric-video/align": { cost: 200, feature: "AI Lyric Alignment (synced lyrics)" },
  "/api/audiogram": { cost: 250, feature: "Audiogram Visualizer" },
  "/api/loop-video": { cost: 150, feature: "Loop Video" },
  "/api/meme": { cost: 100, feature: "Meme Generator" },
  "/api/social-kit": { cost: 400, feature: "Social Media Kit" },
  "/api/promo-cards": { cost: 100, feature: "Release Promo Cards" },
  "/api/clip-description": { cost: 50, feature: "Clip Description" },
  "/api/thumbnail-ab": { cost: 300, feature: "Thumbnail A/B Test" },
  "/api/style-subtitles": { cost: 200, feature: "Subtitle Burn-In" },
  "/api/comment-replies": { cost: 100, feature: "Comment Replies" },
  "/api/trend-predictor": { cost: 100, feature: "Trend Predictor" },
  "/api/trend-predictor/forecast": { cost: 200, feature: "Trend Forecast" },
  "/api/channel-audit": { cost: 300, feature: "Channel Audit" },
  "/api/sponsors/pitch": { cost: 100, feature: "Sponsor Pitch" },
  "/api/sponsors/match": { cost: 100, feature: "Sponsor Match" },
  "/api/sponsors/deals": { cost: 500, feature: "Sponsor Deals" },
  "/api/outreach": { cost: 200, feature: "Outreach" },
  "/api/sync-pitch/one-sheet": { cost: 150, feature: "Sync One-Sheet" },
  "/api/sponsor-read": { cost: 100, feature: "Sponsor Read" },
  "/api/generate-invoice": { cost: 50, feature: "Generate Invoice" },
  "/api/catalog-vault/vault": { cost: 200, feature: "Catalog Vault — permanent release hosting" },
  "/api/shoutouts/ai-message": { cost: 100, feature: "AI Shoutout Message" },
  "/api/press-kit/generate": { cost: 300, feature: "Press Kit Generator" },
  "/api/press-release": { cost: 100, feature: "Press Release Generator" },
  "/api/gamers/ideas": { cost: 100, feature: "Gamer Content Ideas" },
  "/api/show-finder/pitch": { cost: 100, feature: "Show Pitch Draft" },
  "/api/show-finder": { cost: 200, feature: "Show Finder" },
  "/api/brand-deals/outreach": { cost: 100, feature: "Brand Outreach Draft" },
  "/api/brand-deals": { cost: 200, feature: "Brand Deal Finder" },
  "/api/live-shopping/ai-description": { cost: 100, feature: "AI Product Description" },
  "/api/randomizer": { cost: 100, feature: "Content Randomizer" },
  "/api/sound-finder/match": { cost: 100, feature: "Sound Finder" },
  "/api/content-calendar": { cost: 150, feature: "Content Calendar AI" },
  "/api/release-checklist": { cost: 200, feature: "Release Checklist AI" },

  // ── Storefronts ────────────────────────────────────────────────
  "/api/shops/ai/shop-description": { cost: 100, feature: "AI Shop Description" },
  "/api/shops/ai/product-description": { cost: 100, feature: "AI Product Description" },
  "/api/shops/ai/product-image": { cost: 100, feature: "AI Product Image" },

  // ── Creator profiles: AI Page Designer ─────────────────────────
  "/api/ai-page-designer/theme": { cost: 400, feature: "AI Page Designer — Full Page Design" },
  "/api/ai-page-designer/bio": { cost: 100, feature: "AI Page Designer — Bio Writer" },
  "/api/ai-page-designer/banner": { cost: 200, feature: "AI Page Designer — Banner Art" },
  "/api/ai-page-designer/upload": { cost: 0, feature: "Profile Image Upload (free)" },

  // ── Social publishing ──────────────────────────────────────────
  "/api/social/instagram/publish": { cost: 100, feature: "Publish to Instagram" },
  "/api/social/facebook/publish": { cost: 100, feature: "Publish to Facebook" },
  "/api/social/tiktok/publish": { cost: 100, feature: "Publish to TikTok" },
  "/api/generate-community-post": { cost: 50, feature: "Generate Community Post" },
  "/api/best-time": { cost: 75, feature: "Best Time to Post" },

  // ── Link-in-Bio ────────────────────────────────────────────────
  "/api/bio-publish": { cost: 100, feature: "Publish Link-in-Bio Page" },

  // ── Stock media (editor Media rail) ────────────────────────────
  "/api/stock/search": { cost: 0, feature: "Stock Media Search (free)" },
  "/api/stock/import": { cost: 50, feature: "Stock Media Import" },

  // ── Wave 8 ─────────────────────────────────────────────────────
  "/api/wave8/thumbnail-ab/variants": { cost: 75, feature: "Thumbnail A/B Variants" },
  "/api/wave8/caption-styler/burn": { cost: 100, feature: "Styled Caption Burn-in" },
  "/api/wave8/calendar/autofill": { cost: 150, feature: "Content Calendar Auto-Fill" },
  "/api/wave8/hook-rewriter/rewrite": { cost: 50, feature: "Hook Rewriter" },
  "/api/wave8/adlib/generate": { cost: 150, feature: "AI Ad-Lib Generator" },
  "/api/wave8/highlights/cut": { cost: 300, feature: "Stream Highlight Auto-Editor" },
  "/api/wave8/merch-drop/plan": { cost: 100, feature: "Merch Drop Planner" },
  "/api/wave8/media-kit/generate": { cost: 100, feature: "AI Media Kit Builder" },
  "/api/wave8/splits/pdf": { cost: 50, feature: "Royalty Split Sheet PDF" },
  "/api/wave8/sponsors/followup": { cost: 50, feature: "Sponsor Follow-up Draft" },
  // Wave 9 — Suno + CapCut + directing layer (export-everywhere skipped: multi-ratio export already exists)
  "/api/wave9a/structure/generate": { cost: 200, feature: "Song Structure Builder" },
  "/api/wave9a/lyrics/timing": { cost: 50, feature: "Lyrics-to-Timeline" },
  "/api/wave9b/beats/detect": { cost: 150, feature: "Beat-Sync Cuts" },
  "/api/wave9b/templates/apply": { cost: 100, feature: "Timeline Edit Recipes" },
  "/api/wave9b/bg/charge": { cost: 200, feature: "Background Replace" },
  "/api/wave9c/direct/edit": { cost: 150, feature: "Voice-Directed Edits" },
  "/api/wave9d/director/plan": { cost: 150, feature: "Character Director" },
  "/api/wave9d/camera/prompt": { cost: 100, feature: "Camera Move Planner" },
};

/**
 * Get the credit cost for an API endpoint.
 * Returns null if the endpoint doesn't cost credits (or isn't registered).
 *
 * Matching: exact endpoint, or the LONGEST registered prefix (endpoint + "/"
 * or endpoint + "?"). Longest-prefix wins so a specific sub-route entry
 * (e.g. /api/trend-predictor/forecast) is never shadowed by its parent
 * (e.g. /api/trend-predictor) regardless of insertion order.
 */
export function getCreditCost(endpoint: string): { cost: number; feature: string } | null {
  let best: { cost: number; feature: string } | null = null;
  let bestLen = -1;
  for (const [key, value] of Object.entries(CREDIT_COSTS)) {
    if (endpoint === key || endpoint.startsWith(key + "/") || endpoint.startsWith(key + "?")) {
      if (key.length > bestLen) {
        best = value;
        bestLen = key.length;
      }
    }
  }
  return best;
}
