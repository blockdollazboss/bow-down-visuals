-- 0116: add read/unread flag to contact_messages for the admin inbox.
-- Idempotent: safe to re-run as a no-op.
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS "read" boolean NOT NULL DEFAULT false;
