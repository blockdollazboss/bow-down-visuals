-- Sponsor invoices: creators bill landed brand deals with a branded PDF.
-- PDF is rendered server-side from the row at download time (no blob
-- storage). Amounts in minor units (cents). Idempotent.
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  brand_email TEXT,
  creator_name TEXT NOT NULL,
  creator_email TEXT,
  payment_details TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  due_date TIMESTAMPTZ NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_user_invoice_number_uidx
  ON invoices (user_id, invoice_number);
CREATE INDEX IF NOT EXISTS invoices_user_id_idx
  ON invoices (user_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx
  ON invoices (status);
