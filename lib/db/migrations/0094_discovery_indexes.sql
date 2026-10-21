-- Creator Streaming Platform — Discovery + Social indexes (0094).
--
-- Worker 6 (DISCOVERY + SOCIAL). Tables live in 0085–0093
-- (creator_profiles, profile_tracks, profile_videos, playlists, follows,
--  play_events, notifications, digital_sales); this file only adds the
-- indexes that keep the discovery queries fast: windowed chart
-- aggregations over play_events, published-media scans, follower-growth
-- ranking, the notification inbox, and earnings lookups (guide-to-money:
-- "selling" badges + rising-earners rail read digital_sales).
--
-- Idempotent: CREATE INDEX IF NOT EXISTS everywhere.

-- Trending / Top charts: plays in a time window, grouped by media.
CREATE INDEX IF NOT EXISTS play_events_window_idx
  ON play_events (kind, played_at DESC, media_id);
CREATE INDEX IF NOT EXISTS play_events_media_idx
  ON play_events (media_id, played_at DESC);

-- New-this-week rails + published media scans.
CREATE INDEX IF NOT EXISTS profile_tracks_published_idx
  ON profile_tracks (is_published, created_at DESC);
CREATE INDEX IF NOT EXISTS profile_tracks_profile_idx
  ON profile_tracks (profile_id, is_published);
CREATE INDEX IF NOT EXISTS profile_videos_published_idx
  ON profile_videos (is_published, created_at DESC);
CREATE INDEX IF NOT EXISTS profile_videos_profile_idx
  ON profile_videos (profile_id, is_published);

-- Genre charts / genre filter chips.
CREATE INDEX IF NOT EXISTS profile_tracks_genre_idx
  ON profile_tracks (genre) WHERE is_published;
CREATE INDEX IF NOT EXISTS profile_videos_genre_idx
  ON profile_videos (genre) WHERE is_published;

-- Search: prefix/ILIKE scans over names and titles.
CREATE INDEX IF NOT EXISTS creator_profiles_search_idx
  ON creator_profiles (is_public, display_name);
CREATE INDEX IF NOT EXISTS profile_tracks_search_idx
  ON profile_tracks (is_published, title);
CREATE INDEX IF NOT EXISTS profile_videos_search_idx
  ON profile_videos (is_published, title);

-- Top creators / rising ("breaking") rail: follower growth in a window.
CREATE INDEX IF NOT EXISTS follows_growth_idx
  ON follows (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS follows_follower_idx
  ON follows (follower_user_id, profile_id);

-- Activity feed: "who I follow" -> their new releases.
CREATE INDEX IF NOT EXISTS creator_profiles_public_vertical_idx
  ON creator_profiles (is_public, vertical);

-- Notification inbox.
CREATE INDEX IF NOT EXISTS notifications_inbox_idx
  ON notifications (user_id, is_read, created_at DESC);

-- Guide-to-money: "selling" badges + rising-earners rail read digital_sales.
CREATE INDEX IF NOT EXISTS digital_sales_earnings_idx
  ON digital_sales (profile_id, created_at DESC);
