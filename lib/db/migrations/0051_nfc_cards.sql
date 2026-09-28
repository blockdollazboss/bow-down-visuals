-- 0051: NFC business-card line (dropship model).
-- nfc_profiles: buyer's digital card — the tap/QR destination at /c/:slug.
-- nfc_card_orders: the physical card order sent to the manufacturer.
-- Statuses stay honest: only "received" / "pending_fulfillment" until a real
-- fulfillment integration reports otherwise.

CREATE TABLE IF NOT EXISTS nfc_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  title TEXT,
  bio TEXT,
  avatar_url TEXT,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  theme TEXT NOT NULL DEFAULT 'gold-black',
  tap_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nfc_profiles_user_id_idx ON nfc_profiles (user_id);
CREATE INDEX IF NOT EXISTS nfc_profiles_slug_idx ON nfc_profiles (slug);

CREATE TABLE IF NOT EXISTS nfc_card_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  profile_id UUID REFERENCES nfc_profiles(id) ON DELETE SET NULL,
  card_style TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  shipping_address JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  unit_price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nfc_card_orders_user_id_idx ON nfc_card_orders (user_id);
CREATE INDEX IF NOT EXISTS nfc_card_orders_status_idx ON nfc_card_orders (status);
CREATE INDEX IF NOT EXISTS nfc_card_orders_created_at_idx ON nfc_card_orders (created_at DESC);

-- One row per physical card: each card gets its own profile (unique slug,
-- unique NFC URL + QR). Multi-quantity orders fan out into N cards here.
CREATE TABLE IF NOT EXISTS nfc_order_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES nfc_card_orders(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES nfc_profiles(id) ON DELETE CASCADE,
  card_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, card_index)
);
CREATE INDEX IF NOT EXISTS nfc_order_cards_order_id_idx ON nfc_order_cards (order_id);
