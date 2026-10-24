-- 0223: Provenance linkage for scheduled posts (Stack-100 #3, wave 3,
-- lane w3-provenance-publish — numbered at the join; the lane's own
-- 0205 label is void): when a creator schedules/publishes an asset
-- that has a provenance record, the record id + a factual snapshot
-- (tool/model, AI state, licence, disclosure line) ride the
-- scheduled_posts row, so the linkage survives until the post fires —
-- it is never re-derived from the media URL at fire time.
-- Nullable: posts scheduled any other way keep provenance NULL.
ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS provenance jsonb;
