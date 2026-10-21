-- 0187: Producer-custom beat license templates (competitor-gap build,
-- BeatStars parity — ~/workspace/competitor-study/music-audio.md G3).
--
-- Until now a beat could only be licensed under the site's three fixed
-- tiers (basic / premium / exclusive — names + per-beat prices on the
-- beats row; the terms themselves existed only as marketing blurbs).
-- BeatStars' moat is "unlimited customized license agreements": the
-- producer writes their own terms. This migration adds that layer:
--
--   beat_license_templates — one row per producer-defined license offer:
--     name, the producer's own price_cents, is_exclusive, and the
--     commercial terms as structured fields (delivery format, streams /
--     sales / music-video / live-performance caps — NULL cap means the
--     license does not cap that use — radio/TV allowed, term length in
--     years — NULL means no fixed term — territory, required credit
--     line, and a free-text terms note). Templates are producer-scoped:
--     a template can only be sold on its own producer's beats.
--
--   beat_licenses.template_id — the template a license was bought
--     under (NULL for the fixed tiers). ON DELETE SET NULL: the column
--     is informational; deleting a template never erases a sale.
--   beat_licenses.terms_snapshot — the terms EXACTLY as sold, copied
--     onto the license row at purchase (the UGC brand-kit / promo-card
--     snapshot discipline, migrations 0164/0181). Later template edits
--     or deletion never rewrite a sold license; buyer surfaces render
--     the sold terms from this snapshot, never from the live template.
--
-- The three fixed tiers stay as the defaults for producers who never
-- customize, and their purchases snapshot the tiers' standing terms.
-- Fee math is untouched: the 15% beats commission applies to template
-- prices exactly as it does to tier prices.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS beat_license_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id UUID NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  is_exclusive BOOLEAN NOT NULL DEFAULT false,
  format TEXT NOT NULL DEFAULT 'mp3',
  streams_cap INTEGER,
  sales_cap INTEGER,
  music_videos_cap INTEGER,
  radio_tv_allowed BOOLEAN NOT NULL DEFAULT false,
  live_performances_cap INTEGER,
  term_years INTEGER,
  territory TEXT NOT NULL DEFAULT 'Worldwide',
  credit_line TEXT,
  terms_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beat_license_templates_producer_idx
  ON beat_license_templates (producer_id);

ALTER TABLE beat_licenses
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES beat_license_templates(id) ON DELETE SET NULL;
ALTER TABLE beat_licenses
  ADD COLUMN IF NOT EXISTS terms_snapshot JSONB;
