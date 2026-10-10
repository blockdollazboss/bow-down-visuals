-- Thy Books — print-on-demand orders via Lulu.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS book_print_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  /* Lulu print-job id (numeric). Null until the order is submitted. */
  lulu_print_job_id TEXT,
  /* Our idempotency key sent as external_id to Lulu. */
  external_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'quoted',
  /* quote | submitted | in_production | shipped | canceled | failed */
  pod_package_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  page_count INTEGER,
  /* Snapshot of the quote (print cost, shipping options) at order time. */
  quote JSONB DEFAULT '{}'::jsonb,
  /* Shipping address snapshot (PII — only the owner + admins may read). */
  shipping_address JSONB DEFAULT '{}'::jsonb,
  shipping_level TEXT,
  contact_email TEXT,
  /* R2 URLs of the PDFs sent to Lulu. */
  interior_pdf_url TEXT,
  cover_pdf_url TEXT,
  /* Tracking info from Lulu status endpoint. */
  tracking JSONB DEFAULT '{}'::jsonb,
  /* Amount the user paid (cents USD), and how (stripe | visual_bucs). */
  amount_cents INTEGER,
  payment_method TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS book_print_orders_book_id_idx ON book_print_orders (book_id);
CREATE INDEX IF NOT EXISTS book_print_orders_user_id_idx ON book_print_orders (user_id);
CREATE INDEX IF NOT EXISTS book_print_orders_lulu_job_idx ON book_print_orders (lulu_print_job_id);
