-- 0198: Live social-proof sync (competitor-study C5) — verified follower /
-- audience figures from a creator's ALREADY-CONNECTED social accounts,
-- shown on their Grand Stage profile with source + last-updated labels.
--
-- The gap: profiles carried hand-typed social links and a hand-typed
-- media kit. The connected rails (social_accounts OAuth: Instagram,
-- TikTok, Facebook Pages) already return real audience numbers — the
-- Analytics Dashboard fetchers read them live — but nothing carried a
-- verified figure onto the public profile, so the home page never showed
-- the social proof the feeds earned.
--
-- This table is a CACHE + preference store, never a source of truth:
--   * figures   jsonb array of {key, platform, accountId, accountLabel,
--               label, value, fetchedAt}. A figure enters the array ONLY
--               when a connected rail actually returned that number
--               (the analytics fetchers' honest-null stats). Absent
--               fields stay absent — never estimated, never rounded up,
--               never invented.
--   * hidden_keys jsonb array of figure keys the creator switched off.
--               Visibility defaults ON for live figures only (house law:
--               every promotional surface ships with its own off switch);
--               the public read filters hidden keys out everywhere.
--   * refreshed_at stamps the last completed refresh. Public reads
--               date-label every figure with its own fetchedAt, hide
--               figures whose account is disconnected, and stop showing
--               a figure once it is more than 7 days old — a stale
--               number never poses as a fresh one.
--
-- Refresh is lazy (owner read / refresh action / opportunistic on a
-- stale public read) on a 6-hour cadence; there is no cron and no
-- credits code anywhere in the feature — it is FREE.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS creator_social_proof (
  profile_id UUID PRIMARY KEY REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  figures JSONB NOT NULL DEFAULT '[]'::jsonb,
  hidden_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_social_proof_user_idx ON creator_social_proof (user_id);
