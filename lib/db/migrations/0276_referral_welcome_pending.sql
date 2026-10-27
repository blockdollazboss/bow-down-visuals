-- 9999 (PROVISIONAL — the Stack-200 join renumbers; 0245+ is reserved):
-- Referral guards rung 3 — pending welcome-grant lifecycle.
--
-- referrals.welcome_status tracks the referee welcome grant:
--   'pending'  — referral recorded, the 1,000 VB welcome is held until
--                the referee creates a creator profile, then paid
--                exactly once (status flips pending -> granted as the
--                claim; ledger key `referral-welcome:<userId>`).
--   'granted'  — welcome paid.
--   'withheld' — rung-2 duplicate canonical mailbox; never pays.
--
-- DEFAULT 'granted' is deliberate: every pre-rung row was paid at apply
-- time under the old rail, so existing rows keep the truthful status
-- without a backfill. New rows set the value explicitly at insert.

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS welcome_status text NOT NULL DEFAULT 'granted';
