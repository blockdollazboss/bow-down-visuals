-- 0161: Daily Drop catalogue archives (STACK-20 R2 item #18 —
-- UPGRADE-PROGRAM Ring 4, Treasury). The Daily Drop catalogue is a
-- code-level slate: 30 curated template defs (DAILY_DROPS in the
-- API's retention-drops routes) rotating one-per-UTC-day, the same
-- drop for everyone. Until now only TODAY's drop was reachable
-- anywhere — a member who missed a day could never go back for that
-- template, and a template they never want kept taking its turn in
-- their list with no way to tidy it away.
--   daily_drop_archives — one row per (member, drop key) the member
--     has archived out of their active catalogue list. Presence of
--     the row IS the archived state; deleting the row un-archives
--     (fully reversible). Keyed by the member's own user id and the
--     catalogue key — the routes validate the key against the live
--     catalogue and only ever read/write the caller's rows, so one
--     member's tidy-up can never touch another's list. The catalogue
--     itself stays code: no template content lives in this table,
--     and archiving never changes the shared daily rotation — it
--     only filters the member's own catalogue view.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS daily_drop_archives (
  user_id UUID NOT NULL,
  drop_key TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, drop_key)
);
CREATE INDEX IF NOT EXISTS daily_drop_archives_user_idx ON daily_drop_archives (user_id);
