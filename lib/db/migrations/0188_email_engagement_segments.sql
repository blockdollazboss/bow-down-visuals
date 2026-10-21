-- 0188: Email engagement tracking + subscriber tags/segments
-- (competitor-gap build from ~/workspace/competitor-study/creator-business.md:
--  Stan/Beacons/Laylo treat engagement + segments as the foundation of the
--  fan-data layer; Bow Down's email rail had neither).
--
-- The gap: email_subscribers.opens was a reserved column nothing wrote —
-- no tracking pixel, no provider webhook — so the dashboard honestly
-- reported opens as NOT TRACKED, and subscribers carried no tags or
-- segments at all. This migration lands the data layer for the real
-- signal path built in the same stack:
--   * sends dispatch per-recipient through the house Resend rail, one
--     email_campaign_deliveries row per (campaign, subscriber), with a
--     random token the tracking pixel / click redirect / one-click
--     unsubscribe key off;
--   * opens + clicks record into email_engagement_events (first signal
--     wins — the unique indexes below make a repeat signal from any
--     source a no-op, so an open counts exactly once per delivery);
--   * the signature-verified Resend webhook feeds the same event table
--     (opens/clicks it observes, bounces, complaints — a complaint also
--     suppresses the subscriber);
--   * manual tags (email_tags + email_subscriber_tags) and saved
--     segments (email_segments) give creators an audience layer;
--     automatic tags (presave/member/buyer/engagement) are derived at
--     read time from rows the house already keeps, never stored.
--
-- Unsubscribe suppression stays absolute: segment evaluation and
-- campaign dispatch both filter unsubscribed_at IS NULL first, and no
-- criteria can re-include an unsubscribed address.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS segment_id UUID;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS delivered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_subscribers ADD COLUMN IF NOT EXISTS clicks INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS email_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES email_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_tags_list_name_ux ON email_tags (list_id, name);
CREATE INDEX IF NOT EXISTS email_tags_list_idx ON email_tags (list_id);

CREATE TABLE IF NOT EXISTS email_subscriber_tags (
  subscriber_id UUID NOT NULL REFERENCES email_subscribers(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES email_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, tag_id)
);
CREATE INDEX IF NOT EXISTS email_subscriber_tags_tag_idx ON email_subscriber_tags (tag_id);

CREATE TABLE IF NOT EXISTS email_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES email_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  criteria TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_segments_list_idx ON email_segments (list_id);

-- The campaigns.segment_id FK can only land once email_segments
-- exists (the column was added above, before this table).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_campaigns_segment_id_fkey') THEN
    ALTER TABLE email_campaigns
      ADD CONSTRAINT email_campaigns_segment_id_fkey
      FOREIGN KEY (segment_id) REFERENCES email_segments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS email_campaign_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES email_subscribers(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider_message_id TEXT,
  token TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_deliveries_token_idx ON email_campaign_deliveries (token);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_deliveries_campaign_sub_idx ON email_campaign_deliveries (campaign_id, subscriber_id);
CREATE INDEX IF NOT EXISTS email_campaign_deliveries_provider_msg_idx ON email_campaign_deliveries (provider_message_id);
CREATE INDEX IF NOT EXISTS email_campaign_deliveries_campaign_idx ON email_campaign_deliveries (campaign_id);

CREATE TABLE IF NOT EXISTS email_campaign_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES email_campaign_deliveries(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_links_token_idx ON email_campaign_links (token);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_links_delivery_url_idx ON email_campaign_links (delivery_id, target_url);

CREATE TABLE IF NOT EXISTS email_engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES email_campaign_deliveries(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL,
  subscriber_id UUID NOT NULL,
  list_id UUID NOT NULL,
  kind TEXT NOT NULL,
  link_id UUID,
  source TEXT NOT NULL,
  provider_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- First signal wins: one open / bounce / complaint per delivery, ever.
CREATE UNIQUE INDEX IF NOT EXISTS email_engagement_delivery_kind_idx
  ON email_engagement_events (delivery_id, kind) WHERE kind <> 'click';
-- …and one click per (delivery, link).
CREATE UNIQUE INDEX IF NOT EXISTS email_engagement_delivery_click_idx
  ON email_engagement_events (delivery_id, kind, link_id) WHERE kind = 'click';
CREATE UNIQUE INDEX IF NOT EXISTS email_engagement_provider_event_idx
  ON email_engagement_events (provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_engagement_campaign_idx ON email_engagement_events (campaign_id, kind);
CREATE INDEX IF NOT EXISTS email_engagement_subscriber_idx ON email_engagement_events (subscriber_id, kind);
