-- 9999-wave4850 (PROVISIONAL number — renumber at join): Wave-4
-- remainder #48 Evergreen recycling + #49 Top-supporter recognition
-- (Stack-200 rem-wave4850).
--
-- #48: evergreen_settings (per-creator on/off + windows + spacing +
-- cycle cap) and evergreen_proposals (a proposed resurfacing that can
-- only become a scheduled-post DRAFT after the creator approves it —
-- evergreen never posts on its own).
--
-- #49: supporter_board_settings (board on/off + the creator's own
-- plain-words perks, the N6 Front Row Boards delta) and
-- supporter_board_opt_outs (a fan's opt-out from one creator's public
-- board). The board itself is DERIVED at read time from real support
-- records (Fan Graph money facts + ticketed-live attendance) — no
-- score is ever stored, so it can never drift from the source rows.
--
-- #50 needs no migration: post_co_authors (0207) and co_releases /
-- co_release_sides (0222) already exist at base.
--
-- Idempotent: safe to re-run. No prices are created by this file —
-- both features are free interface over records the house already
-- keeps; money stays on the existing rails (TEST MODE, Visual Bucs).

CREATE TABLE IF NOT EXISTS evergreen_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  windows jsonb NOT NULL,
  base_spacing_days integer NOT NULL DEFAULT 7,
  max_cycles integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evergreen_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_post_id uuid NOT NULL,
  cycle integer NOT NULL,
  proposed_slot timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval',
  draft_post_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evergreen_proposals_user_status_idx
  ON evergreen_proposals (user_id, status);
CREATE INDEX IF NOT EXISTS evergreen_proposals_source_idx
  ON evergreen_proposals (source_post_id);

-- #49 supporter_board_* tables: NOT created here. At the join this lane's
-- #49 rider was deduped against the dedicated rem-top-supporter build;
-- the canonical tables (creator_user_id shape) are created by 0261.
