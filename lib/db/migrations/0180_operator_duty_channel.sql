-- 0180: Cloud Operator Phase 2, Lane G — automatic duties join the
-- audit trail. operator_actions.channel gains 'automatic': the rows
-- Thy Cheat Code's scheduled duties write when they fire on their
-- own watch (host reminders, winner heralds, trouble flags — design
-- ~/workspace/operator-phase2-scope.md §3). The channel vocabulary
-- is a CHECK constraint, so widening it is a drop + re-add; the
-- constraint carries the name the Drizzle schema declares
-- (operator_actions_channel_check — the name Postgres gave the
-- inline CHECK in 0177).
--
-- operator_pending_actions is deliberately untouched: duties never
-- propose or confirm — nothing automatic ever spends or punishes.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE operator_actions
  DROP CONSTRAINT IF EXISTS operator_actions_channel_check;

ALTER TABLE operator_actions
  ADD CONSTRAINT operator_actions_channel_check
  CHECK (channel IN ('chat_text', 'voice', 'admin_command', 'automatic'));
