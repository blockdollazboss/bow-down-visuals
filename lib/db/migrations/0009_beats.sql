-- Beat Marketplace — beats listings + license purchases.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- v1 honesty: beat_licenses.status starts as 'pending_payment' — payment
-- processing is coming soon, so no row may be 'completed' yet.

CREATE TABLE IF NOT EXISTS beats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  audio_path TEXT,
  preview_url TEXT,
  genre TEXT NOT NULL DEFAULT 'hip-hop',
  bpm INTEGER,
  musical_key TEXT,
  mood_tags TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  basic_price_cents INTEGER NOT NULL DEFAULT 2999,
  premium_price_cents INTEGER NOT NULL DEFAULT 9999,
  exclusive_price_cents INTEGER NOT NULL DEFAULT 49999,
  exclusive_sold BOOLEAN NOT NULL DEFAULT FALSE,
  plays INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS beats_user_id_idx ON beats (user_id);
CREATE INDEX IF NOT EXISTS beats_genre_idx ON beats (genre);
CREATE INDEX IF NOT EXISTS beats_created_at_idx ON beats (created_at DESC);

CREATE TABLE IF NOT EXISTS beat_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_id UUID NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL,
  producer_id UUID NOT NULL,
  tier TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  commission_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS beat_licenses_beat_id_idx ON beat_licenses (beat_id);
CREATE INDEX IF NOT EXISTS beat_licenses_buyer_id_idx ON beat_licenses (buyer_id);
CREATE INDEX IF NOT EXISTS beat_licenses_producer_id_idx ON beat_licenses (producer_id);
