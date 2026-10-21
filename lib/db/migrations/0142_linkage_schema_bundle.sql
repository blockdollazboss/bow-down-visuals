-- 0142: Linkage schema bundle (site-linkage audit DE-9/DE-14/DE-20 +
-- character audit G4/G8). One migration carries every column the linkage
-- fixes need so the wiring lands against a single schema step:
--   1. songs release metadata (lyrics / genre / ISRC / cover art) — the
--      distribute wizard stops re-collecting what the song already knows.
--   2. artist_vaults.voice_profile — a character's World voice-shaping
--      profile (pitch / formant / EQ), nullable: unset = neutral.
--   3. artist_vault_id on generations / generated_clips / lip_sync_jobs /
--      hub_projects — creations remember the character they were made as.
--   4. hub_projects surrogate id PK — user_id as PK capped a creator at
--      ONE commingled project; now many projects per user. Existing rows
--      are preserved 1:1 (each becomes one project under its new id).
--   5. creator_profiles extension fields (merch_items / events / series /
--      social_posts) — edited in artist-setup, previously stripped on save.
--   6. Settlement markers (settled_payout_id / settled_at) on
--      sponsor_payouts / fan_members / shop_events so pendingPayoutCents
--      can cover released brand deals, memberships and shop sales.
--   7. shoutout_requests checkout columns (stripe_session_id / paid_at).
--   8. tip_jar_tips — durable USD tip-jar checkout rows (DE-14): the jar
--      was in-memory intents at pending_payment forever; paid tips land
--      here exactly once (stripe_session_id UNIQUE).
--   9. projects.hub_project_id (guarded: the editor's saved-projects
--      table is Supabase-owned and may not exist in this database).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

-- ── 1. Songs release metadata ──────────────────────────────────────────
ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS isrc TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS cover_art_url TEXT;

-- ── 2. Character voice-shaping profile ─────────────────────────────────
ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS voice_profile JSONB;

-- ── 3. Creations remember their character ──────────────────────────────
ALTER TABLE generations ADD COLUMN IF NOT EXISTS artist_vault_id UUID;
ALTER TABLE generated_clips ADD COLUMN IF NOT EXISTS artist_vault_id UUID;
ALTER TABLE lip_sync_jobs ADD COLUMN IF NOT EXISTS artist_vault_id UUID;
ALTER TABLE hub_projects ADD COLUMN IF NOT EXISTS artist_vault_id UUID;

-- ── 4. hub_projects: surrogate id primary key ──────────────────────────
ALTER TABLE hub_projects ADD COLUMN IF NOT EXISTS id UUID;
UPDATE hub_projects SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE hub_projects ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE hub_projects ALTER COLUMN id SET NOT NULL;
DO $$
DECLARE
  pk_name text;
  pk_cols text;
BEGIN
  SELECT c.conname, string_agg(a.attname, ',')
    INTO pk_name, pk_cols
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'hub_projects'::regclass AND c.contype = 'p'
   GROUP BY c.conname;
  IF pk_cols = 'user_id' THEN
    EXECUTE format('ALTER TABLE hub_projects DROP CONSTRAINT %I', pk_name);
    ALTER TABLE hub_projects ADD CONSTRAINT hub_projects_pkey PRIMARY KEY (id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS hub_projects_user_idx ON hub_projects (user_id);
-- The hub client's local project id, so a save from a known local
-- project upserts ITS row (and a fresh local project starts a new row)
-- without the client ever holding the server id.
ALTER TABLE hub_projects ADD COLUMN IF NOT EXISTS client_ref TEXT;
CREATE INDEX IF NOT EXISTS hub_projects_user_client_ref_idx ON hub_projects (user_id, client_ref);

-- ── 5. Creator profile extension fields ────────────────────────────────
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS merch_items JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS series JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS social_posts JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── 6. Payout settlement markers ───────────────────────────────────────
ALTER TABLE sponsor_payouts ADD COLUMN IF NOT EXISTS settled_payout_id UUID;
ALTER TABLE sponsor_payouts ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS settled_payout_id UUID;
ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE shop_events ADD COLUMN IF NOT EXISTS settled_payout_id UUID;
ALTER TABLE shop_events ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

-- ── 7. Shoutout checkout ───────────────────────────────────────────────
ALTER TABLE shoutout_requests ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE shoutout_requests ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS shoutout_requests_stripe_session_ux
  ON shoutout_requests (stripe_session_id);

-- ── 8. Tip jar paid tips ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tip_jar_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_user_id UUID NOT NULL,
  handle TEXT NOT NULL,
  fan_name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending_payment',
  stripe_session_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tip_jar_tips_page_user_idx ON tip_jar_tips (page_user_id);

-- ── 9. Editor saved projects ↔ hub project link (guarded) ─────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'projects'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS hub_project_id UUID;
  END IF;
END $$;
