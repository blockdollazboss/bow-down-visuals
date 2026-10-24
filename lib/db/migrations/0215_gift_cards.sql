-- 0215: Creator-store gift cards (Stack-100 #3, #26) — a gift card is a
-- store_products row of the new kind 'gift_card'; buying one is a normal
-- storefront purchase whose delivery is a code. The card is STORED VALUE
-- for that creator's store only (both rails: creator store + customer
-- shops): at checkout it tenders against the total like partial cash.
-- Balance law: balance_cents is the source of truth; reserved_cents is
-- the sum of ACTIVE reservation holds (checked out, not yet settled);
-- spendable = balance - reserved, never negative. Debits happen once,
-- at settlement, inside lib/gift-cards.ts.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE store_products
  ADD COLUMN IF NOT EXISTS gift_card_denominations_cents jsonb;

-- Kind widening (the check is named by Postgres: store_products_kind_check).
-- JOIN NOTE (Stack-100 #3): this list is the full union at this point in
-- the migration sequence — base kinds + 'course' (0214) + 'gift_card'.
DO $$ BEGIN
  ALTER TABLE store_products DROP CONSTRAINT IF EXISTS store_products_kind_check;
  ALTER TABLE store_products ADD CONSTRAINT store_products_kind_check
    CHECK (kind IN ('download','merch','digital','service','ticket','course','gift_card'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  code_last4 text NOT NULL,
  initial_cents integer NOT NULL,
  balance_cents integer NOT NULL,
  reserved_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'active',
  buyer_user_id uuid,
  buyer_email text,
  recipient_email text,
  recipient_name text,
  message text,
  source_order_id uuid REFERENCES store_orders(id) ON DELETE SET NULL,
  source_session_id text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_cards_status_check CHECK (status IN ('active','depleted','void','expired')),
  CONSTRAINT gift_cards_initial_check CHECK (initial_cents > 0),
  CONSTRAINT gift_cards_balance_check CHECK (balance_cents >= 0),
  CONSTRAINT gift_cards_reserved_check CHECK (reserved_cents >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_code_hash_ux ON gift_cards (code_hash);
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_source_session_ux
  ON gift_cards (source_session_id) WHERE source_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gift_cards_profile_idx ON gift_cards (profile_id, created_at);
CREATE INDEX IF NOT EXISTS gift_cards_recipient_idx ON gift_cards (recipient_email);

CREATE TABLE IF NOT EXISTS gift_card_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  entry_type text NOT NULL,
  amount_cents integer NOT NULL,
  balance_after_cents integer NOT NULL,
  ref text,
  actor_user_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_card_ledger_type_check
    CHECK (entry_type IN ('issue','reserve','release','redeem','refund','void','expire'))
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_ledger_ref_ux
  ON gift_card_ledger (card_id, entry_type, ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS gift_card_ledger_card_idx ON gift_card_ledger (card_id, created_at);

CREATE TABLE IF NOT EXISTS gift_card_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  rail text NOT NULL,
  ref text NOT NULL,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT gift_card_reservations_rail_check CHECK (rail IN ('storefront','shop')),
  CONSTRAINT gift_card_reservations_status_check CHECK (status IN ('active','redeemed','released','expired')),
  CONSTRAINT gift_card_reservations_amount_check CHECK (amount_cents > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_reservations_rail_ref_ux
  ON gift_card_reservations (rail, ref);
CREATE INDEX IF NOT EXISTS gift_card_reservations_card_idx ON gift_card_reservations (card_id, status);
CREATE INDEX IF NOT EXISTS gift_card_reservations_expiry_idx
  ON gift_card_reservations (status, expires_at);
