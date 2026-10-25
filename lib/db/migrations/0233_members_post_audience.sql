-- 0233: Members-only feed posts (Wave 4 #33) — a post may carry
-- audience = 'members', gating it to the author's fan club. min_tier_id
-- names the minimum tier on the AUTHOR's own ladder (fan_tiers, ordered
-- by sort_order — the fan-tier-gate semantics the tier-gated community
-- channels already use, migration 0212); NULL means any member of the
-- author, whatever their tier.
--
-- The gate is enforced at READ time on every surface that serves a
-- post (feed, profile, single post, hashtag, saves, quote embeds):
-- a viewer who doesn't qualify never receives the body or media —
-- only an honest locked teaser (the post exists, it's members-only,
-- which tier opens it, and the join door). Nothing is deleted or
-- rewritten when a membership lapses; the gate is evaluated against
-- the membership rows at read time, like every other scoped audience.
--
-- Deleting a fan tier SETs the gate NULL rather than cascading the
-- post away or orphaning the gate: the post falls back to any-member
-- — still members-only, never public — exactly the 0212 channel rule.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS min_tier_id uuid;

DO $$ BEGIN
  ALTER TABLE posts
    ADD CONSTRAINT posts_min_tier_fk
    FOREIGN KEY (min_tier_id) REFERENCES fan_tiers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS posts_min_tier_idx
  ON posts (min_tier_id)
  WHERE min_tier_id IS NOT NULL;
