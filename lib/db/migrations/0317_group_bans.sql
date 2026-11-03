-- 0317: Group bans (stack1400 ruling #11, Y4 OD2).
--
-- Groups had removal but no ban: deleting a member's group_members
-- row was the whole of it, so a removed user could rejoin the next
-- minute — removal alone could never keep anyone out.
--
-- group_bans is the durable ban record, keyed exactly the way
-- group_members is keyed — (group_id, user_id) as the primary key —
-- and deliberately a SEPARATE table rather than a status column on
-- group_members: member removal deletes the membership row, and a
-- ban stored on that row would be deleted with it. A ban row stands
-- until an owner/admin unbans; while it stands, every entry door
-- refuses the user: direct join (routes/community.ts), join-request
-- creation, and join-request approval (routes/trust.ts).
--
-- Bans are issued ONLY on an owner/admin's command (peace law:
-- punishment never fires automatically) — nothing in the system
-- writes this table except the ban endpoints.
--
-- banned_by_user_id is the issuing owner/admin's user id; reason is
-- optional free text the issuer may leave. No foreign key on the
-- user columns: site users live in auth, not in a local users table
-- (the same reason group_members.user_id carries none).
--
-- Fresh CREATE (no legacy table to reconcile): every statement is
-- IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY.

CREATE TABLE IF NOT EXISTS group_bans (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  banned_by_user_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_bans_user_idx ON group_bans (user_id);

CREATE INDEX IF NOT EXISTS group_bans_group_idx ON group_bans (group_id, created_at);
