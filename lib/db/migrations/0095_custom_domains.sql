-- Custom domains (0095) — Worker 10: creator "own website" flagship.
--
-- Every creator gets <slug>.bowdownvisuals.com free (resolved by convention,
-- no row needed). A paid-tier custom domain is a row here: the creator points
-- a CNAME at the platform target and proves ownership via a TXT record, then
-- GET /api/domains/resolve?host= maps the hostname back to their profile slug
-- so the frontend can render their site in Site Mode.
--
-- Idempotent: every statement is safe to re-run.

CREATE TABLE IF NOT EXISTS custom_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verifying', 'active', 'failed')),
  verification_token TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_domains_profile_id_idx
  ON custom_domains (profile_id);

-- Only one primary domain per profile. Partial unique index keeps it
-- idempotent and lets creators hold several verified domains (e.g. the
-- .com and the .net) while one is canonical.
CREATE UNIQUE INDEX IF NOT EXISTS custom_domains_one_primary_per_profile
  ON custom_domains (profile_id)
  WHERE is_primary;
