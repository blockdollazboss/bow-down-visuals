-- Sponsor marketplace — brand deals + creator applications.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- Must stay in sync with lib/db/src/schema/sponsor-deals.ts
-- (boot-time `drizzle-kit push` derives the same shape from the schema).

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

CREATE INDEX IF NOT EXISTS sponsor_deals_status_idx ON sponsor_deals (status);
CREATE INDEX IF NOT EXISTS sponsor_deals_niche_idx ON sponsor_deals (niche);
CREATE INDEX IF NOT EXISTS sponsor_deals_posted_by_idx ON sponsor_deals (posted_by);

CREATE TABLE IF NOT EXISTS sponsor_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES sponsor_deals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  pitch TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deal_id, user_id)
);

CREATE INDEX IF NOT EXISTS sponsor_applications_deal_id_idx ON sponsor_applications (deal_id);
CREATE INDEX IF NOT EXISTS sponsor_applications_user_id_idx ON sponsor_applications (user_id);
