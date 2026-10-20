-- 0177: Cloud Operator Phase 2 — the hands' audit trail + confirm rail.
-- (Lane A: the executor foundation. The owner approved Phase 2 on
-- Oct 20, 2026; the design is ~/workspace/operator-phase2-scope.md.)
--
-- operator_actions: one row per operator action ATTEMPT the server
-- executed or refused — written by the executor FROM THE RAIL'S
-- RESULT, never from the model's words (design law: he reports only
-- what the rail answered; the audit row is the action trail, the
-- credit ledger stays the money trail).
--   user_id        the member the action ran as (the caller's own
--                  session — the executor can never act as anyone else).
--   admin_email    set only for Tier-4 authority actions, where the
--                  ADMIN_EMAILS allowlist email is the authority proof.
--   tier           0 reads · 1 doors · 2 free writes · 3 charged · 4 admin.
--   tool_id        the registry id (e.g. 'credits.balance').
--   summary        plain-words summary of what was attempted/done.
--   target         optional target descriptor (post, person, room).
--   channel        'chat_text' | 'voice' | 'admin_command'.
--   price_quoted   VB quoted to the member before a charged action
--                  (the registry price at proposal time), else NULL.
--   price_charged  VB the rail actually charged (0 when the rail
--                  charged and refunded — the refund shape lives in
--                  result_reason), else NULL for free/refused rows.
--   idempotency_key the rail charge's idempotency key, when one exists.
--   result         'done' | 'refused' | 'failed'.
--   result_reason  for refused: the gate that refused (no_confirmation,
--                  confirmation_expired, confirmation_replayed,
--                  not_admin, hands_disabled, daily_cap, unknown_tool);
--                  for failed: the rail's own error summary.
--
-- operator_pending_actions: the confirmation protocol's store.
-- propose -> the server writes one row (member, tool, args hash,
-- quoted price, short expiry) -> the member confirms -> the executor
-- consumes it EXACTLY ONCE (status pending -> consumed, consumed_at
-- stamped; the consume is guarded on status='pending' so a replay
-- finds nothing to consume and refuses). Expired rows are marked
-- 'expired' when a late confirm arrives; cancelled rows 'cancelled'.
-- One charged step per confirmation — a journey with three charged
-- steps writes three rows over its life, never one shared row.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS operator_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  admin_email TEXT,
  tier INTEGER NOT NULL CHECK (tier IN (0, 1, 2, 3, 4)),
  tool_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  target TEXT,
  channel TEXT NOT NULL DEFAULT 'chat_text' CHECK (channel IN ('chat_text', 'voice', 'admin_command')),
  price_quoted INTEGER,
  price_charged INTEGER,
  idempotency_key TEXT,
  result TEXT NOT NULL CHECK (result IN ('done', 'refused', 'failed')),
  result_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-member readback ("what did you do for me") + the daily charged
-- cap count both read one member's rows newest-first.
CREATE INDEX IF NOT EXISTS operator_actions_user_idx
  ON operator_actions (user_id, created_at DESC);
-- The admin bench reads across members, newest first.
CREATE INDEX IF NOT EXISTS operator_actions_recent_idx
  ON operator_actions (created_at DESC);

CREATE TABLE IF NOT EXISTS operator_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tool_id TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  args_hash TEXT NOT NULL,
  price_quoted INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'chat_text' CHECK (channel IN ('chat_text', 'voice', 'admin_command')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consumed', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

-- The live-pending lookup (one open confirmation per member at a time
-- is enforced by the executor; this index is its read path).
CREATE INDEX IF NOT EXISTS operator_pending_actions_user_idx
  ON operator_pending_actions (user_id, status, created_at DESC);
