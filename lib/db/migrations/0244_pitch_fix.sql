-- 0244: Pitch & Fix intake + Feedback Pop-Up state (Stack-200
-- UPGRADES 196 + 180).
--
-- One intake table for idea pitches, fix reports, and Feedback Pop-Up
-- submissions (feedback is fix-side intake: it surfaces on the Fix
-- Board after moderation). MODERATION GATE: every row is born
-- moderation_status = 'pending'; only rows a team member approves
-- through the admin surface ever appear on the public boards.
--
-- Team-set statuses only:
--   pitch:         reviewing / approved / building / shipped
--   fix + feedback: received / confirmed / fixing / fixed
--
-- pitch_fix_votes backs the Pitch Board upvote (one vote per member
-- per pitch, enforced by the unique index).
--
-- feedback_prompt_prefs is the per-account Feedback Pop-Up state: the
-- Settings ON/OFF toggle (default ON) and last_prompted_at, which the
-- hard cap reads — a prompt may show at most once per 7 days per
-- account, counted from the SHOWING (submit or dismiss alike).
--
-- NO PRICES: this section sells nothing and charges nothing.
--
-- REWARDS (owner ruling, Oct 25, 18:12 EDT; the adopted recommendation
-- in pitch-fix-reward-recommendation.md): shipped pitch = 500 VB to
-- the pitcher; fixed fix/feedback report = 100 VB to the first
-- reporter (250 VB when severity is blocks_me). Paid ONLY on the
-- team-set Shipped/Fixed transition, exactly once per item, from ONE
-- shared 1,000 VB/week pool (separate from the quest pool's 300/wk).
-- Over-cap rewards queue into the next week — queued, never lost.
-- reward_status: none / queued / paid / ineligible (a duplicate of an
-- earlier item, pointed at by duplicate_of_id — first voice only).
-- Visual Bucs only, never cash. Grants land through the referral
-- pattern: claim -> addCreditsAtomic -> strict credit_usage ledger row
-- keyed pitch-fix-reward:<submission_id>; failure claws back and
-- releases the claim to queued so a later run retries it.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS pitch_fix_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  source text NOT NULL DEFAULT 'door',
  submitter_user_id uuid NOT NULL,
  submitter_name text NOT NULL DEFAULT 'Creator',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  why text,
  category text,
  page text,
  severity text,
  rating integer,
  status text NOT NULL,
  moderation_status text NOT NULL DEFAULT 'pending',
  upvote_count integer NOT NULL DEFAULT 0,
  moderated_by_user_id uuid,
  moderated_at timestamptz,
  shipped_at timestamptz,
  reward_status text NOT NULL DEFAULT 'none',
  reward_amount integer,
  reward_queued_at timestamptz,
  reward_paid_at timestamptz,
  duplicate_of_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pitch_fix_submissions_kind_check CHECK (kind IN ('pitch', 'fix', 'feedback')),
  CONSTRAINT pitch_fix_submissions_source_check CHECK (source IN ('door', 'feedback_popup')),
  CONSTRAINT pitch_fix_submissions_category_check CHECK (category IS NULL OR category IN ('create', 'world', 'money', 'social', 'other')),
  CONSTRAINT pitch_fix_submissions_page_check CHECK (page IS NULL OR page IN ('video_editor', 'make_song_video', 'audio_studio', 'thumbnail_studio', 'branding_kit', 'the_world', 'go_live', 'earnings', 'profile', 'somewhere_else')),
  CONSTRAINT pitch_fix_submissions_severity_check CHECK (severity IS NULL OR severity IN ('blocks_me', 'annoying', 'small')),
  CONSTRAINT pitch_fix_submissions_rating_check CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  CONSTRAINT pitch_fix_submissions_status_check CHECK (status IN ('reviewing', 'approved', 'building', 'shipped', 'received', 'confirmed', 'fixing', 'fixed')),
  CONSTRAINT pitch_fix_submissions_moderation_check CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT pitch_fix_submissions_reward_status_check CHECK (reward_status IN ('none', 'queued', 'paid', 'ineligible'))
);

CREATE INDEX IF NOT EXISTS pitch_fix_submissions_board_idx
  ON pitch_fix_submissions (moderation_status, kind, status, created_at);
CREATE INDEX IF NOT EXISTS pitch_fix_submissions_submitter_idx
  ON pitch_fix_submissions (submitter_user_id, created_at);
CREATE INDEX IF NOT EXISTS pitch_fix_submissions_reward_idx
  ON pitch_fix_submissions (reward_status, reward_queued_at);

-- Re-runs on a database where the first 0244 shape already landed add
-- the reward columns idempotently (no-op where they already exist).
ALTER TABLE pitch_fix_submissions ADD COLUMN IF NOT EXISTS reward_status text NOT NULL DEFAULT 'none';
ALTER TABLE pitch_fix_submissions ADD COLUMN IF NOT EXISTS reward_amount integer;
ALTER TABLE pitch_fix_submissions ADD COLUMN IF NOT EXISTS reward_queued_at timestamptz;
ALTER TABLE pitch_fix_submissions ADD COLUMN IF NOT EXISTS reward_paid_at timestamptz;
ALTER TABLE pitch_fix_submissions ADD COLUMN IF NOT EXISTS duplicate_of_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pitch_fix_submissions_reward_status_check') THEN
    ALTER TABLE pitch_fix_submissions ADD CONSTRAINT pitch_fix_submissions_reward_status_check CHECK (reward_status IN ('none', 'queued', 'paid', 'ineligible'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pitch_fix_votes (
  submission_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pitch_fix_votes_unique_idx
  ON pitch_fix_votes (submission_id, user_id);
CREATE INDEX IF NOT EXISTS pitch_fix_votes_submission_idx
  ON pitch_fix_votes (submission_id);

CREATE TABLE IF NOT EXISTS feedback_prompt_prefs (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  last_prompted_at timestamptz,
  prompt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
