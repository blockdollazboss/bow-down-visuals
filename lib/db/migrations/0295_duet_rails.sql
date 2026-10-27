-- 9999 (provisional — renumbered at join): Duet Rails delta
-- (Stack-200 UPGRADE #173, absorbing N3 "Duet the King").
--
-- Duets / Stitches already ship (migration 0091: profile_videos
-- .duet_with / .stitch_with, POST /videos/:id/duet + /stitch).
-- This migration adds ONLY the audit delta:
--
--   duets_enabled   — the per-video DUET-DISABLE switch held by the
--                     original creator. Default TRUE (duets open,
--                     today's behaviour); the creator flips it off
--                     per video and the rails enforce it at the
--                     duet door (UI) and at POST. Stitches are a
--                     separate kind and are not governed by it.
--   king_featured_at — the King's featured pick for the "Duet the
--                     King" launch event: set on a duet whose parent
--                     belongs to the official Thy Cheat Code profile
--                     when the house features it. The pick is a
--                     house pick (stated as such in the API payload
--                     and UI); the fan who made the duet is the
--                     credited creator of the featured row.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY.

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS duets_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS king_featured_at timestamptz;

CREATE INDEX IF NOT EXISTS profile_videos_king_featured_idx
  ON profile_videos (king_featured_at DESC)
  WHERE king_featured_at IS NOT NULL;
