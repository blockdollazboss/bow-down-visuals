-- 0121: generation pipeline tables — generated_clips, generation_history,
-- export_jobs, lip_sync_jobs.
-- These existed only via the retired drizzle-kit push, so any fresh DB
-- 500s on clip generation, export polling, and lip-sync jobs.
-- Definitions mirror lib/db/src/schema/generated-clips.ts,
-- lib/db/src/schema/generation-history.ts, lib/db/src/schema/export-jobs.ts
-- and lib/db/src/schema/lip-sync-jobs.ts exactly.
-- Idempotent: safe to re-run as a no-op.

CREATE TABLE IF NOT EXISTS generated_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID,
  scene_id TEXT,
  title TEXT,
  prompt TEXT,
  final_prompt TEXT,
  runway_job_id TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generated_clips_user_id_idx ON generated_clips (user_id);
CREATE INDEX IF NOT EXISTS generated_clips_project_id_idx ON generated_clips (project_id);

CREATE TABLE IF NOT EXISTS generation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID,
  generation_type TEXT,
  prompt TEXT,
  result JSONB,
  credits_used INTEGER,
  save_status TEXT NOT NULL DEFAULT 'pending',
  refunded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generation_history_user_id_idx ON generation_history (user_id);
CREATE INDEX IF NOT EXISTS generation_history_created_at_idx ON generation_history (created_at DESC);

CREATE TABLE IF NOT EXISTS export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  params JSONB NOT NULL,
  result JSONB,
  error JSONB,
  credits_charged BOOLEAN NOT NULL DEFAULT false,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS export_jobs_user_id_idx ON export_jobs (user_id);
CREATE INDEX IF NOT EXISTS export_jobs_state_idx ON export_jobs (state);

CREATE TABLE IF NOT EXISTS lip_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID,
  scene_id TEXT,
  state TEXT NOT NULL DEFAULT 'queued',
  params JSONB NOT NULL,
  provider_job_id TEXT,
  result_url TEXT,
  error JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  polls INTEGER NOT NULL DEFAULT 0,
  consecutive_poll_errors INTEGER NOT NULL DEFAULT 0,
  next_poll_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  submit_deferrals INTEGER NOT NULL DEFAULT 0,
  history_recorded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lip_sync_jobs_user_id_idx ON lip_sync_jobs (user_id);
CREATE INDEX IF NOT EXISTS lip_sync_jobs_state_idx ON lip_sync_jobs (state);
