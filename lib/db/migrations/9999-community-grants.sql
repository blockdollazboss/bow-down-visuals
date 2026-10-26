-- 9999 (PROVISIONAL — integrator renumbers at join): Community Grants
-- (Stack-200 N15).
--
-- A MONTHLY Visual Bucs pool funds ONE creator project, chosen by
-- COMMUNITY VOTE. VB ONLY, never cash (standing payout law).
--
-- Distinct mechanisms, deliberately NOT merged: this is not the
-- jackpot (admin-run code event), not the quest pool (≤300 VB/wk
-- shared envelope for quests + King gifts + tutorial — no draw from
-- it here), and not contests (prize winners).
--
-- The pool size is an ADMIN-ENTERED parameter recorded on the round
-- (pool_vb) — no figure is hardcoded in code, copy, or this migration.
-- One round per month (month_key UNIQUE). Submission and voting
-- windows are round fields set at creation.
--
-- Candidates: one project per creator per round (unique index),
-- stated in the creator's own words (title + description), tied to
-- their real account. The funded creator's report-back lands on the
-- candidate row (report_back / report_back_at); null = still owed.
--
-- Votes: ONE row per member per round — UNIQUE (round_id, voter_id).
-- A changed vote replaces the candidate on the same row. Tallies are
-- fresh COUNTs of these rows on every read; there is no counter
-- column to drift or fake.
--
-- Result: winner = most real votes at settle. TIE ⇒ result_status =
-- 'tie', NO winner, NO payout — the pool holds for admin resolution
-- (an admin may extend the voting window, returning the round to
-- 'pending'). Payout is exactly once: the round's grant_status claim
-- flip plus a strict credit_usage ledger row keyed
-- 'community-grant:<round_id>' (see lib/community-grants.ts).
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS community_grant_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_key text NOT NULL,
  pool_vb integer NOT NULL,
  submissions_open_at timestamptz NOT NULL,
  submissions_close_at timestamptz NOT NULL,
  voting_open_at timestamptz NOT NULL,
  voting_close_at timestamptz NOT NULL,
  result_status text NOT NULL DEFAULT 'pending',
  winner_candidate_id uuid,
  grant_status text NOT NULL DEFAULT 'none',
  grant_paid_at timestamptz,
  settled_at timestamptz,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_grant_rounds_pool_check CHECK (pool_vb > 0),
  CONSTRAINT community_grant_rounds_result_check CHECK (result_status IN ('pending', 'winner', 'tie', 'no_candidates')),
  CONSTRAINT community_grant_rounds_grant_check CHECK (grant_status IN ('none', 'paid'))
);
CREATE UNIQUE INDEX IF NOT EXISTS community_grant_rounds_month_uidx
  ON community_grant_rounds (month_key);
CREATE INDEX IF NOT EXISTS community_grant_rounds_created_idx
  ON community_grant_rounds (created_at);

CREATE TABLE IF NOT EXISTS community_grant_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  creator_name text NOT NULL DEFAULT 'Creator',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  report_back text,
  report_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_grant_candidates_one_per_creator_uidx
  ON community_grant_candidates (round_id, creator_user_id);
CREATE INDEX IF NOT EXISTS community_grant_candidates_round_idx
  ON community_grant_candidates (round_id, created_at);

CREATE TABLE IF NOT EXISTS community_grant_votes (
  round_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  voter_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_grant_votes_one_per_voter_uidx
  ON community_grant_votes (round_id, voter_id);
CREATE INDEX IF NOT EXISTS community_grant_votes_candidate_idx
  ON community_grant_votes (candidate_id);
