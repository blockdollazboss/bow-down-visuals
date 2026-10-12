-- 0123: contact_messages table for the contact form.
-- Existed only via the retired drizzle-kit push, so any fresh DB 500s on
-- contact submissions. Definition mirrors
-- lib/db/src/schema/contact-messages.ts exactly, INCLUDING the "read"
-- column that migration 0116 adds via ALTER TABLE — so the final schema
-- matches on both fresh and existing DBs.
-- Idempotent: safe to re-run as a no-op.
--
-- NOTE (ordering): migration 0116 runs ALTER TABLE contact_messages on
-- boot and fails fatally on a truly fresh DB because this table is only
-- created here at 0123. See parent report for the recommended one-word
-- fix to 0116 (ALTER TABLE IF EXISTS) — not applied here per the
-- never-edit-an-applied-file rule.

CREATE TABLE IF NOT EXISTS contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_messages_created_at_idx ON contact_messages (created_at DESC);
