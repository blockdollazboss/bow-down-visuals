-- 0138: Stack 10 "Trust, safety & the literal end" — Content ID
-- fingerprints + symmetric claims, succession designations, catalog
-- export jobs, chat automod + unified mod log, stage audio rooms,
-- group join questions/requests, video retention events.
-- Idempotent: safe to re-run as a no-op. Schema: lib/db/src/schema/trust.ts

CREATE TABLE IF NOT EXISTS content_id_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  optin_id UUID,
  user_id UUID NOT NULL,
  track_title TEXT NOT NULL DEFAULT '',
  landmarks JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  sample_rate INTEGER NOT NULL DEFAULT 8000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_id_fp_user_idx ON content_id_fingerprints (user_id);
CREATE INDEX IF NOT EXISTS content_id_fp_optin_idx ON content_id_fingerprints (optin_id);

CREATE TABLE IF NOT EXISTS content_id_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  uploader_user_id UUID NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  offset_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  matched_landmarks INTEGER NOT NULL DEFAULT 0,
  total_landmarks INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  dispute_note TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',
  resolved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_id_matches_owner_idx ON content_id_matches (owner_user_id);
CREATE INDEX IF NOT EXISTS content_id_matches_uploader_idx ON content_id_matches (uploader_user_id);

CREATE TABLE IF NOT EXISTS legacy_designations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  heir_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_designations_user_uidx ON legacy_designations (user_id);
CREATE INDEX IF NOT EXISTS legacy_designations_heir_idx ON legacy_designations (heir_user_id);

CREATE TABLE IF NOT EXISTS catalog_export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  manifest JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_export_jobs_user_idx ON catalog_export_jobs (user_id, created_at);

CREATE TABLE IF NOT EXISTS chat_automod_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  block_links BOOLEAN NOT NULL DEFAULT false,
  blocked_words JSONB NOT NULL DEFAULT '[]'::jsonb,
  caps_percent INTEGER,
  caps_min_length INTEGER NOT NULL DEFAULT 12,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_automod_rules_profile_uidx ON chat_automod_rules (profile_id);

CREATE TABLE IF NOT EXISTS chat_mod_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID,
  stream_id UUID,
  actor_user_id UUID,
  target_user_id UUID,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  rule TEXT,
  message_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_mod_actions_profile_idx ON chat_mod_actions (profile_id, created_at);
CREATE INDEX IF NOT EXISTS chat_mod_actions_stream_idx ON chat_mod_actions (stream_id, created_at);

CREATE TABLE IF NOT EXISTS stage_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id UUID NOT NULL,
  profile_id UUID,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS stage_rooms_status_idx ON stage_rooms (status, created_at);

CREATE TABLE IF NOT EXISTS group_join_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL,
  question TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_join_questions_group_idx ON group_join_questions (group_id, position);

CREATE TABLE IF NOT EXISTS group_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL,
  user_id UUID NOT NULL,
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_join_requests_group_idx ON group_join_requests (group_id, status);
-- Note: pending-uniqueness is enforced in the route (one open request
-- per user per group); a partial unique index cannot be expressed in
-- the Drizzle schema above, so it lives only here.
CREATE UNIQUE INDEX IF NOT EXISTS group_join_requests_open_uidx ON group_join_requests (group_id, user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS video_retention_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL,
  owner_user_id UUID,
  viewer_user_id UUID,
  position_seconds DOUBLE PRECISION NOT NULL,
  duration_seconds DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_retention_video_idx ON video_retention_events (video_id, created_at);
CREATE INDEX IF NOT EXISTS video_retention_viewer_idx ON video_retention_events (viewer_user_id, created_at);
