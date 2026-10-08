/**
 * Wayfinding map for merged/renamed pages — static, no backend.
 *
 * When a page is folded into another page's tab, its old route redirects with
 * `?moved_from=<slug>`. The destination page renders <MovedBanner />, which
 * looks the slug up here and shows a one-time dismissible notice.
 * The "Where did it go?" modal lists this same map.
 *
 * nameKey: i18n key for the old page's plain-language name.
 * locationKey: i18n key describing where it lives now.
 */
export interface MovedPageInfo {
  nameKey: string;
  locationKey: string;
}

export const MOVED_PAGES: Record<string, MovedPageInfo> = {
  // ── First-pass merges (already live) ──
  thumbnail:        { nameKey: "movedPages.names.thumbnail",        locationKey: "movedPages.locations.thumbnailStudioGenerate" },
  mastering:       { nameKey: "movedPages.names.mastering",       locationKey: "movedPages.locations.audioStudioMaster" },
  "comment-replies": { nameKey: "movedPages.names.commentReplies", locationKey: "movedPages.locations.communityReplies" },
  "clip-maker":    { nameKey: "movedPages.names.clipMaker",       locationKey: "movedPages.locations.repurposeStream" },
  analytics:       { nameKey: "movedPages.names.analytics",       locationKey: "movedPages.locations.analyticsHubConnected" },
  titles:          { nameKey: "movedPages.names.titles",          locationKey: "movedPages.locations.hookStudioTitles" },
  "release-checklist": { nameKey: "movedPages.names.releaseChecklist", locationKey: "movedPages.locations.distributePlan" },
  "vocal-removal": { nameKey: "movedPages.names.vocalRemoval",    locationKey: "movedPages.locations.audioStudioStems" },
  "watermark-removal": { nameKey: "movedPages.names.watermarkRemoval", locationKey: "movedPages.locations.upscaleEnhance" },
  "content-calendar": { nameKey: "movedPages.names.contentCalendar", locationKey: "movedPages.locations.schedulerPlan" },
  "playlist-pitch": { nameKey: "movedPages.names.playlistPitch",  locationKey: "movedPages.locations.labelPitchPlaylists" },
  merch:           { nameKey: "movedPages.names.merch",           locationKey: "movedPages.locations.brandingShopMerch" },
  "music-sales":   { nameKey: "movedPages.names.musicSales",      locationKey: "movedPages.locations.storeDashboardDigital" },

  // ── Deep-surgery merges ──
  "audio-cleanup": { nameKey: "movedPages.names.audioCleanup",    locationKey: "movedPages.locations.audioStudioCleanup" },
  stems:           { nameKey: "movedPages.names.stems",           locationKey: "movedPages.locations.audioStudioStems" },
  "mix-master":    { nameKey: "movedPages.names.mixMaster",       locationKey: "movedPages.locations.audioStudioMaster" },
  "beat-maker":    { nameKey: "movedPages.names.beatMaker",       locationKey: "movedPages.locations.aiAudioBeats" },
  samples:         { nameKey: "movedPages.names.samples",         locationKey: "movedPages.locations.aiAudioSamples" },
  sfx:             { nameKey: "movedPages.names.sfx",             locationKey: "movedPages.locations.aiAudioSfx" },
  "thumbnail-maker": { nameKey: "movedPages.names.thumbnailMaker", locationKey: "movedPages.locations.thumbnailStudioGenerate" },
  thumbnails:      { nameKey: "movedPages.names.thumbnails",      locationKey: "movedPages.locations.thumbnailStudioLibrary" },
  "thumbnail-test": { nameKey: "movedPages.names.thumbnailTest",  locationKey: "movedPages.locations.thumbnailStudioAbtest" },
  randomizer:      { nameKey: "movedPages.names.randomizer",      locationKey: "movedPages.locations.hookStudioDice" },
  sponsors:        { nameKey: "movedPages.names.sponsors",        locationKey: "movedPages.locations.brandDealsMarketplace" },
  "sponsorship-outreach": { nameKey: "movedPages.names.sponsorshipOutreach", locationKey: "movedPages.locations.brandDealsPitch" },
  "channel-audit": { nameKey: "movedPages.names.channelAudit",    locationKey: "movedPages.locations.analyticsHubChannelAudit" },
  "virality-check": { nameKey: "movedPages.names.viralityCheck",  locationKey: "movedPages.locations.analyticsHubVirality" },
  royalties:       { nameKey: "movedPages.names.royalties",       locationKey: "movedPages.locations.coachMoneyRoyalties" },
  "song-and-video": { nameKey: "movedPages.names.songAndVideo",   locationKey: "movedPages.locations.createSongVideo" },
  "make-song":     { nameKey: "movedPages.names.makeSong",        locationKey: "movedPages.locations.createSong" },
  "make-video":    { nameKey: "movedPages.names.makeVideo",       locationKey: "movedPages.locations.createVideo" },
};
