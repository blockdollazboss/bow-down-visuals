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
  // Music export renders are FREE — the handlers in
  // routes/music-export.ts charge nothing for either endpoint
  // (verified handler-by-handler, Stack-25 price-registry audit).
  // The registry records 0 so the confirmation system and the
  // operator quote "free" from a source instead of a stale price.
  "/api/music/export": { cost: 0, feature: "Export Audio (free)" },
  "/api/music/preview-render": { cost: 0, feature: "Preview Render (free)" },
  "/api/voiceover/generate": { cost: 200, feature: "Voiceover" },
  "/api/clone-voice": { cost: 500, feature: "Voice Clone" },
  // Parameterized route — the :id segment is the vault id. getCreditCost
  // matches literally, so this entry records the server charge in the
  // registry; the vault page also states the price in its own copy.
  "/api/artist-vaults/:id/voice/clone": { cost: 200, feature: "Voice Clone (from recording)" },
  "/api/album-publish": { cost: 300, feature: "Publish Album" },
  "/api/podcast/generate": { cost: 300, feature: "Generate Podcast" },
  "/api/guest-questions": { cost: 75, feature: "Podcast Guest Questions" },
  "/api/mastering": { cost: 400, feature: "Mastering" },
  "/api/mix-master/master": { cost: 800, feature: "Master (Mix & Master)" },
  "/api/mix-master/mix": { cost: 1500, feature: "Mix — Stems (Mix & Master)" },
  "/api/stems": { cost: 400, feature: "Stem Separation" },
  "/api/stems?mode=instrumental": { cost: 300, feature: "Stem Separation — Instrumental" },
  "/api/vocal-polish": { cost: 200, feature: "Vocal Polish" },
  "/api/vocal-tune": { cost: 200, feature: "Vocal Tuning" }, // PLACEHOLDER — NOT USER-APPROVED
  "/api/lufs/normalize": { cost: 100, feature: "LUFS Loudness Normalize" }, // PLACEHOLDER — NOT USER-APPROVED
  "/api/deverb": { cost: 1000, feature: "De-Reverb" }, // PLACEHOLDER — NOT USER-APPROVED
  "/api/vocal-removal": { cost: 300, feature: "Vocal Removal" },
  "/api/mashup": { cost: 400, feature: "Song Mashup" },
  "/api/generate-harmony": { cost: 300, feature: "Harmony Generator (Classic doubles)" },

  // ── Video ──────────────────────────────────────────────────────

  "/api/generate-runway-clip": { cost: 400, feature: "Generate Video Clip" },
  "/api/generate-promo-clips": { cost: 100, feature: "Generate Promo Clips" },
  "/api/canvas/generate": { cost: 150, feature: "Spotify Canvas Generator" },
  "/api/streamer-clips/analyze": { cost: 300, feature: "Analyze Stream for Clips" },
  "/api/streamer-clips/cut": { cost: 200, feature: "Cut Stream Clip" },
  "/api/generate-video-plan": { cost: 200, feature: "Video Plan" },
  "/api/generate/ai-edit-plan": { cost: 100, feature: "Edit Plan" },
  "/api/auto-video-plan": { cost: 200, feature: "Auto Video Plan" },
  "/api/lip-sync": { cost: 300, feature: "Lip Sync" },
  "/api/lip-sync/run-all": { cost: 300, feature: "Lip Sync — Run All (per scene)" },
  "/api/export-final-video": { cost: 400, feature: "Export Final Video" },
  "/api/export-quality/estimate": { cost: 0, feature: "Export Size Estimate (free)" },
  "/api/export-quality": { cost: 400, feature: "Quality-Controlled Export" },
  // Export Doctor rails are FREE — routes/generate/export-doctor.ts
  // contains zero credit logic (no chargeCredits/deductCredits at
  // all; verified Stack-28 A2-05). The registry records 0 for all
  // 13 export-doctor endpoints so the spend confirmation and the
  // operator quote "free" instead of the old phantom 100–400 VB.
  "/api/export-doctor/export": { cost: 0, feature: "Export Clip (free)" },
  "/api/carousel/export": { cost: 100, feature: "Carousel Export" },
  "/api/books/ai/assist": { cost: 100, feature: "Thy Books AI Writing Assist" },
  "/api/books/cover/generate": { cost: 200, feature: "Thy Books AI Cover Generation" },
  "/api/export-doctor/export-audio": { cost: 0, feature: "Export Audio (free)" },
  "/api/export-doctor/export-all": { cost: 0, feature: "Export All Clips (free)" },
  "/api/export-doctor/export-all-audio": { cost: 0, feature: "Export All Audio (free)" },
  "/api/export-doctor/export-all-captions": { cost: 0, feature: "Export Captions (free)" },
  "/api/export-doctor/export-all-effects": { cost: 0, feature: "Export Effects (free)" },
  "/api/export-doctor/export-all-overlays": { cost: 0, feature: "Export Overlays (free)" },
  "/api/export-doctor/export-overlays-range": { cost: 0, feature: "Export Overlays Range (free)" },
  "/api/export-doctor/export-effects-range": { cost: 0, feature: "Export Effects Range (free)" },
  // ── Video processing (editor tools) ──────────────────────────
  "/api/stabilize": { cost: 300, feature: "Video Stabilization" },
  "/api/apply-speed": { cost: 150, feature: "Speed Preset" },
  "/api/color-grade": { cost: 150, feature: "Color Grade" },
  // PLACEHOLDER — NOT USER-APPROVED: AI background plate generation (gated, no key yet)
  "/api/bg-generate": { cost: 200, feature: "Background Plate (price TBD)" },
  "/api/export-doctor/export-effects-transitions": { cost: 0, feature: "Export Transitions (free)" },
  "/api/video-template/apply": { cost: 250, feature: "Apply Video Template" },
  "/api/split-screen/apply": { cost: 200, feature: "Split-Screen Grid" },
  "/api/export-doctor/export-audio-sync-short": { cost: 0, feature: "Export Audio Sync (free)" },
  "/api/export-multi-ratio": { cost: 100, feature: "Multi-Ratio Export (per ratio)" },
  // Subject-tracking reframe — mirrors REFRAME_COST in the server route
  // (routes/generate/auto-reframe.ts, env REFRAME_CREDITS, default 200).
  // This registry entry is the client's single copy of the price: the
  // editor card reads it via getCreditCost and confirmedFetch shows it
  // in the spend confirmation before anything charges.
  "/api/auto-reframe": { cost: 200, feature: "Smart Reframe — Subject Tracking" },
  "/api/extract-audio": { cost: 50, feature: "Extract Audio" },
  "/api/export-doctor/repair-normalize": { cost: 0, feature: "Repair: Normalize Clip (free)" },
  "/api/export-doctor/repair-clip": { cost: 0, feature: "Repair Clip (free)" },
  // Mirrors PRO_TOOLS_AI_CREDITS in the server route
  // (routes/generate/pro-tools-ai.ts, env PRO_TOOLS_AI_CREDITS,
  // default 100) — the rail charges 100 Visual Bucs.
  "/api/pro-tools/auto-grade": { cost: 100, feature: "Auto Grade" },
  "/api/apply-lut": { cost: 150, feature: "LUT Apply" },
  "/api/slow-motion": { cost: 300, feature: "AI Slow Motion" },
  "/api/cinematic-fx": { cost: 150, feature: "Cinematic FX Render" },
  "/api/freeze-frame": { cost: 150, feature: "Freeze Frame" },
  "/api/apply-mask": { cost: 200, feature: "Mask Effect" },
  "/api/motion-track/track": { cost: 350, feature: "Motion Tracking" },
  "/api/motion-track/apply": { cost: 350, feature: "Motion Track Burn-in" },
  "/api/upscale": { cost: 300, feature: "Upscale" },
  "/api/upscale/image": { cost: 300, feature: "Upscale Image" },
  // PLACEHOLDER prices — the user must approve real prices before these go live.
  "/api/ai-upscale": { cost: 1500, feature: "Generative AI Upscale" },
  "/api/avatar-presenter": { cost: 1200, feature: "Avatar Presenter" },
  "/api/singing-voice": { cost: 800, feature: "Singing-Voice Conversion (price TBD)" },
  "/api/watermark-removal": { cost: 200, feature: "Remove Watermark" },
  "/api/video-translator/translate": { cost: 500, feature: "Video Translator (500 VB per minute per language)" },
  "/api/analyze-sections": { cost: 100, feature: "Analyze Song Sections" },
  "/api/transcribe": { cost: 100, feature: "Transcribe Audio" },
  "/api/transcribe-url": { cost: 100, feature: "Transcribe" },
  "/api/remove-fillers/analyze": { cost: 200, feature: "Filler-Word Remover" },
  "/api/auto-chapters": { cost: 150, feature: "Auto Chapters" },
  "/api/mix-plan": { cost: 200, feature: "Mix Plan" },

  // ── Images & design ────────────────────────────────────────────
  "/api/generate-artist-image": { cost: 200, feature: "Generate Artist Image (Pro)" },
  // Wallpapers: branded renders are FREE (branding is on by default and
  // every piece is promotional). Clean (unbranded) renders pass
  // overrideCost 400 at the call site, mirroring CLEAN_RENDER_COST in
  // api-server routes/wallpapers.ts (mapped from the export-final-video
  // clean-export rail, pending owner confirmation). The screensaver loop
  // mirrors SCREENSAVER_RENDER_COST in the same route (also 400, mapped
  // from the export-final-video rail, pending owner confirmation).
  // pack-download charges nothing, so it stays off this registry.
  "/api/wallpapers/render": { cost: 0, feature: "Wallpaper Render (branded — free)" },
  "/api/wallpapers/screensaver-render": { cost: 400, feature: "Screensaver Loop Render" },
  // Single-shot thumbnail: the rail (routes/generate/thumbnail.ts)
  // charges TEXT_CREDIT_COST 100 + IMAGE_CREDIT_COST 200 = 300 when the
  // image lands, and its 402 pre-check requires the full 300 up front.
  // The registry records the delivered 300 (Stack-28 item 5, A2-08) —
  // the old 100 was the failure-path price only.
  "/api/generate-thumbnail": { cost: 300, feature: "Generate Thumbnail" },
  "/api/thumbnail-generator": { cost: 200, feature: "Generate Thumbnail" },
  "/api/thumbnail-test": { cost: 200, feature: "Thumbnail A/B Test" },
  "/api/thumbnail-test/improve": { cost: 200, feature: "Thumbnail A/B Apply Suggestions" },
  "/api/generate-logo": { cost: 100, feature: "Logo Generator" },
  "/api/generate-intro-outro": { cost: 750, feature: "Intro/Outro Generator" },
  "/api/cover-art": { cost: 200, feature: "Cover Art" },
  "/api/merch/design": { cost: 300, feature: "Merch Design" },
  "/api/stream-pack/generate": { cost: 100, feature: "Stream Pack Generator" },
  // PLACEHOLDER prices — the user must approve real prices before these go live.
  "/api/generate-headshot": { cost: 100, feature: "Headshot (price TBD)" },
  "/api/generate-product-photo": { cost: 100, feature: "Product Photo (Packshot) (price TBD)" },
  "/api/photo-enhance": { cost: 100, feature: "Photo Enhance (price TBD)" },
  "/api/remove-background": { cost: 200, feature: "Background Removal" },
  "/api/photo-backdrop": { cost: 100, feature: "Photo Backdrop (price TBD)" },
  // Priced by pack size on the rail (routes/generate/
  // sample-pack-pricing.ts): SAMPLE_PACK_10_CREDITS = 500 is the
  // base figure this registry records; the 25-pack is 1,200 and the
  // 50-pack 2,000, passed by the caller as the computed cost.
  "/api/sample-pack/generate": { cost: 500, feature: "Sample Pack Generator" },
  "/api/jewelry/design": { cost: 200, feature: "Jewelry Design" },
  // Mirrors JEWELRY_STL_CREDIT_COST in the server pricing module
  // (routes/generate/jewelry-pricing.ts) — the rail charges 400.
  "/api/jewelry/export-stl": { cost: 400, feature: "Export Jewelry STL" },
  "/api/jewelry/consult": { cost: 100, feature: "Jewelry Consult" },
  // The estimate handler (routes/generate/jewelry.ts) is a pure
  // calculator and charges nothing — the registry records it free.
  "/api/jewelry/estimate": { cost: 0, feature: "Jewelry Estimate (free)" },

  // ── Audio AI ───────────────────────────────────────────────────
  "/api/generate-sfx": { cost: 100, feature: "Generate SFX" },
  "/api/audio-cleanup": { cost: 300, feature: "Audio Cleanup" },

  // ── AI text / copilots (1 credit) ──────────────────────────────
  // /api/chat (the direct chat rail): getChatCreditCost() in
  // api-server/src/lib/ai-chat-assistant.ts defaults CHAT_CREDIT_COST
  // to 1 — the registry records that actual default (Stack-28 item 9,
  // A2-06). Env can override it (0 = free mode). The live chat widget
  // does NOT use this rail: it posts to the free /api/free-chat.
  // OWNER PRICE CALL PENDING: whether /api/chat should be free, 1, or
  // 100 is the owner's decision — this stack aligned the DISPLAY to
  // the rail's current behavior and changed no charge.
  "/api/chat": { cost: 1, feature: "Chat Message" },
  "/api/hook-studio": { cost: 100, feature: "Hook Studio" },
  "/api/virality-check": { cost: 200, feature: "Virality Pre-Flight Check" },
  "/api/analytics-hub/insights": { cost: 200, feature: "Growth Plan" },
  "/api/analytics/insights": { cost: 100, feature: "Analytics Insights" },
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
  "/api/auto-captions": { cost: 300, feature: "Auto-Captions" },
  "/api/translate-captions": { cost: 50, feature: "Translate Captions (per language)" },
  "/api/generate-cta": { cost: 50, feature: "Generate CTA" },
  "/api/karaoke-video": { cost: 300, feature: "Karaoke Video" },
  "/api/lyric-video/align": { cost: 200, feature: "AI Lyric Alignment (synced lyrics)" },
  "/api/audiogram": { cost: 250, feature: "Audiogram Visualizer" },
  "/api/loop-video": { cost: 150, feature: "Loop Video" },
  "/api/meme": { cost: 100, feature: "Meme Generator" },
  // Stack-28 item 3 (A2-04): the pre-x100 stale family — these eight
  // actions displayed 1–2 VB in their section copy while their rails
  // charge 100–200 VB, and none had a registry entry, so the stale copy
  // was the only price shown. Every figure below is the rail constant's
  // own default, re-derived in credit-costs-rail-truth.test.ts:
  // meme-machine CAPTIONS_CREDITS 100, style-stealer ANALYZE_CREDITS
  // 200, three-second-lab OPENINGS_CREDITS 200, stream-copilot
  // PREP_CREDITS / CLIP_PLAN_CREDITS 100 each, trend-jacker
  // DRAFT_CREDITS 200, lyric-stories CREDITS_PER_CARD 200 (per card —
  // the rail multiplies by the card count), community
  // MODERATE/SENTIMENT/SUPERFAN credits 100 each (moderation is per
  // 50-comment batch; /api/comment-replies above is the fourth
  // community tool at 100).
  "/api/meme-machine/captions": { cost: 100, feature: "Meme Machine Captions" },
  "/api/style-stealer/analyze": { cost: 200, feature: "Style Stealer Analysis" },
  "/api/three-second-lab/openings": { cost: 200, feature: "3-Second Lab Openings" },
  "/api/stream-copilot/prep": { cost: 100, feature: "Stream Copilot Prep" },
  "/api/stream-copilot/clip-plan": { cost: 100, feature: "Stream Copilot Clip Plan" },
  "/api/trend-jacker/draft": { cost: 200, feature: "Trend Jacker Draft" },
  "/api/lyric-stories/generate": { cost: 200, feature: "Lyric Stories (per card)" },
  "/api/community/moderate": { cost: 100, feature: "Community Moderation (per 50 comments)" },
  "/api/community/sentiment": { cost: 100, feature: "Community Sentiment Report" },
  "/api/community/superfans": { cost: 100, feature: "Community Superfan Scan" },
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
  "/api/shoutouts/ai-message": { cost: 100, feature: "Shoutout Message" },
  "/api/press-kit/generate": { cost: 300, feature: "Press Kit Generator" },
  // Parameterized route — the :id segment is the kit id. getCreditCost
  // matches literally, so this entry records the server charge in the
  // registry; the press-kit page states the price in its own copy.
  "/api/press-kit/:id/regenerate-bio": { cost: 100, feature: "Press Kit Bio Refresh" },
  "/api/press-release": { cost: 100, feature: "Press Release Generator" },
  "/api/gamers/ideas": { cost: 100, feature: "Gamer Content Ideas" },
  "/api/show-finder/pitch": { cost: 100, feature: "Show Pitch Draft" },
  "/api/show-finder": { cost: 200, feature: "Show Finder" },
  "/api/brand-deals/outreach": { cost: 100, feature: "Brand Outreach Draft" },
  "/api/brand-deals": { cost: 200, feature: "Brand Deal Finder" },
  "/api/live-shopping/ai-description": { cost: 100, feature: "Product Description" },
  "/api/randomizer": { cost: 100, feature: "Content Randomizer" },
  "/api/sound-finder/match": { cost: 100, feature: "Sound Finder" },
  "/api/content-calendar": { cost: 150, feature: "Content Calendar" },
  "/api/release-checklist": { cost: 200, feature: "Release Checklist" },

  // ── Storefronts ────────────────────────────────────────────────
  "/api/shops/ai/shop-description": { cost: 100, feature: "Shop Description" },
  "/api/shops/ai/product-description": { cost: 100, feature: "Product Description" },
  "/api/shops/ai/product-image": { cost: 100, feature: "Product Image" },

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
  "/api/posts/assist": { cost: 100, feature: "Post Assist — Write It For Me" },
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
  "/api/wave8/adlib/generate": { cost: 150, feature: "Ad-Lib Generator" },
  "/api/wave8/highlights/cut": { cost: 300, feature: "Stream Highlight Auto-Editor" },
  "/api/wave8/merch-drop/plan": { cost: 100, feature: "Merch Drop Planner" },
  "/api/wave8/media-kit/generate": { cost: 100, feature: "Media Kit Builder" },
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

  // ── Waves 3/4 + stack surfaces ──────────────────────────────────
  // Server charges that landed without a registry row (the operator
  // knowledge base prices from this registry, so an unregistered
  // charge is a price the operator cannot quote). Every figure below
  // is the server constant's own default, cross-checked at knowledge
  // generation time (SERVER_PRICE_LINKS in the generator):
  // WEBSITE_BUILD_CREDITS / WEBSITE_EDIT_CREDITS (routes/generate/
  // website-builder.ts) and PLAYLIST_PITCH_CREDIT_COST (routes/
  // generate/playlist-pitch.ts). Saving a builder project, its
  // versions, and restores charge nothing — only generate/edit do.
  "/api/website-builder/generate": { cost: 3000, feature: "Website Build" },
  "/api/website-builder/edit": { cost: 200, feature: "Website Edit" },
  "/api/website-builder/projects": { cost: 0, feature: "Save Website Project (free)" },
  "/api/playlist-pitch/kit": { cost: 200, feature: "Playlist Pitch Kit" },
  // Free actions (cost 0, same pattern as Inspo Vibe Analysis and
  // Stock Media Search above): the surface's route handlers charge
  // nothing, and the registry records that so the operator can say
  // "free" from a source instead of guessing.
  "/api/playlist-pitch/tracker": { cost: 0, feature: "Pitch Tracker & Deadlines (free)" },
  "/api/tutorials": { cost: 0, feature: "How-To Tutorials (free)" },
  "/api/dj/analyze": { cost: 0, feature: "DJ Set Prep (free)" },
  "/api/live-streams/:id/guest-invites": { cost: 0, feature: "Live Guest Invites (free)" },
  "/api/live-streams/ingest-key": { cost: 0, feature: "Stream Key (free)" },
  "/api/catalog-import/scan": { cost: 0, feature: "Catalog Import (free)" },
  "/api/move-home/draft": { cost: 0, feature: "Move Home (free)" },
  "/api/social-proof/refresh": { cost: 0, feature: "Social Proof (free)" },
  "/api/storefront/claim": { cost: 0, feature: "Lead Magnet Claim (free)" },
  "/api/artist-vaults/:id/identity-photos": { cost: 0, feature: "Identity Set Photos (free)" },
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
