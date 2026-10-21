-- 0197: Email automation sequences (post-purchase thank-you,
-- abandoned checkout, membership winback) on the tracked email rail.
--
-- The gap: campaigns are one-off sends a creator pushes by hand. The
-- fan-data layer (0188) measured engagement and built audiences, but
-- nothing reacted to the moments that matter — a purchase, a checkout
-- that never paid, a membership that lapsed. This migration lands the
-- data layer for three starter automations, one row per (list, kind),
-- materialized lazily with enabled = FALSE: nothing sends for a
-- creator who never switches an automation on.
--
-- Sends ride the EXISTING tracked rail, honestly:
--   * each automation SEND gets its own carrier email_campaigns row
--     (marked by the new automation_id column — deliveries are unique
--     per campaign+subscriber, and every physical email needs its own
--     delivery row/token); deliveries, wrapped links, the tracking
--     pixel, one-click unsubscribe, and the Resend webhook all
--     resolve through the carrier exactly like a newsletter send.
--     Carrier campaigns are filtered out of the newsletter history
--     and manual dispatch refuses them. email_automations.campaign_id
--     points at the latest carrier.
--   * email_automation_sends is the claim ledger: one row per
--     (automation, trigger event), and its unique index is the dedupe
--     law — the same purchase / checkout / lapse can never email a
--     fan twice, however often the sweeper runs. Skips are recorded
--     too ('skipped_unsubscribed'); trigger events whose address is
--     not a subscriber of the list are not actionable and get no row.
--
-- Trigger sources are rows the house already keeps — never invented:
--   post_purchase       shop_events 'sale' rows (paid truth since
--                       0144, buyer email on the row) + digital_sales
--                       rows still 'completed' (buyer email resolved
--                       through the auth rail at send time)
--   abandoned_checkout  shop_events 'pending_sale' rows that never
--                       flip to 'sale'. Only the shop card checkout
--                       writes pending rows, so this trigger honestly
--                       cannot see checkouts started anywhere else —
--                       the UI copy says exactly that.
--   membership_winback  fan_members rows in canceled / expired.
--
-- Unsubscribe suppression stays absolute: the runner re-checks the
-- subscriber at send time and records a skip instead of sending.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS automation_id UUID;
CREATE INDEX IF NOT EXISTS email_campaigns_automation_idx ON email_campaigns (automation_id);

CREATE TABLE IF NOT EXISTS email_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES email_lists(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  delay_hours INTEGER NOT NULL DEFAULT 24,
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,
  enabled_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_automations_list_kind_ux ON email_automations (list_id, kind);
CREATE INDEX IF NOT EXISTS email_automations_enabled_idx ON email_automations (enabled);

CREATE TABLE IF NOT EXISTS email_automation_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES email_automations(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES email_subscribers(id) ON DELETE CASCADE,
  delivery_id UUID REFERENCES email_campaign_deliveries(id) ON DELETE SET NULL,
  trigger_kind TEXT NOT NULL,
  trigger_ref TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_automation_sends_dedupe_ux ON email_automation_sends (automation_id, trigger_ref);
CREATE INDEX IF NOT EXISTS email_automation_sends_automation_idx ON email_automation_sends (automation_id, created_at);
