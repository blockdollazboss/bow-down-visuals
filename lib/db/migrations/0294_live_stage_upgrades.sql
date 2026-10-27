-- 9999 (PROVISIONAL — number assigned at stack join): Live-stage upgrades
-- (dedupe-audit deltas #172 Auto-Highlights, #166 Stage Manager,
-- #153 Creator Classes).
--   · live_streams gains the class format: is_class marks a ticketed
--     stream run as a class (enrollment rides the existing ticket rail),
--     and class_course_product_id points at the course product the
--     session's replay is automatically listed as when it registers.
--   · creator_live_prefs: per-creator automation switches (the
--     sound_prefs pattern) — every automated behavior on the live
--     surfaces carries its own user-facing on/off here.
--   · stream_highlight_proposals: Auto-Highlights' best-3 drafts. A
--     proposal is never a post — the creator approves or dismisses.
--   · live_stage_manager_state: the co-host's per-stream runtime
--     state (the creator's mid-stream mute + the current pin).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS is_class boolean NOT NULL DEFAULT false;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS class_course_product_id uuid REFERENCES store_products(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS creator_live_prefs (
  user_id uuid PRIMARY KEY,
  auto_highlights_enabled boolean NOT NULL DEFAULT true,
  stage_manager_enabled boolean NOT NULL DEFAULT true,
  stage_manager_pin_enabled boolean NOT NULL DEFAULT true,
  stage_manager_links_enabled boolean NOT NULL DEFAULT true,
  stage_manager_sting_enabled boolean NOT NULL DEFAULT true,
  stage_manager_flags_enabled boolean NOT NULL DEFAULT true,
  stage_manager_link_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stream_highlight_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL,
  start_sec integer NOT NULL,
  end_sec integer NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  signals jsonb NOT NULL DEFAULT '{"chatPeak":0,"tipVb":0,"viewerPeak":0}'::jsonb,
  score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'proposed',
  cut_job_id text,
  output_ref text,
  output_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stream_highlight_proposals_stream_start_uniq
  ON stream_highlight_proposals (stream_id, start_sec);
CREATE INDEX IF NOT EXISTS stream_highlight_proposals_stream_idx
  ON stream_highlight_proposals (stream_id, created_at);
CREATE INDEX IF NOT EXISTS stream_highlight_proposals_creator_idx
  ON stream_highlight_proposals (creator_user_id, status);

CREATE TABLE IF NOT EXISTS live_stage_manager_state (
  stream_id uuid PRIMARY KEY REFERENCES live_streams(id) ON DELETE CASCADE,
  muted boolean NOT NULL DEFAULT false,
  pinned_message_id uuid REFERENCES live_chat_messages(id) ON DELETE SET NULL,
  pinned_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
