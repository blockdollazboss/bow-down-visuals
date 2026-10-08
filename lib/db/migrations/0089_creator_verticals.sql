-- Creator Streaming Platform — Foundation (0089): all-creator verticals.
--
-- The platform serves ALL creators (musicians, YouTubers, TikTokers,
-- streamers, podcasters, educators, reviewers, filmmakers, TV/web-series
-- makers, influencers...), not music only.
--
-- creator_profiles.vertical: music | video | gaming | podcast | film | tv |
--   influencer | education | other.
-- creator_profiles.stream_schedule: JSONB array of {day, time, title} —
--   for gamers/streamers. twitch_url / youtube_url / kick_url live in
--   social_links (no dedicated columns).
-- creator_profiles.media_kit: JSONB {audience_size, engagement_rate,
--   rates, niches} — for influencers' brand-deal one-pagers.
-- playlists.kind: 'playlist' | 'series' — film/TV creators model episodic
--   series as playlists of kind 'series'; ordered items give episode order.
-- profile_videos.season / profile_videos.episode: optional episodic
--   numbering for film/TV.
--
-- NOTE: profile_tracks / profile_videos table names stay stable (contract)
-- but hold GENERIC audio/video content: a podcaster's episodes live in
-- profile_tracks, a YouTuber's uploads in profile_videos.
--
-- Idempotent: every statement is safe to re-run.

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS vertical TEXT NOT NULL DEFAULT 'music';

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS stream_schedule JSONB NOT NULL DEFAULT '[]';

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS media_kit JSONB;

ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'playlist';

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS season INTEGER;

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS episode INTEGER;

CREATE INDEX IF NOT EXISTS creator_profiles_vertical_idx
  ON creator_profiles (vertical);

CREATE INDEX IF NOT EXISTS playlists_kind_idx
  ON playlists (kind);
