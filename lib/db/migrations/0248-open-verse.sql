-- 9999 (PROVISIONAL — coordinator renumbers at join): Open Verse
-- (Stack-200 Wave 2, idea #176). A song posted with an open verse slot;
-- other creators submit verses in-app; the song's creator picks the
-- winner and the winner's verse goes onto the track.
--
-- Split terms are shown UP FRONT and validated by the existing
-- publishing-splits rail (sum = 100) — split_terms snapshots that
-- validated two-line split (song creator / winning verse creator).
-- Money law: TEST MODE, Visual Bucs only, never cash; nothing is
-- charged here. open_verse_split_ledger records the split agreement
-- EXACTLY ONCE per post (unique post_id + unique idempotency key).
--
-- song_id carries no FK on purpose: song_kind says which table it
-- points at ('release' -> distribution_releases, 'song' -> songs);
-- the route validates ownership at post time and song_title is
-- snapshotted.
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (house rules).

CREATE TABLE IF NOT EXISTS open_verse_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  song_kind text NOT NULL DEFAULT 'song',
  song_id uuid NOT NULL,
  song_title text NOT NULL DEFAULT '',
  brief text NOT NULL DEFAULT '',
  slot_label text NOT NULL DEFAULT 'Open verse',
  split_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  winner_share_pct numeric(5,2) NOT NULL,
  status text NOT NULL DEFAULT 'open',
  closes_at timestamptz,
  winner_submission_id uuid,
  winner_user_id uuid,
  winner_picked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT open_verse_posts_song_kind_check
    CHECK (song_kind IN ('release','song')),
  CONSTRAINT open_verse_posts_status_check
    CHECK (status IN ('open','closed','winner_picked','cancelled')),
  CONSTRAINT open_verse_posts_winner_share_range_check
    CHECK (winner_share_pct > 0 AND winner_share_pct < 100)
);

CREATE TABLE IF NOT EXISTS open_verse_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES open_verse_posts(id) ON DELETE CASCADE,
  submitter_user_id uuid NOT NULL,
  submitter_name text NOT NULL DEFAULT 'Creator',
  audio_url text NOT NULL,
  lyrics text,
  note text,
  status text NOT NULL DEFAULT 'submitted',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT open_verse_submissions_status_check
    CHECK (status IN ('submitted','winner','not_selected','withdrawn'))
);

CREATE TABLE IF NOT EXISTS open_verse_split_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL UNIQUE REFERENCES open_verse_posts(id) ON DELETE CASCADE,
  winner_submission_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  winner_user_id uuid NOT NULL,
  winner_share_pct numeric(5,2) NOT NULL,
  split_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency text NOT NULL DEFAULT 'VB',
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT open_verse_split_ledger_currency_check
    CHECK (currency = 'VB')
);

CREATE INDEX IF NOT EXISTS open_verse_posts_owner_idx
  ON open_verse_posts (owner_user_id);
CREATE INDEX IF NOT EXISTS open_verse_posts_status_idx
  ON open_verse_posts (status, created_at);
CREATE INDEX IF NOT EXISTS open_verse_posts_song_idx
  ON open_verse_posts (song_kind, song_id);
-- One live (open/closed) open-verse post per song at a time.
CREATE UNIQUE INDEX IF NOT EXISTS open_verse_posts_live_song_uidx
  ON open_verse_posts (song_kind, song_id)
  WHERE status IN ('open','closed');

CREATE UNIQUE INDEX IF NOT EXISTS open_verse_submissions_post_submitter_uidx
  ON open_verse_submissions (post_id, submitter_user_id);
CREATE INDEX IF NOT EXISTS open_verse_submissions_post_idx
  ON open_verse_submissions (post_id, created_at);
CREATE INDEX IF NOT EXISTS open_verse_submissions_submitter_idx
  ON open_verse_submissions (submitter_user_id);
CREATE INDEX IF NOT EXISTS open_verse_split_ledger_winner_idx
  ON open_verse_split_ledger (winner_user_id);
