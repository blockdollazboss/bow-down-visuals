-- 0164: UGC Product Ads (owner order Oct 19, 2026 — "we need to add
-- ugc product ads" + "this is for business too" = both sides).
-- One feature docked in Promote, two record families:
--   ugc_ads — one row per ad a member makes: their own shop product
--     (name/price/image snapshotted server-side from shop_products,
--     never trusted from the client), an uploaded product, their own
--     business product fronted by a generated creator persona, or an
--     ad answering a claimed brief (brief_id). Carries the script,
--     the caption track, the brand-kit snapshot applied at generation
--     time, and the finished video's STABLE storage ref (playable
--     URLs are minted per read, never stored). Status walks
--     draft -> generating -> ready | failed.
--   ugc_briefs — the business side's board: a brand posts a brief
--     (product, what they want, style, deadline); a creator claims
--     it, makes the ad with the same tool, delivers it back through
--     the board; the brand approves or closes it. Status walks
--     open -> claimed -> delivered -> approved (brand may close an
--     open/claimed brief; a claimer may release back to open).
--     NO PAYMENT RAIL exists in these tables by law — the site pays
--     nobody real money, so there is no price, fee, escrow, or
--     Visual Bucs column for briefs; payment is arranged between the
--     brand and the creator directly.
-- Owner-scoping: rows are keyed by user id; foreign records read as
-- "not found" everywhere (the one deliberate exception: a brand may
-- read the ad delivered to their own brief, to review it).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS ugc_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_user_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  product_image_ref TEXT,
  product_url TEXT,
  details TEXT NOT NULL,
  style TEXT NOT NULL,
  deadline TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  claimed_by_user_id UUID,
  delivered_ad_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ugc_briefs_status_created_idx ON ugc_briefs (status, created_at);
CREATE INDEX IF NOT EXISTS ugc_briefs_brand_created_idx ON ugc_briefs (brand_user_id, created_at);
CREATE INDEX IF NOT EXISTS ugc_briefs_claimer_created_idx ON ugc_briefs (claimed_by_user_id, created_at);

CREATE TABLE IF NOT EXISTS ugc_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  brief_id UUID,
  product_source TEXT NOT NULL,
  shop_product_id UUID,
  product_name TEXT NOT NULL,
  product_blurb TEXT,
  product_price_cents INTEGER,
  product_image_ref TEXT,
  style TEXT NOT NULL,
  face_image_ref TEXT,
  face_kind TEXT NOT NULL DEFAULT 'none',
  script JSONB,
  captions JSONB NOT NULL DEFAULT '[]'::jsonb,
  captions_burned BOOLEAN NOT NULL DEFAULT false,
  brand_snapshot JSONB,
  video_ref TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  credits_charged INTEGER NOT NULL DEFAULT 0,
  generation_key TEXT,
  video_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ugc_ads_user_created_idx ON ugc_ads (user_id, created_at);
CREATE INDEX IF NOT EXISTS ugc_ads_brief_idx ON ugc_ads (brief_id);
