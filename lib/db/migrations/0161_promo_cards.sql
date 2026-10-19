-- 0161: Release promo card records (STACK-20 R2 item #17 — promo-card
-- history + per-card actions). Until now a generated promo-card pack
-- existed only in the POST /api/promo-cards response and as objects in
-- permanent storage: no table recorded that a card was ever made, so
-- there was nothing a history list could read and nothing a delete
-- could own. This table is that record:
--   promo_cards — one row per generated card, written by the
--     generation route in the same request that mints the card
--     (one pack = one job_id, one row per platform size). Keyed by
--     the owner's user id — the list and delete routes only ever
--     touch the caller's rows; another member's card id reads as
--     "not found", never as forbidden-but-real.
--   storage_ref holds the STABLE storage ref (r2:// or supabase://);
--   read paths mint a fresh playable URL from it on every read.
--   Deleting a card deletes the row only — the storage object is
--   never purged by these routes (media removal is a deliberate act,
--   not a side effect of tidying a list).
-- Cards generated before this migration live only as storage objects
-- with no row and no recoverable title/artist record, so history
-- begins with the first pack generated after this ships — nothing is
-- backfilled or invented for them.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS promo_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  job_id TEXT NOT NULL,
  style TEXT NOT NULL,
  size TEXT NOT NULL,
  storage_ref TEXT NOT NULL,
  release_title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  caption TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promo_cards_user_created_idx ON promo_cards (user_id, created_at);
CREATE INDEX IF NOT EXISTS promo_cards_job_idx ON promo_cards (job_id);
