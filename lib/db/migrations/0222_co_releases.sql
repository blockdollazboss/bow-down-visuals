-- 0222: Co-releases (Stack-100 #3 Wave 3, lane 2 — numbered at the
-- join; the lane's own 0206 label is void). ONE existing release
-- (distribution_releases) or store product (store_products) published
-- to BOTH creators' profiles, with a royalty split BOTH creators
-- approve before anything publishes.
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
