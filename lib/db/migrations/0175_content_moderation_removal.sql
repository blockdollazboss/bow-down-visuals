-- 0175: Content moderation removal state on posts (Stack-4 admin
-- content-removal rail). Until now post/comment deletion was
-- author-only and destructive: an admin who needed a post or a
-- thread reply gone had no rail at all — the only enforcement path
-- was banning the author. These columns give posts a reversible
-- moderation state instead:
--   removed_at       — when an admin removed the item; NULL = live.
--     Every public read path in routes/social.ts (feed, single post,
--     replies, hashtag, saves, quote embeds) honors it at the read
--     layer: a removed item is served ONLY to its own author, with
--     its moderation state attached, and to nobody else.
--   removed_by_email — the acting admin (the ADMIN_EMAILS identity,
--     the only admin identity the server keeps).
--   removal_reason   — the recorded reason CATEGORY (the vocabulary
--     POST_REMOVAL_REASONS in lib/db/src/schema/
--     creator-stories-posts.ts). This is the part the author sees.
--   removal_note     — an optional free-text note for the admin
--     record; never exposed outside the admin DTO.
-- Removal is a STATE, not a delete: the row, its body and its media
-- references all stay exactly where they were, so a removal can be
-- audited and restored (restore clears all four columns). No media
-- file is ever touched by a removal.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS removed_by_email TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS removal_reason TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS removal_note TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_removal_reason_check') THEN
    ALTER TABLE posts ADD CONSTRAINT posts_removal_reason_check
      CHECK (removal_reason IS NULL OR removal_reason IN ('spam','harassment','hate_speech','violence','sexual_content','copyright','impersonation','other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS posts_removed_at_idx ON posts (removed_at) WHERE removed_at IS NOT NULL;
