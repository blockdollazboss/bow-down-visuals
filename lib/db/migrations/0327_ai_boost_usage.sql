-- 0327: ai_boost_usage — the AI promotion boosts ledger (stack300
-- lane plans-boosts, census A item 2 / manifest item 87).
--
-- WHY THIS FILE EXISTS: every plan surface sells "AI promotion
-- boosts" — Free 3 / Pro 25 / Elite 100 per month (TIER_AI_BOOSTS in
-- api-server lib/platform-fees.ts, ratified plan terms, APPROVED
-- 2026-10-07) — but until now NO rail granted, counted, or consumed
-- a single boost: the figure existed only in plan DTO serialization,
-- and Post Assist (POST /api/posts/assist, the "AI-written promo
-- push" the plan copy points at) charged every member a flat
-- 100 Visual Bucs. The sold allowance was fiction.
--
-- This table is the ledger that makes it real: ONE ROW PER CONSUMED
-- BOOST, written by the Post Assist rail before it would charge,
-- carrying the assist's own server-derived charge idempotency key
-- (UNIQUE) so a double-submit of the same draft request consumes
-- exactly one boost — the same exactly-once discipline the credit
-- ledger (credit_usage.idempotency_key) already enforces for the
-- charge itself. The monthly count is a COUNT of the caller's rows
-- in the current period_month ('YYYY-MM', UTC): a new month simply
-- has no rows yet, so the reset needs no cron and no counter row to
-- roll. A provider failure after consumption deletes the row (the
-- boost twin of the route's credit refund), so a failed assist
-- costs the member nothing either way.
--
-- The quota itself is NEVER read from this table: it comes from
-- TIER_AI_BOOSTS by the caller's resolved tier at request time, so a
-- mid-month tier change prices the rest of the month at the new
-- tier's terms against the same month's usage. Admin accounts
-- (ADMIN_EMAILS) bypass the ledger entirely — the standing
-- admin-unrestricted ruling — and take the unchanged 100 VB charge
-- path; no row is ever written for them.
--
-- Fresh CREATE (no legacy table to reconcile): every statement is
-- IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY.

CREATE TABLE IF NOT EXISTS ai_boost_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_month text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_boost_usage_idempotency_key_ux ON ai_boost_usage (idempotency_key);

CREATE INDEX IF NOT EXISTS ai_boost_usage_user_period_idx ON ai_boost_usage (user_id, period_month);
