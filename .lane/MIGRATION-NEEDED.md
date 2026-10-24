# MIGRATION NEEDED — held, NOT applied by this lane

**Next free number verified:** `lib/db/migrations/` in stack28/integration
@ f96d7b72 tops out at `0204_abandoned_checkouts.sql`. This is **0205**.

**Why a migration is required at all:** a Feed post today has exactly one
author (`posts.profile_id`) and there is no table that can honestly hold a
second author's consent state (pending / accepted / declined / withdrawn +
accept timestamp). Encoding it in `posts.media_urls` or
`collab_requests` would corrupt both. One new table is the whole schema
change — no existing table is altered, no column is added to `posts`
(the post stays a single row, which is precisely why engagement can
never double-count).

**What the code does until this lands (already built + tested):**
- All co-post WRITE routes probe/attempt against `post_co_authors` and
  answer `503 { error: "co_post_not_ready", … }` on Postgres 42P01 —
  no post row is created, nobody is notified, nothing half-exists.
- All READ paths (Feed enrichment, single-post read) catch 42P01 and
  behave exactly as today (no co-posts exist yet).
- The Drizzle schema (`lib/db/src/schema/collab.ts`,
  `postCoAuthorsTable`) is already in sync with this file, per the
  house rule that schema and migration ship together — the integrator
  only has to drop this file into `lib/db/migrations/`.

## Exact migration — `0205_co_posts.sql`

```sql
-- 0205_co_posts.sql
-- Co-posts & collab releases, Feed half (Stack-100 #3, #24): ONE post,
-- TWO author sides. The post row in `posts` stays single (its like /
-- reply / repost counts exist exactly once — engagement never
-- double-counts); this table records each creator's side + consent.
--
-- Status machine (api-server src/lib/co-posts.ts is the source):
--   author side starts 'accepted', co-author side starts 'pending';
--   published <=> every side has accepted_at set (kept after withdraw);
--   'declined' is pre-live only and ends the co-post;
--   'withdrawn' removes ONLY that side — the post leaves that creator's
--   profile and the other creator keeps theirs.
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (house migration rules).

CREATE TABLE IF NOT EXISTS post_co_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'co_author',
  status text NOT NULL DEFAULT 'pending',
  accepted_at timestamptz,
  responded_at timestamptz,
  withdrawn_at timestamptz,
  collab_request_id uuid REFERENCES collab_requests(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_co_authors_role_check
    CHECK (role IN ('author','co_author')),
  CONSTRAINT post_co_authors_status_check
    CHECK (status IN ('pending','accepted','declined','withdrawn'))
);

CREATE UNIQUE INDEX IF NOT EXISTS post_co_authors_post_profile_uidx
  ON post_co_authors (post_id, profile_id);
CREATE INDEX IF NOT EXISTS post_co_authors_post_idx
  ON post_co_authors (post_id);
CREATE INDEX IF NOT EXISTS post_co_authors_profile_status_idx
  ON post_co_authors (profile_id, status);
CREATE INDEX IF NOT EXISTS post_co_authors_user_status_idx
  ON post_co_authors (user_id, status);
```

Notes for whoever applies it:
- `gen_random_uuid()` is already used by every neighbouring table
  (pgcrypto / PG13+ built-in) — no extension statement needed.
- Table name, column names, check values and index names match
  `postCoAuthorsTable` in `lib/db/src/schema/collab.ts` exactly.
- No backfill: there are no co-posts before this feature exists.
- Rollback (if ever wanted) is `DROP TABLE post_co_authors;` — `posts`
  rows created as co-posts remain ordinary posts of their initiator.
