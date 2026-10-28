-- 0299: Per-user device-push preferences (Stack500 push foundation —
-- owner directive Oct 28, 2026: "my app should have real notifications
-- that ping your devices").
--
-- The web-push rails already exist: push_subscriptions (0133) stores
-- browser subscriptions, /api/push/* registers them, and lib/push.ts
-- delivers — but until now the ONLY wired event was go-live alerts and
-- there was no per-user say in WHAT may ping their devices. This table
-- is that say: one row per user, one switch per event category.
--
--   money     sales, payout-ready, plan & credit-pack events  (default ON)
--   messages  DMs and priority DMs                            (default ON)
--   live      go-live alerts (own streams + followed creators)(default ON)
--   mentions  @mentions and tags                              (default ON)
--   social    follows, likes, low-value social                (default OFF)
--
-- No row = the defaults above (the reader in lib/push-events.ts
-- materializes them). Preferences gate the DEVICE PUSH only — the
-- in-app bell always lands its row, so turning a category off silences
-- the ping, never the record.
CREATE TABLE IF NOT EXISTS push_notification_prefs (
  user_id uuid PRIMARY KEY,
  money_enabled boolean NOT NULL DEFAULT true,
  messages_enabled boolean NOT NULL DEFAULT true,
  live_enabled boolean NOT NULL DEFAULT true,
  mentions_enabled boolean NOT NULL DEFAULT true,
  social_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
