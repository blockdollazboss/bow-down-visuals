# Visual Bucs ×100 — Environment Variable Audit

**Date:** 2026-09-28
**Branch:** feat/visual-bucs-redenomination

## ⚠️ ACTION REQUIRED (after staging deploy)

Code defaults were scaled ×100. If any variable below is set in the Render
dashboard (staging or production), the dashboard value OVERRIDES the code default.

**Old dashboard values are in OLD units.** Multiply by 100 or REMOVE the variable
(to fall back to the new code default).

**Do NOT change dashboard values until this branch is deployed to staging.**

## Variables to Check

| Env Variable | New Code Default | Dashboard Action |
|--------------|------------------|------------------|
| `ACADEMY_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `ANALYTICS_HUB_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `ANALYTICS_INSIGHTS_CREDITS` | 100 | ×100 or remove (default 100) |
| `ANALYTICS_SUGGESTIONS_CREDITS` | 100 | ×100 or remove (default 100) |
| `ARTIST_IMAGE_CREDITS` | ? | Check manually |
| `ARTIST_IMAGE_SUNBURST_CREDITS` | ? | Check manually |
| `ARTIST_IMAGE_TURBO_CREDITS` | ? | Check manually |
| `BEAT_AI_TAGS_CREDITS` | ? | Check manually |
| `BRAND_CALCULATOR_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `BRAND_DEAL_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `BRAND_DEAL_OUTREACH_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `CAPTION_STYLER_CREDITS` | 300 | ×100 or remove (default 300) |
| `CHANNEL_AUDIT_CREDIT_COST` | 300 | ×100 or remove (default 300) |
| `CHAT_CREDIT_COST` | ? | Check manually |
| `CLIP_DETECT_CREDIT_COST` | 300 | ×100 or remove (default 300) |
| `COLLAB_MATCH_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `COMMENT_REPLIES_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `COMMUNITY_MODERATE_CREDITS` | 100 | ×100 or remove (default 100) |
| `COMMUNITY_REPLY_CREDITS` | 100 | ×100 or remove (default 100) |
| `COMMUNITY_SENTIMENT_CREDITS` | 100 | ×100 or remove (default 100) |
| `COMMUNITY_SUPERFAN_CREDITS` | 100 | ×100 or remove (default 100) |
| `CONTENT_CALENDAR_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `CONTEST_ANNOUNCE_CREDITS` | 100 | ×100 or remove (default 100) |
| `CONTRACT_ANALYSIS_CREDIT_COST` | 300 | ×100 or remove (default 300) |
| `COPYRIGHT_ASK_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `COPYRIGHT_DRAFT_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `COVER_ART_PREMIUM_CREDITS` | 300 | ×100 or remove (default 300) |
| `COVER_ART_STANDARD_CREDITS` | 200 | ×100 or remove (default 200) |
| `DISCORD_AI_ANNOUNCEMENT_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `DISTRIBUTION_AI_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `DISTRIBUTION_ALBUM_CREDITS` | 3000 | ×100 or remove (default 3000) |
| `DISTRIBUTION_ANNUAL_CREDITS` | 399 | ×100 or remove (default 399) |
| `DISTRIBUTION_EP_CREDITS` | 2000 | ×100 or remove (default 2000) |
| `DISTRIBUTION_RELEASE_CREDITS` | 1000 | ×100 or remove (default 1000) |
| `DISTRIBUTION_SINGLE_CREDITS` | ? | Check manually |
| `EMAIL_NEWSLETTER_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `FACEBOOK_POST_CREDITS` | 100 | ×100 or remove (default 100) |
| `GAMERS_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `HOOK_STUDIO_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `INSTAGRAM_POST_CREDITS` | 100 | ×100 or remove (default 100) |
| `INTERVIEW_FEEDBACK_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `INTERVIEW_PREP_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `JEWELRY_CONSULT_CREDIT_COST` | ? | Check manually |
| `JEWELRY_PREVIEW_CREDIT_COST` | ? | Check manually |
| `JEWELRY_STL_CREDIT_COST` | ? | Check manually |
| `LABEL_PITCH_CREDIT_COST` | 300 | ×100 or remove (default 300) |
| `LIVE_SHOPPING_AI_DESC_CREDITS` | 100 | ×100 or remove (default 100) |
| `LLC_GUIDE_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `LOGO_PREMIUM_CREDITS` | ? | Check manually |
| `LOGO_STANDARD_CREDITS` | ? | Check manually |
| `LYRIC_VIDEO_ALIGN_CREDITS` | 200 | ×100 or remove (default 200) |
| `LYRIC_VIDEO_RENDER_CREDITS` | 500 | ×100 or remove (default 500) |
| `MEDIA_DETECTION_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `MEDIA_IMPORT_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `MEMBERSHIPS_AI_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `MERCH_DESIGN_CREDIT_COST` | ? | Check manually |
| `MONETIZATION_COACH_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `MOVIE_CONCEPT_CREDIT_COST` | 400 | ×100 or remove (default 400) |
| `OUTREACH_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `PLAYLIST_PITCH_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `PRESS_KIT_BIO_REFRESH_CREDITS` | 100 | ×100 or remove (default 100) |
| `PRESS_KIT_GENERATE_CREDITS` | 300 | ×100 or remove (default 300) |
| `PROMO_GENERATOR_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `PRO_TOOLS_AI_CREDITS` | ? | Check manually |
| `RANDOMIZER_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `RELEASE_PLAN_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `REPURPOSE_PACK_CREDITS` | 500 | ×100 or remove (default 500) |
| `REPURPOSE_REROLL_CREDITS` | 100 | ×100 or remove (default 100) |
| `ROYALTY_INSIGHTS_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `SCHEDULER_BEST_TIME_CREDITS` | 100 | ×100 or remove (default 100) |
| `SCHEDULER_POST_CREDITS` | 100 | ×100 or remove (default 100) |
| `SCRIPT_WRITER_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `SEEDANCE_CREDITS_PER_SEC` | ? | Check manually |
| `SETLIST_FLOW_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `SFX_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `SHOP_AI_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `SHOP_IMAGE_PREMIUM_CREDITS` | 200 | ×100 or remove (default 200) |
| `SHOP_IMAGE_STANDARD_CREDITS` | 100 | ×100 or remove (default 100) |
| `SHOUTOUT_AI_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `SHOW_FINDER_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `SHOW_FINDER_PITCH_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `SOUND_MATCH_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `SPONSOR_AI_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `SPONSOR_POST_CREDIT_COST` | 500 | ×100 or remove (default 500) |
| `STREAMER_CLIPS_ANALYZE_CREDITS` | 300 | ×100 or remove (default 300) |
| `STREAMER_CLIPS_CUT_CREDITS` | 200 | ×100 or remove (default 200) |
| `STREAM_PACK_CREDITS_PER_IMAGE` | 100 | ×100 or remove (default 100) |
| `THUMBNAIL_GENERATOR_CREDITS` | 200 | ×100 or remove (default 200) |
| `THUMBNAIL_IMPROVE_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `THUMBNAIL_TEST_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `TIKTOK_POST_CREDITS` | 100 | ×100 or remove (default 100) |
| `TITLE_STUDIO_CREDIT_COST` | 100 | ×100 or remove (default 100) |
| `TOUR_PLANNER_CREDIT_COST` | 300 | ×100 or remove (default 300) |
| `TREND_PREDICTOR_FORECAST_CREDITS` | 200 | ×100 or remove (default 200) |
| `TREND_PREDICTOR_IDEAS_CREDITS` | 100 | ×100 or remove (default 100) |
| `VIDEO_TRANSLATOR_CREDITS_PER_MINUTE` | 500 | ×100 or remove (default 500) |
| `VIRALITY_CHECK_CREDIT_COST` | 200 | ×100 or remove (default 200) |
| `VOICEOVER_CREDITS_PER_MINUTE` | 200 | ×100 or remove (default 200) |
| `WEBSITE_BUILD_CREDIT_COST` | 3000 | ×100 or remove (default 3000) |
| `WEBSITE_EDIT_CREDIT_COST` | 200 | ×100 or remove (default 200) |

## Notes

- Stripe price IDs are UNCHANGED (dollar prices did not change).
- Verify pricing on staging before promoting to production.
