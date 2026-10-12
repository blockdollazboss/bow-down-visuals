-- 0116: add read/unread flag to contact_messages for the admin inbox.
-- Idempotent: safe to re-run as a no-op.
-- IF EXISTS added 2026-10-12: on a fresh DB, 0123 creates contact_messages
-- AFTER this file runs, so a plain ALTER would fatally abort boot. No-op on
-- existing DBs where the table already exists.
ALTER TABLE IF EXISTS contact_messages ADD COLUMN IF NOT EXISTS "read" boolean NOT NULL DEFAULT false;
