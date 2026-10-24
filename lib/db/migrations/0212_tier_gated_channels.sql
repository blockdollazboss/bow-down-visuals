-- 0212: Tier-gated community channels (Stack-100 #3, #19) — a forum channel
-- inside a group may require a fan membership in the GROUP OWNER's
-- fan club at a tier and up. min_fan_tier_id names that tier on the
-- owner's own ladder (fan_tiers, ordered by sort_order); NULL means
-- the channel is open to everyone the group's own visibility rules
-- admit, exactly as before this column existed.
--
-- Deleting a fan tier SETs the gate NULL (the room reopens) rather
-- than cascading the channel away or orphaning the gate; deleting
-- the channel cascades with the group as channels already do.
-- Nothing here touches group_forum_threads / group_forum_replies:
-- a member whose membership lapses keeps their history — the gate
-- is enforced at read/post time, never by deleting content.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE group_forum_channels
  ADD COLUMN IF NOT EXISTS min_fan_tier_id uuid;

DO $$ BEGIN
  ALTER TABLE group_forum_channels
    ADD CONSTRAINT group_forum_channels_min_fan_tier_fk
    FOREIGN KEY (min_fan_tier_id) REFERENCES fan_tiers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS group_forum_channels_min_fan_tier_idx
  ON group_forum_channels (min_fan_tier_id)
  WHERE min_fan_tier_id IS NOT NULL;
