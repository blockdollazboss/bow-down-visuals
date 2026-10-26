-- 9999 (PROVISIONAL): Studio-gear orders — Branding Shop studio-gear line
-- (Stack-200 WAVE-1 lane (d), owner ruling Oct 25 2026).
--
-- PROVISIONAL NUMBER: this file ships as 9999 because the lane branched
-- from ecc63098 (migrations through 0244) while other Stack-200 lanes may
-- claim the next real numbers first. Renumber to the next free slot at
-- join time; the SQL is number-agnostic.
--
-- Made-to-order model: no inventory, a partner makes each piece and
-- ships direct. Creator-custom pieces are proof-gated — production
-- starts only after the creator approves the design proof
-- (proof_status = 'approved'); all-house orders are 'not_required'.
-- TEST MODE: test_mode defaults true and the gear checkout never takes
-- a real charge.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS studio_gear_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  items jsonb NOT NULL,
  total_cents integer NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  zip text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  proof_status text NOT NULL DEFAULT 'not_required',
  proof_url text,
  proof_note text,
  paid boolean NOT NULL DEFAULT false,
  test_mode boolean NOT NULL DEFAULT true,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_gear_orders_status_check CHECK (status IN ('received', 'proof_pending', 'proof_sent', 'in_production', 'shipped', 'delivered', 'canceled')),
  CONSTRAINT studio_gear_orders_proof_status_check CHECK (proof_status IN ('not_required', 'pending', 'sent', 'approved', 'revision_requested')),
  CONSTRAINT studio_gear_orders_total_check CHECK (total_cents > 0)
);

CREATE INDEX IF NOT EXISTS studio_gear_orders_user_idx
  ON studio_gear_orders (user_id, created_at);
CREATE INDEX IF NOT EXISTS studio_gear_orders_proof_idx
  ON studio_gear_orders (proof_status, created_at);
