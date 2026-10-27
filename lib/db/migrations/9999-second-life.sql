-- Second Life (#161) — UPGRADE of Viral Spike Watch.
-- Provisional number 9999 (renumbered at join). Idempotent.
--
-- second_life_prefs: the Settings off-switch for catalog watching
-- (one row per account; no row = watching ON).
-- second_life_revivals: one revival proposal per spike episode —
-- a plan (re-cut as short + fresh cover, Create deep links), never
-- an action; the creator approves or dismisses.

CREATE TABLE IF NOT EXISTS second_life_prefs (
  user_id uuid PRIMARY KEY,
  watch_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS second_life_revivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  kind text NOT NULL,
  media_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  plan jsonb NOT NULL,
  current_plays integer NOT NULL DEFAULT 0,
  baseline_daily double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT second_life_revivals_kind_check CHECK (kind IN ('track','video')),
  CONSTRAINT second_life_revivals_status_check CHECK (status IN ('proposed','approved','dismissed'))
);

CREATE INDEX IF NOT EXISTS second_life_revivals_owner_status_idx
  ON second_life_revivals (owner_user_id, status);
CREATE INDEX IF NOT EXISTS second_life_revivals_media_idx
  ON second_life_revivals (kind, media_id);
