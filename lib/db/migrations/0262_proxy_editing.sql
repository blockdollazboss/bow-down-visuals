-- 9999 (PROVISIONAL NUMBER): Proxy editing (Stack-200 board item 184).
--
-- PROVISIONAL: this file is numbered 9999 because the integration
-- branch assigns real migration numbers at join time (the tree is at
-- 0244). Rename to the next free number at join; the SQL is
-- number-independent.
--
-- A proxy is a low-res, lightweight copy of ONE heavy original clip,
-- made only so the Visual Vibes editor can preview/scrub smoothly.
-- It is never a deliverable: export ALWAYS renders from original_url,
-- and any clip URL pointing at proxy_url is relinked back to the
-- original before a render starts (api-server lib/proxy-editing,
-- wired into the export job kickoff).
--
-- ON DEMAND ONLY: rows are created only when a creator asks for a
-- proxy for a clip that is actually heavy. Light clips get no row.
-- NO PRICES: proxy editing charges nothing and prices nothing.
--
-- Status lifecycle: pending -> generating -> ready | failed.
-- proxy_prefs is the per-account on/off (default ON; no row = ON).
-- Turning it off never deletes rows or media.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS proxy_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id text,
  original_url text NOT NULL,
  proxy_url text,
  original_width integer,
  original_height integer,
  original_bytes integer,
  original_duration_sec double precision,
  original_codec text,
  proxy_width integer,
  proxy_height integer,
  status text NOT NULL DEFAULT 'pending',
  is_heavy boolean NOT NULL DEFAULT true,
  heavy_reasons text[],
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proxy_media_status_check CHECK (status IN ('pending', 'generating', 'ready', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS proxy_media_user_original_idx
  ON proxy_media (user_id, original_url);
CREATE INDEX IF NOT EXISTS proxy_media_user_project_idx
  ON proxy_media (user_id, project_id, created_at);
CREATE INDEX IF NOT EXISTS proxy_media_proxy_url_idx
  ON proxy_media (proxy_url);
CREATE INDEX IF NOT EXISTS proxy_media_status_idx
  ON proxy_media (status, created_at);

CREATE TABLE IF NOT EXISTS proxy_prefs (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
