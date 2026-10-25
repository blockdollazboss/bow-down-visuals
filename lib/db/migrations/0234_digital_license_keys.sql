-- 0234: Digital license keys + per-buyer download limits (Wave 4 #35).
-- A seller can opt a digital-store item into license keys: each purchase
-- of that item issues the buyer ONE unique key (unique per sale + item),
-- the seller sets a per-buyer download cap, downloads are counted on the
-- key (not per link — refreshing a link can never reset the count), and
-- the seller can revoke or re-issue a key. A refund revokes the key via
-- the payment-reversals clawback (same case that expires download links).
--
-- Settings ride a keyed table (item_kind, item_id) — the same pattern as
-- digital_bump_offers (0219): store items span several catalog tables,
-- so per-item settings live in one place instead of columns everywhere.
--
-- Keys are stored as a SHA-256 hash (lookup/verification) plus an
-- AES-256-GCM ciphertext the buyer's library decrypts for display, plus
-- the final group in the clear for seller-side masked display. The full
-- key never appears in a log line.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS digital_product_settings (
  item_kind            text NOT NULL,
  item_id              uuid NOT NULL,
  license_keys_enabled boolean NOT NULL DEFAULT false,
  max_downloads        integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_kind, item_id),
  CHECK (max_downloads IS NULL OR (max_downloads >= 1 AND max_downloads <= 100000))
);

CREATE TABLE IF NOT EXISTS digital_license_keys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id        uuid NOT NULL REFERENCES digital_sales(id) ON DELETE CASCADE,
  profile_id     uuid NOT NULL,
  buyer_user_id  uuid NOT NULL,
  item_kind      text NOT NULL,
  item_id        uuid NOT NULL,
  item_title     text NOT NULL DEFAULT '',
  file_url       text NOT NULL,
  key_hash       text NOT NULL UNIQUE,
  key_cipher     text NOT NULL,
  key_suffix     text NOT NULL,
  max_downloads  integer,
  download_count integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'active',
  revoked_at     timestamptz,
  revoked_reason text,
  reissue_count  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('active', 'revoked')),
  CHECK (max_downloads IS NULL OR (max_downloads >= 1 AND max_downloads <= 100000)),
  UNIQUE (sale_id, item_kind, item_id)
);

CREATE INDEX IF NOT EXISTS digital_license_keys_product_idx
  ON digital_license_keys (profile_id, item_kind, item_id);
CREATE INDEX IF NOT EXISTS digital_license_keys_buyer_idx
  ON digital_license_keys (buyer_user_id);
CREATE INDEX IF NOT EXISTS digital_license_keys_sale_idx
  ON digital_license_keys (sale_id);
