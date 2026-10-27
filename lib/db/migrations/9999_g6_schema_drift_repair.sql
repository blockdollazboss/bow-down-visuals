-- 9999 (PROVISIONAL — QC-200 G6 schema-drift repair).
--
-- PROVISIONAL: this file carries a 9999 number because the G6 lane is
-- not the migration-numbering authority for the next Stack-200 join.
-- The join coordinator renumbers it into the next free slot (0245+)
-- before it can ever apply; migrate-boot picks it up by filename in
-- the meantime on any tree it is merged into. Idempotent throughout:
-- safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.
--
-- WHY — two production-log schema-drift errors (Oct 25 ~20:58) plus
-- the column the stale-queue gate anchors on:
--
-- 1. BASELINE-SKIP GAP (contests, contest_entries): both tables are
--    created ONLY by 0024_fan_contests.sql — at/below the migrate-boot
--    BASELINE (55) — so the boot runner skips 0024 on existing
--    databases on the assumption it was applied manually pre-runner.
--    Production logs proved that assumption false:
--    `relation "contest_entries" does not exist` at request level
--    (routes/generate/contests.ts, routes/activity-feed.ts). The
--    CREATEs below are copied exactly from 0024 and are no-ops where
--    the tables already exist. NO live table is renamed or altered in
--    shape — the canonical definitions are lib/db/src/schema/
--    contests.ts, which these statements match column for column.
--
-- 2. email_campaigns.queued_at: the stale-queue gate column (QC-200
--    G6, lib/db/src/schema/email-lists.ts). The campaign drain anchors
--    staleness on queued_at (stamped by every queue door), falling
--    back to created_at for pre-gate rows. Nullable, no default —
--    a NULL stamp on a queued row means "queued before the gate
--    existed", which the gate treats as stale until a deliberate
--    re-queue stamps it.

-- ── contests (exact copy of 0024) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  prize TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  entry_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  winner_entry_id UUID,
  draw_audit JSONB,
  announcement_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contests_user_id_idx
  ON contests (user_id);

-- ── contest_entries (exact copy of 0024) ─────────────────────────────
CREATE TABLE IF NOT EXISTS contest_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID NOT NULL,
  handle TEXT NOT NULL,
  email TEXT,
  entry_method TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contest_entries_contest_id_idx
  ON contest_entries (contest_id);

CREATE INDEX IF NOT EXISTS contest_entries_handle_idx
  ON contest_entries (handle);

-- ── email_campaigns.queued_at (stale-queue gate anchor) ──────────────
ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;
