-- 9999 (PROVISIONAL — renumber at join): Plain-Words Deals
-- (Stack-200 upgrade #164).
--
-- Two creators WRITE a collab deal in plain words (what each side
-- does / gets), both sign in-app, and at full signature the deal's
-- split is wired into the EXISTING rails by routes/plain-deals.ts:
-- a co-release for a release/product item, the product's sale-splits
-- list for a store/shop product. These tables hold the DEAL; they
-- are not a second splits machine. The pure machine is
-- artifacts/api-server/src/lib/plain-deals.ts.
--
-- plain_deals: the head. agreed_shares + signed_text + signed_at are
-- written exactly once, in the request completing the second
-- signature, and never mutate after (a different deal is a new
-- deal). split_attach records the rail wiring
-- ({ rail, refId, at } jsonb) or stays NULL for a record-only deal.
--
-- plain_deal_sides: exactly two rows per deal (author + partner):
-- their plain words, their proposed share (numeric(5,2), validated
-- by the co-releases validateSplit machine — sums to 100), and their
-- signature state (pending / signed / declined / withdrawn).
--
-- The platform fee is never part of a deal split: the rails take
-- their fee first and the split divides the creator amount, same as
-- co-releases and sale-splits. No prices are introduced here.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY.

CREATE TABLE IF NOT EXISTS plain_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  item_kind text NOT NULL DEFAULT 'general',
  item_id uuid,
  item_title text NOT NULL DEFAULT '',
  agreed_shares jsonb,
  signed_text text,
  signed_at timestamptz,
  split_attach jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plain_deals_item_idx ON plain_deals (item_kind, item_id);
CREATE INDEX IF NOT EXISTS plain_deals_signed_idx ON plain_deals (signed_at);
CREATE INDEX IF NOT EXISTS plain_deals_created_idx ON plain_deals (created_at);

CREATE TABLE IF NOT EXISTS plain_deal_sides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plain_deal_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'partner',
  status text NOT NULL DEFAULT 'pending',
  does_text text NOT NULL DEFAULT '',
  gets_text text NOT NULL DEFAULT '',
  share_pct numeric(5,2) NOT NULL,
  signed_name text,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS plain_deal_sides_deal_profile_uidx
  ON plain_deal_sides (plain_deal_id, profile_id);
CREATE INDEX IF NOT EXISTS plain_deal_sides_deal_idx ON plain_deal_sides (plain_deal_id);
CREATE INDEX IF NOT EXISTS plain_deal_sides_profile_status_idx ON plain_deal_sides (profile_id, status);
CREATE INDEX IF NOT EXISTS plain_deal_sides_user_status_idx ON plain_deal_sides (user_id, status);
