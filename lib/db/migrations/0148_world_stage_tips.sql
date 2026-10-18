-- 0148: World stage tips (Ring 3, program item 3.3).
--
-- The ledger of Visual Bucs tips from a seat to the stage performer
-- inside a World room. One row per landed tip, keyed by the
-- transfer's scoped charge idempotency key so a resumed transfer
-- finds its row instead of paying twice. creator_credited_at
-- stamps when the performer's credit landed.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS world_stage_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id text NOT NULL,
  to_user_id text NOT NULL,
  amount_vb integer NOT NULL,
  room_id text NOT NULL,
  idempotency_key text NOT NULL,
  creator_credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT world_stage_tips_amount_positive CHECK (amount_vb > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS world_stage_tips_key_uq
  ON world_stage_tips (idempotency_key);

CREATE INDEX IF NOT EXISTS world_stage_tips_to_user_idx
  ON world_stage_tips (to_user_id, created_at);
