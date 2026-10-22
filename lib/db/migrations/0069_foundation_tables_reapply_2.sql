-- 0069 — foundation tables reapply #2 (the ≤55-created tables the runner
-- can never apply on a schema'd database).
--
-- WHY THIS FILE EXISTS (2026-10-21 production boot failure, attempt 2):
-- With 0063_foundation_tables_reapply.sql in place, production's boot got
-- past 0065/0067/0068/0069 and died at 0070_press_releases.sql:
-- relation "press_kits" does not exist.
--
-- ROOT CAUSE (same class as 0065, wider than fix #1's audit assumed):
-- migrate-boot.mjs skips every file <= BASELINE (55) on any database that
-- already carries the schema (credit_usage canary), on the doctrine that
-- those files "were applied manually." Production's manual-era database
-- never actually received a set of foundation tables whose ONLY creation
-- statements live in files <= 0055 — they reached staging via the retired
-- drizzle-kit push, and no file > 0055 ever wrote them down. Fix #1's
-- audit treated "created by some file <= first touch" as safe, which is
-- exactly backwards for production: a <= 0055 creation NEVER RUNS there.
--
-- THE CORRECTED RULE used for this file's audit: a relation touched by any
-- still-pending migration (0070–0203 on production) is production-safe
-- ONLY if it is created by (a) a file > 0055 that production has applied
-- or will apply before the first touch, (b) the touching file itself, or
-- (c) 0063_foundation_tables_reapply.sql. Everything else is a gap.
-- Audited touch forms: ALTER TABLE, CREATE INDEX ON, INSERT INTO, UPDATE,
-- DELETE FROM, REFERENCES, FROM/JOIN in raw SQL, TRUNCATE, DROP TABLE.
--
-- THE GAPS (18) — creation source in parentheses:
--   songs (0001), distribution_releases (0011), playlist_pitches (0014),
--   email_lists / email_subscribers / email_campaigns (0015),
--   fan_tiers / fan_members (0016), press_kits (0017),
--   shoutout_requests (0020), live_shop_sales (0021), beat_licenses (0026),
--   shops / shop_products (0030), shop_events (0031),
--   sponsor_payouts (0033), generations (0044), jewelry_orders (0052).
-- Plus their foreign-key targets, also created only <= 0055, without which
-- the verbatim CREATEs above would fail on the FK itself:
--   beats (0026), live_shop_products / live_shop_streams (0021),
--   sponsor_deals (0010).
-- NOT gaps, deliberately excluded: distribution_royalty_splits and
-- scheduled_posts (re-created by ledger-applied 0057 / 0058 reapplies),
-- contact_messages (0123 creates it; its only earlier touch, 0116, is
-- ALTER TABLE IF EXISTS), hub_projects + artist_vaults (0063 reapply).
--
-- CONTENTS: each table's CREATE is copied VERBATIM from its original file,
-- followed by every pre-0070 idempotent column addition that targeted it
-- (0034's distribution_releases block — identical in 0057; 0031's shops
-- columns; 0033's sponsor_deals columns; 0067's songs columns) and every
-- pre-0070 index on it, all in their original IF NOT EXISTS forms. NO data
-- statements are replayed (e.g. 0054's generations UPDATE is a one-time
-- data migration; re-running it would multiply values a second time).
--
-- WHY 0069: the number's only occupant is 0069_albums.sql. A 0069 file
-- (a) is > BASELINE, so the runner applies it on production; (b) sorts
-- before 0070_press_releases.sql, the first pending consumer; (c) is in
-- no database's data_migrations ledger, so it runs exactly once
-- everywhere. Every statement is IF NOT EXISTS, so on staging — where all
-- of these tables already exist in their final shapes — and on any fresh
-- database (where the <= 0055 originals run first), this file is a
-- harmless no-op.
--
-- PROOF: production's condition was simulated faithfully on a scratch
-- Postgres 16 — schema built from files 0001–0069 (manual-era files with
-- era-typical error tolerance, runner-era files strict), the 22 tables
-- above then dropped (outside FK constraints on them dropped first, as
-- their owners' files are already ledger-applied on production),
-- data_migrations seeded with the 0056–0069 filenames (the runner's own
-- ledger format), and the real migrate-boot.mjs run against it: this
-- file applied first, then 0070–0203 — 124 migrations, exit 0, zero
-- missing-relation errors. A second pass on a staging-like database
-- (same prep, no drops, sentinel rows inserted) re-ran this file alone
-- against the populated tables: exit 0, rows untouched — the no-op
-- property holds. (Fix-lane report, 2026-10-21.)

-- ── songs (verbatim from 0001_artist_voice_and_songs.sql) ──
CREATE TABLE IF NOT EXISTS songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  audio_path TEXT,
  source TEXT NOT NULL DEFAULT 'upload',
  parent_song_id UUID,
  artist_vault_id UUID,
  duration_sec TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS mashup_sources JSONB;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS mashup_style TEXT;
CREATE INDEX IF NOT EXISTS songs_user_id_idx ON songs (user_id);

-- ── beats (verbatim from 0026_beats.sql) ──
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

-- ── beat_licenses (verbatim from 0026_beats.sql) ──
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

-- ── distribution_releases (verbatim from 0011_distribution_releases.sql, plus 0034's column block) ──
CREATE TABLE IF NOT EXISTS distribution_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  release_date TEXT,
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  audio_url TEXT,
  artwork_url TEXT,
  metadata JSONB,
  strategy JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  credits_charged INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE distribution_releases
  ADD COLUMN IF NOT EXISTS release_type text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS isrc text,
  ADD COLUMN IF NOT EXISTS genre text,
  ADD COLUMN IF NOT EXISTS explicit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS explicit_declared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upc text,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS copyright_line text,
  ADD COLUMN IF NOT EXISTS song_id uuid,
  ADD COLUMN IF NOT EXISTS tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS aggregator text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS aggregator_release_id text,
  ADD COLUMN IF NOT EXISTS platform_statuses jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS presave_slug text UNIQUE;
CREATE INDEX IF NOT EXISTS distribution_releases_user_idx ON distribution_releases (user_id);

-- ── email_lists (verbatim from 0015_email_lists.sql) ──
CREATE TABLE IF NOT EXISTS email_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  description TEXT,
  welcome_subject TEXT,
  welcome_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_lists_user_id_idx
  ON email_lists (user_id);

-- ── email_subscribers (verbatim from 0015_email_lists.sql) ──
CREATE TABLE IF NOT EXISTS email_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES email_lists(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  source TEXT NOT NULL DEFAULT 'landing',
  confirmed BOOLEAN NOT NULL DEFAULT TRUE,
  opens INTEGER NOT NULL DEFAULT 0,
  unsubscribed_at TIMESTAMPTZ,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (list_id, email)
);
CREATE INDEX IF NOT EXISTS email_subscribers_list_id_idx
  ON email_subscribers (list_id);

-- ── email_campaigns (verbatim from 0015_email_lists.sql) ──
CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES email_lists(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  open_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_campaigns_list_id_idx
  ON email_campaigns (list_id);

-- ── fan_tiers (verbatim from 0016_fan_memberships.sql) ──
CREATE TABLE IF NOT EXISTS fan_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  perks JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active TEXT NOT NULL DEFAULT 'true',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fan_tiers_user_id_idx
  ON fan_tiers (user_id);

-- ── fan_members (verbatim from 0016_fan_memberships.sql) ──
CREATE TABLE IF NOT EXISTS fan_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tier_id UUID NOT NULL,
  fan_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  price_cents INTEGER NOT NULL DEFAULT 0,
  external_ref TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fan_members_user_id_idx
  ON fan_members (user_id);
CREATE INDEX IF NOT EXISTS fan_members_tier_id_idx
  ON fan_members (tier_id);
CREATE UNIQUE INDEX IF NOT EXISTS fan_members_tier_fan_ux
  ON fan_members (tier_id, fan_label);

-- ── press_kits (verbatim from 0017_press_kits.sql) ──
CREATE TABLE IF NOT EXISTS press_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  artist_name TEXT NOT NULL,
  tagline TEXT,
  bio TEXT,
  genre TEXT,
  location TEXT,
  booking_email TEXT,
  website TEXT,
  instagram_url TEXT,
  tiktok_url TEXT,
  youtube_url TEXT,
  spotify_url TEXT,
  achievements JSONB NOT NULL DEFAULT '[]'::jsonb,
  press_quotes JSONB NOT NULL DEFAULT '[]'::jsonb,
  photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
  artist_vault_id UUID,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS press_kits_user_id_idx ON press_kits (user_id);
CREATE INDEX IF NOT EXISTS press_kits_handle_idx ON press_kits (handle);

-- ── playlist_pitches (verbatim from 0014_playlist_pitch.sql) ──
CREATE TABLE IF NOT EXISTS playlist_pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  song_title TEXT NOT NULL,
  artist_name TEXT,
  curator_name TEXT,
  playlist_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  notes TEXT,
  contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS playlist_pitches_user_id_idx
  ON playlist_pitches (user_id);
CREATE INDEX IF NOT EXISTS playlist_pitches_user_status_idx
  ON playlist_pitches (user_id, status);

-- ── shoutout_requests (verbatim from 0020_fan_shoutouts.sql) ──
CREATE TABLE IF NOT EXISTS shoutout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id UUID NOT NULL,
  fan_name TEXT NOT NULL,
  fan_email TEXT,
  occasion TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  price_cents INTEGER NOT NULL DEFAULT 0,
  delivery_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS shoutout_requests_creator_idx
  ON shoutout_requests (creator_user_id);
CREATE INDEX IF NOT EXISTS shoutout_requests_status_idx
  ON shoutout_requests (status);

-- ── live_shop_products (verbatim from 0021_live_shopping.sql) ──
CREATE TABLE IF NOT EXISTS live_shop_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  image_url TEXT,
  external_url TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS live_shop_products_user_id_idx
  ON live_shop_products (user_id);

-- ── live_shop_streams (verbatim from 0021_live_shopping.sql) ──
CREATE TABLE IF NOT EXISTS live_shop_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  pinned_product_id UUID REFERENCES live_shop_products(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS live_shop_streams_user_id_idx
  ON live_shop_streams (user_id);

-- ── live_shop_sales (verbatim from 0021_live_shopping.sql) ──
CREATE TABLE IF NOT EXISTS live_shop_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stream_id UUID REFERENCES live_shop_streams(id) ON DELETE SET NULL,
  product_id UUID REFERENCES live_shop_products(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  platform_fee_cents INTEGER NOT NULL CHECK (platform_fee_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS live_shop_sales_user_id_idx
  ON live_shop_sales (user_id);
CREATE INDEX IF NOT EXISTS live_shop_sales_stream_id_idx
  ON live_shop_sales (stream_id);

-- ── shops (verbatim from 0030_customer_shops.sql) ──
CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  tagline TEXT,
  description TEXT,
  banner_color TEXT NOT NULL DEFAULT '#0a0a0a',
  accent_color TEXT NOT NULL DEFAULT '#d4af37',
  banner_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS domain_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS domain_verification_token TEXT;
CREATE INDEX IF NOT EXISTS shops_user_id_idx
  ON shops (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS shops_custom_domain_unique_idx
  ON shops (custom_domain) WHERE custom_domain IS NOT NULL;

-- ── shop_products (verbatim from 0030_customer_shops.sql) ──
CREATE TABLE IF NOT EXISTS shop_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  image_url TEXT,
  image_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shop_products_shop_id_idx
  ON shop_products (shop_id);
CREATE INDEX IF NOT EXISTS shop_products_user_id_idx
  ON shop_products (user_id);

-- ── shop_events (verbatim from 0031_shop_domains_events.sql) ──
CREATE TABLE IF NOT EXISTS shop_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  product_id UUID,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  buyer_email TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shop_events_shop_id_idx
  ON shop_events (shop_id);
CREATE INDEX IF NOT EXISTS shop_events_shop_type_time_idx
  ON shop_events (shop_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_events_view_dedup_idx
  ON shop_events (shop_id, ip_hash, created_at DESC)
  WHERE event_type = 'view' AND ip_hash IS NOT NULL;

-- ── sponsor_deals (verbatim from 0010_sponsor_deals.sql) ──
CREATE TABLE IF NOT EXISTS sponsor_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name TEXT NOT NULL,
  budget_min INTEGER NOT NULL,
  budget_max INTEGER NOT NULL,
  niche TEXT NOT NULL,
  deliverables TEXT NOT NULL,
  description TEXT NOT NULL,
  deadline TIMESTAMPTZ NOT NULL,
  posted_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS agreed_amount_cents INTEGER;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS escrow_status TEXT NOT NULL DEFAULT 'unfunded';
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS creator_payout_cents INTEGER;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS accepted_application_id UUID;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS accepted_user_id TEXT;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS sponsor_deals_status_idx ON sponsor_deals (status);
CREATE INDEX IF NOT EXISTS sponsor_deals_niche_idx ON sponsor_deals (niche);
CREATE INDEX IF NOT EXISTS sponsor_deals_posted_by_idx ON sponsor_deals (posted_by);
CREATE INDEX IF NOT EXISTS sponsor_deals_escrow_status_idx ON sponsor_deals (escrow_status);
CREATE INDEX IF NOT EXISTS sponsor_deals_accepted_user_idx ON sponsor_deals (accepted_user_id);

-- ── sponsor_payouts (verbatim from 0033_sponsor_escrow.sql) ──
CREATE TABLE IF NOT EXISTS sponsor_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES sponsor_deals(id) ON DELETE CASCADE,
  creator_user_id TEXT NOT NULL,
  gross_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  net_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'released',
  stripe_transfer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deal_id)
);
CREATE INDEX IF NOT EXISTS sponsor_payouts_creator_idx ON sponsor_payouts (creator_user_id);
CREATE INDEX IF NOT EXISTS sponsor_payouts_deal_idx ON sponsor_payouts (deal_id);

-- ── generations (verbatim from 0044_generation_history.sql) ──
CREATE TABLE IF NOT EXISTS generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL, -- 'image', 'video', 'song', 'voice', etc.
  title TEXT,
  file_url TEXT,
  thumbnail_url TEXT,
  prompt TEXT,
  credits_spent INTEGER NOT NULL DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Soft delete: never permanently lose user data
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_generations_user_created
  ON generations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_user_type
  ON generations (user_id, type);

-- ── jewelry_orders (verbatim from 0052_jewelry_orders.sql) ──
CREATE TABLE IF NOT EXISTS jewelry_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  finish TEXT NOT NULL,
  size_option TEXT NOT NULL,
  engraving TEXT,
  design_notes TEXT,
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
CREATE INDEX IF NOT EXISTS jewelry_orders_user_id_idx ON jewelry_orders (user_id);
CREATE INDEX IF NOT EXISTS jewelry_orders_status_idx ON jewelry_orders (status);
CREATE INDEX IF NOT EXISTS jewelry_orders_created_at_idx ON jewelry_orders (created_at DESC);