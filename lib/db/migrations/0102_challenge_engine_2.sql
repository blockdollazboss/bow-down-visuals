-- 0102_challenge_engine_2.sql — Challenge engine 2.0: prize pools, voting, winners.
--
-- Extends the challenges system (0091) with the full competitive layer:
--   1. challenge_prizes    — prize pool per challenge in Visual Bucs (x100
--                            convention; always multiples of 100), auto-paid
--                            to winners, idempotent by UNIQUE(challenge_id, place).
--   2. challenge_votes     — community voting: one vote per user per entry
--                            (UNIQUE(user_id, video_id)); vote counts
--                            denormalized onto challenge_entries.vote_count.
--   3. challenge_winners   — announced winners; paid_at marks the prize as
--                            paid; UNIQUE(challenge_id, place) + the paid_at
--                            IS NULL claim pattern make double-pay impossible.
--   4. challenges lifecycle — status (upcoming|live|judging|winners) plus
--                            starts_at / ends_at / judging_ends_at and a
--                            prize_pool_credits cache column.
--
-- All DDL is IF NOT EXISTS so the file is safe to re-run.

-- ── challenges: lifecycle columns ─────────────────────────────────────────
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'live';
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS ends_at timestamptz;
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS judging_ends_at timestamptz;
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS prize_pool_credits integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenges_status_check'
  ) THEN
    ALTER TABLE challenges
      ADD CONSTRAINT challenges_status_check
      CHECK (status IN ('upcoming', 'live', 'judging', 'winners'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS challenges_status_idx ON challenges (status);
CREATE INDEX IF NOT EXISTS challenges_ends_at_idx ON challenges (ends_at);

-- ── challenge_prizes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_prizes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  uuid NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
  place         integer NOT NULL CHECK (place >= 1 AND place <= 10),
  prize_credits integer NOT NULL CHECK (prize_credits >= 100 AND prize_credits % 100 = 0),
  description   text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenge_prizes_challenge_place_unique'
  ) THEN
    ALTER TABLE challenge_prizes
      ADD CONSTRAINT challenge_prizes_challenge_place_unique
      UNIQUE (challenge_id, place);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS challenge_prizes_challenge_idx ON challenge_prizes (challenge_id);

-- ── challenge_votes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  uuid NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
  video_id      uuid NOT NULL REFERENCES profile_videos (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenge_votes_user_video_unique'
  ) THEN
    ALTER TABLE challenge_votes
      ADD CONSTRAINT challenge_votes_user_video_unique
      UNIQUE (user_id, video_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS challenge_votes_challenge_idx ON challenge_votes (challenge_id);
CREATE INDEX IF NOT EXISTS challenge_votes_video_idx ON challenge_votes (video_id);

-- vote counts denormalized onto the entry row (kept in sync by the API)
ALTER TABLE challenge_entries
  ADD COLUMN IF NOT EXISTS vote_count integer NOT NULL DEFAULT 0;

-- ── challenge_winners ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_winners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  uuid NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
  place         integer NOT NULL CHECK (place >= 1 AND place <= 10),
  video_id      uuid NOT NULL REFERENCES profile_videos (id) ON DELETE CASCADE,
  profile_id    uuid REFERENCES creator_profiles (id) ON DELETE SET NULL,
  user_id       uuid,
  prize_credits integer NOT NULL DEFAULT 0,
  -- paid_at IS NULL  -> prize not yet paid. Payout claims the row with
  -- UPDATE ... WHERE paid_at IS NULL so two concurrent judges can never
  -- both pay the same winner.
  paid_at       timestamptz,
  announced_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenge_winners_challenge_place_unique'
  ) THEN
    ALTER TABLE challenge_winners
      ADD CONSTRAINT challenge_winners_challenge_place_unique
      UNIQUE (challenge_id, place);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS challenge_winners_challenge_idx ON challenge_winners (challenge_id);
CREATE INDEX IF NOT EXISTS challenge_winners_profile_idx ON challenge_winners (profile_id);
