-- Sponsor applications — escrow workflow columns (heal for 0033).
--
-- WHY THIS FILE EXISTS (Gate #5, part 5 step 4, 2026-11-01): on the live
-- build, a freshly posted sponsor deal shows in the marketplace but its
-- detail page and the Sponsor Dashboard can NEVER load ("Could not load
-- the deal — try again." / "Could not load your dashboard"), so no
-- Apply/Accept control is reachable and the escrow flow cannot start.
--
-- The columns below were introduced by 0033_sponsor_escrow.sql — a file
-- numbered <= BASELINE (55) that the boot runner (migrate-boot.mjs) never
-- applies to a non-fresh database; it trusts the manual pre-runner era.
-- The 0069 heal file re-applied 0033's sponsor_deals columns and the
-- sponsor_payouts table, but omitted sponsor_applications, so production's
-- table still has its 0010 shape (id, deal_id, user_id, pitch, created_at)
-- while every read path in routes/generate/sponsors.ts names the 0033
-- columns:
--   - myApplicationStatus:  SELECT status FROM sponsor_applications
--   - GET deal applications: SELECT ... status, portfolio_url, decided_at
--   - dashboard applied list: SELECT a.status AS application_status ...
--   - apply / review / direct-deal inserts + updates write all three.
-- Each of those queries throws "column does not exist" and the routes
-- answer their honest 500s. POST + list deals keep working because they
-- touch only base sponsor_deals columns — exactly the live symptom split.
--
-- This file re-applies 0033's sponsor_applications block verbatim, in the
-- same idempotent form. The drizzle schema
-- (lib/db/src/schema/sponsor-deals.ts) already carries these columns, so
-- no schema change accompanies this file. Idempotent: safe to run on a
-- database that already has the columns (e.g. a fresh DB that ran 0033).

ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS portfolio_url TEXT;
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sponsor_applications_status_idx ON sponsor_applications (status);
