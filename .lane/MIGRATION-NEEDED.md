# MIGRATION NEEDED — held, NOT applied by this lane (Stack-100 #3, #27 Creator Comment Controls)

**Number: NOT claimed by this lane.** 0205 is already held by another
Stack-100 #3 lane; numbering is assigned at join. The integrator drops
the SQL below into `lib/db/migrations/<assigned>_creator_comment_controls.sql`.

**Why a migration is required:** `profile_comments` and `media_comments`
(the two comment models that exist — Shout Wall + track/video player
comments) have no state column at all: no pin, no hide, no held state can
be represented honestly today, and there is no table that can hold a
per-creator hold mode + keyword blocklist for comments (the existing
`blocked_words` column in `lib/db/src/schema/trust.ts` belongs to
live-stream chat automod rules for a stream, a different surface).
Encoding state in `body` or a JSON side-column would corrupt both.

**Drizzle source of truth already in sync:** `lib/db/src/schema/creator-social.ts`
(`profileCommentsTable`, `mediaCommentsTable`, `creatorCommentSettingsTable`)
matches this SQL column-for-column. Integrator only drops in the file.

**What the code does until this lands (already built + tested):**
- Reads: comment rows are read through helpers that treat a missing
  `status` as `'public'` and missing `pinned` as `false` (pre-migration
  rows / selects behave exactly as today). If the settings table is
  missing (Postgres 42P01), settings reads return the OFF defaults.
- Comment POSTs try the insert WITH the control columns first; on a
  missing-column error (42703) they retry with the legacy column set, so
  posting never breaks before the migration lands (the comment lands
  public, exactly as today).
- Control WRITES (pin / hide / approve / reject / settings save) that
  cannot be honoured without the schema answer
  `503 { error: "comment_controls_not_ready", … }` — nothing half-applies.

## Exact migration SQL (idempotent, no BEGIN/COMMIT, no CONCURRENTLY)

```sql
-- Creator comment controls (Stack-100 #3, #27): pin / hide /
-- held-for-review + per-creator hold mode and keyword blocklist for the
-- two existing comment models (profile_comments = Shout Wall,
-- media_comments = track/video player comments).
-- A comment's moderation state is a STATE, never a delete: 'held' is a
-- delay in the creator's review queue (visible to the creator and to
-- its author, badged as held), 'hidden' is visible to the creator and
-- its author (badged as hidden) and reversible. Defaults keep every
-- existing row exactly as it behaves today: status 'public', unpinned.
-- Prices/fees: none. Comment controls are free.

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

-- One pinned comment per target is enforced by the API (pin clears the
-- previous pin on the same wall / media item in the same request); these
-- indexes keep the pinned-first read and the held queue cheap.
CREATE INDEX IF NOT EXISTS profile_comments_target_status_idx
  ON profile_comments (profile_id, status, pinned);
CREATE INDEX IF NOT EXISTS media_comments_target_status_idx
  ON media_comments (kind, media_id, status, pinned);
CREATE INDEX IF NOT EXISTS profile_comments_author_idx
  ON profile_comments (author_user_id);
CREATE INDEX IF NOT EXISTS media_comments_author_idx
  ON media_comments (author_user_id);
```

Notes for whoever applies it:
- No backfill: defaults make every existing comment 'public' + unpinned,
  and settings default to OFF with an empty blocklist — behaviour is
  unchanged until a creator opts in.
- Rollback (if ever wanted): drop `creator_comment_settings` and the
  four added columns on each comment table; no comment row is ever
  deleted by this feature.
