-- Splits Ledger (DistroKid "Splits" parity).
-- Per-release royalty split agreements with:
--   - collaborator email + invite status (invite emails are a stub until an
--     email provider is configured; the invite is always recorded)
--   - versioned agreements: editing splits supersedes the old version instead
--     of deleting it, so changes apply to future earnings only (DistroKid
--     behavior). effective_from / superseded_at decide which version applied
--     to a given money entry.
--   - split_share_slug on the release: mint a public, shareable agreement
--     summary link (/splits/:slug).
--   - money_entries.release_id: link income entries to a release so the
--     Splits view in Money Tracker can compute each collaborator's share of
--     logged income.
-- HONESTY: automatic store payouts require a distribution partnership we
-- don't have. This ledger tracks AGREED splits and applies them to income
-- the creator logs in Money Tracker.
-- Idempotent: every statement is guarded.

ALTER TABLE distribution_royalty_splits
  ADD COLUMN IF NOT EXISTS payee_email TEXT;

ALTER TABLE distribution_royalty_splits
  ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'not_invited';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'distribution_royalty_splits_invite_status_check'
  ) THEN
    ALTER TABLE distribution_royalty_splits
      ADD CONSTRAINT distribution_royalty_splits_invite_status_check
      CHECK (invite_status IN ('not_invited', 'invited', 'accepted'));
  END IF;
END
$$;

ALTER TABLE distribution_royalty_splits
  ADD COLUMN IF NOT EXISTS invite_token TEXT;

ALTER TABLE distribution_royalty_splits
  ADD COLUMN IF NOT EXISTS agreement_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE distribution_royalty_splits
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE distribution_royalty_splits
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS distribution_royalty_splits_release_version_idx
  ON distribution_royalty_splits (release_id, agreement_version);

CREATE INDEX IF NOT EXISTS distribution_royalty_splits_release_active_idx
  ON distribution_royalty_splits (release_id)
  WHERE superseded_at IS NULL;

-- Public share slug for the split agreement summary.
ALTER TABLE distribution_releases
  ADD COLUMN IF NOT EXISTS split_share_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS distribution_releases_split_share_slug_uidx
  ON distribution_releases (split_share_slug);

-- Link money entries to a release so splits can be applied to logged income.
ALTER TABLE money_entries
  ADD COLUMN IF NOT EXISTS release_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'money_entries_release_id_fkey'
  ) THEN
    ALTER TABLE money_entries
      ADD CONSTRAINT money_entries_release_id_fkey
      FOREIGN KEY (release_id)
      REFERENCES distribution_releases (id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS money_entries_release_id_idx
  ON money_entries (release_id);
