-- Creator Streaming Platform — Digital Store (0090): widen digital_sales.item_kind.
--
-- The store sells ALL kinds of digital content, not just music:
--   track   — audio track (profile_tracks)
--   video   — video / course / exclusive video (profile_videos)
--   album   — album / EP bundle (catalog entity lands later)
--   pack    — sample pack / beat pack (catalog entity lands later)
--   digital — preset / template / ebook (catalog entity lands later)
--
-- The checkout, fee-split, delivery, and dashboard pipelines are kind-agnostic;
-- each catalog entity opts in by exposing download_price_cents + a file URL.
-- Keeps the two economies separate: digital SALES = real money via Stripe;
-- Visual Bucs = AI credits. Never mix them.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'digital_sales_item_kind_check'
      AND conrelid = 'digital_sales'::regclass
  ) THEN
    ALTER TABLE digital_sales DROP CONSTRAINT digital_sales_item_kind_check;
  END IF;
END $$;

ALTER TABLE digital_sales
  ADD CONSTRAINT digital_sales_item_kind_check
  CHECK (item_kind IN ('track', 'video', 'album', 'pack', 'digital'));

CREATE INDEX IF NOT EXISTS digital_sales_kind_idx
  ON digital_sales (item_kind);
