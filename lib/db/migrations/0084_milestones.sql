-- Milestone Tracker + Catalog Vault (DistroKid RIAA-monitoring / Leave-a-Legacy parity).
--
-- milestones: user-logged or CSV-imported stream/download counts per track and
--   platform. We CANNOT pull live Spotify stream counts (no distribution
--   partner sync yet) — every row carries a source ('manual' | 'csv') so the
--   UI can say exactly where the number came from.
-- catalog_vaults: per-release one-time purchase (200 Visual Bucs) that keeps
--   the release's presave page, showcase entry and assets live permanently
--   on Bow Down Visuals (our own hosting — this guarantee we CAN make).
--
-- Idempotent: every statement is safe to re-run.

CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  track_title TEXT NOT NULL,
  artist_name TEXT,
  platform TEXT NOT NULL DEFAULT 'spotify',
  stream_count BIGINT NOT NULL DEFAULT 0,
  award_tier TEXT NOT NULL DEFAULT 'none',
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS milestones_user_id_idx
  ON milestones (user_id);
CREATE INDEX IF NOT EXISTS milestones_user_track_idx
  ON milestones (user_id, track_title, platform);

CREATE TABLE IF NOT EXISTS catalog_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'vaulted',
  vaulted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_vaults_user_release_uidx
  ON catalog_vaults (user_id, release_id);
CREATE INDEX IF NOT EXISTS catalog_vaults_user_id_idx
  ON catalog_vaults (user_id);
CREATE INDEX IF NOT EXISTS catalog_vaults_release_id_idx
  ON catalog_vaults (release_id);
