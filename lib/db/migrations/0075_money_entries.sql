-- Creator Money Tracker: per-user income/expense ledger. Idempotent.
-- Powers the Money Tracker tab in the Monetization Coach (/coach): monthly
-- P&L, category breakdowns, running totals. Pure UI + DB — no credits.
CREATE TABLE IF NOT EXISTS money_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
  category TEXT NOT NULL DEFAULT 'other',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note TEXT NOT NULL DEFAULT '',
  source TEXT,
  entry_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS money_entries_user_date_idx
  ON money_entries (user_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS money_entries_user_type_idx
  ON money_entries (user_id, entry_type);
