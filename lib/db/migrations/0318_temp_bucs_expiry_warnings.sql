-- 0318: Temporary Bucs expiry warning — delivery ledger
-- (stack1400 ruling #12 / Y6, 2026-11-02).
--
-- RENUMBERED AT THE STACK1400 JOIN: this lane numbered its migration
-- 0317, but three lanes claimed 0317; in join order group-bans kept
-- 0317, this file became 0318, and the reserve-statuses file 0319.
--
-- WHY THIS FILE EXISTS: Temporary Visual Bucs (the profiles bonus
-- pool: bonus_credits + bonus_credits_expires_at on the Supabase
-- profiles row, 48h from grant — lib/bonus.ts) expire silently. The
-- balance display already names the soonest expiry and the amount
-- (lib/credits.ts creditBalanceComposition), but nothing ever WARNS
-- the member by email before the Bucs are gone. The ruling: ONE
-- warning email before expiry, carrying the amount and the exact
-- expiry date, exactly once per pool expiry.
--
-- This ledger is what makes that warning exactly-once. One row per
-- (user_id, pool_expires_at): the pool's expiry instant IS the
-- warning's identity — a new grant refreshes the pool expiry, which
-- is a new pool and may earn its own warning; the same pool can
-- never be warned twice. The claim is insert-first ON CONFLICT DO
-- NOTHING on the unique index (the presave_release_deliveries
-- discipline, migration 0186): only a claim that lands may send, so
-- retries, racing sweepers, and restarts can never double-email.
--   pending    → a claim landed; the send has not resolved yet.
--   sent       → the provider accepted the email (provider_id kept).
--   failed     → the send attempt failed (last_error kept); a later
--                sweep may retry while attempts < the cap.
--   dead       → attempts exhausted; terminal, never retried.
--   suppressed → the address is unsubscribed/suppressed (checked at
--                send time, the email-automations law); terminal —
--                suppression is absolute and never mailed.
-- amount_vb / email are denormalized at claim time so the ledger
-- stays the durable record of the one allowed warning even if the
-- pool or the address later changes.
--
-- Fresh CREATE (no legacy table to reconcile): every statement is
-- IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY. 0318 > BASELINE (55), so the boot runner applies it
-- on fresh and existing databases alike.

CREATE TABLE IF NOT EXISTS temp_bucs_expiry_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  pool_expires_at TIMESTAMPTZ NOT NULL,
  email TEXT NOT NULL,
  amount_vb INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dead', 'suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS temp_bucs_expiry_warnings_user_pool_uidx
  ON temp_bucs_expiry_warnings (user_id, pool_expires_at);
-- The sweeper's retry scan reads by status.
CREATE INDEX IF NOT EXISTS temp_bucs_expiry_warnings_status_idx
  ON temp_bucs_expiry_warnings (status);
