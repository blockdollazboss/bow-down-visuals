-- 9999-stems-player.sql (PROVISIONAL NUMBER — integrator renumbers at join)
-- N14 Stems Player: the fan-playback stem carrier for profile tracks.
-- One row per track that carries stems; no row = no stem controls.
-- `stems` maps stem keys (vocals/drums/bass/other/guitar/piano — the Stem
-- Splitter's own key set) to stable storage refs (the splitter's stemRefs).
-- Refs only — signed playback URLs are minted on read, never stored.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS track_stems (
  track_id uuid PRIMARY KEY REFERENCES profile_tracks(id) ON DELETE CASCADE,
  stems jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
