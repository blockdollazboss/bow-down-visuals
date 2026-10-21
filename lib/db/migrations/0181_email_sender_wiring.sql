-- 0181: Email sender wiring — the Resend campaign sender
-- (artifacts/api-server/src/lib/email-campaign-sender.ts) needs three
-- things the v1 queue-only schema (0015) could not express:
--
--   1. Welcome SEQUENCE steps 2 and 3 on the list itself. Step 1 already
--      lives in welcome_subject/welcome_body; steps 2 (+24h) and 3
--      (+72h after step 2) get their own stored templates so the sender
--      templates from stored content, not hard-coded copy.
--   2. email_sequence_deliveries — one queued row per subscriber per
--      step, drained by the sender when scheduled_for comes due. The
--      (subscriber_id, step) unique index makes queueing idempotent.
--   3. email_campaign_sends — the per-recipient send log: who actually
--      got what, provider id, and the honest per-recipient error when
--      one address fails without killing the batch.
--
-- Plus: a per-subscriber unsubscribe_token so every send can carry a
-- working one-click unsubscribe link (List-Unsubscribe), and a `kind`
-- discriminator on campaigns.
--
-- Must stay in sync with lib/db/src/schema/email-lists.ts.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE email_lists ADD COLUMN IF NOT EXISTS welcome2_subject TEXT;
ALTER TABLE email_lists ADD COLUMN IF NOT EXISTS welcome2_body TEXT;
ALTER TABLE email_lists ADD COLUMN IF NOT EXISTS welcome3_subject TEXT;
ALTER TABLE email_lists ADD COLUMN IF NOT EXISTS welcome3_body TEXT;

ALTER TABLE email_subscribers ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT;

UPDATE email_subscribers
SET unsubscribe_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE unsubscribe_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS email_subscribers_unsubscribe_token_idx
  ON email_subscribers (unsubscribe_token);

ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'campaign';

CREATE TABLE IF NOT EXISTS email_sequence_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES email_lists(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES email_subscribers(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_sequence_deliveries_sub_step_idx
  ON email_sequence_deliveries (subscriber_id, step);

CREATE INDEX IF NOT EXISTS email_sequence_deliveries_due_idx
  ON email_sequence_deliveries (status, scheduled_for);

CREATE TABLE IF NOT EXISTS email_campaign_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE,
  delivery_id UUID REFERENCES email_sequence_deliveries(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES email_subscribers(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_campaign_sends_campaign_idx
  ON email_campaign_sends (campaign_id);

CREATE INDEX IF NOT EXISTS email_campaign_sends_delivery_idx
  ON email_campaign_sends (delivery_id);
