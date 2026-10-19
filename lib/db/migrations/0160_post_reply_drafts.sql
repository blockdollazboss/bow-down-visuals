-- 0160: Post reply drafts (STACK-20 R2 item #8 — UPGRADE-PROGRAM 2.19,
-- the reply-drafts bench at the Community Board). The board's per-post
-- reply composer held its words in component state only: closing the
-- thread, leaving the Hall or reloading the phone lost a half-written
-- answer outright, and the composer's tone lived nowhere at all. This
-- table is the bench those words rest on, riding the dm_drafts pattern
-- (0157):
--   post_reply_drafts — one row per (post, author): the member's
--     in-progress reply text for that board post, the tone they picked
--     for it (the Comment Reply Assistant's own set — hype / grateful /
--     playful / professional — stored as metadata on the draft; no
--     generation is wired to it), plus its last-save stamp. Keyed by
--     the author's own user id — the routes only ever read/write the
--     caller's row, so a draft is private scratch no other member can
--     see or overwrite.
-- Lifecycle: PUT saves (upsert on the unique pair), saving an empty
-- body deletes the row, DELETE clears it, and a landed reply deletes
-- the sender's row in the same request (see routes/social.ts). A
-- draft never becomes a reply on its own — sending is still the
-- composer's explicit act through POST /posts/:id/reply. Deleting the
-- post cascades its drafts away.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS post_reply_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  body TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'hype',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS post_reply_drafts_post_user_uidx ON post_reply_drafts (post_id, user_id);
CREATE INDEX IF NOT EXISTS post_reply_drafts_user_idx ON post_reply_drafts (user_id);
