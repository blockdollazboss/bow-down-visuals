-- 0303: Playlist follows get a row (stack1000 Lane M3 —
-- social-counter truth, round 2; flagged as stack900 L4 residual R4).
--
-- Until now the playlist follow pair kept NO record of who follows a
-- playlist: POST /playlists/:id/follow ran a bare
-- `follower_count = follower_count + 1` on EVERY call, so a double-tap
-- or a client retry inflated the count; DELETE …/unfollow decremented
-- for anyone — including someone who never followed, stealing a count
-- that was never theirs. And no owner's bell could ever fire
-- truthfully: with no landed transition there is no moment to
-- announce.
--
-- This table is the follow itself, mirroring the profile `follows`
-- table (migration 0087): one row per (user, playlist), primary key
-- on the pair. The endpoints now insert/delete with the outcome read
-- back, and playlists.follower_count plus the owner's social bell
-- move only when a row lands or leaves — a replay is an exact no-op.
--
-- Historic follower_count values are deliberately left untouched:
-- they accumulated with no rows behind them and cannot be reconciled
-- either way. From this migration forward every move of the counter
-- is a landed transition, the same settlement the profile
-- followerCount reached in stack900 L4.
CREATE TABLE IF NOT EXISTS playlist_follows (
  user_id uuid NOT NULL,
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, playlist_id)
);
CREATE INDEX IF NOT EXISTS playlist_follows_playlist_idx
  ON playlist_follows (playlist_id);
