-- 0213: AI alt-text at publish doors (Stack-100 #3, #29) — the description a
-- screen reader speaks for an image/video thumbnail. Creator-written alt
-- always wins verbatim; a vision call proposes the text on an EMPTY door.
--   * profile_videos.thumbnail_alt_text — the video poster's poster image
--   * shop_products.image_alt_text      — the customer-shop product shot
--   * store_products.media_alt_texts    — the storefront gallery, a jsonb
--     ARRAY aligned by index with media_urls ('' = no alt for that item)
-- Length ≤400 chars is enforced HERE as a CHECK and again in the app
-- (lib/alt-text.ts) so a direct write cannot stuff a paragraph in.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE profile_videos ADD COLUMN IF NOT EXISTS thumbnail_alt_text text;

ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS image_alt_text text;

ALTER TABLE store_products ADD COLUMN IF NOT EXISTS media_alt_texts jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE profile_videos ADD CONSTRAINT profile_videos_thumbnail_alt_text_len_check
    CHECK (thumbnail_alt_text IS NULL OR char_length(thumbnail_alt_text) <= 400);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE shop_products ADD CONSTRAINT shop_products_image_alt_text_len_check
    CHECK (image_alt_text IS NULL OR char_length(image_alt_text) <= 400);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
