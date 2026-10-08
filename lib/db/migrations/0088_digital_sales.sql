-- Creator Streaming Platform — Foundation (0088): digital_sales, download_links, dmca_reports.
--
-- digital_sales: paid track/album downloads via Stripe Checkout.
--   platform_fee_cents + creator_amount_cents must equal amount_cents.
-- download_links: single-use-capable tokenized download URLs per sale.
-- dmca_reports: public takedown-report intake (no prior reporting flow
--   existed; reviewed manually by the site operator).
--
-- Idempotent: every statement is safe to re-run.

CREATE TABLE IF NOT EXISTS digital_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id UUID NOT NULL,
  profile_id UUID NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('track', 'album')),
  item_id UUID NOT NULL,
  stripe_session_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  creator_amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS digital_sales_profile_id_idx
  ON digital_sales (profile_id);
CREATE INDEX IF NOT EXISTS digital_sales_buyer_idx
  ON digital_sales (buyer_user_id);

CREATE TABLE IF NOT EXISTS download_links (
  token TEXT PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES digital_sales(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS download_links_sale_id_idx
  ON download_links (sale_id);

CREATE TABLE IF NOT EXISTS dmca_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_name TEXT NOT NULL,
  reporter_email TEXT NOT NULL,
  reporter_org TEXT,
  infringing_urls JSONB NOT NULL DEFAULT '[]',
  original_urls JSONB NOT NULL DEFAULT '[]',
  description TEXT NOT NULL,
  agree_under_penalty TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dmca_reports_status_idx
  ON dmca_reports (status);
