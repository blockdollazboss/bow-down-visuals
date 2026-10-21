-- 0198: Back-catalog migration assistant — one row per piece of a
-- creator's existing body of work on its way home.
--
-- The gap (competitor study, social-platforms C4/G4): a creator arriving
-- with hundreds of TikToks and YouTube videos faced manual re-upload,
-- one file at a time, losing titles, captions, chapters and grouping on
-- the way. Platform APIs do NOT offer third parties a clean "download
-- my whole catalog" pipe, and this table never pretends otherwise:
--
--   * 'connected' rows are listed only from the creator's OWN connected
--     accounts (social_accounts), only where the granted OAuth scopes
--     actually allow reading the catalog — Instagram
--     (instagram_business_basic) and Facebook Pages
--     (pages_read_engagement). TikTok's granted scopes
--     (user.info.basic, video.upload) cannot read a catalog at all, so
--     TikTok parks in the UI with the reason stated and produces NO
--     rows here. YouTube/X/Twitch are display-only links (no OAuth) and
--     likewise produce no rows.
--   * 'upload' rows are the creator's own files, bulk-uploaded to R2
--     under their own key prefix — the always-available path.
--
-- The row is the progress unit: listed → fetching → here (file copied
-- to Bow Down storage, a draft library row exists) → ready (AI rebuild
-- draft waiting) → approved (draft applied; videos publish). 'blocked'
-- = the platform would not hand over the file, with the reason in
-- status_note in plain words; nothing is scraped around a block.
-- 'failed' = a retryable fetch failure. 'dismissed' stops a listed
-- item resurrecting on re-scan (the dedupe unique index keeps the row).
--
-- Only CONTENT moves through this table. Followers/audiences do not
-- transfer — no platform allows it — and no column here claims one did.
--
-- The feature is FREE end to end: no credits table is referenced by the
-- catalog-import code (pinned by a source test).
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS catalog_import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source_kind TEXT NOT NULL,
  platform TEXT,
  social_account_id UUID,
  external_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  original_caption TEXT,
  original_url TEXT,
  remote_file_url TEXT,
  remote_thumbnail_url TEXT,
  media_url TEXT,
  storage_key TEXT,
  thumbnail_url TEXT,
  duration_sec INTEGER,
  status TEXT NOT NULL DEFAULT 'listed',
  status_note TEXT,
  draft JSONB,
  target_kind TEXT,
  target_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_import_items_user_idx ON catalog_import_items (user_id, status);
CREATE INDEX IF NOT EXISTS catalog_import_items_account_idx ON catalog_import_items (social_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS catalog_import_items_dedupe_ux ON catalog_import_items (user_id, platform, external_id);
