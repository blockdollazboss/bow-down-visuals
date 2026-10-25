-- 0232: Keyword automations (Wave 4 #32 — the ManyChat pattern).
-- A creator defines keyword rules: when a fan comments the keyword on
-- the creator's post / media / profile wall / live chat, the fan
-- instantly gets an in-app DM from the creator (the site's own
-- messages rail — conversations/messages), and if the rule asks, the
-- fan can reply in that DM with an email address that is captured
-- into the creator's EXISTING email list (email_subscribers — never a
-- new silo).
--
-- Laws baked into the shape:
--   - enabled defaults FALSE: nothing ever sends for a creator who
--     hasn't switched a rule on (same law as email_automations 0198).
--   - keyword_automation_events is the honest audit log + the dedupe
--     ledger: the partial unique index makes one fired DM per
--     (rule, fan, surface, surface ref) a database fact — a fan can
--     never be auto-DMed twice by the same rule about the same post,
--     however the trigger path is retried.
--   - keyword_automation_captures holds at most ONE pending email
--     capture per (rule, fan) — the partial unique index again.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS keyword_automation_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL,
  list_id         uuid REFERENCES email_lists(id) ON DELETE SET NULL,
  keyword         text NOT NULL,
  surfaces        jsonb NOT NULL DEFAULT '["post"]'::jsonb,
  dm_body         text NOT NULL,
  capture_email   boolean NOT NULL DEFAULT false,
  enabled         boolean NOT NULL DEFAULT false,
  enabled_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS keyword_automation_rules_creator_idx
  ON keyword_automation_rules (creator_user_id);

CREATE TABLE IF NOT EXISTS keyword_automation_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         uuid NOT NULL REFERENCES keyword_automation_rules(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL,
  fan_user_id     uuid NOT NULL,
  surface         text NOT NULL,
  surface_ref     text NOT NULL,
  outcome         text NOT NULL,
  dm_message_id   uuid,
  captured_email  text,
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS keyword_automation_events_creator_idx
  ON keyword_automation_events (creator_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS keyword_automation_events_rule_idx
  ON keyword_automation_events (rule_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS keyword_automation_events_dedupe_ux
  ON keyword_automation_events (rule_id, fan_user_id, surface, surface_ref)
  WHERE outcome = 'sent';

CREATE TABLE IF NOT EXISTS keyword_automation_captures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         uuid NOT NULL REFERENCES keyword_automation_rules(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL,
  fan_user_id     uuid NOT NULL,
  conversation_id uuid NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  captured_email  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  captured_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS keyword_automation_captures_pending_ux
  ON keyword_automation_captures (rule_id, fan_user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS keyword_automation_captures_fan_idx
  ON keyword_automation_captures (fan_user_id, status);
