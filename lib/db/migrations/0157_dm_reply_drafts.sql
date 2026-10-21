-- 0157: DM reply drafts (STACK-20 item #15 — the persistence half of
-- UPGRADE-PROGRAM 2.19). Until now the in-progress reply in a DM
-- thread lived only in the composer's component state: one shared
-- useState for the whole desk, not even keyed by conversation, so
-- switching threads carried the words across and closing the panel,
-- rejoining or reloading the phone lost them outright. Nothing on
-- the server held a draft at all. This table is the bench the words
-- rest on:
--   dm_drafts — one row per (conversation, author): the member's
--     in-progress reply text for that thread, plus its last-save
--     stamp. Keyed by the author's own user id — the routes only
--     ever read/write the caller's row, so a draft is private
--     scratch the other participant cannot see or overwrite.
-- Lifecycle: PUT saves (upsert on the unique pair), saving an empty
-- body deletes the row, DELETE clears it, and a landed send deletes
-- the sender's row in the same request. Deleting a conversation
-- cascades its drafts away. No draft ever becomes a message on its
-- own — sending is still the composer's explicit act.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS dm_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dm_drafts_conversation_user_uidx ON dm_drafts (conversation_id, user_id);
CREATE INDEX IF NOT EXISTS dm_drafts_user_idx ON dm_drafts (user_id);
