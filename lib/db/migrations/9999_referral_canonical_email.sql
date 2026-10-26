-- 9999 (PROVISIONAL — the Stack-200 join renumbers; 0245+ is reserved):
-- Referral guards rung 2 — canonical-mailbox anti-farm column.
--
-- referrals.referee_canonical_email stores the referee's canonical
-- mailbox at apply time (see artifacts/api-server/src/lib/canonical-email:
-- lowercased, +tag stripped, gmail/googlemail dots folded). The apply
-- rail refuses a second welcome grant to any mailbox that already has a
-- referrals row, so plus-address / gmail-dot aliases of one inbox can
-- never farm the 1,000 VB Referral Welcome twice.
--
-- Nullable on purpose: pre-rung rows keep NULL (their welcome was paid
-- under the old rail) and NULLs never match each other in the guard's
-- equality lookup.

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS referee_canonical_email text;

CREATE INDEX IF NOT EXISTS referrals_referee_canonical_email_idx
  ON referrals (referee_canonical_email);
