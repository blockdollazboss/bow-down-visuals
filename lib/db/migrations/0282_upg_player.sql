-- 9999-upg-player.sql (PROVISIONAL — renumbered at join)
-- Upgrade-deltas wave, lane upg-player: #174 Thumbnail Duels · N5 Auto Chapters · N9 Karaoke Mode.
-- Idempotent; no BEGIN/COMMIT; no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS video_auto_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showcase_item_id uuid NOT NULL UNIQUE REFERENCES showcase_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thumbnail_duels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showcase_item_id uuid NOT NULL REFERENCES showcase_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  cover_a_url text NOT NULL,
  cover_b_url text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  winner text,
  views_a integer NOT NULL DEFAULT 0,
  views_b integer NOT NULL DEFAULT 0,
  clicks_a integer NOT NULL DEFAULT 0,
  clicks_b integer NOT NULL DEFAULT 0,
  target_views integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS thumbnail_duel_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duel_id uuid NOT NULL REFERENCES thumbnail_duels(id) ON DELETE CASCADE,
  cover text NOT NULL,
  voter_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS thumbnail_duel_clicks_uq
  ON thumbnail_duel_clicks (duel_id, cover, voter_key);

CREATE TABLE IF NOT EXISTS karaoke_singalongs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  audio_url text NOT NULL,
  status text NOT NULL DEFAULT 'private',
  showcase_item_id uuid REFERENCES showcase_items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE songs ADD COLUMN IF NOT EXISTS karaoke_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS karaoke_share_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS timed_lyrics text;
