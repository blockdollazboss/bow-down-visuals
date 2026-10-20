-- 0166: Legacy contact (Stack 3 — succession / legacy settings tail).
-- Stack 10 (migration 0138) built the succession DESIGNATION: name an
-- heir who is a Bow Down Visuals account holder; the heir accepts or
-- declines, and any activation is a manual, human-reviewed process.
-- What it cannot express is the simpler, common case: the person to
-- CONTACT about a creator's account and work if the creator no longer
-- can is usually NOT a creator on the platform — a partner, a family
-- member — and is reachable by name + email, not by account id.
--   legacy_contacts — at most one row per user (unique user_id):
--     contact_name + contact_email for the person Bow Down Visuals
--     should contact, plus an optional short note from the owner.
-- The row RECORDS the designation only. It promises no account
-- transfer, no payout, and no legal effect, and it carries no status
-- or activation machinery — that framing lives in the settings copy.
-- Owner-only by construction: the API reads and writes it solely
-- through the caller's own /api/legacy/contact routes, and it is
-- never joined into any public profile DTO (the contact's email is
-- private). Clearing the setting deletes the row outright — a
-- contact has no counterparty lifecycle to preserve, unlike a
-- designation's revoked state.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS legacy_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_contacts_user_uidx ON legacy_contacts (user_id);
