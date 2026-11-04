-- 0320: beat_samples — durable per-user Beat Studio sample library
-- (stack1500 beat-persistence lane).
--
-- WHY THIS FILE EXISTS: a sound a creator loads onto a Beat Studio
-- sequencer track used to live only in the browser session. The beat
-- project persisted the assignment (sound id + display name in
-- trackSounds/trackSoundNames) but never the bytes, so after a reload
-- the track silently fell back to its built-in synth voice behind a
-- "not loaded" notice — the creator's own sounds were not actually
-- theirs across sessions. This table is the library of record that
-- closes the gap: one row per saved sample, owned by exactly one
-- account; the audio bytes live in R2 under storage_key
-- ("<userId>/beat-samples/<id>.<ext>", the user-prefix shape the
-- shared R2 rail already enforces) and this row carries the metadata
-- + lifecycle:
--
--   pending → row + presigned PUT minted, bytes not yet confirmed.
--             Pending rows are invisible to every read path.
--   ready   → the /complete step verified the landed object's size
--             against size_bytes via HEAD; the sample can be listed,
--             fetched, and rehydrated into the sound registry.
--
-- The registry sound id is derived, never stored: "upload:<row id>",
-- the same id shape session uploads use, so a saved beat project
-- resolves identically after any reload.
--
-- Fresh CREATE (no legacy table to reconcile): every statement is
-- IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY. NOTE FOR THE JOIN: 0320 was the next free number on
-- the stack1400/join base tree (0319 was head); sibling stack1500
-- lanes were expected to claim numbers in the same range — renumber
-- at join time if another 0320 lands first.

CREATE TABLE IF NOT EXISTS beat_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  storage_key text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS beat_samples_storage_key_ux ON beat_samples (storage_key);

CREATE INDEX IF NOT EXISTS beat_samples_user_idx ON beat_samples (user_id, status);
