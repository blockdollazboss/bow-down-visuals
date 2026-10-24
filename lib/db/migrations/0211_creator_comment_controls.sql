-- 0211: Creator comment controls (Stack-100 #3, #27) — pin / hide /
-- held-for-review + per-creator hold mode and keyword blocklist for the
-- two existing comment models (profile_comments = Shout Wall,
-- media_comments = track/video player comments).
-- A comment's moderation state is a STATE, never a delete: 'held' is a
-- delay in the creator's review queue (visible to the creator and to
-- its author, badged as held), 'hidden' is visible to the creator and
-- its author (badged as hidden) and reversible. Defaults keep every
-- existing row exactly as it behaves today: status 'public', unpinned.
-- Prices/fees: none. Comment controls are free.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE profile_comments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'public';
ALTER TABLE profile_comments ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE profile_comments ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
ALTER TABLE profile_comments ADD COLUMN IF NOT EXISTS held_reason text;

ALTER TABLE media_comments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'public';
ALTER TABLE media_comments ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE media_comments ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
ALTER TABLE media_comments ADD COLUMN IF NOT EXISTS held_reason text;

DO $$ BEGIN
  ALTER TABLE profile_comments ADD CONSTRAINT profile_comments_status_check
    CHECK (status IN ('public','held','hidden'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE media_comments ADD CONSTRAINT media_comments_status_check
    CHECK (status IN ('public','held','hidden'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS creator_comment_settings (
  profile_id uuid PRIMARY KEY REFERENCES creator_profiles(id) ON DELETE CASCADE,
  hold_mode text NOT NULL DEFAULT 'off',
  blocked_words jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_comment_settings_hold_mode_check
    CHECK (hold_mode IN ('off','all','first_time'))
);

CREATE INDEX IF NOT EXISTS profile_comments_target_status_idx
  ON profile_comments (profile_id, status, pinned);
CREATE INDEX IF NOT EXISTS media_comments_target_status_idx
  ON media_comments (kind, media_id, status, pinned);
CREATE INDEX IF NOT EXISTS profile_comments_author_idx
  ON profile_comments (author_user_id);
CREATE INDEX IF NOT EXISTS media_comments_author_idx
  ON media_comments (author_user_id);
