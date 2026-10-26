-- 9999 (PROVISIONAL — integrator renumbers at join): Remix the King
-- (Stack-200 audit #152, TRULY NEW).
--
-- A monthly house event: the King drops a track, members remix it,
-- the winning remix becomes an official release under splits
-- published in writing up front (remix_king_events.splits, frozen
-- once the event leaves draft — enforced in the API layer).
--
-- Money: Visual Bucs only, TEST MODE, never cash. Split payments are
-- exactly-once: remix_king_split_payments.idempotency_key is UNIQUE
-- and the matching credit_usage ledger row is keyed
-- remix-king-split:<payment_id>.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS remix_king_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_key text NOT NULL,
  title text NOT NULL,
  king_track_title text NOT NULL,
  king_track_audio_url text,
  king_track_stems_url text,
  description text NOT NULL DEFAULT '',
  splits jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft',
  entries_open_at timestamptz,
  entries_close_at timestamptz,
  winner_entry_id uuid,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remix_king_events_status_check CHECK (status IN ('draft','open','judging','decided','released','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS remix_king_events_month_key_uidx ON remix_king_events (month_key);
CREATE INDEX IF NOT EXISTS remix_king_events_status_idx ON remix_king_events (status, month_key);

CREATE TABLE IF NOT EXISTS remix_king_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES remix_king_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  entrant_name text NOT NULL DEFAULT 'Creator',
  remix_title text NOT NULL,
  audio_url text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'submitted',
  vote_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remix_king_entries_status_check CHECK (status IN ('submitted','shortlisted','winner','not_selected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS remix_king_entries_one_per_user_uidx ON remix_king_entries (event_id, user_id);
CREATE INDEX IF NOT EXISTS remix_king_entries_event_idx ON remix_king_entries (event_id, created_at);

CREATE TABLE IF NOT EXISTS remix_king_votes (
  entry_id uuid NOT NULL REFERENCES remix_king_entries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS remix_king_votes_unique_idx ON remix_king_votes (entry_id, user_id);
CREATE INDEX IF NOT EXISTS remix_king_votes_entry_idx ON remix_king_votes (entry_id);

CREATE TABLE IF NOT EXISTS remix_king_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES remix_king_events(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL,
  winner_user_id uuid NOT NULL,
  winner_name text NOT NULL DEFAULT 'Creator',
  release_title text NOT NULL,
  splits jsonb NOT NULL DEFAULT '[]',
  distribution_release_id uuid,
  status text NOT NULL DEFAULT 'pending_release',
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remix_king_releases_status_check CHECK (status IN ('pending_release','released'))
);
CREATE UNIQUE INDEX IF NOT EXISTS remix_king_releases_event_uidx ON remix_king_releases (event_id);

CREATE TABLE IF NOT EXISTS remix_king_split_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES remix_king_releases(id) ON DELETE CASCADE,
  payee_user_id uuid,
  payee_name text NOT NULL,
  role text NOT NULL,
  share_pct integer NOT NULL,
  amount_vb integer NOT NULL,
  period text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remix_king_split_payments_status_check CHECK (status IN ('pending','paid'))
);
CREATE UNIQUE INDEX IF NOT EXISTS remix_king_split_payments_idem_uidx ON remix_king_split_payments (idempotency_key);
CREATE INDEX IF NOT EXISTS remix_king_split_payments_release_idx ON remix_king_split_payments (release_id, period);
