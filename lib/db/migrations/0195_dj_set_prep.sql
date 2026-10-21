-- 0194: DJ Set-Prep Pack — per-song DJ analysis + performance crates
-- (competitor-study/pro-creative-software.md §6: VirtualDJ / Serato /
-- rekordbox automate BPM+key analysis, but set-building is manual
-- everywhere; Bow Down had BPM buried in melody-analysis, no key/Camelot,
-- and zero DJ library export).
--
-- song_dj_analysis: one row per song, upserted on (re-)analysis. Every
-- number is an ESTIMATE, so the honesty labels travel with it:
-- bpm_confidence / key_confidence (high | medium | low) and key_score
-- (the winning Krumhansl-Schmuckler correlation). A UI must never show
-- a low-confidence key as certain — the columns exist so it doesn't
-- have to guess.
--
-- dj_crates / dj_crate_items: the creator's set crates. position is the
-- play order; Thy Cheat Code's harmonic proposal is computed on read and
-- only becomes the crate order when the creator saves it (creator
-- decides — the proposal never overwrites on its own).
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS song_dj_analysis (
  song_id UUID PRIMARY KEY REFERENCES songs(id),
  user_id UUID NOT NULL,
  bpm INTEGER,
  bpm_confidence TEXT,
  key_root INTEGER,
  key_mode TEXT,
  key_label TEXT,
  camelot TEXT,
  key_score DOUBLE PRECISION,
  key_confidence TEXT,
  duration_sec INTEGER,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  analyzer_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS song_dj_analysis_user_idx
  ON song_dj_analysis (user_id);

CREATE TABLE IF NOT EXISTS dj_crates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dj_crates_user_idx
  ON dj_crates (user_id, created_at);

CREATE TABLE IF NOT EXISTS dj_crate_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crate_id UUID NOT NULL REFERENCES dj_crates(id),
  song_id UUID NOT NULL REFERENCES songs(id),
  position INTEGER NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dj_crate_items_crate_song_idx
  ON dj_crate_items (crate_id, song_id);
-- Crate reads are always "the set, in order".
CREATE INDEX IF NOT EXISTS dj_crate_items_crate_pos_idx
  ON dj_crate_items (crate_id, position);
