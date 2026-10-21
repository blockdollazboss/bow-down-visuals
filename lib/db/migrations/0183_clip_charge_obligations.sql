-- 0183: Durable charge→refund obligations for generated video clips
-- (payments defect D3, ~/workspace/payments-test-matrix.md).
--
-- The defect: routes/generate/runway-clip.ts charges credits when a
-- Runway/Veo task SUCCEEDS and remembers the charge in an in-memory
-- map (chargedTasks) so POST /api/generated-clips can refund if its
-- insert fails. A server restart between the charge and the save lost
-- the map entry: the member was charged for a clip that never landed
-- and nothing gave the credits back.
--
-- clip_charge_obligations: one row per charged task, written at
-- charge time — the durable source of truth the in-memory map never
-- was (the operator_pending_actions pattern from 0177, applied to a
-- refund obligation).
--   task_id    the provider task id (Runway taskId or veo-<uuid>) —
--              the same key the in-memory map used; UNIQUE so a
--              re-poll can never record the same charge twice.
--   user_id    the member who was charged (refund goes to them).
--   credits    the amount actually charged — refunds read it from
--              the row, never from a current-price constant.
--   status     'pending' (charge stands, clip not landed yet) →
--              'delivered' (a generated_clips row landed) or
--              'refunded' (credits returned). Every refund path
--              claims the row with UPDATE … WHERE status='pending',
--              so restarts/racing sweepers can never double-refund.
--   resolution how it resolved ('saved' | 'save_failed' |
--              'swept_refunded' | 'swept_delivered').
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS clip_charge_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  credits INTEGER NOT NULL,
  project_id UUID,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'refunded')),
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS clip_charge_obligations_task_idx
  ON clip_charge_obligations (task_id);
-- The stale sweeper scans open obligations oldest-first.
CREATE INDEX IF NOT EXISTS clip_charge_obligations_pending_idx
  ON clip_charge_obligations (status, created_at);
