# MIGRATION NEEDED — held, NOT applied by this lane (Wave 3 co-release; supersedes the phase-1 note in git history on this branch)

**Numbering:** `lib/db/migrations/` in this branch tops out at
`0204_abandoned_checkouts.sql`. Phase 1 (stack29/coposts) already holds
**0205** for `post_co_authors` in ITS `.lane/MIGRATION-NEEDED.md` (kept
in this branch's history — the file at the parent commit). This lane
therefore claims **0206**. If the join applies the two lanes in a
different order, renumber this file — nothing in the code depends on
the number.

**Why a migration is required at all:** a co-release needs a consent
ledger over a MONEY-BEARING split between two creator accounts. No
existing table can honestly hold it:
- `distribution_royalty_splits` is owner-only and versioned by
  unilateral edit (a PUT supersedes) — payees are names/emails, and no
  row records a second creator account's consent. Reusing it would let
  the owner rewrite a "consented" split alone, breaking immutability.
- `wave8_royalty_splits.collaborators` is free-form JSON with no
  consent state at all.
- `distribution_releases` / `store_products` are single-owner rows.
Two new tables are the whole schema change; no existing table is
altered. The Drizzle schema (`coReleasesTable` + `coReleaseSidesTable`
in `lib/db/src/schema/collab.ts`) is already in sync with this file.

**What the code does until this lands (built + tested):**
- All co-release WRITE routes probe both tables first and answer
  `503 { error: "co_release_not_ready", … }` on Postgres 42P01 —
  nothing is created, nobody is notified.
- READ routes (`/mine`, `/by-profile/:id`) treat a missing table as
  "no co-releases yet". Attribution answers the same honest 503.
- Split immutability is enforced TWICE: the pure machine offers no
  post-publish mutation, and the migration's trigger (below) refuses
  any UPDATE that changes `agreed_share_pct`, `agreed_at`, or
  `published_at` once set — even a hand-written SQL edit cannot
  rewrite an agreed split.

## Exact migration — `0206_co_releases.sql`

```sql
-- 0206_co_releases.sql
-- Co-releases (Stack-100 #3 Wave 3, co-posts phase 2): ONE existing
-- release (distribution_releases) or store product (store_products)
-- published to BOTH creators' profiles, with a royalty split BOTH
-- creators approve before anything publishes.
--
-- Consent machine (api-server src/lib/co-releases.ts is the source):
--   author side starts 'accepted' with the proposed share_pct;
--   co-author side starts 'pending'; published <=> head.published_at
--   is set, which happens exactly when the second side accepts — at
--   that same moment each side's agreed_share_pct is frozen from the
--   proposed share it approved. 'declined' is pre-live only;
--   'withdrawn' removes ONLY that side's profile copy and never
--   touches the agreed columns.
-- Shares are creator-entered percentages; the per-row CHECK guards
-- range only — the sum-to-100 rule spans rows, so it is enforced in
-- the API machine, exactly like distribution_royalty_splits.
-- The platform fee is NOT in these tables: store rails take their
-- flat 5% first; splits divide creator amounts only.
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (house rules).

CREATE TABLE IF NOT EXISTS co_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_kind text NOT NULL DEFAULT 'release',
  item_id uuid NOT NULL,
  item_title text NOT NULL DEFAULT '',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT co_releases_item_kind_check
    CHECK (item_kind IN ('release','product'))
);

CREATE TABLE IF NOT EXISTS co_release_sides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_release_id uuid NOT NULL REFERENCES co_releases(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'co_author',
  status text NOT NULL DEFAULT 'pending',
  share_pct numeric(5,2) NOT NULL,
  agreed_share_pct numeric(5,2),
  accepted_at timestamptz,
  responded_at timestamptz,
  withdrawn_at timestamptz,
  agreed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT co_release_sides_role_check
    CHECK (role IN ('author','co_author')),
  CONSTRAINT co_release_sides_status_check
    CHECK (status IN ('pending','accepted','declined','withdrawn')),
  CONSTRAINT co_release_sides_share_range_check
    CHECK (share_pct > 0 AND share_pct < 100),
  CONSTRAINT co_release_sides_agreed_range_check
    CHECK (agreed_share_pct IS NULL OR (agreed_share_pct > 0 AND agreed_share_pct < 100))
);

CREATE UNIQUE INDEX IF NOT EXISTS co_release_sides_release_profile_uidx
  ON co_release_sides (co_release_id, profile_id);
CREATE INDEX IF NOT EXISTS co_releases_item_idx
  ON co_releases (item_kind, item_id);
CREATE INDEX IF NOT EXISTS co_releases_published_idx
  ON co_releases (published_at);
CREATE INDEX IF NOT EXISTS co_release_sides_release_idx
  ON co_release_sides (co_release_id);
CREATE INDEX IF NOT EXISTS co_release_sides_profile_status_idx
  ON co_release_sides (profile_id, status);
CREATE INDEX IF NOT EXISTS co_release_sides_user_status_idx
  ON co_release_sides (user_id, status);

-- Immutability: once frozen at publish, the agreed split and the
-- publish moment can never be rewritten — by the API or by hand.
CREATE OR REPLACE FUNCTION co_release_freeze_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.agreed_share_pct IS NOT NULL AND NEW.agreed_share_pct IS DISTINCT FROM OLD.agreed_share_pct THEN
    RAISE EXCEPTION 'co_release agreed_share_pct is immutable once agreed';
  END IF;
  IF OLD.agreed_at IS NOT NULL AND NEW.agreed_at IS DISTINCT FROM OLD.agreed_at THEN
    RAISE EXCEPTION 'co_release agreed_at is immutable once agreed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS co_release_sides_freeze ON co_release_sides;
CREATE TRIGGER co_release_sides_freeze
  BEFORE UPDATE ON co_release_sides
  FOR EACH ROW EXECUTE FUNCTION co_release_freeze_guard();

CREATE OR REPLACE FUNCTION co_release_head_freeze_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'co_release published_at is immutable once published';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS co_releases_freeze ON co_releases;
CREATE TRIGGER co_releases_freeze
  BEFORE UPDATE ON co_releases
  FOR EACH ROW EXECUTE FUNCTION co_release_head_freeze_guard();
```

Notes for whoever applies it:
- `item_id` carries no FK on purpose: it points at one of two tables
  (`distribution_releases` or `store_products`); the route validates
  ownership against the correct table at draft time, and
  `item_title` is snapshotted so lists survive item deletion.
- No backfill: there are no co-releases before this feature exists.
- Rollback is `DROP TABLE co_release_sides; DROP TABLE co_releases;`
  (plus the two guard functions) — the underlying releases/products
  remain ordinary solo items of their owners.

## Money-rail hold (reported, not faked)
- **Releases:** attribution IS built in the read layer —
  `GET /api/co-releases/:id/attribution` applies the frozen split to
  the author's logged income (`money_entries` linked to the release,
  on/after the publish date) — the same accounting model as
  `GET /api/splits/overview`. It is NOT mirrored into
  `distribution_royalty_splits`, deliberately: that ledger's owner-only
  PUT supersedes versions unilaterally, so mirroring would let one
  side silently supersede a split the other side consented to.
  Integrator decision if the two views should ever merge: the PUT
  must refuse to supersede a version that came from a published
  co-release.
- **Products:** attribution IS built — the same endpoint splits
  completed `store_orders.creator_amount_cents` (post-fee creator
  amount) for orders on/after publish. The checkout rail itself is
  untouched: it still records one creator amount to the item's owner;
  splitting AT the rail (per-side order rows / balances) would need
  its own migration + money review and is NOT claimed here. No payout
  exists anywhere in this lane — the site pays nobody real money.
