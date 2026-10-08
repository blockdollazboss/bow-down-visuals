-- Creator Streaming Platform — Foundation (0091): video → sound linkage.
--
-- Link-graph reinforcement: every video payload must carry its sound
-- linkage so UI workers can link video <-> track both ways from the
-- payload alone. sound_track_id is nullable (not every video has a
-- linked sound); ON DELETE SET NULL so deleting a track never orphans
-- a video.
--
-- Idempotent: every statement is safe to re-run.

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS sound_track_id UUID REFERENCES profile_tracks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profile_videos_sound_track_id_idx
  ON profile_videos (sound_track_id);
