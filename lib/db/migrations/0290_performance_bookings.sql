-- 9999_performance_bookings.sql (PROVISIONAL — renumbered at the stack join)
-- Book the Artist (#158): performance bookings with escrow, on the
-- sponsors escrow pattern (sponsor_deals, migrations 0010 + 0033).
-- Idempotent: safe to re-run. No BEGIN/COMMIT (migrate-boot owns the txn).

CREATE TABLE IF NOT EXISTS performance_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  artist_user_id text NOT NULL,
  artist_name text NOT NULL,
  promoter_user_id text NOT NULL,
  promoter_name text NOT NULL,
  event_title text NOT NULL,
  event_date timestamptz NOT NULL,
  venue_name text NOT NULL,
  venue_address text NOT NULL,
  venue_city text NOT NULL,
  fee_cents integer NOT NULL,
  terms jsonb NOT NULL,
  plain_words text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'proposed',
  escrow_status text NOT NULL DEFAULT 'unfunded',
  stripe_session_id text,
  stripe_payment_intent_id text,
  platform_fee_cents integer,
  artist_payout_cents integer,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_bookings_fee_sane CHECK (fee_cents > 0),
  CONSTRAINT performance_bookings_status_sane CHECK (
    status IN ('proposed', 'accepted', 'funded', 'completed', 'paid', 'declined', 'cancelled')
  ),
  CONSTRAINT performance_bookings_escrow_sane CHECK (
    escrow_status IN ('unfunded', 'funding', 'funded', 'released', 'refunded')
  )
);

CREATE INDEX IF NOT EXISTS performance_bookings_artist_idx
  ON performance_bookings (artist_user_id, status);
CREATE INDEX IF NOT EXISTS performance_bookings_promoter_idx
  ON performance_bookings (promoter_user_id, status);
CREATE INDEX IF NOT EXISTS performance_bookings_profile_idx
  ON performance_bookings (profile_id);
