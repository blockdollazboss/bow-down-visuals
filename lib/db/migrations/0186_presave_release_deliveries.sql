-- 0185: Release-day presave fan notifications — delivery ledger
-- (wave 3 #15: presave hub depth).
--
-- The presave landing page promises fans "You'll get one email when
-- the music drops. No spam, ever." Until now nothing sent that email:
-- presave_follows captured the addresses, but no release-day fan-out
-- existed. This ledger is what makes the fan-out exactly-once.
--
-- There is no server-side "released" status flip for distribution
-- releases (statuses are draft → packaged only): the release moment
-- is temporal — the packaged release's release_date arriving (the
-- public presave endpoint computes `released` the same way). A
-- sweeper finds due releases and fans out from this ledger.
--
-- presave_release_deliveries: one row per (release, fan email).
--   release_id / follow_id / email — the fan being notified; email is
--     denormalized from presave_follows at claim time so the ledger
--     stays the durable record of the one allowed send.
--   status     'pending' (claimed, send unresolved) → 'sent'
--              (provider accepted; provider_id recorded) | 'failed'
--              (attempt failed, last_error recorded; a later sweep
--              retries while attempts < cap) | 'dead' (cap reached,
--              terminal). The claim is insert-first ON CONFLICT DO
--              NOTHING on the UNIQUE (release_id, email) index — the
--              live_go_live_deliveries discipline (0133): only a
--              claim that lands may send, so retries, racing
--              sweepers, and restarts can never double-email a fan.
--   attempts   send attempts made against this row.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS presave_release_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES distribution_releases(id) ON DELETE CASCADE,
  follow_id UUID REFERENCES presave_follows(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS presave_release_deliveries_release_email_idx
  ON presave_release_deliveries (release_id, email);
-- The fan-out reads a release's deliveries as one set.
CREATE INDEX IF NOT EXISTS presave_release_deliveries_release_idx
  ON presave_release_deliveries (release_id);
