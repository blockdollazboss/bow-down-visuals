-- 9999 (PROVISIONAL — integrator renumbers at join): Loop Exchange
-- (Stack-200 Wave 2, idea #168). Loops/hooks posted for others to
-- build on; split terms agreed up front on the existing splits rail
-- (the sale-splits sum-to-100 machine validates the build's list);
-- the original poster is credited and paid per the agreed split on
-- EVERY downstream sale of a build. TEST MODE, Visual Bucs only,
-- never cash. Exactly-once: loop_exchange_sales.sale_ref is UNIQUE
-- and loop_exchange_split_ledger is UNIQUE on (sale_id,
-- recipient_user_id), so a downstream sale can only ever pay once.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS loop_exchange_loops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_user_id uuid NOT NULL,
  poster_profile_id uuid,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  audio_url text NOT NULL,
  bpm integer,
  musical_key text,
  duration_seconds integer,
  poster_share_pct numeric(5,2) NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_exchange_loops_status_check CHECK (status IN ('open', 'paused', 'closed')),
  CONSTRAINT loop_exchange_loops_share_check CHECK (poster_share_pct > 0 AND poster_share_pct < 100)
);
CREATE INDEX IF NOT EXISTS loop_exchange_loops_poster_idx ON loop_exchange_loops (poster_user_id, status);
CREATE INDEX IF NOT EXISTS loop_exchange_loops_status_idx ON loop_exchange_loops (status, created_at);

CREATE TABLE IF NOT EXISTS loop_exchange_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id uuid NOT NULL REFERENCES loop_exchange_loops(id) ON DELETE CASCADE,
  builder_user_id uuid NOT NULL,
  builder_profile_id uuid,
  title text NOT NULL,
  audio_url text,
  splits jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending_terms',
  agreed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_exchange_builds_status_check CHECK (status IN ('pending_terms', 'agreed', 'declined'))
);
CREATE INDEX IF NOT EXISTS loop_exchange_builds_loop_idx ON loop_exchange_builds (loop_id, status);
CREATE INDEX IF NOT EXISTS loop_exchange_builds_builder_idx ON loop_exchange_builds (builder_user_id, status);

CREATE TABLE IF NOT EXISTS loop_exchange_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL REFERENCES loop_exchange_builds(id) ON DELETE CASCADE,
  loop_id uuid NOT NULL REFERENCES loop_exchange_loops(id) ON DELETE CASCADE,
  sale_ref text NOT NULL,
  buyer_user_id uuid,
  recorded_by_user_id uuid NOT NULL,
  gross_vb integer NOT NULL,
  fee_vb integer NOT NULL DEFAULT 0,
  net_vb integer NOT NULL DEFAULT 0,
  test_mode boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_exchange_sales_gross_check CHECK (gross_vb > 0),
  CONSTRAINT loop_exchange_sales_net_check CHECK (net_vb >= 0 AND fee_vb >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS loop_exchange_sales_ref_ux ON loop_exchange_sales (sale_ref);
CREATE INDEX IF NOT EXISTS loop_exchange_sales_build_idx ON loop_exchange_sales (build_id, created_at);
CREATE INDEX IF NOT EXISTS loop_exchange_sales_loop_idx ON loop_exchange_sales (loop_id, created_at);

CREATE TABLE IF NOT EXISTS loop_exchange_split_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES loop_exchange_sales(id) ON DELETE CASCADE,
  build_id uuid NOT NULL,
  loop_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'collaborator',
  share_pct numeric(5,2) NOT NULL,
  amount_vb integer NOT NULL DEFAULT 0,
  credit_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_exchange_split_ledger_role_check CHECK (role IN ('loop_poster', 'builder', 'collaborator')),
  CONSTRAINT loop_exchange_split_ledger_amount_check CHECK (amount_vb >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS loop_exchange_split_ledger_sale_recipient_ux ON loop_exchange_split_ledger (sale_id, recipient_user_id);
CREATE INDEX IF NOT EXISTS loop_exchange_split_ledger_recipient_idx ON loop_exchange_split_ledger (recipient_user_id, created_at);
CREATE INDEX IF NOT EXISTS loop_exchange_split_ledger_loop_idx ON loop_exchange_split_ledger (loop_id, created_at);
