-- 0161: Storyboards (STACK-20 R2 item #19 — UPGRADE-PROGRAM 2.3, the
-- planner half). The site already GENERATES storyboards (the AI
-- script-to-shots route, the locked pre-production packs), but a member
-- had nowhere to plan a video by hand: panels they author themselves —
-- a frame image, a title, their notes, in an order they control —
-- saved as THEIR storyboard and handed into the video flow as a
-- project. Nothing on the server held that plan at all; the in-world
-- Video Desk's Ring 2 bench only autosaves song-scene drafts keyed by
-- workflow, one slot per member, with no panels to reorder.
-- This table is the bench the plan rests on:
--   storyboards — one row per storyboard: the owner, the board's
--     title, and the panels as one ordered JSONB array. A panel is
--     { id, title, notes, imageUrl, imagePrompt } — position IS the
--     array order, so a move is a rewrite of the one array inside the
--     owner's own row; there is no second table to fall out of sync.
--     imageUrl is a PERMANENT media ref (the generation rail's public
--     URL, or our own storage ref after write-time normalization) —
--     never a signed URL that can expire under a saved plan. A panel
--     with imageUrl NULL is a notes-only panel: a legitimate plan
--     state, shown as one, never dressed up with a stand-in image.
-- Lifecycle: the routes only ever read/write the caller's own rows
-- (a foreign board is a 404 on every verb, panels included); deleting
-- a board deletes its panels with it (they live inside the row).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS storyboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled storyboard',
  panels JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storyboards_user_idx ON storyboards (user_id, updated_at DESC);
