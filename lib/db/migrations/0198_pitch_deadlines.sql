-- 0198: Playlist-pitch submission deadlines (competitor gap G7).
--
-- The gap: the Playlist Pitcher generated pitch kits and logged pitch
-- outcomes (playlist_pitches: sent/pending/accepted/rejected), but the
-- pitch PACKET was typed in by hand instead of being assembled from the
-- creator's release record, and nothing tracked submission deadlines —
-- the pitch-window workflow distributors coach around ("submit 3+
-- weeks before release day") had no home.
--
-- The packet needs no table: it is assembled at read time from rows the
-- house already keeps (distribution_releases + creator_profiles +
-- presave/link stats), stating missing fields as missing.
--
-- pitch_deadlines is the one new table: one row per submission
-- deadline a creator tracks — target curator/playlist, deadline date,
-- and workflow status (drafted → sent → followed_up → answered, a
-- deliberately different vocabulary from the tracker's outcome
-- statuses). pitch_id / release_id are optional links to the tracker
-- pitch and the release being pitched, both ON DELETE SET NULL so the
-- deadline record survives either parent going away. In-app state
-- only: no email, no notifications ride this table.

CREATE TABLE IF NOT EXISTS pitch_deadlines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  pitch_id UUID REFERENCES playlist_pitches(id) ON DELETE SET NULL,
  release_id UUID REFERENCES distribution_releases(id) ON DELETE SET NULL,
  curator_name TEXT,
  playlist_name TEXT NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'drafted',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pitch_deadlines_status_check
    CHECK (status IN ('drafted', 'sent', 'followed_up', 'answered'))
);
CREATE INDEX IF NOT EXISTS pitch_deadlines_user_deadline_idx
  ON pitch_deadlines (user_id, deadline_at);
