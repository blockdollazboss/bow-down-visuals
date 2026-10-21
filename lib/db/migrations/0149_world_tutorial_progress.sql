-- 0149: "Your First 10 Minutes" tutorial progress (Ring 3, Phase 6).
--
-- One row per member: where they stand in the seven-step
-- first-session quest line, which step keys are done, when the
-- line completed, and the completion reward's stamp (the reward
-- rides the shared <=300 VB/week quest pool, counted from
-- reward_amount_vb + reward_claimed_at).
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS world_tutorial_progress (
  user_id uuid PRIMARY KEY,
  current_step integer NOT NULL DEFAULT 1,
  completed_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamptz,
  reward_amount_vb integer,
  reward_claimed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
