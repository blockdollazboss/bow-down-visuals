-- 0320: Too Lost release submissions (stack1500, Front 14).
--
-- Front 12 built the delivery connection (OAuth connect/callback/status;
-- tokens in social_accounts, platform 'toolost'). This table is the
-- submission rail's own honest state record: ONE row per release
-- (UNIQUE on release_id), written by
-- POST /api/distribution/toolost/releases/:id/submit and read by
-- GET /api/distribution/toolost/submissions.
--
-- State vocabulary (the rail's lifecycle, distinct from
-- distribution_releases.status, which the sandbox packaging door owns
-- and this lane deliberately does not touch):
--   draft      → the row exists, nothing has been sent yet
--   submitting → the provider pipeline is running (draft → uploads →
--                metadata → submit)
--   in_review  → the provider accepted the package for review
--   failed     → a step failed; failure_reason carries OUR sanitized
--                plain-language reason (never a raw provider body)
--
-- provider_release_id is stored the moment the provider draft exists,
-- so a retry after a mid-pipeline failure REUSES the same provider
-- draft instead of creating a duplicate release on the partner side.
--
-- ai_declaration records what shipped on the metadata call:
--   { isAiGenerated: boolean,
--     aiDocumentation: { fileName, fileUrl } | null }
-- The submit route refuses to run at all when a release that is
-- AI-generated (by declaration, or by our own song records) lacks the
-- documentation — the row only ever records declarations that passed.
--
-- No foreign keys: site users live in auth, not in a local users table,
-- and distribution_releases has no FK tradition either (royalty splits
-- key on release_id the same bare way).
--
-- Fresh CREATE (no legacy table to reconcile): every statement is
-- IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY.

CREATE TABLE IF NOT EXISTS distribution_toolost_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL,
  user_id uuid NOT NULL,
  provider_release_id text,
  state text NOT NULL DEFAULT 'draft',
  failure_reason text,
  ai_declaration jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS distribution_toolost_submissions_release_uidx
  ON distribution_toolost_submissions (release_id);

CREATE INDEX IF NOT EXISTS distribution_toolost_submissions_user_idx
  ON distribution_toolost_submissions (user_id);
