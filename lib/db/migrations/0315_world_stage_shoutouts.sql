-- 0315: World stage shoutouts (Ring 3, program item 3.3 remainder).
--
-- The ledger of Visual Bucs shoutouts bought from a seat for the
-- stage performer inside a World room — the paid half of the stage
-- applause pair (stage tips are migration 0148). One row per landed
-- shoutout, keyed by the transfer's scoped charge idempotency key
-- so a resumed transfer finds its row instead of paying twice.
--
-- The price is the performer's own shoutout price (shoutout_settings
-- on the site rail), charged in Visual Bucs at that number; the
-- split is the shoutout rail's flat 5%: amount_vb is the gross the
-- fan paid, net_vb is what the performer was credited, fee_vb is
-- the platform's cut (amount = fee + net, always). A free shoutout
-- (the performer's price is 0) lands with all three at 0.
-- creator_credited_at stamps when the performer's credit landed;
-- a standing row with it null is an in-flight (or crashed) transfer
-- the resume gate completes rather than duplicates.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS world_stage_shoutouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id text NOT NULL,
  to_user_id text NOT NULL,
  amount_vb integer NOT NULL,
  fee_vb integer NOT NULL,
  net_vb integer NOT NULL,
  message text NOT NULL,
  room_id text NOT NULL,
  idempotency_key text NOT NULL,
  creator_credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT world_stage_shoutouts_amount_nonnegative CHECK (amount_vb >= 0),
  CONSTRAINT world_stage_shoutouts_split_adds_up CHECK (fee_vb + net_vb = amount_vb)
);

CREATE UNIQUE INDEX IF NOT EXISTS world_stage_shoutouts_key_uq
  ON world_stage_shoutouts (idempotency_key);

CREATE INDEX IF NOT EXISTS world_stage_shoutouts_to_user_idx
  ON world_stage_shoutouts (to_user_id, created_at);
